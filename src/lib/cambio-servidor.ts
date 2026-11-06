/**
 * Câmbio no servidor (E6, parte A, 05/11/2026). A regra pura mora em
 * ./cambio.ts.
 *
 * - CAMBIO_SCHEMA_SQL: cache global de cotações e índices, estado das fontes
 *   (disjuntor), cofre do Super Admin para segredos da plataforma, variações
 *   cambiais por agência e a trava que impede trocar a moeda de uma conta
 *   bancária que já tem movimento.
 * - atualizarCotacoes(): UMA consulta global (a tarefa de 15 min chama),
 *   cliente HTTP injetável (os testes nunca chamam a internet).
 * - lerPainelDeCambio(): o que as telas leem (só o cache).
 * - segredos da plataforma: a chave da AwesomeAPI, cifrada (./cofre).
 *
 * As tabelas de cotação e de estado das fontes não têm tenant_id de
 * propósito: são as mesmas para todas as agências (uma consulta só).
 */
import type { ExecutorSQL } from './caixa-atomico';
import { cifrar, cofreDisponivel, decifrar, mascarar } from './cofre';
import {
  FALHAS_PARA_ABRIR_FONTE, MOEDAS_ESTRANGEIRAS, MOEDAS_TURISMO, SERIES_SGS, ErroDeFonte,
  diaDeBrasilia, fonteEmPausa, lerRespostaAwesome, lerRespostaPtax, lerSerieSgs, precisaConsultarIndices,
  precisaConsultarPtax, proximoEstadoDaFonte, urlAwesomeTurismo, urlPtaxPeriodo, urlSgsUltimos,
  type CodigoIndice, type CodigoMoeda, type Cotacao, type EstadoDaFonte, type NomeDaFonte, type ValorDeIndice,
} from './cambio';
import { janelaDeMinutos, type DefinicaoTarefa } from './agendador/nucleo';
import { addDias } from './money';

