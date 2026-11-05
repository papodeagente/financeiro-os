/**
 * Liquidação no servidor (05/11/2026).
 *
 * - registrarBaixas(): prévia ou gravação de uma ou várias baixas (lote), numa
 *   transação, com os títulos travados em ordem fixa. O servidor refaz a conta
 *   (baixa-calculo.ts) e recusa se o título mudou desde a prévia da tela.
 * - estornarBaixa(): desfaz UMA baixa (inclusive no meio do histórico).
 * - historicoDaConta(): todas as baixas do título, com quem/quando/onde.
 * - registrarBaixaLegada(): os caminhos antigos (tela antiga, conciliação,
 *   CRM, plataformas) também deixam a linha no histórico.
 *
 * Toda baixa move o caixa por aplicarMovimentoCaixaAtomico (razão junto) e
 * respeita o fechamento de período (gatilho no banco).
 */
import { createHash } from 'node:crypto';
import { aplicarMovimentoCaixaAtomico, pessoaDaConta, type ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { hojeISO, num, paraCentavos, deCentavos, round2 } from './money';
import {
  calcularEncargos,
  planoDaBaixa,
  tituloDepoisDaBaixa,
  tituloDepoisDoEstorno,
  type PlanoDaBaixa,
  type PoliticaCobranca,
  type TituloParaBaixa,
  type TituloTabela,
  type TratamentoDiferenca,
} from './baixa-calculo';
import { mensagemPeriodoFechado } from './periodo-fechado';

export const BAIXAS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS baixas (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'baixa',
    chave_idempotencia TEXT,
    titulo_tabela TEXT NOT NULL,
    titulo_id TEXT NOT NULL,
    data_baixa DATE NOT NULL,
    conta_bancaria_id TEXT,
    forma TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    juros_centavos BIGINT NOT NULL DEFAULT 0,
    multa_centavos BIGINT NOT NULL DEFAULT 0,
    desconto_centavos BIGINT NOT NULL DEFAULT 0,
    taxa_centavos BIGINT NOT NULL DEFAULT 0,
    credito_centavos BIGINT NOT NULL DEFAULT 0,
    caixa_centavos BIGINT NOT NULL DEFAULT 0,
    tratamento_diferenca TEXT,
    politica_aplicada JSONB,
    lote_id TEXT,
    origem TEXT NOT NULL,
    usuario_id TEXT,
    usuario_nome TEXT,
    estorna_baixa_id TEXT,
    motivo TEXT,
    observacao TEXT,
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_baixas_idem ON baixas(tenant_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_baixas_estorno ON baixas(tenant_id, estorna_baixa_id) WHERE estorna_baixa_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_baixas_titulo ON baixas(tenant_id, titulo_tabela, titulo_id, criado_em);
  CREATE INDEX IF NOT EXISTS idx_baixas_lote ON baixas(tenant_id, lote_id) WHERE lote_id IS NOT NULL;
`;

export class ErroBaixa extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'ErroBaixa';
  }
}

export interface ItemBaixa {
  titulo_tabela: TituloTabela;
  titulo_id: string;
  data?: string;
  conta_bancaria_id?: string | null;
  forma?: string;
  valor: number;
  juros?: number;
  multa?: number;
  desconto?: number;
  taxa?: number;
  tratamento_diferenca?: TratamentoDiferenca;
  observacao?: string;
  /** O que a tela mostrou; se o servidor chegar a outro resultado, recusa. */
  esperado?: { status_depois?: string; valor_baixado_depois?: number; saldo_depois?: number };
  /** Anexos (comprovantes) a somar aos do título. */
  anexos?: Array<Record<string, unknown>>;
  /** Plataforma que reteve a taxa (contas a receber). */
  taxa_plataforma?: string;
}

export interface ContextoBaixa {
  tenantId: string;
  usuarioId?: string;
  usuarioNome?: string;
  origem: 'tela' | 'lote' | 'conciliacao' | 'crm' | 'plataforma' | 'api';
  /** Cabeçalho Idempotency-Key: repetir a mesma gravação não grava duas vezes. */
  idempotencia?: string;
  politica?: PoliticaCobranca | null;
}

export interface ResultadoItem {
  titulo_tabela: TituloTabela;
  titulo_id: string;
  descricao: string;
  pessoa: string;
  conta_bancaria_id: string | null;
  data: string;
  plano: PlanoDaBaixa;
  encargos_sugeridos: ReturnType<typeof calcularEncargos>;
  baixa_id?: string;
  ja_existia?: boolean;
}

const CAMPO = { contas_receber: 'valor_recebido', contas_pagar: 'valor_pago' } as const;
const CAMPO_DATA = { contas_receber: 'data_recebimento', contas_pagar: 'data_pagamento' } as const;
const TABELAS_OK = new Set<TituloTabela>(['contas_receber', 'contas_pagar']);

/** O que já foi baixado do título, pela mesma regra do saldo (PARCIAL pelo acumulado). */
export function valorBaixadoDoTitulo(tabela: TituloTabela, d: Record<string, unknown>): number {
  const status = String(d.status ?? '');
  const campo = CAMPO[tabela];
  if (status === 'PARCIAL') return round2(num(d[campo]));
  if (status === 'RECEBIDO' || status === 'PAGO') return round2(num(d[campo]) || num(d.valor_final));
  return 0;
}

export function tituloParaBaixa(tabela: TituloTabela, d: Record<string, unknown>): TituloParaBaixa {
  return {
    tabela,
    status: String(d.status ?? 'PENDENTE'),
    valor_final: round2(num(d.valor_final) || num(d.valor_brl)),
    valor_baixado: valorBaixadoDoTitulo(tabela, d),
    data_vencimento: String(d.data_vencimento ?? ''),
    juros: num(d.juros),
    multa: num(d.multa),
    desconto: num(d.desconto),
    valor_base_encargos: d.valor_base_encargos == null ? null : num(d.valor_base_encargos),
    conta_bancaria_id: (d.conta_bancaria_id as string | null | undefined) || null,
  };
}

async function politicaDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<PoliticaCobranca | null> {
  try {
    const { rows } = await exec.query(`SELECT data->'politica_cobranca' AS p FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`, [tenantId]);
    return (rows[0]?.p as PoliticaCobranca | null) ?? null;
  } catch {
    return null;
  }
}

async function periodoFechadoPara(exec: ExecutorSQL, tenantId: string, conta: string | null, data: string): Promise<string | null> {
  try {
    const { rows: tem } = await exec.query(`SELECT to_regprocedure('fin_periodo_fechado(text,text,date)') IS NOT NULL AS ok`);
    if (!tem[0]?.ok) return null;
    const { rows } = await exec.query(
      `SELECT CASE WHEN fin_periodo_fechado($1, $2, $3::date) THEN fin_fechado_ate($1, $2)::text END AS ate`,
      [tenantId, conta ?? '', data.slice(0, 10)],
    );
    return (rows[0]?.ate as string | null) ?? null;
  } catch {
    return null;
  }
}

/** Assinatura da prévia: o mesmo título no mesmo estado + o mesmo pedido. */
function assinar(partes: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex').slice(0, 32);
}

/** Linha "já baixado antes do histórico": o título tinha dinheiro antes da primeira baixa registrada. */
async function garantirLinhaAnterior(
  exec: ExecutorSQL,
  tenantId: string,
  tabela: TituloTabela,
  id: string,
  d: Record<string, unknown>,
): Promise<void> {
  const ja = valorBaixadoDoTitulo(tabela, d);
  if (ja <= 0) return;
  const { rows } = await exec.query(
    `SELECT 1 FROM baixas WHERE tenant_id = $1 AND titulo_tabela = $2 AND titulo_id = $3 LIMIT 1`,
    [tenantId, tabela, id],
  );
  if (rows.length) return;
  const data = String(d[CAMPO_DATA[tabela]] ?? '').slice(0, 10) || hojeISO();
  await exec.query(
    `INSERT INTO baixas (id, tenant_id, tipo, titulo_tabela, titulo_id, data_baixa, conta_bancaria_id, valor_centavos,
                         juros_centavos, multa_centavos, desconto_centavos, caixa_centavos, origem, observacao)
     VALUES ($1, $2, 'anterior', $3, $4, $5::date, $6, $7, $8, $9, $10, 0, 'anterior',
             'Valor já baixado antes do histórico de baixas existir.')`,
    [generateId(), tenantId, tabela, id, /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : hojeISO(),
      (d.conta_bancaria_id as string) || null, paraCentavos(ja),
      paraCentavos(num(d.juros)), paraCentavos(num(d.multa)), paraCentavos(num(d.desconto))],
  );
}

/**
 * Prévia (gravar = false) ou gravação de baixas. Na gravação, tudo ou nada.
 */
export async function registrarBaixas(
  exec: ExecutorSQL,
  ctx: ContextoBaixa,
  itens: ItemBaixa[],
  opcoes: { gravar: boolean; assinatura?: string; loteId?: string },
): Promise<{ itens: ResultadoItem[]; assinatura: string; lote_id: string | null }> {
  if (!Array.isArray(itens) || itens.length === 0) throw new ErroBaixa('Nenhuma conta para liquidar.');
  if (itens.length > 500) throw new ErroBaixa('Até 500 contas por vez.');
  const politica = ctx.politica !== undefined ? ctx.politica : await politicaDaAgencia(exec, ctx.tenantId);
  const loteId = opcoes.gravar && itens.length > 1 ? (opcoes.loteId || generateId()) : null;

  // Ordem fixa: duas liquidações em lote cruzadas não travam uma na outra.
  const ordenados = itens
    .map((it, i) => ({ it, i }))
    .sort((a, b) => `${a.it.titulo_tabela}:${a.it.titulo_id}`.localeCompare(`${b.it.titulo_tabela}:${b.it.titulo_id}`));

  const resultados: ResultadoItem[] = new Array(itens.length);
  const assinaturaPartes: unknown[] = [];

  for (const { it, i } of ordenados) {
    if (!TABELAS_OK.has(it.titulo_tabela)) throw new ErroBaixa('Tipo de conta inválido.');
    if (!it.titulo_id) throw new ErroBaixa('Conta não informada.');
    if (it.tratamento_diferenca === 'credito') {
      throw new ErroBaixa('Guardar a sobra como crédito do cliente chega com a carteira de crédito. Lance a sobra como acréscimo.');
    }

    // Idempotência: a mesma gravação repetida devolve o que já foi feito.
    const chave = opcoes.gravar && ctx.idempotencia ? `${ctx.idempotencia}:${i}` : null;
    if (chave) {
      const { rows } = await exec.query(`SELECT id FROM baixas WHERE tenant_id = $1 AND chave_idempotencia = $2`, [ctx.tenantId, chave]);
      if (rows.length) {
        resultados[i] = {
          titulo_tabela: it.titulo_tabela, titulo_id: it.titulo_id, descricao: '', pessoa: '', conta_bancaria_id: null,
          data: it.data ?? '', plano: planoDaBaixa({ tabela: it.titulo_tabela, status: '', valor_final: 0, valor_baixado: 0, data_vencimento: '' }, { valor: 0, data: '' }),
          encargos_sugeridos: { dias_atraso: 0, juros: 0, multa: 0, desconto_antecipacao: 0 },
          baixa_id: String(rows[0].id), ja_existia: true,
        };
        continue;
      }
    }

    const { rows } = await exec.query(
      `SELECT data, updated_at::text AS v FROM ${it.titulo_tabela} WHERE id = $1 AND tenant_id = $2${opcoes.gravar ? ' FOR UPDATE' : ''}`,
      [it.titulo_id, ctx.tenantId],
    );
    if (!rows.length) throw new ErroBaixa('Conta não encontrada.', 404);
    const d = (rows[0].data ?? {}) as Record<string, unknown>;
    const t = tituloParaBaixa(it.titulo_tabela, d);
    const data = (it.data || hojeISO()).slice(0, 10);

    // Parcelas de um mesmo título ficam na mesma conta bancária: os caminhos
    // antigos (estorno ao excluir, conciliação) contam com isso.
    const contaTitulo = t.conta_bancaria_id;
    const contaPedida = it.conta_bancaria_id || null;
    if (t.valor_baixado > 0 && contaTitulo && contaPedida && contaPedida !== contaTitulo) {
      throw new ErroBaixa('Esta conta já tem pagamento registrado em outra conta bancária. As próximas baixas entram na mesma conta; para usar outra, estorne as anteriores.', 409);
    }
    const conta: string | null = contaPedida || contaTitulo || null;

    const fechado = await periodoFechadoPara(exec, ctx.tenantId, conta, data);
    if (fechado) throw new ErroBaixa(mensagemPeriodoFechado(fechado), 423);

    const encargos = calcularEncargos(t, data, politica);
    const plano = planoDaBaixa(t, {
      valor: it.valor, data,
      juros: it.juros, multa: it.multa, desconto: it.desconto, taxa: it.taxa,
      tratamento_diferenca: it.tratamento_diferenca,
    });

    resultados[i] = {
      titulo_tabela: it.titulo_tabela, titulo_id: it.titulo_id,
      descricao: String(d.descricao ?? ''),
      pessoa: String((it.titulo_tabela === 'contas_receber' ? d.cliente_nome : d.fornecedor_nome) ?? ''),
      conta_bancaria_id: conta, data, plano, encargos_sugeridos: encargos,
    };
    assinaturaPartes.push([it.titulo_tabela, it.titulo_id, rows[0].v, plano.valor, plano.juros, plano.multa, plano.desconto, plano.status_depois, conta, data]);

    if (!opcoes.gravar) continue;
    if (plano.erros.length) throw new ErroBaixa(`${d.descricao ? `${String(d.descricao)}: ` : ''}${plano.erros[0]}`);
    if (it.esperado) {
      const e = it.esperado;
      const difere =
        (e.status_depois !== undefined && e.status_depois !== plano.status_depois)
        || (e.valor_baixado_depois !== undefined && round2(num(e.valor_baixado_depois)) !== plano.valor_baixado_depois)
        || (e.saldo_depois !== undefined && round2(num(e.saldo_depois)) !== plano.saldo_depois);
      if (difere) throw new ErroBaixa('Esta conta mudou desde que a tela abriu. Feche e abra de novo para ver os valores atuais.', 409);
    }

    await garantirLinhaAnterior(exec, ctx.tenantId, it.titulo_tabela, it.titulo_id, d);

    const novo = tituloDepoisDaBaixa(d, t, plano, { data, conta_bancaria_id: conta });
    // A forma escolhida na liquidação fica na conta quando ela não tinha
    // nenhuma (o extrato e as movimentações leem a forma da conta).
    const campoForma = it.titulo_tabela === 'contas_receber' ? 'forma_recebimento' : 'forma_pagamento';
    if (it.forma && !String(d[campoForma] ?? '').trim()) novo[campoForma] = String(it.forma).slice(0, 60);
    if (it.anexos && it.anexos.length) {
      novo.anexos = [...((d.anexos as unknown[]) ?? []), ...it.anexos];
      // `comprovante` guarda o mais recente, para quem lê um campo só.
      const ultimo = it.anexos[it.anexos.length - 1];
      if (ultimo && typeof ultimo.url === 'string') novo.comprovante = ultimo.url;
    }
    if (it.taxa_plataforma && plano.taxa > 0) novo.taxa_plataforma = it.taxa_plataforma;
    if (it.observacao) novo.observacoes = `${d.observacoes ? `${String(d.observacoes)} · ` : ''}${it.observacao}`;
    await exec.query(
      `UPDATE ${it.titulo_tabela} SET data = $3::jsonb, status = $4, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [it.titulo_id, ctx.tenantId, JSON.stringify(novo), plano.status_depois],
    );

    const sinal = it.titulo_tabela === 'contas_receber' ? 1 : -1;
    const caixa = round2(plano.valor * sinal);
    const ok = await aplicarMovimentoCaixaAtomico(ctx.tenantId, conta, caixa, exec, {
      tipo: it.titulo_tabela === 'contas_receber' ? 'baixa_receber' : 'baixa_pagar',
      tabela: it.titulo_tabela, id: it.titulo_id, pessoaId: pessoaDaConta(it.titulo_tabela, d),
    });
    if (!ok) throw new ErroBaixa('A conta bancária escolhida não existe nesta agência. Escolha outra.', 409);

    const baixaId = generateId();
    await exec.query(
      `INSERT INTO baixas (id, tenant_id, tipo, chave_idempotencia, titulo_tabela, titulo_id, data_baixa, conta_bancaria_id, forma,
                           valor_centavos, juros_centavos, multa_centavos, desconto_centavos, taxa_centavos, credito_centavos,
                           caixa_centavos, tratamento_diferenca, politica_aplicada, lote_id, origem, usuario_id, usuario_nome, observacao)
       VALUES ($1, $2, 'baixa', $3, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18, $19, $20, $21, $22)`,
      [baixaId, ctx.tenantId, chave, it.titulo_tabela, it.titulo_id, data, conta, it.forma ?? '',
        paraCentavos(plano.valor), paraCentavos(plano.juros), paraCentavos(plano.multa), paraCentavos(plano.desconto),
        paraCentavos(plano.taxa), paraCentavos(plano.credito), paraCentavos(caixa), it.tratamento_diferenca ?? null,
        JSON.stringify(politica ?? null), loteId, loteId ? 'lote' : ctx.origem, ctx.usuarioId ?? null, ctx.usuarioNome ?? null,
        it.observacao ?? null],
    );
    resultados[i].baixa_id = baixaId;
  }

  const assinatura = assinar(assinaturaPartes);
  // Repetição (mesma Idempotency-Key): o que já foi gravado não entra na
  // assinatura, então ela só é conferida quando nenhum item é repetição.
  const repeticao = resultados.some(r => r?.ja_existia);
  if (opcoes.gravar && opcoes.assinatura && !repeticao && opcoes.assinatura !== assinatura) {
    throw new ErroBaixa('Os valores mudaram desde a prévia. Revise e confirme de novo.', 409);
  }
  return { itens: resultados, assinatura, lote_id: loteId };
}

