/**
 * Recorrência no servidor (05/11/2026).
 *
 * Tudo aqui recebe um executor (a transação de quem chama) para rodar igual
 * em produção e no teste com Postgres real. Regras:
 *  - criar a série e os títulos acontece numa transação só; a mesma
 *    ocorrência nunca nasce duas vezes (INSERT ... ON CONFLICT DO NOTHING
 *    sobre o índice (tenant, serie_id, serie_ordem));
 *  - editar e encerrar só mexem em título EM ABERTO e SEM BAIXA; pago,
 *    recebido ou com baixa parcial fica como está e volta na lista de
 *    "intocados";
 *  - nada aqui move caixa: título sem baixa não tem dinheiro para estornar.
 */
import type { ExecutorSQL } from './caixa-atomico';
import { createContaPagar, createContaReceber } from './crm-types';
import { addMeses, dataSegura, deCentavos, num, paraBRL, paraCentavos, round2 } from './money';
import { horaDeBrasilia, janelaDiaria, type DefinicaoTarefa } from './agendador/nucleo';
import {
  ajustarVencimento, chaveDaCopia, descreverRegra, ehDataValida, LIMITE_GERACAO_IMEDIATA, lerRegra,
  ocorrenciasComValor, parcelarValor, podeCopiarConta, presetPorChave, proximasDatas, regraDoPreset,
  rotuloDoMes, separarSufixo, totalDeOcorrencias, tituloGeradoPeloSistema, tituloSemBaixa,
  type ChavePreset, type ModoSerie, type RegraRecorrencia, type TabelaAlvo,
} from './recorrencia';
import { brlEmCentavos, CAMPOS_DO_MODELO, idDoTitulo, limparModelo, montarTitulo } from './recorrencia-titulos';
import { CALENDARIO_NACIONAL } from './feriados';

export class ErroRecorrencia extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const TABELAS_ALVO: readonly TabelaAlvo[] = ['contas_pagar', 'contas_receber'];

export function lerTabela(v: unknown): TabelaAlvo {
  if (v === 'contas_pagar' || v === 'contas_receber') return v;
  throw new ErroRecorrencia('Diga se é conta a pagar ou a receber.');
}

const FIM_DOS_TEMPOS = '9999-12-31';

// ---------------------------------------------------------------------------
// Preparação (validação) e prévia
// ---------------------------------------------------------------------------

export interface SeriePreparada {
  id: string;
  tabela: TabelaAlvo;
  modo: ModoSerie;
  regra: RegraRecorrencia;
  inicio: string;
  /** Recorrente: valor de cada; parcelado: o total. Na moeda do título. */
  valorCentavos: number;
  modelo: Record<string, unknown>;
  horizonteMeses: number;
  total: number | null;
}