export const CAMBIO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS cotacoes_cambio (
    id BIGSERIAL PRIMARY KEY,
    tipo TEXT NOT NULL,
    codigo TEXT NOT NULL,
    fonte TEXT NOT NULL,
    referencia TEXT NOT NULL,
    compra NUMERIC(18,8),
    venda NUMERIC(18,8),
    valor NUMERIC(18,8),
    cotado_em TIMESTAMPTZ NOT NULL,
    obtido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (tipo, codigo, fonte, referencia)
  );
  CREATE INDEX IF NOT EXISTS idx_cotacoes_cambio_ultima ON cotacoes_cambio (tipo, codigo, cotado_em DESC);

  CREATE TABLE IF NOT EXISTS cambio_fontes_estado (
    fonte TEXT PRIMARY KEY,
    falhas_seguidas INTEGER NOT NULL DEFAULT 0,
    aberto_ate TIMESTAMPTZ,
    ultimo_erro TEXT,
    ultimo_sucesso TIMESTAMPTZ,
    ultima_tentativa TIMESTAMPTZ,
    sem_chave BOOLEAN NOT NULL DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS segredos_plataforma (
    nome TEXT PRIMARY KEY,
    envelope JSONB NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_por TEXT
  );

  CREATE TABLE IF NOT EXISTS variacoes_cambiais (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    baixa_id TEXT NOT NULL,
    estorna_id TEXT,
    titulo_tabela TEXT NOT NULL,
    titulo_id TEXT NOT NULL,
    data DATE NOT NULL,
    moeda TEXT NOT NULL,
    valor_moeda_centavos BIGINT NOT NULL,
    cambio_lancado NUMERIC(18,8) NOT NULL,
    cambio_pago NUMERIC(18,8) NOT NULL,
    variacao_centavos BIGINT NOT NULL,
    resultado_centavos BIGINT NOT NULL,
    cambio_origem TEXT,
    cambio_fonte TEXT,
    cambio_cotado_em TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_variacoes_titulo ON variacoes_cambiais (tenant_id, titulo_tabela, titulo_id);
  CREATE INDEX IF NOT EXISTS idx_variacoes_data ON variacoes_cambiais (tenant_id, data);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_variacoes_baixa ON variacoes_cambiais (tenant_id, baixa_id) WHERE estorna_id IS NULL;

  -- Conta bancária: a moeda não muda depois que a conta tem movimento (o
  -- saldo e o razão dela estão naquela moeda). Conta sem movimento muda livre.
  CREATE OR REPLACE FUNCTION fin_moeda_da_conta_fixa() RETURNS trigger LANGUAGE plpgsql AS $fn$
  DECLARE
    v_antes TEXT := COALESCE(NULLIF(OLD.data->>'moeda', ''), 'BRL');
    v_depois TEXT := COALESCE(NULLIF(NEW.data->>'moeda', ''), 'BRL');
    v_atual NUMERIC := CASE WHEN OLD.data->>'saldo_atual' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (OLD.data->>'saldo_atual')::numeric ELSE 0 END;
    v_inicial NUMERIC := CASE WHEN OLD.data->>'saldo_inicial' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (OLD.data->>'saldo_inicial')::numeric ELSE 0 END;
  BEGIN
    IF v_antes IS NOT DISTINCT FROM v_depois THEN RETURN NEW; END IF;
    IF v_atual <> v_inicial
       OR EXISTS (SELECT 1 FROM transferencias t WHERE t.tenant_id = OLD.tenant_id
                   AND (t.conta_origem_id = OLD.id OR t.conta_destino_id = OLD.id) AND COALESCE(t.data->>'status', '') = 'EFETIVADA')
       OR EXISTS (SELECT 1 FROM contas_pagar p WHERE p.tenant_id = OLD.tenant_id AND p.data->>'conta_bancaria_id' = OLD.id
                   AND COALESCE(p.data->>'status', '') IN ('PAGO', 'PARCIAL'))
       OR EXISTS (SELECT 1 FROM contas_receber r WHERE r.tenant_id = OLD.tenant_id AND r.data->>'conta_bancaria_id' = OLD.id
                   AND COALESCE(r.data->>'status', '') IN ('RECEBIDO', 'PARCIAL'))
    THEN
      RAISE EXCEPTION 'A moeda desta conta não pode mudar: ela já tem movimento. Crie outra conta na moeda nova.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END
  $fn$;
  DO $do$ BEGIN
    IF to_regclass('public.contas_bancarias') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'fin_moeda_da_conta_fixa' AND tgrelid = 'public.contas_bancarias'::regclass
    ) THEN
      CREATE TRIGGER fin_moeda_da_conta_fixa BEFORE UPDATE ON contas_bancarias
        FOR EACH ROW EXECUTE FUNCTION fin_moeda_da_conta_fixa();
    END IF;
  END $do$;
`;

// ---------------------------------------------------------------------------
// Cliente HTTP (injetável: os testes passam respostas simuladas)
// ---------------------------------------------------------------------------

export interface RespostaHttp {
  status: number;
  json(): Promise<unknown>;
}
export type ClienteHttp = (url: string, init: { headers: Record<string, string> }) => Promise<RespostaHttp>;

/** fetch com tempo-limite de 10 s (uma fonte lenta não segura a tarefa). */
export const clienteHttpPadrao: ClienteHttp = async (url, init) => {
  const r = await fetch(url, { headers: init.headers, signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  return { status: r.status, json: () => r.json() };
};

function erroDoStatus(fonte: NomeDaFonte, status: number): string {
  if (status === 401 || status === 403) return `${fonte}: a chave foi recusada (HTTP ${status}). Confira a chave no cofre do Super Admin.`;
  if (status === 429) return `${fonte}: limite de chamadas atingido (HTTP 429).`;
  return `${fonte}: resposta HTTP ${status}.`;
}

async function pedirJson(http: ClienteHttp, fonte: NomeDaFonte, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const r = await http(url, { headers: { Accept: 'application/json', 'User-Agent': 'EnturOS-Financeiro/1.0', ...headers } });
  if (r.status < 200 || r.status >= 300) throw new ErroDeFonte(erroDoStatus(fonte, r.status));
  try {
    return await r.json();
  } catch {
    throw new ErroDeFonte(`${fonte}: a resposta não é JSON.`);
  }
}

// ---------------------------------------------------------------------------
// Cofre do Super Admin (segredos da plataforma, não de uma agência)
// ---------------------------------------------------------------------------

export const SEGREDO_AWESOMEAPI = 'awesomeapi';
export const SEGREDOS_CONHECIDOS: Record<string, { nome: string; ajuda: string }> = {
  [SEGREDO_AWESOMEAPI]: {
    nome: 'Chave da AwesomeAPI (câmbio turismo)',
    ajuda: 'Chave própria do Financeiro, criada em awesomeapi.com.br. Sem ela o câmbio turismo não é consultado; a PTAX e os índices do Banco Central continuam.',
  },
};

export class ErroCofrePlataforma extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'ErroCofrePlataforma';
  }
}

/** Segredo decifrado (só no servidor). null = não cadastrado ou ilegível. */
export async function lerSegredoPlataforma(exec: ExecutorSQL, nome: string): Promise<string | null> {
  const { rows } = await exec.query(`SELECT envelope FROM segredos_plataforma WHERE nome = $1`, [nome]);
  if (!rows.length) return null;
  try {
    const v = decifrar(rows[0].envelope);
    return v || null;
  } catch (e) {
    console.error(`[cambio] segredo ${nome} não decifrou:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export interface SituacaoDoSegredo {
  nome: string;
  rotulo: string;
  ajuda: string;
  definida: boolean;
  mascara: string;
  legivel: boolean;
  atualizado_em: string | null;
  atualizado_por: string | null;
  cofre_disponivel: boolean;
}

/** O que a tela do Super Admin vê: máscara, nunca o segredo. */
export async function situacaoDosSegredos(exec: ExecutorSQL): Promise<SituacaoDoSegredo[]> {
  const { rows } = await exec.query(`SELECT nome, envelope, atualizado_em::text AS em, atualizado_por FROM segredos_plataforma`);
  const porNome = new Map(rows.map(r => [String(r.nome), r]));
  return Object.entries(SEGREDOS_CONHECIDOS).map(([nome, info]) => {
    const r = porNome.get(nome);
    let valor = '';
    let legivel = true;
    if (r) {
      try { valor = decifrar(r.envelope); } catch { legivel = false; }
    }
    return {
      nome, rotulo: info.nome, ajuda: info.ajuda,
      definida: !!r, mascara: valor ? mascarar(valor) : '', legivel,
      atualizado_em: r ? String(r.em) : null, atualizado_por: r ? ((r.atualizado_por as string | null) ?? null) : null,
      cofre_disponivel: cofreDisponivel(),
    };
  });
}

/** Grava (ou apaga, com valor vazio) um segredo da plataforma. Sempre cifrado. */
export async function salvarSegredoPlataforma(exec: ExecutorSQL, nome: string, valor: string, quem: string): Promise<void> {
  if (!SEGREDOS_CONHECIDOS[nome]) throw new ErroCofrePlataforma('Segredo desconhecido.');
  const v = (valor ?? '').trim();
  if (!v) {
    await exec.query(`DELETE FROM segredos_plataforma WHERE nome = $1`, [nome]);
    return;
  }
  if (v.includes('•')) throw new ErroCofrePlataforma('Cole a chave inteira; a máscara não é a chave.');
  if (v.length < 8 || v.length > 300 || /\s/.test(v)) throw new ErroCofrePlataforma('Essa chave não parece válida (sem espaços, de 8 a 300 caracteres).');
  // Segredo da plataforma nunca vai em texto puro: sem a chave mestra, recusa.
  if (!cofreDisponivel()) throw new ErroCofrePlataforma('O cofre está sem a chave mestra (INTEGRACOES_MASTER_KEY). Nada foi gravado.', 503);
  await exec.query(
    `INSERT INTO segredos_plataforma (nome, envelope, atualizado_em, atualizado_por) VALUES ($1, $2::jsonb, NOW(), $3)
     ON CONFLICT (nome) DO UPDATE SET envelope = EXCLUDED.envelope, atualizado_em = NOW(), atualizado_por = EXCLUDED.atualizado_por`,
    [nome, JSON.stringify(cifrar(v)), quem.slice(0, 200)],
  );
  // Chave nova: a fonte sai da pausa e tenta na próxima janela.
  if (nome === SEGREDO_AWESOMEAPI) {
    await exec.query(`UPDATE cambio_fontes_estado SET falhas_seguidas = 0, aberto_ate = NULL, sem_chave = FALSE WHERE fonte = 'awesomeapi'`);
  }
}

// ---------------------------------------------------------------------------
// Estado das fontes
// ---------------------------------------------------------------------------

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(String(v)).toISOString());