/** Desfaz uma baixa. O dinheiro volta para a conta onde entrou/saiu. */
export async function estornarBaixa(
  exec: ExecutorSQL,
  ctx: { tenantId: string; usuarioId?: string; usuarioNome?: string },
  baixaId: string,
  p: { motivo: string; data?: string },
): Promise<{ estorno_id: string; status_depois: string }> {
  const motivo = (p.motivo ?? '').trim();
  if (motivo.length < 3) throw new ErroBaixa('Informe o motivo do estorno.');
  const { rows } = await exec.query(`SELECT *, data_baixa::text AS data_baixa_txt FROM baixas WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [ctx.tenantId, baixaId]);
  if (!rows.length) throw new ErroBaixa('Baixa não encontrada.', 404);
  const b = rows[0];
  if (b.tipo === 'estorno') throw new ErroBaixa('Isto já é um estorno.');
  const { rows: ja } = await exec.query(`SELECT 1 FROM baixas WHERE tenant_id = $1 AND estorna_baixa_id = $2`, [ctx.tenantId, baixaId]);
  if (ja.length) throw new ErroBaixa('Esta baixa já foi estornada.', 409);

  const tabela = String(b.titulo_tabela) as TituloTabela;
  const { rows: tr } = await exec.query(`SELECT data FROM ${tabela} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [b.titulo_id, ctx.tenantId]);
  if (!tr.length) throw new ErroBaixa('A conta desta baixa não existe mais.', 404);
  const d = (tr[0].data ?? {}) as Record<string, unknown>;

  const valores = {
    valor: deCentavos(b.valor_centavos as string), juros: deCentavos(b.juros_centavos as string),
    multa: deCentavos(b.multa_centavos as string), desconto: deCentavos(b.desconto_centavos as string),
    taxa: deCentavos(b.taxa_centavos as string), credito: deCentavos(b.credito_centavos as string),
  };
  const novo = tituloDepoisDoEstorno(d, tabela, valores);
  // Data do título passa a ser a da última baixa que continua valendo.
  const { rows: ultimas } = await exec.query(
    `SELECT data_baixa::text AS d FROM baixas x
      WHERE x.tenant_id = $1 AND x.titulo_tabela = $2 AND x.titulo_id = $3 AND x.tipo <> 'estorno' AND x.id <> $4
        AND NOT EXISTS (SELECT 1 FROM baixas e WHERE e.tenant_id = x.tenant_id AND e.estorna_baixa_id = x.id)
      ORDER BY data_baixa DESC LIMIT 1`,
    [ctx.tenantId, tabela, b.titulo_id, baixaId],
  );
  if (novo.status === 'PENDENTE') novo[CAMPO_DATA[tabela]] = '';
  else if (ultimas[0]?.d) novo[CAMPO_DATA[tabela]] = ultimas[0].d;

  // Avisa à trava de período a data da baixa estornada (só nesta transação).
  await exec.query(`SELECT set_config('fin.estorno_data', $1, true)`, [String(b.data_baixa_txt ?? '')]);
  await exec.query(`UPDATE ${tabela} SET data = $3::jsonb, status = $4, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
    [b.titulo_id, ctx.tenantId, JSON.stringify(novo), novo.status]);
  await exec.query(`SELECT set_config('fin.estorno_data', '', true)`);

  const sinal = tabela === 'contas_receber' ? 1 : -1;
  // Linha "anterior" não tem caixa_centavos (o dinheiro entrou antes do
  // histórico), mas o estorno devolve o valor dela do mesmo jeito.
  const caixaOriginal = Number(b.caixa_centavos) !== 0 ? deCentavos(b.caixa_centavos as string) : round2(valores.valor * sinal);
  const conta = (b.conta_bancaria_id as string | null) || (d.conta_bancaria_id as string | null) || null;
  if (caixaOriginal !== 0) {
    const ok = await aplicarMovimentoCaixaAtomico(ctx.tenantId, conta, -caixaOriginal, exec, {
      tipo: tabela === 'contas_receber' ? 'baixa_receber' : 'baixa_pagar',
      tabela, id: String(b.titulo_id), pessoaId: pessoaDaConta(tabela, d),
      descricao: `Estorno de baixa: ${motivo}`,
    });
    if (!ok) throw new ErroBaixa('A conta bancária desta baixa não existe mais. Nada foi estornado.', 409);
  }

  const id = generateId();
  await exec.query(
    `INSERT INTO baixas (id, tenant_id, tipo, titulo_tabela, titulo_id, data_baixa, conta_bancaria_id, forma, valor_centavos,
                         juros_centavos, multa_centavos, desconto_centavos, taxa_centavos, credito_centavos, caixa_centavos,
                         origem, usuario_id, usuario_nome, estorna_baixa_id, motivo)
     VALUES ($1, $2, 'estorno', $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'tela', $15, $16, $17, $18)`,
    [id, ctx.tenantId, tabela, b.titulo_id, (p.data || hojeISO()).slice(0, 10), conta, b.forma ?? '',
      b.valor_centavos, b.juros_centavos, b.multa_centavos, b.desconto_centavos, b.taxa_centavos, b.credito_centavos,
      paraCentavos(-caixaOriginal), ctx.usuarioId ?? null, ctx.usuarioNome ?? null, baixaId, motivo],
  );
  return { estorno_id: id, status_depois: String(novo.status) };
}

export interface LinhaHistorico {
  id: string;
  tipo: 'baixa' | 'estorno' | 'anterior' | 'legada';
  data: string;
  conta_bancaria_id: string | null;
  forma: string;
  valor: number;
  juros: number;
  multa: number;
  desconto: number;
  taxa: number;
  caixa: number;
  origem: string;
  usuario: string | null;
  motivo: string | null;
  observacao: string | null;
  estornada: boolean;
  estorna: string | null;
  lote_id: string | null;
  criado_em: string;
}

export async function historicoDaConta(exec: ExecutorSQL, tenantId: string, tabela: TituloTabela, id: string): Promise<LinhaHistorico[]> {
  const { rows } = await exec.query(
    `SELECT b.*, b.data_baixa::text AS data_txt, b.criado_em::text AS criado_txt,
            EXISTS (SELECT 1 FROM baixas e WHERE e.tenant_id = b.tenant_id AND e.estorna_baixa_id = b.id) AS estornada
       FROM baixas b
      WHERE b.tenant_id = $1 AND b.titulo_tabela = $2 AND b.titulo_id = $3
      ORDER BY CASE WHEN b.tipo = 'anterior' THEN 0 ELSE 1 END, b.criado_em, b.id`,
    [tenantId, tabela, id],
  );
  return rows.map(r => ({
    id: String(r.id), tipo: String(r.tipo) as LinhaHistorico['tipo'], data: String(r.data_txt),
    conta_bancaria_id: (r.conta_bancaria_id as string | null) ?? null, forma: String(r.forma ?? ''),
    valor: deCentavos(r.valor_centavos as string), juros: deCentavos(r.juros_centavos as string),
    multa: deCentavos(r.multa_centavos as string), desconto: deCentavos(r.desconto_centavos as string),
    taxa: deCentavos(r.taxa_centavos as string), caixa: deCentavos(r.caixa_centavos as string),
    origem: String(r.origem ?? ''), usuario: (r.usuario_nome as string | null) ?? (r.usuario_id as string | null) ?? null,
    motivo: (r.motivo as string | null) ?? null, observacao: (r.observacao as string | null) ?? null,
    estornada: Boolean(r.estornada), estorna: (r.estorna_baixa_id as string | null) ?? null,
    lote_id: (r.lote_id as string | null) ?? null, criado_em: String(r.criado_txt),
  }));
}

/**
 * Caminhos antigos (tela antiga, conciliação, CRM, plataformas) mexem no
 * valor baixado direto no título. Isto deixa a linha no histórico para cada
 * movimento de caixa que eles fizeram. Nunca derruba o caminho que chamou.
 */
export async function registrarBaixaLegada(
  exec: ExecutorSQL,
  p: {
    tenantId: string;
    tabela: TituloTabela;
    tituloId: string;
    dadosAntes: Record<string, unknown>;
    conta: string | null;
    /** Movimento de caixa (entrada +, saída −). */
    caixa: number;
    data?: string;
    origem: 'tela_antiga' | 'conciliacao' | 'crm' | 'plataforma';
  },
): Promise<void> {
  let comPonto = false;
  try { await exec.query('SAVEPOINT baixa_legada'); comPonto = true; } catch { comPonto = false; }
  try {
    await garantirLinhaAnterior(exec, p.tenantId, p.tabela, p.tituloId, p.dadosAntes);
    const sinal = p.tabela === 'contas_receber' ? 1 : -1;
    const valor = round2(p.caixa * sinal);
    const data = (p.data || hojeISO()).slice(0, 10);
    await exec.query(
      `INSERT INTO baixas (id, tenant_id, tipo, titulo_tabela, titulo_id, data_baixa, conta_bancaria_id, valor_centavos, caixa_centavos, origem)
       VALUES ($1, $2, 'legada', $3, $4, $5::date, $6, $7, $8, $9)`,
      [generateId(), p.tenantId, p.tabela, p.tituloId, /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : hojeISO(), p.conta,
        paraCentavos(valor), paraCentavos(p.caixa), p.origem],
    );
    if (comPonto) await exec.query('RELEASE SAVEPOINT baixa_legada');
  } catch (e) {
    if (comPonto) { try { await exec.query('ROLLBACK TO SAVEPOINT baixa_legada'); } catch { /* conexão perdida */ } }
    const msg = e instanceof Error ? e.message : String(e);
    if (!/baixas|does not exist|não existe/i.test(msg) || !avisou) console.error('[baixas] histórico não registrado:', msg);
    avisou = true;
  }
}
let avisou = false;