function novoId(): string {
  return `rec-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

/** Lê o corpo de "criar série" e devolve a série pronta ou um ErroRecorrencia. */
export function prepararSerie(corpo: Record<string, unknown>): SeriePreparada {
  const tabela = lerTabela(corpo.tabela);
  const modo: ModoSerie = corpo.tipo === 'parcelado' ? 'parcelado' : 'recorrente';
  const lida = lerRegra(corpo.regra, modo);
  if ('erro' in lida) throw new ErroRecorrencia(lida.erro);
  const inicio = String(corpo.inicio ?? '');
  if (!ehDataValida(inicio)) throw new ErroRecorrencia('Informe o primeiro vencimento.');
  if (lida.regra.fim.tipo === 'data' && (lida.regra.fim.data ?? '') < inicio) {
    throw new ErroRecorrencia('A data final precisa ser depois do primeiro vencimento.');
  }
  const valor = num(corpo.valor);
  if (!(valor > 0)) throw new ErroRecorrencia('O valor precisa ser maior que zero.');
  const modelo = limparModelo(tabela, corpo.modelo);
  if (!String(modelo.descricao ?? '').trim()) throw new ErroRecorrencia('Informe uma descrição.');
  if (tabela === 'contas_pagar' && modelo.moeda !== 'BRL' && modelo.moeda && !(num(modelo.cambio) > 0)) {
    throw new ErroRecorrencia('Informe o câmbio da moeda estrangeira.');
  }
  const horizonte = Math.floor(num(corpo.horizonte_meses) || 3);
  const id = typeof corpo.id === 'string' && /^[\w-]{6,64}$/.test(corpo.id) ? corpo.id : novoId();
  const total = totalDeOcorrencias(lida.regra, inicio);
  if (total === 0) throw new ErroRecorrencia('Com essa regra nenhuma data cai até o fim escolhido.');
  return {
    id, tabela, modo, regra: lida.regra, inicio, valorCentavos: paraCentavos(valor), modelo,
    horizonteMeses: Math.min(24, Math.max(1, horizonte)), total,
  };
}

/** Até quando gerar agora: tudo, se for curta; senão o horizonte a partir de hoje. */
export function limiteDeGeracao(s: Pick<SeriePreparada, 'inicio' | 'horizonteMeses' | 'total'>, hoje: string): string {
  if (s.total !== null && s.total <= LIMITE_GERACAO_IMEDIATA) return FIM_DOS_TEMPOS;
  const base = hoje > s.inicio ? hoje : s.inicio;
  return addMeses(base, s.horizonteMeses);
}

export interface ItemDaPrevia {
  ordem: number;
  vencimento: string;
  nominal: string;
  valor: number;
  aviso: string | null;
}

export interface PreviaDaSerie {
  descricao_regra: string;
  total: number | null;
  gerar_agora: number;
  soma: number | null;
  ocorrencias: ItemDaPrevia[];
  /** Série sem fim: as próximas nascem sozinhas, sempre N meses à frente. */
  proximas_sozinhas: boolean;
  horizonte_meses: number;
}

export function previaDaSerie(s: SeriePreparada, hoje: string, limiteItens = 60): PreviaDaSerie {
  const ate = limiteDeGeracao(s, hoje);
  const todas = ocorrenciasComValor({ modo: s.modo, regra: s.regra, inicio: s.inicio, valorCentavos: s.valorCentavos, ate });
  const finita = s.total !== null && s.total <= LIMITE_GERACAO_IMEDIATA;
  return {
    descricao_regra: descreverRegra(s.regra, s.inicio),
    total: s.total,
    gerar_agora: todas.length,
    soma: finita ? deCentavos(todas.reduce((a, o) => a + o.valor_centavos, 0)) : null,
    ocorrencias: todas.slice(0, limiteItens).map(o => ({
      ordem: o.ordem, vencimento: o.vencimento, nominal: o.nominal, valor: deCentavos(o.valor_centavos), aviso: o.aviso,
    })),
    proximas_sozinhas: !finita,
    horizonte_meses: s.horizonteMeses,
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface LinhaSerie {
  id: string;
  tenant_id: string;
  tabela: TabelaAlvo;
  modo: ModoSerie;
  modelo: Record<string, unknown>;
  regra: RegraRecorrencia;
  inicio: string;
  valorCentavos: number;
  horizonteMeses: number;
  geradoAte: string | null;
  ocorrenciasGeradas: number;
  status: 'ativa' | 'concluida' | 'encerrada';
  versao: number;
  ultimaChave: string | null;
}

function jsonDe(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

export async function carregarSerie(exec: ExecutorSQL, tenantId: string, id: string, travar = false): Promise<LinhaSerie | null> {
  const { rows } = await exec.query(
    `SELECT id, tenant_id, tabela_alvo, modo, modelo, regra, inicio::text AS inicio, valor_centavos::text AS valor_centavos,
            horizonte_meses, gerado_ate::text AS gerado_ate, ocorrencias_geradas, status, versao, ultima_chave
       FROM recorrencias WHERE id = $1 AND tenant_id = $2${travar ? ' FOR UPDATE' : ''}`,
    [id, tenantId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id), tenant_id: String(r.tenant_id), tabela: r.tabela_alvo as TabelaAlvo, modo: r.modo as ModoSerie,
    modelo: jsonDe(r.modelo), regra: jsonDe(r.regra) as unknown as RegraRecorrencia, inicio: String(r.inicio).slice(0, 10),
    valorCentavos: Number(r.valor_centavos), horizonteMeses: Number(r.horizonte_meses),
    geradoAte: r.gerado_ate ? String(r.gerado_ate).slice(0, 10) : null, ocorrenciasGeradas: Number(r.ocorrencias_geradas),
    status: r.status as LinhaSerie['status'], versao: Number(r.versao), ultimaChave: r.ultima_chave ? String(r.ultima_chave) : null,
  };
}

export interface ResumoDaSerie {
  id: string;
  tabela: TabelaAlvo;
  modo: ModoSerie;
  regra: RegraRecorrencia;
  descricao_regra: string;
  inicio: string;
  valor: number;
  total: number | null;
  ocorrencias_geradas: number;
  gerado_ate: string | null;
  status: LinhaSerie['status'];
  versao: number;
}

export function resumoDaSerie(s: LinhaSerie): ResumoDaSerie {
  return {
    id: s.id, tabela: s.tabela, modo: s.modo, regra: s.regra, descricao_regra: descreverRegra(s.regra, s.inicio),
    inicio: s.inicio, valor: deCentavos(s.valorCentavos), total: totalDeOcorrencias(s.regra, s.inicio),
    ocorrencias_geradas: s.ocorrenciasGeradas, gerado_ate: s.geradoAte, status: s.status, versao: s.versao,
  };
}

interface Titulo { id: string; data: Record<string, unknown> }

export async function titulosDaSerie(exec: ExecutorSQL, tabela: TabelaAlvo, tenantId: string, serieId: string, travar = false): Promise<Titulo[]> {
  const { rows } = await exec.query(
    `SELECT id, data FROM ${tabela}
      WHERE tenant_id = $1 AND data->>'serie_id' = $2
      ORDER BY COALESCE(NULLIF(data->>'serie_ordem', ''), '0')::int${travar ? ' FOR UPDATE' : ''}`,
    [tenantId, serieId],
  );
  return rows.map(r => ({ id: String(r.id), data: jsonDe(r.data) }));
}

// ---------------------------------------------------------------------------
// Gravação dos títulos
// ---------------------------------------------------------------------------

/** Insere títulos novos; o que já existe (mesmo id ou mesma ocorrência) fica. */
async function inserirTitulos(exec: ExecutorSQL, tabela: TabelaAlvo, tenantId: string, titulos: Record<string, unknown>[]): Promise<number> {
  let criados = 0;
  for (const t of titulos) {
    const json = JSON.stringify(t);
    const r = tabela === 'contas_pagar'
      ? await exec.query(
        `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at)
         VALUES ($1, $2, $3, 'PENDENTE', $4::jsonb, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [t.id, tenantId, String(t.fornecedor_id ?? ''), json])
      : await exec.query(
        `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at)
         VALUES ($1, $2, '', $3, 'PENDENTE', $4::jsonb, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [t.id, tenantId, String(t.cliente_id ?? ''), json]);
    criados += r.rowCount ?? 0;
  }
  return criados;
}

export interface TituloGerado { id: string; ordem: number; vencimento: string; valor: number }

/** Gera as ocorrências que faltam até `ate` (a série precisa estar travada). */
async function gerarOcorrencias(exec: ExecutorSQL, s: LinhaSerie, ate: string, hoje: string): Promise<{ criados: number; titulos: TituloGerado[] }> {
  const total = totalDeOcorrencias(s.regra, s.inicio);
  const ocorr = ocorrenciasComValor({ modo: s.modo, regra: s.regra, inicio: s.inicio, valorCentavos: s.valorCentavos, ate })
    .filter(o => o.ordem > s.ocorrenciasGeradas);
  if (ocorr.length === 0) return { criados: 0, titulos: [] };

  const n = s.regra.fim.ocorrencias ?? total ?? 0;
  const parcelado = s.modo === 'parcelado';
  // Parcelado em moeda estrangeira: o real também é dividido com resto na
  // última, para a soma em reais bater com o total convertido.
  const brlParcelas = parcelado ? parcelarValor(brlEmCentavos(s.tabela, s.modelo, s.valorCentavos), n) : null;
  const taxa = s.tabela === 'contas_receber' ? paraCentavos(num(s.modelo.taxa)) : 0;
  const taxaParcelas = parcelado && taxa ? parcelarValor(taxa, n) : null;

  const titulos = ocorr.map(o => montarTitulo({
    tabela: s.tabela, serieId: s.id, modo: s.modo, regra: s.regra, modelo: s.modelo, ordem: o.ordem,
    total,
    vencimento: o.vencimento, nominal: o.nominal, valorCentavos: o.valor_centavos,
    valorBrlCentavos: brlParcelas ? brlParcelas[o.ordem - 1] : brlEmCentavos(s.tabela, s.modelo, o.valor_centavos),
    taxaCentavos: taxaParcelas ? taxaParcelas[o.ordem - 1] : taxa,
    emissao: hoje, id: idDoTitulo(s.id, o.ordem),
  }) as unknown as Record<string, unknown>);

  const criados = await inserirTitulos(exec, s.tabela, s.tenant_id, titulos);
  const ultima = ocorr[ocorr.length - 1];
  const concluida = total !== null && ultima.ordem >= total;
  await exec.query(
    `UPDATE recorrencias SET ocorrencias_geradas = $3, gerado_ate = $4::date,
            status = CASE WHEN status = 'ativa' AND $5 THEN 'concluida' ELSE status END, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [s.id, s.tenant_id, ultima.ordem, ultima.nominal, concluida],
  );
  s.ocorrenciasGeradas = ultima.ordem;
  s.geradoAte = ultima.nominal;
  if (concluida && s.status === 'ativa') s.status = 'concluida';
  return {
    criados,
    titulos: ocorr.map(o => ({ id: idDoTitulo(s.id, o.ordem), ordem: o.ordem, vencimento: o.vencimento, valor: deCentavos(o.valor_centavos) })),
  };
}