export async function lerEstadosDasFontes(exec: ExecutorSQL): Promise<EstadoDaFonte[]> {
  const { rows } = await exec.query(
    `SELECT fonte, falhas_seguidas, aberto_ate::text AS aberto_ate, ultimo_erro, ultimo_sucesso::text AS ultimo_sucesso,
            ultima_tentativa::text AS ultima_tentativa, sem_chave FROM cambio_fontes_estado ORDER BY fonte`,
  );
  return rows.map(r => ({
    fonte: String(r.fonte) as NomeDaFonte, falhas_seguidas: Number(r.falhas_seguidas ?? 0),
    aberto_ate: iso(r.aberto_ate), ultimo_erro: (r.ultimo_erro as string | null) ?? null,
    ultimo_sucesso: iso(r.ultimo_sucesso), ultima_tentativa: iso(r.ultima_tentativa), sem_chave: Boolean(r.sem_chave),
  }));
}

async function gravarEstado(exec: ExecutorSQL, e: EstadoDaFonte): Promise<void> {
  await exec.query(
    `INSERT INTO cambio_fontes_estado (fonte, falhas_seguidas, aberto_ate, ultimo_erro, ultimo_sucesso, ultima_tentativa, sem_chave)
     VALUES ($1, $2, $3::timestamptz, $4, $5::timestamptz, $6::timestamptz, $7)
     ON CONFLICT (fonte) DO UPDATE SET falhas_seguidas = EXCLUDED.falhas_seguidas, aberto_ate = EXCLUDED.aberto_ate,
       ultimo_erro = EXCLUDED.ultimo_erro, ultimo_sucesso = EXCLUDED.ultimo_sucesso,
       ultima_tentativa = EXCLUDED.ultima_tentativa, sem_chave = EXCLUDED.sem_chave`,
    [e.fonte, e.falhas_seguidas, e.aberto_ate, e.ultimo_erro, e.ultimo_sucesso, e.ultima_tentativa, Boolean(e.sem_chave)],
  );
}