// ---------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------

export interface ResultadoCriacao {
  serie: ResumoDaSerie;
  criados: number;
  ja_existia: boolean;
  titulos: TituloGerado[];
}

export async function criarSerieNoExecutor(exec: ExecutorSQL, tenantId: string, p: SeriePreparada, hoje: string): Promise<ResultadoCriacao> {
  const { rows } = await exec.query(
    `INSERT INTO recorrencias (id, tenant_id, tabela_alvo, modo, modelo, regra, inicio, valor_centavos, horizonte_meses)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::date, $8, $9)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [p.id, tenantId, p.tabela, p.modo, JSON.stringify(p.modelo), JSON.stringify(p.regra), p.inicio, p.valorCentavos, p.horizonteMeses],
  );
  const s = await carregarSerie(exec, tenantId, p.id, true);
  if (!s) throw new ErroRecorrencia('Não foi possível criar a repetição. Tente de novo.', 409);
  if (rows.length === 0) {
    // Mesmo pedido de novo (duplo clique, rede que repetiu): devolve o que já existe.
    const ja = await titulosDaSerie(exec, s.tabela, tenantId, s.id);
    return {
      serie: resumoDaSerie(s), criados: 0, ja_existia: true,
      titulos: ja.map(t => ({ id: t.id, ordem: num(t.data.serie_ordem), vencimento: String(t.data.data_vencimento ?? ''), valor: num(t.data.valor_original) })),
    };
  }
  const g = await gerarOcorrencias(exec, s, limiteDeGeracao(p, hoje), hoje);
  return { serie: resumoDaSerie(s), criados: g.criados, ja_existia: false, titulos: g.titulos };
}

/** Estende o horizonte de uma série viva (tarefa diária). */
export async function estenderHorizonteNoExecutor(exec: ExecutorSQL, tenantId: string, id: string, hoje: string): Promise<number> {
  const s = await carregarSerie(exec, tenantId, id, true);
  if (!s || s.status !== 'ativa') return 0;
  const ate = limiteDeGeracao({ inicio: s.inicio, horizonteMeses: s.horizonteMeses, total: totalDeOcorrencias(s.regra, s.inicio) }, hoje);
  const g = await gerarOcorrencias(exec, s, ate, hoje);
  return g.criados;
}

// ---------------------------------------------------------------------------
// Editar: só esta / esta e as próximas / todas
// ---------------------------------------------------------------------------

export type Escopo = 'so_esta' | 'esta_e_proximas' | 'todas';

export interface PedidoDeEdicao {
  escopo: Escopo;
  titulo_id: string;
  alteracoes: Record<string, unknown>;
  versao?: number;
  previa?: boolean;
}

export interface ResultadoEdicao {
  alterados: { id: string; ordem: number; vencimento: string }[];
  intocados: { id: string; ordem: number; motivo: string }[];
  versao: number;
}

function lerEscopo(v: unknown): Escopo {
  if (v === 'so_esta' || v === 'esta_e_proximas' || v === 'todas') return v;
  throw new ErroRecorrencia('Escolha: só esta, esta e as próximas, ou todas.');
}

/** Aplica as alterações num título (sem baixa). Puro. */
export function aplicarAlteracoes(
  tabela: TabelaAlvo,
  serie: Pick<LinhaSerie, 'regra'>,
  data: Record<string, unknown>,
  alteracoes: Record<string, unknown>,
  escopo: Escopo,
): Record<string, unknown> {
  const novo: Record<string, unknown> = { ...data };
  for (const campo of CAMPOS_DO_MODELO[tabela]) {
    if (campo === 'descricao' || alteracoes[campo] === undefined) continue;
    novo[campo] = alteracoes[campo];
  }
  if (typeof alteracoes.descricao === 'string') {
    if (escopo === 'so_esta') novo.descricao = alteracoes.descricao.trim();
    else {
      // Troca a parte do texto e mantém o "(3/12 — mensal)" de cada um.
      const atual = String(data.descricao ?? '');
      const sufixo = atual.slice(separarSufixo(atual).length);
      novo.descricao = `${separarSufixo(alteracoes.descricao.trim())}${sufixo}`;
    }
  }
  if (alteracoes.valor_original !== undefined) novo.valor_original = round2(num(alteracoes.valor_original));
  if (tabela === 'contas_pagar') {
    if (novo.moeda === 'BRL' || !novo.moeda) { novo.moeda = 'BRL'; novo.cambio = 1; }
    if (['valor_original', 'moeda', 'cambio'].some(c => alteracoes[c] !== undefined)) {
      const brl = paraBRL(num(novo.valor_original), String(novo.moeda), num(novo.cambio));
      novo.valor_final = brl;
      novo.valor_brl = brl;
    }
    if (alteracoes.forma_pagamento !== undefined && novo.forma_pagamento !== 'CARTAO_CORP') novo.cartao_id = null;
    if (alteracoes.fornecedor_nome !== undefined && String(alteracoes.fornecedor_nome).trim()) novo.fornecedor_pendente = false;
  } else if (alteracoes.valor_original !== undefined) {
    novo.valor_final = novo.valor_original;
  }
  if (escopo === 'so_esta' && ehDataValida(alteracoes.data_vencimento)) {
    novo.data_vencimento = alteracoes.data_vencimento;
  }
  const dia = Math.floor(num(alteracoes.dia_do_mes));
  if (escopo !== 'so_esta' && dia >= 1 && dia <= 31 && (serie.regra.frequencia === 'MES' || serie.regra.frequencia === 'ANO')) {
    const ref = String(data.serie_nominal || data.data_vencimento || '');
    if (ehDataValida(ref)) {
      const nominal = dataSegura(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)), dia);
      novo.serie_nominal = nominal;
      novo.data_vencimento = ajustarVencimento(nominal, serie.regra.feriado, CALENDARIO_NACIONAL);
    }
  }
  return novo;
}

export async function editarSerieNoExecutor(exec: ExecutorSQL, tenantId: string, serieId: string, pedido: PedidoDeEdicao): Promise<ResultadoEdicao> {
  const escopo = lerEscopo(pedido.escopo);
  const s = await carregarSerie(exec, tenantId, serieId, true);
  if (!s) throw new ErroRecorrencia('Repetição não encontrada.', 404);
  if (pedido.versao !== undefined && pedido.versao !== null && Number(pedido.versao) !== s.versao) {
    throw new ErroRecorrencia('Esta repetição foi alterada por outra pessoa enquanto você editava. Abra de novo.', 409);
  }
  const alteracoes = pedido.alteracoes && typeof pedido.alteracoes === 'object' ? pedido.alteracoes : {};
  if (Object.keys(alteracoes).length === 0) throw new ErroRecorrencia('Nada para alterar.');
  if (alteracoes.valor_original !== undefined && !(num(alteracoes.valor_original) > 0)) {
    throw new ErroRecorrencia('O valor precisa ser maior que zero.');
  }

  const titulos = await titulosDaSerie(exec, s.tabela, tenantId, s.id, true);
  const alvo = titulos.find(t => t.id === pedido.titulo_id);
  if (!alvo) throw new ErroRecorrencia('Esta conta não faz parte da repetição.', 404);
  const ordemAlvo = num(alvo.data.serie_ordem);
  const escolhidos = titulos.filter(t =>
    escopo === 'so_esta' ? t.id === alvo.id : escopo === 'esta_e_proximas' ? num(t.data.serie_ordem) >= ordemAlvo : true);

  const alterados: ResultadoEdicao['alterados'] = [];
  const intocados: ResultadoEdicao['intocados'] = [];
  const novos: Titulo[] = [];
  for (const t of escolhidos) {
    const ordem = num(t.data.serie_ordem);
    if (!tituloSemBaixa(s.tabela, t.data)) {
      intocados.push({ id: t.id, ordem, motivo: t.data.status === 'CANCELADO' ? 'cancelada' : 'já tem pagamento registrado' });
      continue;
    }
    const novo = aplicarAlteracoes(s.tabela, s, t.data, alteracoes, escopo);
    novos.push({ id: t.id, data: novo });
    alterados.push({ id: t.id, ordem, vencimento: String(novo.data_vencimento ?? '') });
  }
  if (pedido.previa) return { alterados, intocados, versao: s.versao };

  for (const t of novos) {
    if (s.tabela === 'contas_pagar') {
      await exec.query(
        `UPDATE contas_pagar SET data = $3::jsonb, fornecedor_id = $4, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [t.id, tenantId, JSON.stringify(t.data), String(t.data.fornecedor_id ?? '')]);
    } else {
      await exec.query(
        `UPDATE contas_receber SET data = $3::jsonb, cliente_id = $4, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [t.id, tenantId, JSON.stringify(t.data), String(t.data.cliente_id ?? '')]);
    }
  }

  let versao = s.versao;
  if (escopo !== 'so_esta') {
    // As próximas ocorrências (ainda não criadas) seguem a mudança.
    const modelo = { ...s.modelo, ...limparModelo(s.tabela, { ...s.modelo, ...alteracoes }) };
    if (typeof alteracoes.descricao === 'string') modelo.descricao = separarSufixo(alteracoes.descricao.trim());
    const regra: RegraRecorrencia = { ...s.regra };
    const dia = Math.floor(num(alteracoes.dia_do_mes));
    if (dia >= 1 && dia <= 31 && (regra.frequencia === 'MES' || regra.frequencia === 'ANO')) {
      regra.dia_do_mes = dia;
      delete regra.ultimo_dia_util;
    }
    const valor = s.modo === 'recorrente' && alteracoes.valor_original !== undefined ? paraCentavos(num(alteracoes.valor_original)) : s.valorCentavos;
    const { rows } = await exec.query(
      `UPDATE recorrencias SET modelo = $3::jsonb, regra = $4::jsonb, valor_centavos = $5, versao = versao + 1, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2 RETURNING versao`,
      [s.id, tenantId, JSON.stringify(modelo), JSON.stringify(regra), valor]);
    versao = Number(rows[0]?.versao ?? versao + 1);
  }
  return { alterados, intocados, versao };
}

// ---------------------------------------------------------------------------
// Encerrar
// ---------------------------------------------------------------------------

export interface ResultadoEncerramento {
  removidos: { id: string; ordem: number; vencimento: string; valor: number }[];
  mantidos: number;
  soma: number;
  status: LinhaSerie['status'];
}

export async function encerrarSerieNoExecutor(
  exec: ExecutorSQL, tenantId: string, serieId: string, opcoes: { aPartirDe: string; previa?: boolean },
): Promise<ResultadoEncerramento> {
  const s = await carregarSerie(exec, tenantId, serieId, true);
  if (!s) throw new ErroRecorrencia('Repetição não encontrada.', 404);
  const titulos = await titulosDaSerie(exec, s.tabela, tenantId, s.id, true);
  const remover = titulos.filter(t => tituloSemBaixa(s.tabela, t.data) && String(t.data.data_vencimento ?? '') >= opcoes.aPartirDe);
  const removidos = remover.map(t => ({
    id: t.id, ordem: num(t.data.serie_ordem), vencimento: String(t.data.data_vencimento ?? ''),
    valor: round2(num(t.data.valor_final)),
  }));
  const soma = deCentavos(removidos.reduce((a, r) => a + paraCentavos(r.valor), 0));
  if (opcoes.previa) return { removidos, mantidos: titulos.length - remover.length, soma, status: s.status };
  if (remover.length > 0) {
    await exec.query(`DELETE FROM ${s.tabela} WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, remover.map(t => t.id)]);
  }
  await exec.query(
    `UPDATE recorrencias SET status = 'encerrada', encerrada_em = COALESCE(encerrada_em, NOW()), versao = versao + 1, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`, [s.id, tenantId]);
  return { removidos, mantidos: titulos.length - remover.length, soma, status: 'encerrada' };
}