// ---------------------------------------------------------------------------
// Gravação no cache
// ---------------------------------------------------------------------------

async function gravarCotacoes(exec: ExecutorSQL, cotacoes: readonly Cotacao[]): Promise<number> {
  let n = 0;
  for (const c of cotacoes) {
    // Turismo: a referência é o próprio horário da fonte (cada cotação nova é
    // uma linha; a mesma repetida só atualiza "conferido em").
    const referencia = c.tipo === 'turismo' ? c.cotado_em : c.referencia;
    await exec.query(
      `INSERT INTO cotacoes_cambio (tipo, codigo, fonte, referencia, compra, venda, cotado_em, obtido_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
       ON CONFLICT (tipo, codigo, fonte, referencia) DO UPDATE SET obtido_em = EXCLUDED.obtido_em`,
      [c.tipo, c.moeda, c.fonte, referencia, c.compra, c.venda, c.cotado_em, c.obtido_em],
    );
    n++;
  }
  return n;
}

async function gravarIndices(exec: ExecutorSQL, valores: readonly ValorDeIndice[], obtidoEm: Date): Promise<number> {
  for (const v of valores) {
    // Mês em curso muda de valor ao longo do mês: atualiza a linha.
    const cotado = v.referencia.length === 7 ? `${v.referencia}-01T12:00:00Z` : `${v.referencia}T12:00:00Z`;
    await exec.query(
      `INSERT INTO cotacoes_cambio (tipo, codigo, fonte, referencia, valor, cotado_em, obtido_em, dados)
       VALUES ('indice', $1, 'bcb_sgs', $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)
       ON CONFLICT (tipo, codigo, fonte, referencia) DO UPDATE SET valor = EXCLUDED.valor, obtido_em = EXCLUDED.obtido_em, dados = EXCLUDED.dados`,
      [v.indice, v.referencia, v.valor, cotado, obtidoEm.toISOString(), JSON.stringify(v.parcial ? { parcial: true } : {})],
    );
  }
  return valores.length;
}

// ---------------------------------------------------------------------------
// A consulta global (a tarefa de 15 min)
// ---------------------------------------------------------------------------

export interface OpcoesAtualizacao {
  http?: ClienteHttp;
  agora?: Date;
  /** Chave da AwesomeAPI (padrão: a do cofre do Super Admin). */
  chaveAwesome?: string | null;
  moedasPtax?: readonly CodigoMoeda[];
}

export interface ResumoDaAtualizacao {
  awesomeapi: 'ok' | 'sem_chave' | 'em_pausa' | 'falhou';
  bcb_ptax: 'ok' | 'em_dia' | 'em_pausa' | 'falhou' | 'parcial';
  bcb_sgs: 'ok' | 'em_dia' | 'em_pausa' | 'falhou' | 'parcial';
  gravadas: number;
  chamadas: number;
  erros: string[];
}

/**
 * Consulta as fontes que estão devendo e grava no cache. Uma fonte que falha
 * não impede as outras e nunca é trocada por outra: ela só fica sem
 * atualização, com o erro e a pausa registrados.
 */
export async function atualizarCotacoes(exec: ExecutorSQL, opcoes: OpcoesAtualizacao = {}): Promise<ResumoDaAtualizacao> {
  const http = opcoes.http ?? clienteHttpPadrao;
  const agora = opcoes.agora ?? new Date();
  const hoje = diaDeBrasilia(agora);
  const estados = new Map((await lerEstadosDasFontes(exec)).map(e => [e.fonte, e]));
  const resumo: ResumoDaAtualizacao = { awesomeapi: 'ok', bcb_ptax: 'ok', bcb_sgs: 'ok', gravadas: 0, chamadas: 0, erros: [] };
  const registrar = async (fonte: NomeDaFonte, r: { ok: true } | { ok: false; erro: string }) => {
    const novo = proximoEstadoDaFonte(estados.get(fonte) ?? null, fonte, r, agora);
    estados.set(fonte, novo);
    await gravarEstado(exec, novo);
  };

  // 1) Turismo: uma chamada para todos os pares, com a chave do Financeiro.
  const chave = opcoes.chaveAwesome !== undefined ? opcoes.chaveAwesome : await lerSegredoPlataforma(exec, SEGREDO_AWESOMEAPI);
  const estAw = estados.get('awesomeapi') ?? null;
  if (!chave) {
    resumo.awesomeapi = 'sem_chave';
    const e: EstadoDaFonte = {
      ...(estAw ?? { fonte: 'awesomeapi', falhas_seguidas: 0, aberto_ate: null, ultimo_erro: null, ultimo_sucesso: null, ultima_tentativa: null }),
      sem_chave: true,
    };
    estados.set('awesomeapi', e);
    await gravarEstado(exec, e);
  } else if (fonteEmPausa(estAw, agora)) {
    resumo.awesomeapi = 'em_pausa';
  } else {
    try {
      resumo.chamadas++;
      const json = await pedirJson(http, 'awesomeapi', urlAwesomeTurismo(MOEDAS_TURISMO), { 'x-api-key': chave });
      resumo.gravadas += await gravarCotacoes(exec, lerRespostaAwesome(json, agora));
      await registrar('awesomeapi', { ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resumo.awesomeapi = 'falhou';
      resumo.erros.push(msg);
      await registrar('awesomeapi', { ok: false, erro: msg });
    }
  }

  // 2) PTAX: só quando falta o fechamento esperado; uma chamada por moeda.
  const moedasPtax = opcoes.moedasPtax ?? MOEDAS_ESTRANGEIRAS;
  const estPtax = estados.get('bcb_ptax') ?? null;
  const { rows: ult } = await exec.query(
    `SELECT MIN(r) AS r FROM (SELECT codigo, MAX(referencia) AS r FROM cotacoes_cambio WHERE tipo = 'ptax' AND codigo = ANY($1::text[]) GROUP BY codigo) x`,
    [moedasPtax as unknown as string[]],
  );
  const { rows: qtd } = await exec.query(`SELECT COUNT(DISTINCT codigo)::int AS n FROM cotacoes_cambio WHERE tipo = 'ptax' AND codigo = ANY($1::text[])`, [moedasPtax as unknown as string[]]);
  const ultimaPtax = Number(qtd[0]?.n ?? 0) < moedasPtax.length ? null : ((ult[0]?.r as string | null) ?? null);
  if (fonteEmPausa(estPtax, agora)) {
    resumo.bcb_ptax = 'em_pausa';
  } else if (!precisaConsultarPtax(ultimaPtax, estPtax?.ultima_tentativa ?? null, agora)) {
    resumo.bcb_ptax = 'em_dia';
  } else {
    const de = addDias(hoje, -7);
    let falhas = 0;
    let ultimoErro = '';
    for (const moeda of moedasPtax) {
      try {
        resumo.chamadas++;
        const json = await pedirJson(http, 'bcb_ptax', urlPtaxPeriodo(moeda, de, hoje));
        resumo.gravadas += await gravarCotacoes(exec, lerRespostaPtax(json, moeda, agora));
      } catch (e) {
        falhas++;
        ultimoErro = e instanceof Error ? e.message : String(e);
      }
    }
    if (falhas === 0) await registrar('bcb_ptax', { ok: true });
    else {
      resumo.bcb_ptax = falhas === moedasPtax.length ? 'falhou' : 'parcial';
      resumo.erros.push(ultimoErro);
      await registrar('bcb_ptax', { ok: false, erro: `${falhas} de ${moedasPtax.length} moedas: ${ultimoErro}` });
    }
  }

  // 3) Índices: uma vez a cada 12 horas; uma chamada por série.
  const estSgs = estados.get('bcb_sgs') ?? null;
  if (fonteEmPausa(estSgs, agora)) {
    resumo.bcb_sgs = 'em_pausa';
  } else if (!precisaConsultarIndices(estSgs?.ultimo_sucesso ?? null, estSgs?.ultima_tentativa ?? null, agora)) {
    resumo.bcb_sgs = 'em_dia';
  } else {
    let falhas = 0;
    let ultimoErro = '';
    const series = Object.keys(SERIES_SGS) as CodigoIndice[];
    for (const indice of series) {
      try {
        resumo.chamadas++;
        const n = SERIES_SGS[indice].periodicidade === 'mensal' ? 14 : 10;
        const json = await pedirJson(http, 'bcb_sgs', urlSgsUltimos(SERIES_SGS[indice].codigo, n));
        resumo.gravadas += await gravarIndices(exec, lerSerieSgs(json, indice, hoje), agora);
      } catch (e) {
        falhas++;
        ultimoErro = e instanceof Error ? e.message : String(e);
      }
    }
    if (falhas === 0) await registrar('bcb_sgs', { ok: true });
    else {
      resumo.bcb_sgs = falhas === series.length ? 'falhou' : 'parcial';
      resumo.erros.push(ultimoErro);
      await registrar('bcb_sgs', { ok: false, erro: `${falhas} de ${series.length} séries: ${ultimoErro}` });
    }
  }
  return resumo;
}

// ---------------------------------------------------------------------------
// Leitura (as telas leem só daqui)
// ---------------------------------------------------------------------------

export interface PainelDeCambio {
  agora: string;
  /** A mais recente de cada (tipo, moeda). */
  cotacoes: Cotacao[];
  /** Últimos valores de cada índice (até 14 por índice). */
  indices: ValorDeIndice[];
  fontes: EstadoDaFonte[];
  /** Histórico curto por moeda (mais recente primeiro), quando pedido. */
  historico?: Cotacao[];
  limite_falhas: number;
}

function linhaParaCotacao(r: Record<string, unknown>): Cotacao {
  const cotado = new Date(String(r.cotado_em)).toISOString();
  return {
    tipo: String(r.tipo) as Cotacao['tipo'], moeda: String(r.codigo) as CodigoMoeda, fonte: String(r.fonte) as NomeDaFonte,
    compra: Number(r.compra), venda: Number(r.venda), cotado_em: cotado,
    obtido_em: new Date(String(r.obtido_em)).toISOString(),
    referencia: r.tipo === 'ptax' ? String(r.referencia) : diaDeBrasilia(new Date(cotado)),
  };
}

export async function lerPainelDeCambio(
  exec: ExecutorSQL,
  opcoes: { agora?: Date; historico?: { moeda?: string; por_moeda?: number } } = {},
): Promise<PainelDeCambio> {
  const agora = opcoes.agora ?? new Date();
  const { rows: ult } = await exec.query(
    `SELECT DISTINCT ON (tipo, codigo) tipo, codigo, fonte, referencia, compra, venda, cotado_em::text AS cotado_em, obtido_em::text AS obtido_em
       FROM cotacoes_cambio WHERE tipo IN ('turismo', 'ptax')
      ORDER BY tipo, codigo, cotado_em DESC`,
  );
  const { rows: ind } = await exec.query(
    `SELECT codigo, referencia, valor, dados FROM (
        SELECT codigo, referencia, valor, dados, ROW_NUMBER() OVER (PARTITION BY codigo ORDER BY referencia DESC) AS n
          FROM cotacoes_cambio WHERE tipo = 'indice') x
      WHERE n <= 14 ORDER BY codigo, referencia`,
  );
  const painel: PainelDeCambio = {
    agora: agora.toISOString(),
    cotacoes: ult.map(linhaParaCotacao),
    indices: ind.map(r => ({
      indice: String(r.codigo) as CodigoIndice, referencia: String(r.referencia), valor: Number(r.valor),
      ...((r.dados as Record<string, unknown> | null)?.parcial ? { parcial: true } : {}),
    })),
    fontes: await lerEstadosDasFontes(exec),
    limite_falhas: FALHAS_PARA_ABRIR_FONTE,
  };
  if (opcoes.historico) {
    const n = Math.min(60, Math.max(1, Math.floor(opcoes.historico.por_moeda ?? 12)));
    const moeda = opcoes.historico.moeda ? String(opcoes.historico.moeda).toUpperCase() : null;
    const { rows: h } = await exec.query(
      `SELECT tipo, codigo, fonte, referencia, compra, venda, cotado_em::text AS cotado_em, obtido_em::text AS obtido_em FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY tipo, codigo ORDER BY cotado_em DESC) AS n
            FROM cotacoes_cambio WHERE tipo IN ('turismo', 'ptax') AND ($1::text IS NULL OR codigo = $1)) x
        WHERE n <= $2 ORDER BY codigo, tipo, cotado_em DESC`,
      [moeda, n],
    );
    painel.historico = h.map(linhaParaCotacao);
  }
  return painel;
}

// ---------------------------------------------------------------------------
// Variações cambiais da agência (para o resultado e para a tela)
// ---------------------------------------------------------------------------

export interface LinhaDeVariacao {
  titulo_tabela: 'contas_receber' | 'contas_pagar';
  titulo_id: string;
  baixa_id: string;
  data: string;
  moeda: string;
  valor_moeda: number;
  cambio_lancado: number;
  cambio_pago: number;
  /** Quanto o título mudou em reais. */
  variacao: number;
  /** + ganho, − perda. */
  resultado: number;
  estorno: boolean;
}

/** Variações (e estornos delas), todas, da agência. */
export async function variacoesDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<LinhaDeVariacao[]> {
  try {
    const { rows } = await exec.query(
      `SELECT titulo_tabela, titulo_id, baixa_id, data::text AS data, moeda, valor_moeda_centavos, cambio_lancado, cambio_pago,
              variacao_centavos, resultado_centavos, estorna_id
         FROM variacoes_cambiais WHERE tenant_id = $1 ORDER BY data, criado_em`,
      [tenantId],
    );
    return rows.map(r => ({
      titulo_tabela: String(r.titulo_tabela) as LinhaDeVariacao['titulo_tabela'], titulo_id: String(r.titulo_id),
      baixa_id: String(r.baixa_id), data: String(r.data), moeda: String(r.moeda),
      valor_moeda: Number(r.valor_moeda_centavos) / 100, cambio_lancado: Number(r.cambio_lancado), cambio_pago: Number(r.cambio_pago),
      variacao: Number(r.variacao_centavos) / 100, resultado: Number(r.resultado_centavos) / 100, estorno: !!r.estorna_id,
    }));
  } catch {
    // Sem a tabela ainda: nenhuma variação (o resultado de antes).
    return [];
  }
}

// ---------------------------------------------------------------------------
// A tarefa (exportada; quem integra registra em agendador/tarefas.ts)
// ---------------------------------------------------------------------------

/**
 * Cotações e índices: uma consulta GLOBAL a cada 15 minutos (sem `agencias`:
 * o agendador roda uma vez por janela, para todas). O cliente HTTP é
 * injetável para os testes.
 */
export function criarTarefaCotacoes(http?: ClienteHttp): DefinicaoTarefa {
  return {
    nome: 'cambio-cotacoes',
    janela: janelaDeMinutos(15),
    executar: async ({ exec, agora }) => {
      const r = await atualizarCotacoes(exec, { agora, http });
      return { ...r, erros: r.erros.slice(0, 5) };
    },
  };
}

export const tarefaCotacoes: DefinicaoTarefa = criarTarefaCotacoes();