// ---------------------------------------------------------------------------
// Mais parcelas
// ---------------------------------------------------------------------------

export const MSG_MAIS_PARCELAS_RECUSADA = 'Esta conta veio de uma venda ou de uma fatura de cartão: as parcelas dela nascem da origem, não daqui.';

export interface PedidoMaisParcelas {
  tabela: TabelaAlvo;
  titulo_id: string;
  quantidade: number;
  periodicidade: ChavePreset;
  emissao_no_vencimento: boolean;
  previa?: boolean;
  /** Mesmo pedido repetido (duplo clique) não gera de novo. */
  chave?: string;
}

export interface ResultadoMaisParcelas {
  serie_id: string;
  parcelas: { id: string; ordem: number; vencimento: string; emissao: string; valor: number }[];
  criadas: number;
  ja_feito: boolean;
}

export async function maisParcelasNoExecutor(
  exec: ExecutorSQL, tenantId: string, pedido: PedidoMaisParcelas, hoje: string,
): Promise<ResultadoMaisParcelas> {
  const tabela = lerTabela(pedido.tabela);
  if (pedido.quantidade === undefined || pedido.quantidade === null || String(pedido.quantidade) === '') {
    throw new ErroRecorrencia('Diga quantas parcelas a mais.');
  }
  const qtd = Number(pedido.quantidade);
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > 120) throw new ErroRecorrencia('A quantidade vai de 1 a 120.');
  const preset = presetPorChave(String(pedido.periodicidade));
  if (!preset) throw new ErroRecorrencia('Escolha uma periodicidade da lista.');

  const { rows } = await exec.query(`SELECT id, data FROM ${tabela} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [pedido.titulo_id, tenantId]);
  if (!rows[0]) throw new ErroRecorrencia('Conta não encontrada.', 404);
  const origem = jsonDe(rows[0].data);
  if (tituloGeradoPeloSistema(tabela, origem)) throw new ErroRecorrencia(MSG_MAIS_PARCELAS_RECUSADA, 422);
  if (origem.status === 'CANCELADO') throw new ErroRecorrencia('Esta conta está cancelada.', 422);
  const venc = String(origem.data_vencimento ?? '');
  if (!ehDataValida(venc)) throw new ErroRecorrencia('A conta precisa ter vencimento para gerar parcelas.', 422);

  let serie = origem.serie_id ? await carregarSerie(exec, tenantId, String(origem.serie_id), true) : null;
  if (serie && serie.status === 'ativa' && serie.regra.fim.tipo === 'nunca') {
    throw new ErroRecorrencia('Esta conta já se repete sozinha até ser encerrada.', 422);
  }
  if (serie && pedido.chave && serie.ultimaChave === pedido.chave) {
    const existentes = await titulosDaSerie(exec, tabela, tenantId, serie.id);
    return { serie_id: serie.id, parcelas: [], criadas: 0, ja_feito: existentes.length > 0 };
  }

  let baseOrdem = 1;
  if (serie) {
    const { rows: m } = await exec.query(
      `SELECT COALESCE(MAX(COALESCE(NULLIF(data->>'serie_ordem', ''), '0')::int), 0) AS m FROM ${tabela}
        WHERE tenant_id = $1 AND data->>'serie_id' = $2`, [tenantId, serie.id]);
    baseOrdem = Math.max(1, Number(m[0]?.m ?? 1), serie.ocorrenciasGeradas);
  }
  const serieId = serie?.id ?? `pa-${pedido.titulo_id}`.slice(0, 64);
  const regra = regraDoPreset(preset.chave, { tipo: 'ocorrencias', ocorrencias: qtd + 1 });
  const datas = proximasDatas(regra, venc, FIM_DOS_TEMPOS).slice(1);
  const totalFinal = baseOrdem + qtd;
  const descricao = separarSufixo(String(origem.descricao ?? ''));
  const parcelas = datas.map((o, i) => {
    const ordem = baseOrdem + i + 1;
    return {
      id: idDoTitulo(serieId, ordem), ordem, vencimento: o.vencimento,
      emissao: pedido.emissao_no_vencimento ? o.vencimento : hoje,
      valor: round2(num(origem.valor_final)),
    };
  });
  if (pedido.previa) return { serie_id: serieId, parcelas, criadas: 0, ja_feito: false };

  if (!serie) {
    const modelo = limparModelo(tabela, origem);
    modelo.descricao = descricao;
    await exec.query(
      `INSERT INTO recorrencias (id, tenant_id, tabela_alvo, modo, modelo, regra, inicio, valor_centavos, ocorrencias_geradas, gerado_ate, status, ultima_chave)
       VALUES ($1, $2, $3, 'recorrente', $4::jsonb, $5::jsonb, $6::date, $7, $8, $9::date, 'concluida', $10)
       ON CONFLICT (id) DO NOTHING`,
      [serieId, tenantId, tabela, JSON.stringify(modelo), JSON.stringify(regra), venc,
        paraCentavos(num(origem.valor_original)), totalFinal, parcelas[parcelas.length - 1]?.vencimento ?? venc, pedido.chave ?? null]);
    const marcado = { ...origem, serie_id: serieId, serie_ordem: 1, serie_modo: 'recorrente', serie_nominal: venc, parcela_numero: 1, total_parcelas: totalFinal };
    await exec.query(`UPDATE ${tabela} SET data = $3::jsonb, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [pedido.titulo_id, tenantId, JSON.stringify(marcado)]);
    serie = await carregarSerie(exec, tenantId, serieId, true);
  } else {
    const novaRegra: RegraRecorrencia = serie.regra.fim.tipo === 'ocorrencias'
      ? { ...serie.regra, fim: { tipo: 'ocorrencias', ocorrencias: totalFinal } } : serie.regra;
    await exec.query(
      `UPDATE recorrencias SET ocorrencias_geradas = $3, regra = $4::jsonb, ultima_chave = $5, versao = versao + 1, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [serie.id, tenantId, totalFinal, JSON.stringify(novaRegra), pedido.chave ?? null]);
  }

  const limpos = parcelas.map(p => {
    const base: Record<string, unknown> = tabela === 'contas_pagar'
      ? { ...createContaPagar() } : { ...createContaReceber() };
    return {
      ...base,
      ...origem,
      id: p.id,
      descricao,
      data_emissao: p.emissao,
      data_vencimento: p.vencimento,
      status: 'PENDENTE',
      juros: 0, multa: 0, desconto: 0,
      ...(tabela === 'contas_pagar'
        ? { valor_pago: null, data_pagamento: null, comprovante: '' }
        : { valor_recebido: null, data_recebimento: null, boleto_emitido: false, boleto_codigo: '', boleto_url: '' }),
      conta_bancaria_id: null,
      anexos: [],
      parcela_numero: p.ordem,
      total_parcelas: totalFinal,
      serie_id: serieId,
      serie_ordem: p.ordem,
      serie_modo: 'recorrente',
      serie_nominal: p.vencimento,
      copia_chave: undefined,
    } as Record<string, unknown>;
  });
  const criadas = await inserirTitulos(exec, tabela, tenantId, limpos);
  return { serie_id: serie?.id ?? serieId, parcelas, criadas, ja_feito: false };
}

// ---------------------------------------------------------------------------
// Copiar mês
// ---------------------------------------------------------------------------

export interface PedidoCopiarMes {
  tabela: TabelaAlvo;
  mes_origem: string;
  mes_destino: string;
  previa?: boolean;
}

export interface ResultadoCopiarMes {
  quantidade: number;
  ja_copiadas: number;
  soma: number;
  copiadas: number;
  itens: { origem_id: string; id: string; descricao: string; pessoa: string; vencimento: string; valor: number }[];
}

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Valor em reais do título: valor_final, ou valor_brl quando não houver. */
function valorBrlDoTitulo(d: Record<string, unknown>): number {
  const final = num(d.valor_final);
  return final ? round2(final) : round2(num(d.valor_brl));
}

export async function copiarMesNoExecutor(exec: ExecutorSQL, tenantId: string, pedido: PedidoCopiarMes, hoje: string): Promise<ResultadoCopiarMes> {
  const tabela = lerTabela(pedido.tabela);
  if (!MES_RE.test(String(pedido.mes_origem)) || !MES_RE.test(String(pedido.mes_destino))) {
    throw new ErroRecorrencia('Escolha o mês de origem e o de destino.');
  }
  if (pedido.mes_origem === pedido.mes_destino) throw new ErroRecorrencia('O mês de destino precisa ser outro.');
  const { rows } = await exec.query(
    `SELECT id, data FROM ${tabela} WHERE tenant_id = $1 AND substr(data->>'data_vencimento', 1, 7) = $2 ORDER BY created_at DESC`,
    [tenantId, pedido.mes_origem]);
  const elegiveis = rows.map(r => ({ id: String(r.id), data: jsonDe(r.data) })).filter(t => podeCopiarConta(tabela, t.data));
  const chaves = elegiveis.map(t => chaveDaCopia(pedido.mes_destino, t.id));
  const { rows: ja } = chaves.length
    ? await exec.query(`SELECT data->>'copia_chave' AS c FROM ${tabela} WHERE tenant_id = $1 AND data->>'copia_chave' = ANY($2::text[])`, [tenantId, chaves])
    : { rows: [] as Record<string, unknown>[] };
  const jaCopiadas = new Set(ja.map(r => String(r.c)));
  const [anoDestino, mesDestino] = pedido.mes_destino.split('-').map(Number);

  const pendentes = elegiveis.filter(t => !jaCopiadas.has(chaveDaCopia(pedido.mes_destino, t.id)));
  const novas = pendentes.map(t => {
    const d = t.data;
    const dia = Number(String(d.data_vencimento ?? '').slice(8, 10)) || 1;
    const vencimento = dataSegura(anoDestino, mesDestino, dia);
    const id = `cp${pedido.mes_destino.replace('-', '')}-${t.id}`.slice(0, 120);
    const observacoes = `Copiado de ${rotuloDoMes(pedido.mes_origem)}`;
    const copia_chave = chaveDaCopia(pedido.mes_destino, t.id);
    if (tabela === 'contas_pagar') {
      const valorBrl = valorBrlDoTitulo(d);
      // Os mesmos campos que a tela sempre copiou.
      return {
        ...createContaPagar(), id,
        origem: d.origem, fornecedor_id: d.fornecedor_id, fornecedor_nome: d.fornecedor_nome, descricao: d.descricao,
        categoria_id: d.categoria_id, centro_custo: d.centro_custo, valor_original: round2(num(d.valor_original)),
        valor_final: valorBrl, moeda: d.moeda, cambio: d.cambio, valor_brl: valorBrl, data_vencimento: vencimento,
        forma_pagamento: d.forma_pagamento, natureza_custo: d.natureza_custo, is_custo_comercial: d.is_custo_comercial,
        observacoes, copia_chave, data_emissao: hoje,
      } as Record<string, unknown>;
    }
    const valor = round2(num(d.valor_final) || num(d.valor_original));
    return {
      ...createContaReceber(), id,
      origem: d.origem, cliente_id: d.cliente_id, cliente_nome: d.cliente_nome, descricao: d.descricao,
      categoria_id: d.categoria_id, centro_custo: d.centro_custo, valor_original: valor, valor_final: valor,
      forma_recebimento: d.forma_recebimento, data_vencimento: vencimento, observacoes, copia_chave, data_emissao: hoje,
    } as Record<string, unknown>;
  });
  const itens = novas.map((c, i) => ({
    origem_id: pendentes[i].id,
    id: String(c.id), descricao: String(c.descricao ?? ''),
    pessoa: String((tabela === 'contas_pagar' ? c.fornecedor_nome : c.cliente_nome) ?? ''),
    vencimento: String(c.data_vencimento), valor: round2(num(c.valor_final)),
  }));
  const soma = deCentavos(itens.reduce((a, it) => a + paraCentavos(it.valor), 0));
  if (pedido.previa) return { quantidade: novas.length, ja_copiadas: jaCopiadas.size, soma, copiadas: 0, itens };
  const copiadas = await inserirTitulos(exec, tabela, tenantId, novas);
  return { quantidade: novas.length, ja_copiadas: jaCopiadas.size + (novas.length - copiadas), soma, copiadas, itens };
}

// ---------------------------------------------------------------------------
// Tarefa diária: estende o horizonte das séries vivas
// ---------------------------------------------------------------------------

/**
 * Registrar em src/lib/agendador/tarefas.ts (a integração faz isso).
 * Diária a partir das 5h de Brasília; por agência, uma série por transação.
 */
export const tarefaRecorrenciaGerar: DefinicaoTarefa = {
  nome: 'recorrencia-gerar',
  janela: janelaDiaria(5),
  agencias: async ({ exec }) => {
    const { rows } = await exec.query(`SELECT DISTINCT tenant_id FROM recorrencias WHERE status = 'ativa' ORDER BY tenant_id`);
    return rows.map(r => String(r.tenant_id));
  },
  executar: async ({ exec, emTransacao, agora, restanteMs }, tenantId) => {
    const hoje = horaDeBrasilia(agora).data;
    const { rows } = await exec.query(
      `SELECT id FROM recorrencias WHERE tenant_id = $1 AND status = 'ativa' ORDER BY gerado_ate NULLS FIRST, id`, [tenantId]);
    let series = 0, criados = 0, pendentes = 0;
    for (const r of rows) {
      if (restanteMs() < 2_000) { pendentes++; continue; }
      criados += await emTransacao(tx => estenderHorizonteNoExecutor(tx, tenantId, String(r.id), hoje));
      series++;
    }
    return { series, criados, pendentes };
  },
};
