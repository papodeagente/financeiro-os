/**
 * Faturas ao cliente no banco (E5, parte B, 05/11/2026).
 *
 * Como o dinheiro anda (para nunca contar duas vezes):
 *  - A venda gera a conta a receber da forma "Faturar" (`faturar: true`,
 *    venda-contas.ts). Ela é o ITEM a faturar.
 *  - A fatura tem a SUA conta a receber (origem FATURA, `titulo_id`), com o
 *    total líquido: é ela que se cobra (boleto/Pix da E3), se baixa e aparece
 *    no contas a receber, no fluxo e no painel.
 *  - Quando o item entra na fatura, a conta dele fica Cancelada com o carimbo
 *    `na_fatura` (mesma técnica da unificação com a plataforma): sai dos
 *    totais e o valor passa a viver na conta da fatura. Ao sair da fatura
 *    (mover, tirar, reabrir e recalcular), volta ao que era.
 *  - A posição da venda lê o item pela situação da conta da fatura
 *    (`projetarContasNaFatura`).
 *
 * Regras que custam dinheiro se quebradas:
 *  1. Fatura fechada, paga em parte ou com cobrança valendo não muda: nem
 *     item, nem valor. Correção vira nota de crédito/débito ESCRITA, que cai
 *     na próxima fatura do pagante (ou numa fatura avulsa, se a pessoa quiser).
 *  2. Nenhuma diferença passa para a próxima fatura em silêncio: o saldo de
 *     pagamento parcial e a mudança de uma venda já faturada viram nota com o
 *     motivo e o número da fatura de origem.
 *  3. Tudo por agência (tenant_id em toda consulta) e sob uma trava por
 *     agência (pg_advisory_xact_lock): duas pessoas mexendo nas faturas da
 *     mesma agência não se atropelam. Quem chama abre a transação.
 */
import { generateId } from './utils';
import { EMPRESA_PRINCIPAL_ID, empresaDoRegistro } from './empresas';
import { addDias, deCentavos, hojeISO, round2 } from './money';
import { STATUS_BAIXADOS, type ExecutorSQL } from './caixa-atomico';
import { criarCalendario, CALENDARIO_NACIONAL, type Calendario } from './feriados';
import {
  conferirComArquivo, escolherRegra, normalizarRegra, normalizarRetencoes, posicaoDoItem, situacaoVisivel, totaisDaFatura,
  ROTULO_TIPO_DE_PESSOA,
  type CampoDaFatura, type ConferenciaDaFatura, type ConfigRetencoes, type LinhaDoArquivo, type ModeloDeFatura,
  type RegraDeFaturamento, type RelatorioDaConferencia, type SituacaoDaFatura, type SituacaoVisivel, type TotaisDaFatura,
  type TipoDePessoaDaRegra,
} from './fatura-regras';
import type { CorporativoDoItem } from './fatura-documento';
import { normalizarCorporativo } from './venda-modelo';

// ============================================================
// Tipos públicos
// ============================================================

export class ErroFatura extends Error {
  constructor(public codigo: string, mensagem: string, public status = 400, public detalhes?: unknown) {
    super(mensagem);
    this.name = 'ErroFatura';
  }
}

export interface UsuarioDaFatura { id: string; nome: string }
const SISTEMA: UsuarioDaFatura = { id: '', nome: 'Sistema' };

export interface Fatura {
  id: string;
  numero: number;
  pessoa_id: string;
  pessoa_nome: string;
  regra_id: string;
  chave: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  vencimento: string;
  vencimento_ajuste: string;
  emissao: string | null;
  situacao: SituacaoDaFatura;
  conferencia: ConferenciaDaFatura;
  avulsa: boolean;
  complementar_de: string;
  titulo_id: string;
  descricao: string;
  solicitante: string;
  centro_custo: string;
  observacoes: string;
  modelo: ModeloDeFatura;
  campos: CampoDaFatura[];
  retencoes: ConfigRetencoes;
  total_itens_centavos: number;
  total_creditos_centavos: number;
  total_debitos_centavos: number;
  total_retencoes_centavos: number;
  total_centavos: number;
  invalida: boolean;
  fechada_em: string | null;
  fechada_por: string;
  conferida_em: string | null;
  criado_em: string;
}

export interface DetalheDoProduto {
  tipo: string;
  descricao: string;
  fornecedor_nome: string;
  localizador: string;
  data_inicio: string;
  data_fim: string;
  passageiros: string[];
}

export interface DetalhesDoItem {
  produtos: DetalheDoProduto[];
  centro_custo: string;
  solicitante: string;
  cliente_nome: string;
  /** Viagem corporativa da venda (E7): só quando a venda tem. */
  corporativo?: CorporativoDoItem;
}

export interface ItemDaFatura {
  conta_id: string;
  fatura_id: string;
  venda_id: string;
  venda_numero: string;
  data_venda: string | null;
  data_referencia: string | null;
  descricao: string;
  valor_centavos: number;
  taxas_servico_centavos: number;
  detalhes: DetalhesDoItem;
  conferido: boolean;
  conferencia_nota: string;
  contestacao: string;
  contestado_em: string | null;
  resposta: string;
}

export interface AjusteDaFatura {
  id: string;
  pessoa_id: string;
  pessoa_nome: string;
  fatura_id: string;
  origem_fatura_id: string;
  conta_id: string;
  venda_id: string;
  tipo: 'CREDITO' | 'DEBITO';
  valor_centavos: number;
  motivo: string;
  criado_por_nome: string;
  criado_em: string;
}

export interface EventoDaFatura {
  id: string;
  tipo: string;
  motivo: string;
  usuario_nome: string;
  detalhe: Record<string, unknown>;
  criado_em: string;
}

export interface TituloDaFatura {
  id: string;
  status: string;
  valor_final: number;
  valor_recebido: number;
  data_recebimento: string | null;
}

// ============================================================
// Utilitários
// ============================================================

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataISO = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) {
    // DATE chega como meia-noite: UTC (PGlite) ou local (node-postgres). Meia-noite
    // UTC exata → partes UTC; senão, partes locais. Os dois dão a data civil certa.
    const utc = v.getUTCHours() === 0 && v.getUTCMinutes() === 0;
    const a = utc ? v.getUTCFullYear() : v.getFullYear();
    const m = String((utc ? v.getUTCMonth() : v.getMonth()) + 1).padStart(2, '0');
    const d = String(utc ? v.getUTCDate() : v.getDate()).padStart(2, '0');
    return `${a}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
};
const quando = (v: unknown): string => (v instanceof Date ? v.toISOString() : txt(v));
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const reais = (c: number) => deCentavos(c);
const centavosDe = (v: unknown) => Math.round(round2(Number(v) || 0) * 100);
const brl = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_LIVRES = ['PENDENTE', 'ATRASADO', 'VENCIDO', ''];

let tabelasProntas = false;
/** As tabelas da fatura existem? (Ambiente de teste antigo, ou antes do initDB.) */
export async function faturasDisponiveis(exec: ExecutorSQL): Promise<boolean> {
  if (tabelasProntas) return true;
  const { rows } = await exec.query(`SELECT to_regclass('public.faturas') IS NOT NULL AS ok`);
  tabelasProntas = rows[0]?.ok === true;
  return tabelasProntas;
}

async function temCobrancas(exec: ExecutorSQL): Promise<boolean> {
  const { rows } = await exec.query(`SELECT to_regclass('public.cobrancas') IS NOT NULL AS ok`);
  return rows[0]?.ok === true;
}

/** Uma trava por agência para tudo que mexe nas faturas (curto: dura a transação). */
export async function travarFaturas(exec: ExecutorSQL, tenantId: string): Promise<void> {
  if (!tenantId) throw new ErroFatura('SEM_EMPRESA', 'Empresa não identificada.', 400);
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext('faturas'))`, [tenantId]);
}

/** Calendário da agência: feriados nacionais + os que ela cadastrou (agencia.data.feriados_extras). */
export async function calendarioDaAgencia(exec: ExecutorSQL, tenantId: string): Promise<Calendario> {
  const { rows } = await exec.query(`SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`, [tenantId])
    .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  const extras = (rows[0]?.data as Record<string, unknown> | undefined)?.feriados_extras;
  const lista = Array.isArray(extras) ? extras.map(String).filter(s => DATA.test(s.slice(0, 10))).map(s => s.slice(0, 10)) : [];
  return lista.length ? criarCalendario({ extras: lista }) : CALENDARIO_NACIONAL;
}

const COLUNAS_FATURA = `id, numero, pessoa_id, pessoa_nome, regra_id, chave, periodo_inicio, periodo_fim, vencimento, vencimento_ajuste,
  emissao, situacao, conferencia, avulsa, complementar_de, titulo_id, descricao, solicitante, centro_custo, observacoes, modelo,
  campos, retencoes, total_itens_centavos, total_creditos_centavos, total_debitos_centavos, total_retencoes_centavos,
  total_centavos, invalida, fechada_em, fechada_por, conferida_em, criado_em`;

function lerFatura(r: Record<string, unknown>): Fatura {
  return {
    id: txt(r.id), numero: Number(r.numero) || 0, pessoa_id: txt(r.pessoa_id), pessoa_nome: txt(r.pessoa_nome),
    regra_id: txt(r.regra_id), chave: txt(r.chave), periodo_inicio: dataISO(r.periodo_inicio), periodo_fim: dataISO(r.periodo_fim),
    vencimento: dataISO(r.vencimento) ?? '', vencimento_ajuste: txt(r.vencimento_ajuste), emissao: dataISO(r.emissao),
    situacao: txt(r.situacao) as SituacaoDaFatura, conferencia: txt(r.conferencia) as ConferenciaDaFatura,
    avulsa: r.avulsa === true, complementar_de: txt(r.complementar_de), titulo_id: txt(r.titulo_id),
    descricao: txt(r.descricao), solicitante: txt(r.solicitante), centro_custo: txt(r.centro_custo), observacoes: txt(r.observacoes),
    modelo: (txt(r.modelo) || 'PADRAO') as ModeloDeFatura,
    campos: (Array.isArray(r.campos) ? r.campos : []) as CampoDaFatura[],
    retencoes: normalizarRetencoes(r.retencoes),
    total_itens_centavos: Number(r.total_itens_centavos) || 0, total_creditos_centavos: Number(r.total_creditos_centavos) || 0,
    total_debitos_centavos: Number(r.total_debitos_centavos) || 0, total_retencoes_centavos: Number(r.total_retencoes_centavos) || 0,
    total_centavos: Number(r.total_centavos) || 0, invalida: r.invalida === true,
    fechada_em: r.fechada_em ? quando(r.fechada_em) : null, fechada_por: txt(r.fechada_por),
    conferida_em: r.conferida_em ? quando(r.conferida_em) : null, criado_em: quando(r.criado_em),
  };
}

const COLUNAS_ITEM = `conta_id, fatura_id, venda_id, venda_numero, data_venda, data_referencia, descricao, valor_centavos,
  taxas_servico_centavos, detalhes, conferido, conferencia_nota, contestacao, contestado_em, resposta`;

function lerItem(r: Record<string, unknown>): ItemDaFatura {
  const d = (r.detalhes ?? {}) as Partial<DetalhesDoItem>;
  return {
    conta_id: txt(r.conta_id), fatura_id: txt(r.fatura_id), venda_id: txt(r.venda_id), venda_numero: txt(r.venda_numero),
    data_venda: dataISO(r.data_venda), data_referencia: dataISO(r.data_referencia), descricao: txt(r.descricao),
    valor_centavos: Number(r.valor_centavos) || 0, taxas_servico_centavos: Number(r.taxas_servico_centavos) || 0,
    detalhes: {
      produtos: Array.isArray(d.produtos) ? d.produtos : [], centro_custo: txt(d.centro_custo), solicitante: txt(d.solicitante), cliente_nome: txt(d.cliente_nome),
      ...(d.corporativo && typeof d.corporativo === 'object' ? { corporativo: d.corporativo as CorporativoDoItem } : {}),
    },
    conferido: r.conferido === true, conferencia_nota: txt(r.conferencia_nota), contestacao: txt(r.contestacao),
    contestado_em: r.contestado_em ? quando(r.contestado_em) : null, resposta: txt(r.resposta),
  };
}

const COLUNAS_AJUSTE = `id, pessoa_id, pessoa_nome, fatura_id, origem_fatura_id, conta_id, venda_id, tipo, valor_centavos, motivo, criado_por_nome, criado_em`;
function lerAjuste(r: Record<string, unknown>): AjusteDaFatura {
  return {
    id: txt(r.id), pessoa_id: txt(r.pessoa_id), pessoa_nome: txt(r.pessoa_nome), fatura_id: txt(r.fatura_id),
    origem_fatura_id: txt(r.origem_fatura_id), conta_id: txt(r.conta_id), venda_id: txt(r.venda_id),
    tipo: txt(r.tipo) === 'DEBITO' ? 'DEBITO' : 'CREDITO', valor_centavos: Number(r.valor_centavos) || 0, motivo: txt(r.motivo),
    criado_por_nome: txt(r.criado_por_nome), criado_em: quando(r.criado_em),
  };
}

export async function carregarFatura(exec: ExecutorSQL, tenantId: string, id: string): Promise<Fatura | null> {
  if (!id) return null;
  const { rows } = await exec.query(`SELECT ${COLUNAS_FATURA} FROM faturas WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return rows[0] ? lerFatura(rows[0]) : null;
}

async function exigirFatura(exec: ExecutorSQL, tenantId: string, id: string): Promise<Fatura> {
  const f = await carregarFatura(exec, tenantId, id);
  if (!f) throw new ErroFatura('NAO_ACHOU', 'Fatura não encontrada.', 404);
  return f;
}

async function itensDa(exec: ExecutorSQL, tenantId: string, faturaId: string): Promise<ItemDaFatura[]> {
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_ITEM} FROM fatura_itens WHERE tenant_id = $1 AND fatura_id = $2 ORDER BY data_referencia NULLS LAST, venda_numero, conta_id`,
    [tenantId, faturaId],
  );
  return rows.map(lerItem);
}

async function ajustesDa(exec: ExecutorSQL, tenantId: string, faturaId: string): Promise<AjusteDaFatura[]> {
  const { rows } = await exec.query(`SELECT ${COLUNAS_AJUSTE} FROM fatura_ajustes WHERE tenant_id = $1 AND fatura_id = $2 ORDER BY criado_em, id`, [tenantId, faturaId]);
  return rows.map(lerAjuste);
}

export async function tituloDa(exec: ExecutorSQL, tenantId: string, f: Pick<Fatura, 'titulo_id'>): Promise<TituloDaFatura | null> {
  if (!f.titulo_id) return null;
  const { rows } = await exec.query(`SELECT id, status, data FROM contas_receber WHERE tenant_id = $1 AND id = $2`, [tenantId, f.titulo_id]);
  if (!rows[0]) return null;
  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  return {
    id: txt(rows[0].id), status: txt(d.status ?? rows[0].status) || 'PENDENTE', valor_final: Number(d.valor_final) || 0,
    valor_recebido: Number(d.valor_recebido) || 0, data_recebimento: d.data_recebimento ? txt(d.data_recebimento).slice(0, 10) : null,
  };
}

async function cobrancaValendo(exec: ExecutorSQL, tenantId: string, tituloId: string): Promise<boolean> {
  if (!tituloId || !(await temCobrancas(exec))) return false;
  const { rows } = await exec.query(
    `SELECT 1 FROM cobrancas WHERE tenant_id = $1 AND titulo_tabela = 'contas_receber' AND titulo_id = $2 AND status IN ('emitindo','aberta','vencida') LIMIT 1`,
    [tenantId, tituloId],
  );
  return rows.length > 0;
}

/** Fatura que ainda aceita mudança: aberta, sem nada recebido. */
async function exigirEditavel(exec: ExecutorSQL, tenantId: string, f: Fatura): Promise<void> {
  if (f.situacao === 'CANCELADA') throw new ErroFatura('FATURA_CANCELADA', `A fatura Nº ${f.numero} foi cancelada.`, 409);
  if (f.situacao === 'FECHADA') {
    throw new ErroFatura('FATURA_FECHADA', `A fatura Nº ${f.numero} está fechada. Reabra a fatura para mudar itens, ou lance uma nota de crédito ou débito para a próxima.`, 409);
  }
  const t = await tituloDa(exec, tenantId, f);
  if (t && (STATUS_BAIXADOS as readonly string[]).includes(t.status)) {
    throw new ErroFatura('FATURA_RECEBIDA', `A fatura Nº ${f.numero} já tem pagamento registrado: os itens não mudam mais. Use uma nota de crédito ou débito.`, 409);
  }
}

export async function registrarEventoDaFatura(
  exec: ExecutorSQL, tenantId: string, faturaId: string, tipo: string,
  o: { usuario?: UsuarioDaFatura | null; motivo?: string; detalhe?: Record<string, unknown> } = {},
): Promise<void> {
  await exec.query(
    `INSERT INTO fatura_eventos (tenant_id, id, fatura_id, tipo, motivo, usuario_id, usuario_nome, detalhe) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [tenantId, generateId(), faturaId, tipo, (o.motivo ?? '').slice(0, 1000), o.usuario?.id ?? '', o.usuario?.nome ?? '', JSON.stringify(o.detalhe ?? {})],
  );
}

async function eventosDa(exec: ExecutorSQL, tenantId: string, faturaId: string): Promise<EventoDaFatura[]> {
  const { rows } = await exec.query(
    `SELECT id, tipo, motivo, usuario_nome, detalhe, criado_em FROM fatura_eventos WHERE tenant_id = $1 AND fatura_id = $2 ORDER BY criado_em DESC, id DESC LIMIT 200`,
    [tenantId, faturaId],
  );
  return rows.map(r => ({ id: txt(r.id), tipo: txt(r.tipo), motivo: txt(r.motivo), usuario_nome: txt(r.usuario_nome), detalhe: (r.detalhe ?? {}) as Record<string, unknown>, criado_em: quando(r.criado_em) }));
}

// ============================================================
// Regras de faturamento
// ============================================================

function lerRegraDoBanco(r: Record<string, unknown>): RegraDeFaturamento {
  return normalizarRegra({ ...r, prazo_dias: Number(r.prazo_dias), inicio_semana: Number(r.inicio_semana) }).regra;
}

export async function listarRegras(
  exec: ExecutorSQL, tenantId: string, filtro: { pessoa_tipo?: string; pessoa_id?: string; incluir_inativas?: boolean } = {},
): Promise<RegraDeFaturamento[]> {
  const where = ['tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (filtro.pessoa_tipo) { args.push(filtro.pessoa_tipo); where.push(`pessoa_tipo = $${args.length}`); }
  if (filtro.pessoa_id) { args.push(filtro.pessoa_id); where.push(`pessoa_id = $${args.length}`); }
  if (!filtro.incluir_inativas) where.push('ativa');
  const { rows } = await exec.query(`SELECT * FROM regras_faturamento WHERE ${where.join(' AND ')} ORDER BY pessoa_nome, pessoa_id, produto_tipo, fornecedor_id, id LIMIT 2000`, args);
  return rows.map(lerRegraDoBanco);
}

export async function carregarRegra(exec: ExecutorSQL, tenantId: string, id: string): Promise<RegraDeFaturamento | null> {
  const { rows } = await exec.query(`SELECT * FROM regras_faturamento WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return rows[0] ? lerRegraDoBanco(rows[0]) : null;
}

/** Cria ou altera a regra. Uma regra ativa por pessoa × produto × fornecedor. */
export async function salvarRegra(exec: ExecutorSQL, tenantId: string, entrada: unknown, usuario: UsuarioDaFatura): Promise<RegraDeFaturamento> {
  const { regra, erros } = normalizarRegra(entrada);
  if (erros.length) throw new ErroFatura('DADOS', erros[0].mensagem, 400, { erros });
  await travarFaturas(exec, tenantId);
  const nova = !regra.id;
  if (nova) regra.id = `rf-${generateId()}`;
  else if (!(await carregarRegra(exec, tenantId, regra.id))) throw new ErroFatura('NAO_ACHOU', 'Regra não encontrada.', 404);
  if (!regra.pessoa_nome) regra.pessoa_nome = await nomeDaPessoa(exec, tenantId, regra.pessoa_tipo, regra.pessoa_id);
  const { rows: igual } = await exec.query(
    `SELECT id FROM regras_faturamento WHERE tenant_id = $1 AND pessoa_tipo = $2 AND pessoa_id = $3 AND produto_tipo = $4 AND fornecedor_id = $5 AND ativa AND id <> $6`,
    [tenantId, regra.pessoa_tipo, regra.pessoa_id, regra.produto_tipo, regra.fornecedor_id, regra.id],
  );
  if (igual.length && regra.ativa) {
    throw new ErroFatura('REGRA_REPETIDA', `${regra.pessoa_nome || 'Esta pessoa'} já tem uma regra para ${regra.produto_tipo || regra.fornecedor_id ? 'este produto/fornecedor' : 'tudo'}. Altere a que existe.`, 409, { regra_id: txt(igual[0].id) });
  }
  await exec.query(
    `INSERT INTO regras_faturamento (tenant_id, id, pessoa_tipo, pessoa_id, pessoa_nome, produto_tipo, fornecedor_id, fornecedor_nome, periodo,
       inicio_semana, faturar_por, sentido, prazo_dias, dia_nao_util, considerar_feriados, faixas, descricao, solicitante, centro_custo,
       modelo, campos, retencoes, ativa, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23,$24)
     ON CONFLICT (tenant_id, id) DO UPDATE SET pessoa_tipo = EXCLUDED.pessoa_tipo, pessoa_id = EXCLUDED.pessoa_id, pessoa_nome = EXCLUDED.pessoa_nome,
       produto_tipo = EXCLUDED.produto_tipo, fornecedor_id = EXCLUDED.fornecedor_id, fornecedor_nome = EXCLUDED.fornecedor_nome,
       periodo = EXCLUDED.periodo, inicio_semana = EXCLUDED.inicio_semana, faturar_por = EXCLUDED.faturar_por, sentido = EXCLUDED.sentido,
       prazo_dias = EXCLUDED.prazo_dias, dia_nao_util = EXCLUDED.dia_nao_util, considerar_feriados = EXCLUDED.considerar_feriados,
       faixas = EXCLUDED.faixas, descricao = EXCLUDED.descricao, solicitante = EXCLUDED.solicitante, centro_custo = EXCLUDED.centro_custo,
       modelo = EXCLUDED.modelo, campos = EXCLUDED.campos, retencoes = EXCLUDED.retencoes, ativa = EXCLUDED.ativa, atualizado_em = NOW()`,
    [tenantId, regra.id, regra.pessoa_tipo, regra.pessoa_id, regra.pessoa_nome, regra.produto_tipo, regra.fornecedor_id, regra.fornecedor_nome,
      regra.periodo, regra.inicio_semana, regra.faturar_por, regra.sentido, regra.prazo_dias, regra.dia_nao_util, regra.considerar_feriados,
      JSON.stringify(regra.faixas), regra.descricao, regra.solicitante, regra.centro_custo, regra.modelo, JSON.stringify(regra.campos),
      JSON.stringify(regra.retencoes), regra.ativa, usuario.nome || usuario.id],
  );
  return (await carregarRegra(exec, tenantId, regra.id))!;
}

/** Desliga a regra (as faturas que ela montou ficam). */
export async function desativarRegra(exec: ExecutorSQL, tenantId: string, id: string): Promise<void> {
  const { rowCount } = await exec.query(`UPDATE regras_faturamento SET ativa = FALSE, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rowCount) throw new ErroFatura('NAO_ACHOU', 'Regra não encontrada.', 404);
}

async function nomeDaPessoa(exec: ExecutorSQL, tenantId: string, tipo: TipoDePessoaDaRegra, id: string): Promise<string> {
  const sql = tipo === 'CLIENTE'
    ? `SELECT nome AS n FROM clientes WHERE tenant_id = $1 AND id = $2`
    : `SELECT nome_fantasia AS n FROM fornecedores_crm WHERE tenant_id = $1 AND id = $2`;
  const { rows } = await exec.query(sql, [tenantId, id]).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  return txt(rows[0]?.n);
}

// ============================================================
// O que o item é (da venda)
// ============================================================

interface InfoDoItem {
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  inicio: string;
  fim: string;
  produto_tipos: string[];
  fornecedor_ids: string[];
  detalhes: DetalhesDoItem;
  taxas_servico_centavos: number;
}

const COMPONENTES_DE_SERVICO = ['TAXA_DU', 'RAV', 'FEE'];

async function infoDoItem(exec: ExecutorSQL, tenantId: string, conta: { id: string; data: Record<string, unknown> }): Promise<InfoDoItem> {
  const d = conta.data;
  const vendaId = txt(d.origem_venda_id) || txt(d.venda_id);
  const base: InfoDoItem = {
    venda_id: vendaId, venda_numero: '', data_venda: txt(d.data_emissao).slice(0, 10) || hojeISO(), inicio: '', fim: '',
    produto_tipos: [], fornecedor_ids: [],
    detalhes: { produtos: [], centro_custo: txt(d.centro_custo), solicitante: '', cliente_nome: txt(d.cliente_nome) },
    taxas_servico_centavos: 0,
  };
  if (!vendaId) return base;
  const { rows: cab } = await exec.query(`SELECT data FROM vendas_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, vendaId]);
  const v = (cab[0]?.data ?? {}) as Record<string, unknown>;
  base.venda_numero = txt(v.numero);
  if (DATA.test(txt(v.data_venda).slice(0, 10))) base.data_venda = txt(v.data_venda).slice(0, 10);
  const { rows: mod } = await exec.query(`SELECT * FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [tenantId, vendaId])
    .catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  if (!mod[0]) return base;
  base.venda_numero = txt(mod[0].numero) || base.venda_numero;
  base.data_venda = dataISO(mod[0].data_venda) ?? base.data_venda;
  if (txt(mod[0].centro_custo)) base.detalhes.centro_custo = base.detalhes.centro_custo || txt(mod[0].centro_custo);
  // Viagem corporativa (E7): o solicitante da venda e os dados da empresa cliente.
  const corp = normalizarCorporativo(mod[0].corporativo);
  if (corp) {
    if (corp.solicitante) base.detalhes.solicitante = corp.solicitante;
    const item: CorporativoDoItem = {};
    if (corp.centro_custo) item.cc_cliente = corp.centro_custo;
    for (const k of ['aprovador', 'matricula', 'projeto', 'motivo', 'requisicao'] as const) if (corp[k]) item[k] = corp[k];
    if (Object.keys(item).length) base.detalhes.corporativo = item;
  }
  const { rows: prods } = await exec.query(
    `SELECT id, tipo, descricao, fornecedor_id, fornecedor_nome, localizador, data_inicio, data_fim, cambio FROM venda_produtos
      WHERE tenant_id = $1 AND venda_id = $2 AND cancelado_em IS NULL ORDER BY sequencia, id`,
    [tenantId, vendaId],
  );
  const { rows: pax } = await exec.query(
    `SELECT produto_id, nome FROM venda_passageiros WHERE tenant_id = $1 AND venda_id = $2 AND cancelado_em IS NULL ORDER BY ordem, id`,
    [tenantId, vendaId],
  );
  const { rows: comps } = await exec.query(
    `SELECT produto_id, tipo, valor_centavos FROM venda_componentes WHERE tenant_id = $1 AND venda_id = $2 AND tipo = ANY($3::text[])`,
    [tenantId, vendaId, COMPONENTES_DE_SERVICO],
  );
  const cambio = new Map(prods.map(p => [txt(p.id), Number(p.cambio) || 1]));
  for (const p of prods) {
    const ini = dataISO(p.data_inicio) ?? '';
    const fim = dataISO(p.data_fim) ?? '';
    if (ini && (!base.inicio || ini < base.inicio)) base.inicio = ini;
    if (fim && (!base.fim || fim > base.fim)) base.fim = fim;
    if (!base.produto_tipos.includes(txt(p.tipo))) base.produto_tipos.push(txt(p.tipo));
    if (txt(p.fornecedor_id) && !base.fornecedor_ids.includes(txt(p.fornecedor_id))) base.fornecedor_ids.push(txt(p.fornecedor_id));
    base.detalhes.produtos.push({
      tipo: txt(p.tipo), descricao: txt(p.descricao), fornecedor_nome: txt(p.fornecedor_nome), localizador: txt(p.localizador),
      data_inicio: ini, data_fim: fim, passageiros: pax.filter(x => txt(x.produto_id) === txt(p.id)).map(x => txt(x.nome)).filter(Boolean),
    });
  }
  if (!base.fim) base.fim = base.inicio;
  // Taxas de serviço (Taxa DU, RAV, Fee) na proporção do que esta conta representa da venda.
  const totalServico = comps.reduce((a, c) => a + Math.round((Number(c.valor_centavos) || 0) * (cambio.get(txt(c.produto_id)) ?? 1)), 0);
  const totalCliente = Number(mod[0].total_cliente_centavos) || 0;
  const valor = centavosDe(d.valor_final);
  base.taxas_servico_centavos = totalCliente > 0 ? Math.round(totalServico * Math.min(1, valor / totalCliente)) : 0;
  return base;
}

// ============================================================
// A conta a receber da fatura
// ============================================================

function descricaoDoTitulo(f: Pick<Fatura, 'numero' | 'descricao' | 'pessoa_nome'>): string {
  return [`Fatura Nº ${f.numero}`, f.descricao || f.pessoa_nome].filter(Boolean).join(' - ');
}

async function criarTitulo(exec: ExecutorSQL, tenantId: string, f: Fatura, hoje: string, empresaId?: string): Promise<string> {
  const id = generateId();
  const dados: Record<string, unknown> = {
    id, origem: 'FATURA', venda_id: null, grupo_id: null, cliente_id: f.pessoa_id, cliente_nome: f.pessoa_nome,
    descricao: descricaoDoTitulo(f), categoria_id: '', centro_custo: f.centro_custo, valor_original: 0, juros: 0, multa: 0, desconto: 0,
    valor_final: 0, data_emissao: hoje, data_vencimento: f.vencimento, data_recebimento: null, valor_recebido: null,
    conta_bancaria_id: null, forma_recebimento: 'FATURAR', taxa: 0, taxa_plataforma: '', parcela_numero: 1, total_parcelas: 1,
    boleto_emitido: false, boleto_codigo: '', boleto_url: '', status: 'PENDENTE', rateio: [], anexos: [], observacoes: '',
    fatura_id: f.id, fatura_numero: f.numero, fatura_situacao: f.situacao, gerado_pela_fatura: true,
    // Várias empresas (E7): a conta da fatura é da empresa da fatura.
    ...(empresaId ? { empresa_id: empresaId } : {}),
  };
  await exec.query(
    `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, status, data, created_at, updated_at) VALUES ($1,$2,'',$3,'PENDENTE',$4::jsonb,NOW(),NOW())`,
    [id, tenantId, f.pessoa_id, JSON.stringify(dados)],
  );
  return id;
}

/**
 * Recalcula os totais e a conta a receber da fatura a partir dos itens e das
 * notas. Fatura aberta que ficou sem nada é cancelada (e a conta dela também).
 */
export async function recalcularFatura(exec: ExecutorSQL, tenantId: string, faturaId: string, hoje = hojeISO()): Promise<Fatura | null> {
  const f = await carregarFatura(exec, tenantId, faturaId);
  if (!f || f.situacao === 'CANCELADA') return f;
  const itens = await itensDa(exec, tenantId, faturaId);
  const ajustes = await ajustesDa(exec, tenantId, faturaId);
  if (f.situacao === 'ABERTA' && !itens.length && !ajustes.length) {
    const t = await tituloDa(exec, tenantId, f);
    if (!t || !(STATUS_BAIXADOS as readonly string[]).includes(t.status)) {
      await exec.query(`UPDATE faturas SET situacao = 'CANCELADA', total_itens_centavos = 0, total_centavos = 0, total_creditos_centavos = 0, total_debitos_centavos = 0, total_retencoes_centavos = 0, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, faturaId]);
      if (f.titulo_id) {
        await exec.query(
          `UPDATE contas_receber SET status = 'CANCELADO', data = data || jsonb_build_object('status','CANCELADO','valor_final',0,'valor_original',0,'fatura_situacao','CANCELADA'), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, f.titulo_id],
        );
      }
      await registrarEventoDaFatura(exec, tenantId, faturaId, 'cancelada_sem_itens', { usuario: SISTEMA, motivo: 'A fatura ficou sem itens e sem notas.' });
      return carregarFatura(exec, tenantId, faturaId);
    }
  }
  const tot = totaisDaFatura(itens, ajustes, f.retencoes);
  await exec.query(
    `UPDATE faturas SET total_itens_centavos = $3, total_creditos_centavos = $4, total_debitos_centavos = $5, total_retencoes_centavos = $6,
       total_centavos = $7, invalida = $8, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, faturaId, tot.itens, tot.creditos, tot.debitos, tot.total_retencoes, tot.liquido, tot.invalida],
  );
  const atual = (await carregarFatura(exec, tenantId, faturaId))!;
  let tituloId = atual.titulo_id;
  if (!tituloId) {
    tituloId = await criarTitulo(exec, tenantId, atual, hoje);
    await exec.query(`UPDATE faturas SET titulo_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, faturaId, tituloId]);
    atual.titulo_id = tituloId;
  }
  await atualizarTitulo(exec, tenantId, atual, itens, tot);
  return atual;
}

async function atualizarTitulo(exec: ExecutorSQL, tenantId: string, f: Fatura, itens: ItemDaFatura[], tot: TotaisDaFatura): Promise<void> {
  const t = await tituloDa(exec, tenantId, f);
  if (!t) return;
  const travado = (STATUS_BAIXADOS as readonly string[]).includes(t.status) || await cobrancaValendo(exec, tenantId, f.titulo_id);
  // Parte de cada venda na fatura (o Resultado do mês, no caixa, divide o recebido por venda).
  const porVenda = new Map<string, number>();
  for (const i of itens) if (i.venda_id) porVenda.set(i.venda_id, (porVenda.get(i.venda_id) ?? 0) + i.valor_centavos);
  const fatura_vendas = [...porVenda.entries()].map(([venda_id, c]) => ({ venda_id, valor: reais(c) }));
  const sempre: Record<string, unknown> = {
    fatura_id: f.id, fatura_numero: f.numero, fatura_situacao: f.situacao, fatura_vendas, gerado_pela_fatura: true,
    fatura_bruto: reais(tot.bruto), fatura_retencoes: tot.retencoes.map(r => ({ nome: r.nome, percentual: r.percentual, valor: reais(r.valor_centavos) })),
    descricao: descricaoDoTitulo(f), cliente_nome: f.pessoa_nome, centro_custo: f.centro_custo,
  };
  if (f.emissao) sempre.data_emissao = f.emissao;
  if (!travado) {
    const valor = reais(Math.max(0, tot.liquido));
    Object.assign(sempre, { valor_final: valor, valor_original: valor, data_vencimento: f.vencimento });
  }
  await exec.query(`UPDATE contas_receber SET data = data || $3::jsonb, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, f.titulo_id, JSON.stringify(sempre)]);
}

// ============================================================
// Criar fatura, incluir e tirar itens
// ============================================================

async function proximoNumero(exec: ExecutorSQL, tenantId: string): Promise<number> {
  const { rows } = await exec.query(`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM faturas WHERE tenant_id = $1`, [tenantId]);
  return Number(rows[0]?.n) || 1;
}

interface NovaFatura {
  pessoa_id: string;
  pessoa_nome: string;
  regra?: RegraDeFaturamento | null;
  chave: string;
  inicio: string | null;
  fim: string | null;
  vencimento: string;
  vencimento_ajuste?: string;
  avulsa?: boolean;
  complementar_de?: string;
  /** Empresa da fatura (E7). Ausente = a principal (agência de uma empresa só). */
  empresa_id?: string;
}

/** A empresa de uma fatura (E7): coluna empresa_id; sem ela, a principal. */
async function empresaDaFatura(exec: ExecutorSQL, tenantId: string, faturaId: string): Promise<string> {
  const { rows } = await exec.query(
    `SELECT COALESCE(NULLIF(to_jsonb(f)->>'empresa_id', ''), 'principal') AS e FROM faturas f WHERE tenant_id = $1 AND id = $2`,
    [tenantId, faturaId]);
  return txt(rows[0]?.e) || EMPRESA_PRINCIPAL_ID;
}

/** A chave da fatura aberta ganha a empresa quando não é a principal (E7). */
function chaveNaEmpresa(chave: string, empresa: string | undefined): string {
  return empresa && empresa !== EMPRESA_PRINCIPAL_ID ? `${chave}|emp:${empresa}` : chave;
}

async function criarFatura(exec: ExecutorSQL, tenantId: string, n: NovaFatura, usuario: UsuarioDaFatura, hoje: string): Promise<Fatura> {
  const id = `fat-${generateId()}`;
  const numero = await proximoNumero(exec, tenantId);
  const r = n.regra;
  await exec.query(
    `INSERT INTO faturas (tenant_id, id, numero, pessoa_id, pessoa_nome, regra_id, chave, periodo_inicio, periodo_fim, vencimento, vencimento_ajuste,
       avulsa, complementar_de, descricao, solicitante, centro_custo, modelo, campos, retencoes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,'')::date,NULLIF($9,'')::date,$10::date,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb)`,
    [tenantId, id, numero, n.pessoa_id, n.pessoa_nome, r?.id ?? '', n.chave, n.inicio ?? '', n.fim ?? '', n.vencimento, n.vencimento_ajuste ?? '',
      n.avulsa === true, n.complementar_de ?? '', r?.descricao ?? '', r?.solicitante ?? '', r?.centro_custo ?? '', r?.modelo ?? 'PADRAO',
      JSON.stringify(r?.campos ?? []), JSON.stringify(r?.retencoes ?? {})],
  );
  // Várias empresas (E7): a fatura e a conta dela ficam na empresa dos itens.
  if (n.empresa_id && n.empresa_id !== EMPRESA_PRINCIPAL_ID) {
    await exec.query(`UPDATE faturas SET empresa_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, n.empresa_id]);
  }
  const f = (await carregarFatura(exec, tenantId, id))!;
  f.titulo_id = await criarTitulo(exec, tenantId, f, hoje, n.empresa_id);
  await exec.query(`UPDATE faturas SET titulo_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, f.titulo_id]);
  await registrarEventoDaFatura(exec, tenantId, id, 'criada', {
    usuario, detalhe: { regra_id: r?.id ?? '', vencimento: n.vencimento, avulsa: n.avulsa === true, complementar_de: n.complementar_de ?? '' },
  });
  await anexarAjustesPendentes(exec, tenantId, f);
  return f;
}

/** Notas que esperavam a próxima fatura do pagante entram nesta. */
async function anexarAjustesPendentes(exec: ExecutorSQL, tenantId: string, f: Fatura): Promise<number> {
  const { rowCount } = await exec.query(
    `UPDATE fatura_ajustes SET fatura_id = $3 WHERE tenant_id = $1 AND pessoa_id = $2 AND fatura_id = ''`,
    [tenantId, f.pessoa_id, f.id],
  );
  if (rowCount) await registrarEventoDaFatura(exec, tenantId, f.id, 'notas_anexadas', { usuario: SISTEMA, detalhe: { quantidade: rowCount } });
  return rowCount ?? 0;
}

async function acharOuCriarFaturaAberta(
  exec: ExecutorSQL, tenantId: string, n: NovaFatura, usuario: UsuarioDaFatura, hoje: string,
): Promise<Fatura> {
  n = { ...n, chave: chaveNaEmpresa(n.chave, n.empresa_id) };
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_FATURA} FROM faturas WHERE tenant_id = $1 AND pessoa_id = $2 AND chave = $3 AND situacao = 'ABERTA'`,
    [tenantId, n.pessoa_id, n.chave],
  );
  if (rows[0]) return lerFatura(rows[0]);
  // A fatura deste período já foi fechada: o item vai para uma fatura complementar do mesmo período.
  const { rows: fechada } = await exec.query(
    `SELECT id FROM faturas WHERE tenant_id = $1 AND pessoa_id = $2 AND chave = $3 AND situacao = 'FECHADA' ORDER BY numero DESC LIMIT 1`,
    [tenantId, n.pessoa_id, n.chave],
  );
  return criarFatura(exec, tenantId, { ...n, complementar_de: n.complementar_de ?? txt(fechada[0]?.id) }, usuario, hoje);
}

async function incluirItem(
  exec: ExecutorSQL, tenantId: string, f: Fatura, conta: { id: string; status: string; data: Record<string, unknown> },
  info: InfoDoItem, referencia: string | null, usuario: UsuarioDaFatura,
): Promise<boolean> {
  const d = conta.data;
  const descricao = [info.venda_numero ? `Venda ${info.venda_numero}` : txt(d.descricao), info.detalhes.produtos.map(p => p.descricao).filter(Boolean).join(' + ')]
    .filter(Boolean).join(' - ').slice(0, 300) || txt(d.descricao);
  const detalhes: DetalhesDoItem = { ...info.detalhes, solicitante: info.detalhes.solicitante || f.solicitante };
  const { rowCount } = await exec.query(
    `INSERT INTO fatura_itens (tenant_id, conta_id, fatura_id, venda_id, venda_numero, data_venda, data_referencia, descricao, valor_centavos,
       taxas_servico_centavos, detalhes, incluido_por)
     VALUES ($1,$2,$3,$4,$5,NULLIF($6,'')::date,NULLIF($7,'')::date,$8,$9,$10,$11::jsonb,$12)
     ON CONFLICT (tenant_id, conta_id) DO NOTHING`,
    [tenantId, conta.id, f.id, info.venda_id, info.venda_numero, info.data_venda, referencia ?? '', descricao, centavosDe(d.valor_final),
      info.taxas_servico_centavos, JSON.stringify(detalhes), usuario.nome || usuario.id],
  );
  if (!rowCount) return false;
  const carimbo = { fatura_id: f.id, numero: f.numero, status_anterior: conta.status || 'PENDENTE' };
  await exec.query(
    `UPDATE contas_receber SET status = 'CANCELADO', data = data || jsonb_build_object('status','CANCELADO','na_fatura',$3::jsonb), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, conta.id, JSON.stringify(carimbo)],
  );
  return true;
}

/** Tira o item da fatura: a conta volta ao que era (sem o carimbo). */
async function soltarItem(exec: ExecutorSQL, tenantId: string, contaId: string, marcarManual: boolean): Promise<void> {
  await exec.query(`DELETE FROM fatura_itens WHERE tenant_id = $1 AND conta_id = $2`, [tenantId, contaId]);
  const { rows } = await exec.query(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND id = $2`, [tenantId, contaId]);
  if (!rows[0]) return;
  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  const carimbo = (d.na_fatura ?? null) as { status_anterior?: string } | null;
  if (!carimbo) return;
  const volta = txt(carimbo.status_anterior) || 'PENDENTE';
  await exec.query(
    `UPDATE contas_receber SET status = $3, data = (data - 'na_fatura') || jsonb_build_object('status', $3::text, 'fatura_manual', $4::boolean), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, contaId, volta, marcarManual],
  );
}

async function moverItemPara(exec: ExecutorSQL, tenantId: string, contaId: string, destino: Fatura): Promise<void> {
  await exec.query(`UPDATE fatura_itens SET fatura_id = $3 WHERE tenant_id = $1 AND conta_id = $2`, [tenantId, contaId, destino.id]);
  await exec.query(
    `UPDATE contas_receber SET data = jsonb_set(jsonb_set(data, '{na_fatura,fatura_id}', to_jsonb($3::text)), '{na_fatura,numero}', to_jsonb($4::int)), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND data ? 'na_fatura'`,
    [tenantId, contaId, destino.id, destino.numero],
  );
}

// ============================================================
// Alocação automática pela regra
// ============================================================

export interface ResultadoDaAlocacao {
  alocados: Array<{ conta_id: string; fatura_id: string; numero: number; vencimento: string }>;
  /** Pagantes sem regra de faturamento: a conta fica como está, com o vencimento da venda. */
  sem_regra: string[];
  faturas: string[];
}

/**
 * Junta nas faturas os itens a faturar ainda soltos (conta da forma Faturar,
 * em aberto, sem cobrança emitida e que ninguém tirou da fatura à mão).
 * Idempotente: rodar de novo não muda nada.
 */
export async function alocarItens(
  exec: ExecutorSQL, tenantId: string,
  filtro: { venda_id?: string; conta_ids?: string[]; pessoa_id?: string; incluir_manuais?: boolean } = {},
  o: { usuario?: UsuarioDaFatura; hoje?: string } = {},
): Promise<ResultadoDaAlocacao> {
  const hoje = o.hoje ?? hojeISO();
  const usuario = o.usuario ?? SISTEMA;
  await travarFaturas(exec, tenantId);
  const where = [
    `c.tenant_id = $1`, `c.data->>'faturar' = 'true'`,
    `COALESCE(NULLIF(c.data->>'status',''), c.status, '') = ANY($2::text[])`,
    `NOT EXISTS (SELECT 1 FROM fatura_itens fi WHERE fi.tenant_id = c.tenant_id AND fi.conta_id = c.id)`,
  ];
  const args: unknown[] = [tenantId, STATUS_LIVRES];
  if (!filtro.incluir_manuais) where.push(`COALESCE(c.data->>'fatura_manual','false') <> 'true'`);
  if (filtro.venda_id) { args.push(filtro.venda_id); where.push(`(c.data->>'origem_venda_id' = $${args.length} OR c.venda_id = $${args.length})`); }
  if (filtro.conta_ids) { args.push(filtro.conta_ids); where.push(`c.id = ANY($${args.length}::text[])`); }
  if (filtro.pessoa_id) { args.push(filtro.pessoa_id); where.push(`COALESCE(NULLIF(c.cliente_id,''), c.data->>'cliente_id') = $${args.length}`); }
  if (await temCobrancas(exec)) {
    where.push(`NOT EXISTS (SELECT 1 FROM cobrancas cb WHERE cb.tenant_id = c.tenant_id AND cb.titulo_tabela = 'contas_receber' AND cb.titulo_id = c.id AND cb.status IN ('emitindo','aberta','vencida'))`);
  }
  const { rows } = await exec.query(`SELECT c.id, c.status, c.data FROM contas_receber c WHERE ${where.join(' AND ')} ORDER BY c.data->>'data_vencimento', c.id LIMIT 2000`, args);
  const res: ResultadoDaAlocacao = { alocados: [], sem_regra: [], faturas: [] };
  if (!rows.length) return res;
  const cal = await calendarioDaAgencia(exec, tenantId);
  const regrasPorPessoa = new Map<string, RegraDeFaturamento[]>();
  const tocadas = new Set<string>();
  for (const r of rows) {
    const data = (r.data ?? {}) as Record<string, unknown>;
    const conta = { id: txt(r.id), status: txt(data.status ?? r.status), data };
    const pessoa = txt(data.cliente_id);
    if (!pessoa) { res.sem_regra.push(conta.id); continue; }
    if (!regrasPorPessoa.has(pessoa)) regrasPorPessoa.set(pessoa, await listarRegras(exec, tenantId, { pessoa_tipo: 'CLIENTE', pessoa_id: pessoa }));
    const info = await infoDoItem(exec, tenantId, conta);
    const regra = escolherRegra(regrasPorPessoa.get(pessoa)!, { pessoa_tipo: 'CLIENTE', pessoa_id: pessoa, produto_tipos: info.produto_tipos, fornecedor_ids: info.fornecedor_ids });
    if (!regra) { res.sem_regra.push(conta.id); continue; }
    const pos = posicaoDoItem(regra, { venda: info.data_venda, inicio: info.inicio, fim: info.fim }, { item_id: conta.id, cal });
    const f = await acharOuCriarFaturaAberta(exec, tenantId, {
      pessoa_id: pessoa, pessoa_nome: txt(data.cliente_nome) || regra.pessoa_nome, regra, chave: pos.chave,
      inicio: pos.inicio, fim: pos.fim, vencimento: pos.vencimento, vencimento_ajuste: pos.ajuste, avulsa: regra.periodo === 'AVULSO',
      // Uma fatura por empresa (E7): conta da empresa B não entra na fatura da A.
      empresa_id: empresaDoRegistro(data),
    }, usuario, hoje);
    if (await incluirItem(exec, tenantId, f, conta, info, pos.referencia, usuario)) {
      res.alocados.push({ conta_id: conta.id, fatura_id: f.id, numero: f.numero, vencimento: f.vencimento });
      tocadas.add(f.id);
    }
  }
  for (const id of tocadas) {
    await recalcularFatura(exec, tenantId, id, hoje);
    await registrarEventoDaFatura(exec, tenantId, id, 'itens_incluidos', {
      usuario, detalhe: { contas: res.alocados.filter(a => a.fatura_id === id).map(a => a.conta_id) },
    });
  }
  res.faturas = [...tocadas];
  return res;
}

// ============================================================
// Ações na fatura
// ============================================================

const ehDataValida = (s: string) => DATA.test(s);

export async function fecharFatura(exec: ExecutorSQL, tenantId: string, id: string, o: { usuario: UsuarioDaFatura; hoje?: string }): Promise<Fatura> {
  const hoje = o.hoje ?? hojeISO();
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, id);
  if (f.situacao === 'FECHADA') return f; // repetir não muda nada
  if (f.situacao === 'CANCELADA') throw new ErroFatura('FATURA_CANCELADA', `A fatura Nº ${f.numero} foi cancelada.`, 409);
  const atual = (await recalcularFatura(exec, tenantId, id, hoje))!;
  if (atual.situacao !== 'ABERTA') throw new ErroFatura('FATURA_VAZIA', 'A fatura não tem itens nem notas.', 409);
  if (atual.invalida) {
    throw new ErroFatura('FATURA_INVALIDA', `As notas de crédito (${brl(atual.total_creditos_centavos)}) passam do valor dos itens: a fatura ficaria negativa. Tire uma nota ou inclua itens antes de fechar.`, 409);
  }
  if (atual.total_centavos <= 0) throw new ErroFatura('FATURA_ZERADA', 'A fatura está zerada: não há o que cobrar.', 409);
  const { rows } = await exec.query(`SELECT MAX(data_venda) AS m FROM fatura_itens WHERE tenant_id = $1 AND fatura_id = $2`, [tenantId, id]);
  const ultimaVenda = dataISO(rows[0]?.m);
  if (ultimaVenda && ultimaVenda > hoje) {
    throw new ErroFatura('VENDA_FUTURA', `Há item de venda com data ${ultimaVenda.split('-').reverse().join('/')}: a fatura só fecha a partir desse dia (a emissão não pode vir antes da venda).`, 409);
  }
  await exec.query(
    `UPDATE faturas SET situacao = 'FECHADA', emissao = $3::date, fechada_em = NOW(), fechada_por = $4, conferencia = 'AGUARDANDO', atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, hoje, o.usuario.nome || o.usuario.id],
  );
  const fechada = (await carregarFatura(exec, tenantId, id))!;
  await atualizarTitulo(exec, tenantId, fechada, await itensDa(exec, tenantId, id), totaisDaFatura(await itensDa(exec, tenantId, id), await ajustesDa(exec, tenantId, id), fechada.retencoes));
  await registrarEventoDaFatura(exec, tenantId, id, 'fechada', { usuario: o.usuario, detalhe: { total_centavos: fechada.total_centavos, vencimento: fechada.vencimento } });
  return fechada;
}

/**
 * "Fechar e cobrar" fechou a fatura agora e a cobrança não saiu (provedor
 * recusou, cadastro incompleto): a fatura volta a ficar aberta, com o motivo
 * no histórico. Só desfaz se nada foi recebido nem há cobrança valendo.
 */
export async function desfazerFechamento(exec: ExecutorSQL, tenantId: string, id: string, motivo: string, usuario: UsuarioDaFatura): Promise<boolean> {
  await travarFaturas(exec, tenantId);
  const f = await carregarFatura(exec, tenantId, id);
  if (!f || f.situacao !== 'FECHADA') return false;
  const t = await tituloDa(exec, tenantId, f);
  if ((t && (STATUS_BAIXADOS as readonly string[]).includes(t.status)) || await cobrancaValendo(exec, tenantId, f.titulo_id)) return false;
  const { rows } = await exec.query(`SELECT 1 FROM faturas WHERE tenant_id = $1 AND pessoa_id = $2 AND chave = $3 AND situacao = 'ABERTA'`, [tenantId, f.pessoa_id, f.chave]);
  if (rows.length) return false;
  await exec.query(`UPDATE faturas SET situacao = 'ABERTA', conferencia = 'NAO_ENVIADA', fechada_em = NULL, fechada_por = '', atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  await registrarEventoDaFatura(exec, tenantId, id, 'fechamento_desfeito', { usuario, motivo: `A cobrança não saiu: ${motivo}`.slice(0, 1000) });
  await recalcularFatura(exec, tenantId, id);
  return true;
}

export const MOTIVO_MINIMO = 10;

export async function reabrirFatura(exec: ExecutorSQL, tenantId: string, id: string, o: { usuario: UsuarioDaFatura; motivo: string; hoje?: string }): Promise<Fatura> {
  const motivo = String(o.motivo ?? '').trim();
  if (motivo.length < MOTIVO_MINIMO) throw new ErroFatura('MOTIVO', 'Diga em uma frase por que a fatura vai ser reaberta.', 400);
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, id);
  if (f.situacao === 'ABERTA') return f;
  if (f.situacao === 'CANCELADA') throw new ErroFatura('FATURA_CANCELADA', `A fatura Nº ${f.numero} foi cancelada.`, 409);
  const t = await tituloDa(exec, tenantId, f);
  if (t && (STATUS_BAIXADOS as readonly string[]).includes(t.status)) {
    throw new ErroFatura('FATURA_RECEBIDA', `A fatura Nº ${f.numero} já tem pagamento registrado e não reabre. Para corrigir, lance uma nota de crédito ou débito.`, 409);
  }
  if (await cobrancaValendo(exec, tenantId, f.titulo_id)) {
    throw new ErroFatura('COBRANCA_VALENDO', `A fatura Nº ${f.numero} tem boleto ou Pix emitido. Cancele a cobrança em Cobranças antes de reabrir.`, 409);
  }
  const jaComOCliente = f.conferencia !== 'NAO_ENVIADA';
  // Se, depois do fechamento, nasceu uma fatura complementar aberta do mesmo período, ela volta para esta.
  const { rows: irma } = await exec.query(
    `SELECT ${COLUNAS_FATURA} FROM faturas WHERE tenant_id = $1 AND pessoa_id = $2 AND chave = $3 AND situacao = 'ABERTA'`,
    [tenantId, f.pessoa_id, f.chave],
  );
  await exec.query(
    `UPDATE faturas SET situacao = 'ABERTA', conferencia = 'NAO_ENVIADA', fechada_em = NULL, fechada_por = '', conferida_em = NULL, atualizado_em = NOW()
      WHERE tenant_id = $1 AND id = $2 AND NOT EXISTS (SELECT 1 FROM faturas x WHERE x.tenant_id = $1 AND x.pessoa_id = $3 AND x.chave = $4 AND x.situacao = 'ABERTA')`,
    [tenantId, id, f.pessoa_id, f.chave],
  );
  if (irma[0]) {
    const comp = lerFatura(irma[0]);
    // A complementar ocupa a chave: ela é cancelada e o que tinha volta para a reaberta.
    await exec.query(`UPDATE faturas SET situacao = 'CANCELADA', atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, comp.id]);
    await exec.query(`UPDATE faturas SET situacao = 'ABERTA', conferencia = 'NAO_ENVIADA', fechada_em = NULL, fechada_por = '', conferida_em = NULL, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    const reaberta = (await carregarFatura(exec, tenantId, id))!;
    for (const it of await itensDa(exec, tenantId, comp.id)) await moverItemPara(exec, tenantId, it.conta_id, reaberta);
    await exec.query(`UPDATE fatura_ajustes SET fatura_id = $3 WHERE tenant_id = $1 AND fatura_id = $2`, [tenantId, comp.id, id]);
    if (comp.titulo_id) {
      await exec.query(
        `UPDATE contas_receber SET status = 'CANCELADO', data = data || jsonb_build_object('status','CANCELADO','valor_final',0,'valor_original',0,'fatura_situacao','CANCELADA'), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, comp.titulo_id],
      );
    }
    await registrarEventoDaFatura(exec, tenantId, comp.id, 'juntada', { usuario: o.usuario, motivo: `Itens voltaram para a fatura Nº ${f.numero}, reaberta.` });
  }
  await registrarEventoDaFatura(exec, tenantId, id, 'reaberta', {
    usuario: o.usuario, motivo,
    detalhe: { cliente_ja_tinha_recebido: jaComOCliente, juntou_complementar: txt(irma[0]?.id) },
  });
  return (await recalcularFatura(exec, tenantId, id, o.hoje))!;
}

async function itensDaFatura(exec: ExecutorSQL, tenantId: string, f: Fatura, contaIds: string[]): Promise<ItemDaFatura[]> {
  const ids = [...new Set((contaIds ?? []).map(String).filter(Boolean))];
  if (!ids.length) throw new ErroFatura('SEM_ITENS', 'Escolha ao menos um item.', 400);
  const itens = (await itensDa(exec, tenantId, f.id)).filter(i => ids.includes(i.conta_id));
  if (itens.length !== ids.length) throw new ErroFatura('ITEM_DE_OUTRA', `Algum item escolhido não está na fatura Nº ${f.numero}.`, 409);
  return itens;
}

/** Mover itens para a fatura do pagante com outro vencimento (cria uma, se não houver). */
export async function moverItens(
  exec: ExecutorSQL, tenantId: string, faturaId: string, contaIds: string[], vencimento: string, o: { usuario: UsuarioDaFatura; hoje?: string },
): Promise<{ origem: Fatura | null; destino: Fatura }> {
  const hoje = o.hoje ?? hojeISO();
  if (!ehDataValida(vencimento)) throw new ErroFatura('DADOS', 'Escolha o vencimento de destino.', 400);
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, faturaId);
  await exigirEditavel(exec, tenantId, f);
  const itens = await itensDaFatura(exec, tenantId, f, contaIds);
  if (vencimento === f.vencimento) throw new ErroFatura('MESMO_VENCIMENTO', 'Os itens já estão numa fatura com este vencimento.', 409);
  // A fatura de destino é da mesma empresa (E7).
  const empresa = await empresaDaFatura(exec, tenantId, f.id);
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_FATURA} FROM faturas f2 WHERE tenant_id = $1 AND pessoa_id = $2 AND situacao = 'ABERTA' AND vencimento = $3::date AND id <> $4 AND NOT avulsa
        AND COALESCE(NULLIF(to_jsonb(f2)->>'empresa_id', ''), 'principal') = $5 ORDER BY numero LIMIT 1`,
    [tenantId, f.pessoa_id, vencimento, f.id, empresa],
  );
  const destino = rows[0] ? lerFatura(rows[0]) : await criarFatura(exec, tenantId, {
    pessoa_id: f.pessoa_id, pessoa_nome: f.pessoa_nome, regra: f.regra_id ? await carregarRegra(exec, tenantId, f.regra_id) : null,
    chave: chaveNaEmpresa(`manual|${vencimento}`, empresa), inicio: null, fim: null, vencimento, empresa_id: empresa,
  }, o.usuario, hoje);
  await exigirEditavel(exec, tenantId, destino);
  for (const it of itens) await moverItemPara(exec, tenantId, it.conta_id, destino);
  const total = itens.reduce((a, i) => a + i.valor_centavos, 0);
  await registrarEventoDaFatura(exec, tenantId, f.id, 'itens_movidos', { usuario: o.usuario, detalhe: { para: destino.numero, contas: itens.map(i => i.conta_id), valor_centavos: total } });
  await registrarEventoDaFatura(exec, tenantId, destino.id, 'itens_recebidos', { usuario: o.usuario, detalhe: { de: f.numero, contas: itens.map(i => i.conta_id), valor_centavos: total } });
  const origem = await recalcularFatura(exec, tenantId, f.id, hoje);
  return { origem, destino: (await recalcularFatura(exec, tenantId, destino.id, hoje))! };
}

/** Faturar avulso: os itens escolhidos saem para uma fatura só deles. */
export async function faturarAvulso(
  exec: ExecutorSQL, tenantId: string, faturaId: string, contaIds: string[], o: { usuario: UsuarioDaFatura; vencimento?: string; hoje?: string },
): Promise<{ origem: Fatura | null; avulsa: Fatura }> {
  const hoje = o.hoje ?? hojeISO();
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, faturaId);
  await exigirEditavel(exec, tenantId, f);
  const itens = await itensDaFatura(exec, tenantId, f, contaIds);
  const venc = o.vencimento && ehDataValida(o.vencimento) ? o.vencimento : f.vencimento;
  const avulsa = await criarFatura(exec, tenantId, {
    pessoa_id: f.pessoa_id, pessoa_nome: f.pessoa_nome, regra: f.regra_id ? await carregarRegra(exec, tenantId, f.regra_id) : null,
    chave: `avulsa|${generateId()}`, inicio: f.periodo_inicio, fim: f.periodo_fim, vencimento: venc, avulsa: true,
    empresa_id: await empresaDaFatura(exec, tenantId, f.id),
  }, o.usuario, hoje);
  for (const it of itens) await moverItemPara(exec, tenantId, it.conta_id, avulsa);
  const total = itens.reduce((a, i) => a + i.valor_centavos, 0);
  await registrarEventoDaFatura(exec, tenantId, f.id, 'faturado_avulso', { usuario: o.usuario, detalhe: { para: avulsa.numero, contas: itens.map(i => i.conta_id), valor_centavos: total } });
  await registrarEventoDaFatura(exec, tenantId, avulsa.id, 'itens_recebidos', { usuario: o.usuario, detalhe: { de: f.numero, contas: itens.map(i => i.conta_id), valor_centavos: total } });
  const origem = await recalcularFatura(exec, tenantId, f.id, hoje);
  return { origem, avulsa: (await recalcularFatura(exec, tenantId, avulsa.id, hoje))! };
}

/** Faturar avulso itens que ainda não estão em fatura nenhuma (pagante sem regra, ou tirado à mão). */
export async function faturarSoltosAvulso(
  exec: ExecutorSQL, tenantId: string, contaIds: string[], o: { usuario: UsuarioDaFatura; vencimento?: string; hoje?: string },
): Promise<Fatura> {
  const hoje = o.hoje ?? hojeISO();
  await travarFaturas(exec, tenantId);
  const contas = await contasSoltas(exec, tenantId, contaIds);
  const pessoas = [...new Set(contas.map(c => txt(c.data.cliente_id)))];
  if (pessoas.length !== 1 || !pessoas[0]) throw new ErroFatura('PAGANTES_DIFERENTES', 'Escolha itens de um mesmo pagante.', 409);
  // Uma fatura é de uma empresa só (E7).
  const empresas = [...new Set(contas.map(c => empresaDoRegistro(c.data)))];
  if (empresas.length > 1) throw new ErroFatura('EMPRESAS_DIFERENTES', 'Os itens escolhidos são de empresas diferentes. Gere uma fatura para cada empresa.', 409);
  const venc = o.vencimento && ehDataValida(o.vencimento) ? o.vencimento : (contas.map(c => txt(c.data.data_vencimento).slice(0, 10)).filter(ehDataValida).sort()[0] || addDias(hoje, 30));
  const regra = escolherRegra(await listarRegras(exec, tenantId, { pessoa_tipo: 'CLIENTE', pessoa_id: pessoas[0] }), { pessoa_tipo: 'CLIENTE', pessoa_id: pessoas[0], produto_tipos: [], fornecedor_ids: [] });
  const f = await criarFatura(exec, tenantId, {
    pessoa_id: pessoas[0], pessoa_nome: txt(contas[0].data.cliente_nome), regra, chave: `avulsa|${generateId()}`,
    inicio: null, fim: null, vencimento: venc, avulsa: true, empresa_id: empresas[0],
  }, o.usuario, hoje);
  for (const c of contas) await incluirItem(exec, tenantId, f, c, await infoDoItem(exec, tenantId, c), null, o.usuario);
  await registrarEventoDaFatura(exec, tenantId, f.id, 'itens_incluidos', { usuario: o.usuario, detalhe: { contas: contas.map(c => c.id), avulsa: true } });
  return (await recalcularFatura(exec, tenantId, f.id, hoje))!;
}

async function contasSoltas(exec: ExecutorSQL, tenantId: string, contaIds: string[]): Promise<Array<{ id: string; status: string; data: Record<string, unknown> }>> {
  const ids = [...new Set((contaIds ?? []).map(String).filter(Boolean))];
  if (!ids.length) throw new ErroFatura('SEM_ITENS', 'Escolha ao menos um item.', 400);
  const { rows } = await exec.query(
    `SELECT c.id, c.status, c.data FROM contas_receber c WHERE c.tenant_id = $1 AND c.id = ANY($2::text[])
       AND NOT EXISTS (SELECT 1 FROM fatura_itens fi WHERE fi.tenant_id = c.tenant_id AND fi.conta_id = c.id)`,
    [tenantId, ids],
  );
  const contas = rows.map(r => ({ id: txt(r.id), status: txt((r.data as Record<string, unknown>)?.status ?? r.status), data: (r.data ?? {}) as Record<string, unknown> }));
  if (contas.length !== ids.length) throw new ErroFatura('ITEM_INDISPONIVEL', 'Algum item escolhido já está numa fatura ou não existe.', 409);
  for (const c of contas) {
    if (c.data.faturar !== true) throw new ErroFatura('NAO_E_FATURAR', `"${txt(c.data.descricao)}" não é da forma Faturar.`, 409);
    if (!STATUS_LIVRES.includes(c.status)) throw new ErroFatura('ITEM_INDISPONIVEL', `"${txt(c.data.descricao)}" não está em aberto.`, 409);
    if (await cobrancaValendo(exec, tenantId, c.id)) throw new ErroFatura('COBRANCA_VALENDO', `"${txt(c.data.descricao)}" já tem boleto ou Pix emitido: cancele a cobrança antes de faturar.`, 409);
  }
  return contas;
}

/** Adicionar itens soltos do mesmo pagante a uma fatura aberta. */
export async function adicionarItens(
  exec: ExecutorSQL, tenantId: string, faturaId: string, contaIds: string[], o: { usuario: UsuarioDaFatura; hoje?: string },
): Promise<Fatura> {
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, faturaId);
  await exigirEditavel(exec, tenantId, f);
  const contas = await contasSoltas(exec, tenantId, contaIds);
  if (contas.some(c => txt(c.data.cliente_id) !== f.pessoa_id)) throw new ErroFatura('PAGANTES_DIFERENTES', `Só entram itens de ${f.pessoa_nome || 'quem paga esta fatura'}.`, 409);
  for (const c of contas) await incluirItem(exec, tenantId, f, c, await infoDoItem(exec, tenantId, c), null, o.usuario);
  await registrarEventoDaFatura(exec, tenantId, f.id, 'itens_incluidos', { usuario: o.usuario, detalhe: { contas: contas.map(c => c.id), manual: true } });
  return (await recalcularFatura(exec, tenantId, f.id, o.hoje))!;
}

/** Tirar itens da fatura: voltam a ser contas a receber soltas e não entram sozinhos de novo. */
export async function tirarItens(
  exec: ExecutorSQL, tenantId: string, faturaId: string, contaIds: string[], o: { usuario: UsuarioDaFatura; hoje?: string },
): Promise<Fatura | null> {
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, faturaId);
  await exigirEditavel(exec, tenantId, f);
  const itens = await itensDaFatura(exec, tenantId, f, contaIds);
  for (const it of itens) await soltarItem(exec, tenantId, it.conta_id, true);
  await registrarEventoDaFatura(exec, tenantId, f.id, 'itens_retirados', { usuario: o.usuario, detalhe: { contas: itens.map(i => i.conta_id) } });
  return recalcularFatura(exec, tenantId, f.id, o.hoje);
}

/**
 * Para a parte D (cancelamento da venda): tira das faturas ABERTAS os itens da
 * venda, devolvendo as contas ao que eram. Itens de fatura fechada ficam (a
 * diferença vira nota de crédito pela parte D).
 */
export async function retirarItensDaVenda(exec: ExecutorSQL, tenantId: string, vendaId: string, o: { usuario?: UsuarioDaFatura; motivo?: string; hoje?: string } = {}): Promise<{ retirados: string[]; em_fatura_fechada: string[] }> {
  if (!(await faturasDisponiveis(exec))) return { retirados: [], em_fatura_fechada: [] };
  await travarFaturas(exec, tenantId);
  const { rows } = await exec.query(
    `SELECT fi.conta_id, fi.fatura_id, f.situacao, f.titulo_id FROM fatura_itens fi JOIN faturas f ON f.tenant_id = fi.tenant_id AND f.id = fi.fatura_id
      WHERE fi.tenant_id = $1 AND fi.venda_id = $2`,
    [tenantId, vendaId],
  );
  const retirados: string[] = [];
  const fechados: string[] = [];
  const tocadas = new Set<string>();
  for (const r of rows) {
    const f = await carregarFatura(exec, tenantId, txt(r.fatura_id));
    let editavel = !!f && f.situacao === 'ABERTA';
    if (editavel && f) { try { await exigirEditavel(exec, tenantId, f); } catch { editavel = false; } }
    if (!editavel) { fechados.push(txt(r.conta_id)); continue; }
    await soltarItem(exec, tenantId, txt(r.conta_id), false);
    retirados.push(txt(r.conta_id));
    tocadas.add(txt(r.fatura_id));
  }
  for (const id of tocadas) {
    await registrarEventoDaFatura(exec, tenantId, id, 'itens_retirados', { usuario: o.usuario ?? SISTEMA, motivo: o.motivo ?? 'Venda cancelada.', detalhe: { venda_id: vendaId } });
    await recalcularFatura(exec, tenantId, id, o.hoje);
  }
  return { retirados, em_fatura_fechada: fechados };
}

// ============================================================
// Notas de crédito e de débito
// ============================================================

export interface NovaNota {
  pessoa_id: string;
  pessoa_nome?: string;
  tipo: 'CREDITO' | 'DEBITO';
  valor_centavos: number;
  motivo: string;
  /** Fatura aberta onde a nota entra. Vazio = a próxima fatura aberta do pagante (ou espera a próxima). */
  fatura_id?: string;
  origem_fatura_id?: string;
  conta_id?: string;
  venda_id?: string;
  /** Mesma chave = mesma nota (repetir não duplica). */
  chave?: string;
}

/** A fatura aberta mais próxima do pagante (a próxima a vencer, a partir de hoje). */
async function proximaAbertaDoPagante(exec: ExecutorSQL, tenantId: string, pessoaId: string, excluir: string, hoje: string): Promise<Fatura | null> {
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_FATURA} FROM faturas f WHERE f.tenant_id = $1 AND f.pessoa_id = $2 AND f.situacao = 'ABERTA' AND f.id <> $3
       AND NOT EXISTS (SELECT 1 FROM contas_receber t WHERE t.tenant_id = f.tenant_id AND t.id = f.titulo_id AND COALESCE(t.data->>'status', t.status) IN ('RECEBIDO','PARCIAL'))
     ORDER BY (f.vencimento < $4::date), f.vencimento, f.numero LIMIT 1`,
    [tenantId, pessoaId, excluir, hoje],
  );
  return rows[0] ? lerFatura(rows[0]) : null;
}

export async function lancarNota(exec: ExecutorSQL, tenantId: string, n: NovaNota, o: { usuario: UsuarioDaFatura; hoje?: string }): Promise<AjusteDaFatura> {
  const hoje = o.hoje ?? hojeISO();
  const motivo = String(n.motivo ?? '').trim();
  const valor = Math.round(Number(n.valor_centavos) || 0);
  if (n.tipo !== 'CREDITO' && n.tipo !== 'DEBITO') throw new ErroFatura('DADOS', 'Diga se é nota de crédito ou de débito.', 400);
  if (valor <= 0) throw new ErroFatura('DADOS', 'O valor da nota precisa ser maior que zero.', 400);
  if (motivo.length < 5) throw new ErroFatura('MOTIVO', 'Escreva o motivo da nota: o cliente vai ler.', 400);
  if (!n.pessoa_id) throw new ErroFatura('DADOS', 'Diga de quem é a nota.', 400);
  await travarFaturas(exec, tenantId);
  if (n.chave) {
    const { rows } = await exec.query(`SELECT ${COLUNAS_AJUSTE} FROM fatura_ajustes WHERE tenant_id = $1 AND chave = $2`, [tenantId, n.chave]);
    if (rows[0]) return lerAjuste(rows[0]);
  }
  let destino: Fatura | null = null;
  if (n.fatura_id) {
    destino = await exigirFatura(exec, tenantId, n.fatura_id);
    await exigirEditavel(exec, tenantId, destino);
    if (destino.pessoa_id !== n.pessoa_id) throw new ErroFatura('PAGANTES_DIFERENTES', 'A nota é de outro pagante.', 409);
  } else {
    destino = await proximaAbertaDoPagante(exec, tenantId, n.pessoa_id, n.origem_fatura_id ?? '', hoje);
  }
  const id = `aj-${generateId()}`;
  const pessoaNome = n.pessoa_nome || destino?.pessoa_nome || '';
  await exec.query(
    `INSERT INTO fatura_ajustes (tenant_id, id, pessoa_id, pessoa_nome, fatura_id, origem_fatura_id, conta_id, venda_id, tipo, valor_centavos, motivo, chave, criado_por, criado_por_nome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [tenantId, id, n.pessoa_id, pessoaNome, destino?.id ?? '', n.origem_fatura_id ?? '', n.conta_id ?? '', n.venda_id ?? '', n.tipo, valor,
      motivo.slice(0, 1000), n.chave ?? '', o.usuario.id, o.usuario.nome],
  );
  const rotulo = n.tipo === 'CREDITO' ? 'nota de crédito' : 'nota de débito';
  if (destino) {
    await registrarEventoDaFatura(exec, tenantId, destino.id, 'nota_lancada', { usuario: o.usuario, motivo, detalhe: { ajuste_id: id, tipo: n.tipo, valor_centavos: valor } });
    await recalcularFatura(exec, tenantId, destino.id, hoje);
  }
  if (n.origem_fatura_id && n.origem_fatura_id !== destino?.id) {
    await registrarEventoDaFatura(exec, tenantId, n.origem_fatura_id, 'nota_para_proxima', {
      usuario: o.usuario, motivo, detalhe: { ajuste_id: id, tipo: n.tipo, valor_centavos: valor, destino: destino?.numero ?? null, rotulo },
    });
  }
  const { rows } = await exec.query(`SELECT ${COLUNAS_AJUSTE} FROM fatura_ajustes WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return lerAjuste(rows[0]);
}

export async function removerNota(exec: ExecutorSQL, tenantId: string, ajusteId: string, o: { usuario: UsuarioDaFatura; hoje?: string }): Promise<void> {
  await travarFaturas(exec, tenantId);
  const { rows } = await exec.query(`SELECT ${COLUNAS_AJUSTE} FROM fatura_ajustes WHERE tenant_id = $1 AND id = $2`, [tenantId, ajusteId]);
  if (!rows[0]) throw new ErroFatura('NAO_ACHOU', 'Nota não encontrada.', 404);
  const a = lerAjuste(rows[0]);
  if (a.fatura_id) await exigirEditavel(exec, tenantId, await exigirFatura(exec, tenantId, a.fatura_id));
  await exec.query(`DELETE FROM fatura_ajustes WHERE tenant_id = $1 AND id = $2`, [tenantId, ajusteId]);
  if (a.fatura_id) {
    await registrarEventoDaFatura(exec, tenantId, a.fatura_id, 'nota_removida', { usuario: o.usuario, motivo: a.motivo, detalhe: { tipo: a.tipo, valor_centavos: a.valor_centavos } });
    await recalcularFatura(exec, tenantId, a.fatura_id, o.hoje);
  }
}

/**
 * Corrigir o valor de um item. Nunca reescreve o item nem a venda: a
 * diferença vira nota escrita — na própria fatura, se ela está aberta; na
 * próxima do pagante, se esta já foi fechada.
 */
export async function corrigirValor(
  exec: ExecutorSQL, tenantId: string, faturaId: string, contaId: string, novoCentavos: number,
  o: { usuario: UsuarioDaFatura; motivo: string; hoje?: string },
): Promise<{ nota: AjusteDaFatura | null; na_propria_fatura: boolean }> {
  const motivo = String(o.motivo ?? '').trim();
  if (motivo.length < 5) throw new ErroFatura('MOTIVO', 'Diga por que o valor muda: o cliente vai ler.', 400);
  const novo = Math.round(Number(novoCentavos));
  if (!Number.isFinite(novo) || novo < 0) throw new ErroFatura('DADOS', 'Informe o valor certo do item.', 400);
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, faturaId);
  if (f.situacao === 'CANCELADA') throw new ErroFatura('FATURA_CANCELADA', `A fatura Nº ${f.numero} foi cancelada.`, 409);
  const [item] = await itensDaFatura(exec, tenantId, f, [contaId]);
  const { rows } = await exec.query(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'DEBITO' THEN valor_centavos ELSE -valor_centavos END), 0) AS s FROM fatura_ajustes WHERE tenant_id = $1 AND conta_id = $2`,
    [tenantId, contaId],
  );
  const atual = item.valor_centavos + Number(rows[0]?.s ?? 0);
  const diferenca = novo - atual;
  if (diferenca === 0) return { nota: null, na_propria_fatura: true };
  let aberta = f.situacao === 'ABERTA';
  if (aberta) { try { await exigirEditavel(exec, tenantId, f); } catch { aberta = false; } }
  const frase = `Correção de "${item.descricao}" (fatura Nº ${f.numero}): de ${brl(atual)} para ${brl(novo)}. ${motivo}`;
  const nota = await lancarNota(exec, tenantId, {
    pessoa_id: f.pessoa_id, pessoa_nome: f.pessoa_nome, tipo: diferenca > 0 ? 'DEBITO' : 'CREDITO', valor_centavos: Math.abs(diferenca),
    motivo: frase, fatura_id: aberta ? f.id : undefined, origem_fatura_id: f.id, conta_id: contaId, venda_id: item.venda_id,
    chave: `correcao:${contaId}:${atual}:${novo}`,
  }, { usuario: o.usuario, hoje: o.hoje });
  return { nota, na_propria_fatura: aberta };
}

/**
 * Pagamento parcial: o que falta sai desta fatura (que fica recebida pelo
 * que entrou) e vira nota de débito explicada na próxima do pagante.
 */
export async function levarSaldoParaProxima(exec: ExecutorSQL, tenantId: string, faturaId: string, o: { usuario: UsuarioDaFatura; hoje?: string }): Promise<AjusteDaFatura> {
  const hoje = o.hoje ?? hojeISO();
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, faturaId);
  const t = await tituloDa(exec, tenantId, f);
  if (!t || t.status !== 'PARCIAL') throw new ErroFatura('SEM_SALDO_PARCIAL', 'Só a fatura paga em parte tem saldo para levar à próxima.', 409);
  if (await cobrancaValendo(exec, tenantId, f.titulo_id)) throw new ErroFatura('COBRANCA_VALENDO', 'Há boleto ou Pix valendo para esta fatura: cancele a cobrança antes de levar o saldo.', 409);
  const saldo = centavosDe(t.valor_final) - centavosDe(t.valor_recebido);
  if (saldo <= 0) throw new ErroFatura('SEM_SALDO_PARCIAL', 'Não há saldo em aberto nesta fatura.', 409);
  const motivo = `Saldo da fatura Nº ${f.numero}: foram pagos ${brl(centavosDe(t.valor_recebido))} de ${brl(centavosDe(t.valor_final))}${t.data_recebimento ? ` em ${t.data_recebimento.split('-').reverse().join('/')}` : ''}; o restante veio para esta fatura.`;
  const nota = await lancarNota(exec, tenantId, {
    pessoa_id: f.pessoa_id, pessoa_nome: f.pessoa_nome, tipo: 'DEBITO', valor_centavos: saldo, motivo,
    origem_fatura_id: f.id, chave: `saldo:${f.id}`,
  }, { usuario: o.usuario, hoje });
  await exec.query(
    `UPDATE contas_receber SET status = 'RECEBIDO', data = data || jsonb_build_object('status','RECEBIDO','valor_final',(data->>'valor_recebido')::numeric,
       'saldo_levado_para_proxima', $3::numeric, 'observacoes', trim(both ' |' from concat(data->>'observacoes', ' | ', $4::text))), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND COALESCE(data->>'status', status) = 'PARCIAL'`,
    [tenantId, f.titulo_id, reais(saldo), `Saldo de ${brl(saldo)} levado para a próxima fatura (nota de débito).`],
  );
  await registrarEventoDaFatura(exec, tenantId, f.id, 'saldo_levado', { usuario: o.usuario, motivo, detalhe: { valor_centavos: saldo, ajuste_id: nota.id } });
  return nota;
}

// ============================================================
// Recalcular vencimentos
// ============================================================

export interface MudancaDeVencimento {
  conta_id: string;
  descricao: string;
  valor_centavos: number;
  de: { fatura_id: string; numero: number; vencimento: string };
  para: { vencimento: string | null; motivo: string };
}

/**
 * Recalcula, pela regra de hoje, onde ficam os itens das faturas ABERTAS da
 * pessoa (as montadas pela regra; as movidas e avulsas à mão ficam). Sem
 * `aplicar`, só mostra a diferença.
 */
export async function recalcularVencimentos(
  exec: ExecutorSQL, tenantId: string, pessoaId: string, o: { aplicar: boolean; usuario: UsuarioDaFatura; hoje?: string },
): Promise<{ mudancas: MudancaDeVencimento[]; faturas_afetadas: number[]; aplicado: boolean }> {
  const hoje = o.hoje ?? hojeISO();
  await travarFaturas(exec, tenantId);
  const cal = await calendarioDaAgencia(exec, tenantId);
  const regras = await listarRegras(exec, tenantId, { pessoa_tipo: 'CLIENTE', pessoa_id: pessoaId });
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_FATURA} FROM faturas WHERE tenant_id = $1 AND pessoa_id = $2 AND situacao = 'ABERTA' AND NOT avulsa AND chave NOT LIKE 'manual|%' ORDER BY vencimento, numero`,
    [tenantId, pessoaId],
  );
  const mudancas: MudancaDeVencimento[] = [];
  for (const r of rows) {
    const f = lerFatura(r);
    try { await exigirEditavel(exec, tenantId, f); } catch { continue; }
    for (const it of await itensDa(exec, tenantId, f.id)) {
      const { rows: c } = await exec.query(`SELECT id, status, data FROM contas_receber WHERE tenant_id = $1 AND id = $2`, [tenantId, it.conta_id]);
      if (!c[0]) continue;
      const conta = { id: it.conta_id, status: 'PENDENTE', data: (c[0].data ?? {}) as Record<string, unknown> };
      const info = await infoDoItem(exec, tenantId, conta);
      const regra = escolherRegra(regras, { pessoa_tipo: 'CLIENTE', pessoa_id: pessoaId, produto_tipos: info.produto_tipos, fornecedor_ids: info.fornecedor_ids });
      if (!regra) {
        mudancas.push({ conta_id: it.conta_id, descricao: it.descricao, valor_centavos: it.valor_centavos, de: { fatura_id: f.id, numero: f.numero, vencimento: f.vencimento }, para: { vencimento: null, motivo: 'Nenhuma regra serve mais: o item sai da fatura e fica como conta a receber solta.' } });
        continue;
      }
      const pos = posicaoDoItem(regra, { venda: info.data_venda, inicio: info.inicio, fim: info.fim }, { item_id: it.conta_id, cal });
      if (pos.chave !== f.chave) {
        mudancas.push({ conta_id: it.conta_id, descricao: it.descricao, valor_centavos: it.valor_centavos, de: { fatura_id: f.id, numero: f.numero, vencimento: f.vencimento }, para: { vencimento: pos.vencimento, motivo: pos.ajuste } });
      }
    }
  }
  const faturas_afetadas = [...new Set(mudancas.map(m => m.de.numero))];
  if (!o.aplicar || !mudancas.length) return { mudancas, faturas_afetadas, aplicado: false };
  const origens = new Set<string>();
  for (const m of mudancas) { await soltarItem(exec, tenantId, m.conta_id, false); origens.add(m.de.fatura_id); }
  for (const id of origens) await registrarEventoDaFatura(exec, tenantId, id, 'vencimentos_recalculados', { usuario: o.usuario, detalhe: { contas: mudancas.filter(m => m.de.fatura_id === id).map(m => m.conta_id) } });
  await alocarItens(exec, tenantId, { conta_ids: mudancas.filter(m => m.para.vencimento).map(m => m.conta_id) }, { usuario: o.usuario, hoje });
  for (const id of origens) {
    // Fatura que ficou sem itens: as notas dela seguem para a próxima fatura aberta do pagante.
    const { rows: resto } = await exec.query(`SELECT 1 FROM fatura_itens WHERE tenant_id = $1 AND fatura_id = $2 LIMIT 1`, [tenantId, id]);
    if (!resto.length) {
      await exec.query(`UPDATE fatura_ajustes SET fatura_id = '' WHERE tenant_id = $1 AND fatura_id = $2`, [tenantId, id]);
      const prox = await proximaAbertaDoPagante(exec, tenantId, pessoaId, id, hoje);
      if (prox) { await anexarAjustesPendentes(exec, tenantId, prox); await recalcularFatura(exec, tenantId, prox.id, hoje); }
    }
    await recalcularFatura(exec, tenantId, id, hoje);
  }
  return { mudancas, faturas_afetadas, aplicado: true };
}

// ============================================================
// Conferência (arquivo do cliente e marcação à mão)
// ============================================================

function referenciasDoItem(i: ItemDaFatura): string[] {
  const refs = [i.venda_numero, ...i.detalhes.produtos.map(p => p.localizador), ...i.detalhes.produtos.flatMap(p => p.passageiros), i.conta_id];
  return refs.filter(Boolean);
}

export async function conferirPorArquivo(
  exec: ExecutorSQL, tenantId: string, faturaId: string, linhas: LinhaDoArquivo[], o: { usuario: UsuarioDaFatura; arquivo?: string },
): Promise<RelatorioDaConferencia> {
  if (!Array.isArray(linhas) || !linhas.length) throw new ErroFatura('DADOS', 'O arquivo não trouxe linhas para conferir.', 400);
  if (linhas.length > 5000) throw new ErroFatura('DADOS', 'Até 5.000 linhas por conferência.', 400);
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, faturaId);
  const t = await tituloDa(exec, tenantId, f);
  if (t?.status === 'RECEBIDO') throw new ErroFatura('FATURA_RECEBIDA', 'Fatura já recebida não se confere mais.', 409);
  const itens = await itensDa(exec, tenantId, faturaId);
  const rel = conferirComArquivo(itens.map(i => ({ conta_id: i.conta_id, valor_centavos: i.valor_centavos, referencias: referenciasDoItem(i) })), linhas.map(l => ({
    referencia: String(l?.referencia ?? '').slice(0, 200),
    valor_centavos: l?.valor_centavos === null || l?.valor_centavos === undefined || !Number.isFinite(Number(l.valor_centavos)) ? null : Math.round(Number(l.valor_centavos)),
  })));
  for (const r of rel.itens) {
    const nota = r.resultado === 'CONFERIDO' ? `Conferido com a linha ${r.linha} do arquivo.`
      : r.resultado === 'VALOR_DIFERENTE' ? `No arquivo (linha ${r.linha}) o valor é ${brl(r.valor_arquivo_centavos ?? 0)}.`
        : 'Não aparece no arquivo do cliente.';
    await exec.query(`UPDATE fatura_itens SET conferido = $4, conferencia_nota = $5 WHERE tenant_id = $1 AND fatura_id = $2 AND conta_id = $3`,
      [tenantId, faturaId, r.conta_id, r.resultado === 'CONFERIDO', nota]);
  }
  await registrarEventoDaFatura(exec, tenantId, faturaId, 'conferida_por_arquivo', {
    usuario: o.usuario, detalhe: { arquivo: o.arquivo ?? '', conferidos: rel.conferidos, divergentes: rel.divergentes, linhas_sem_item: rel.linhas_sem_item.length },
  });
  return rel;
}

export async function marcarConferido(exec: ExecutorSQL, tenantId: string, faturaId: string, contaId: string, conferido: boolean, o: { usuario: UsuarioDaFatura }): Promise<void> {
  const f = await exigirFatura(exec, tenantId, faturaId);
  if (f.situacao === 'CANCELADA') throw new ErroFatura('FATURA_CANCELADA', `A fatura Nº ${f.numero} foi cancelada.`, 409);
  if ((await tituloDa(exec, tenantId, f))?.status === 'RECEBIDO') throw new ErroFatura('FATURA_RECEBIDA', 'Fatura já recebida não se confere mais.', 409);
  await itensDaFatura(exec, tenantId, f, [contaId]);
  await exec.query(`UPDATE fatura_itens SET conferido = $4, conferencia_nota = $5 WHERE tenant_id = $1 AND fatura_id = $2 AND conta_id = $3`,
    [tenantId, faturaId, contaId, conferido, conferido ? `Conferido por ${o.usuario.nome || 'alguém da agência'}.` : '']);
}

// ============================================================
// A venda mudou: as faturas acompanham
// ============================================================

/**
 * Chamada por `salvarVenda` (venda-servidor.ts), na mesma transação, depois
 * de regerar as contas: tira das faturas abertas o item cuja conta a
 * regeração devolveu ou apagou, junta de novo pelo valor novo e, se a venda
 * encolheu depois de faturada (fatura fechada), lança a nota de crédito.
 */
export async function sincronizarFaturasDaVenda(
  exec: ExecutorSQL, tenantId: string, vendaId: string,
  o: { avisos?: Array<{ codigo: string; valor_centavos?: number; mensagem?: string }>; venda_numero?: string; hoje?: string } = {},
): Promise<void> {
  if (!(await faturasDisponiveis(exec))) return;
  await travarFaturas(exec, tenantId);
  const { rows } = await exec.query(
    `SELECT fi.conta_id, fi.fatura_id, f.situacao, c.data AS conta FROM fatura_itens fi
       JOIN faturas f ON f.tenant_id = fi.tenant_id AND f.id = fi.fatura_id
       LEFT JOIN contas_receber c ON c.tenant_id = fi.tenant_id AND c.id = fi.conta_id
      WHERE fi.tenant_id = $1 AND fi.venda_id = $2`,
    [tenantId, vendaId],
  );
  const tocadas = new Set<string>();
  const fechadas: Array<{ fatura_id: string; pessoa_id: string }> = [];
  for (const r of rows) {
    const conta = (r.conta ?? null) as Record<string, unknown> | null;
    const carimbo = (conta?.na_fatura ?? null) as { fatura_id?: string } | null;
    const contaId = txt(r.conta_id);
    if (txt(r.situacao) !== 'ABERTA') { fechadas.push({ fatura_id: txt(r.fatura_id), pessoa_id: txt(conta?.cliente_id) }); continue; }
    if (conta && carimbo?.fatura_id === txt(r.fatura_id)) continue;
    const status = txt(conta?.status) || 'PENDENTE';
    if (conta && conta.faturar === true && STATUS_LIVRES.includes(status)) {
      // A regeração atualizou a conta no lugar (mesmo id): o item fica onde
      // está, com o valor novo, e a conta volta a ficar dentro da fatura.
      const { rows: fr } = await exec.query(`SELECT numero FROM faturas WHERE tenant_id = $1 AND id = $2`, [tenantId, txt(r.fatura_id)]);
      const { rows: antes } = await exec.query(`SELECT valor_centavos FROM fatura_itens WHERE tenant_id = $1 AND conta_id = $2`, [tenantId, contaId]);
      const novo = centavosDe(conta.valor_final);
      await exec.query(`UPDATE fatura_itens SET valor_centavos = $3 WHERE tenant_id = $1 AND conta_id = $2`, [tenantId, contaId, novo]);
      await exec.query(
        `UPDATE contas_receber SET status = 'CANCELADO', data = data || jsonb_build_object('status','CANCELADO','na_fatura',$3::jsonb), updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, contaId, JSON.stringify({ fatura_id: txt(r.fatura_id), numero: Number(fr[0]?.numero) || 0, status_anterior: status })],
      );
      const antigo = Number(antes[0]?.valor_centavos) || 0;
      if (antigo !== novo) {
        await registrarEventoDaFatura(exec, tenantId, txt(r.fatura_id), 'item_atualizado_pela_venda', { usuario: SISTEMA, detalhe: { conta_id: contaId, de: antigo, para: novo } });
      }
      tocadas.add(txt(r.fatura_id));
      continue;
    }
    // A conta foi apagada ou deixou de ser da forma Faturar: o item sai.
    await exec.query(`DELETE FROM fatura_itens WHERE tenant_id = $1 AND conta_id = $2`, [tenantId, contaId]);
    await registrarEventoDaFatura(exec, tenantId, txt(r.fatura_id), 'item_saiu_pela_venda', { usuario: SISTEMA, detalhe: { conta_id: contaId, venda_id: vendaId } });
    tocadas.add(txt(r.fatura_id));
  }
  const alocacao = await alocarItens(exec, tenantId, { venda_id: vendaId }, { hoje: o.hoje });
  for (const id of tocadas) if (!alocacao.faturas.includes(id)) await recalcularFatura(exec, tenantId, id, o.hoje);
  // A venda mudou depois de faturada em fatura fechada: o que já foi faturado
  // a mais vira nota de crédito; se a venda volta a subir, a nota é desfeita
  // por uma nota de débito. Conta corrente por venda (notas `venda-dif:`):
  // o total das notas sempre iguala o que está faturado a mais AGORA.
  if (!fechadas.length) {
    const { rows: tem } = await exec.query(`SELECT 1 FROM fatura_ajustes WHERE tenant_id = $1 AND venda_id = $2 AND chave LIKE 'venda-dif:%' LIMIT 1`, [tenantId, vendaId]);
    if (!tem.length) return;
  }
  const { rows: fat } = await exec.query(
    `SELECT COALESCE(SUM(fi.valor_centavos), 0) AS v FROM fatura_itens fi JOIN faturas f ON f.tenant_id = fi.tenant_id AND f.id = fi.fatura_id
      WHERE fi.tenant_id = $1 AND fi.venda_id = $2 AND f.situacao = 'FECHADA'`,
    [tenantId, vendaId],
  );
  const faturadoFechado = Number(fat[0]?.v) || 0;
  // Só o excesso do lado do cliente (o aviso da regeração diz o lado), e no máximo o que está em fatura fechada.
  const excesso = (o.avisos ?? [])
    .filter(a => a.codigo === 'MOVIDO_ACIMA_DO_PREVISTO' && /\(cliente\)/.test(String((a as { mensagem?: string }).mensagem ?? '')))
    .reduce((t, a) => t + (Number(a.valor_centavos) || 0), 0);
  const devido = Math.min(excesso, faturadoFechado);
  const { rows: ja } = await exec.query(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'CREDITO' THEN valor_centavos ELSE -valor_centavos END), 0) AS s, COUNT(*) AS n
       FROM fatura_ajustes WHERE tenant_id = $1 AND venda_id = $2 AND chave LIKE 'venda-dif:%'`,
    [tenantId, vendaId],
  );
  const lancado = Number(ja[0]?.s) || 0;
  const diferenca = devido - lancado;
  if (diferenca === 0) return;
  const { rows: ref } = await exec.query(
    `SELECT f.id FROM fatura_itens fi JOIN faturas f ON f.tenant_id = fi.tenant_id AND f.id = fi.fatura_id
      WHERE fi.tenant_id = $1 AND fi.venda_id = $2 AND f.situacao <> 'CANCELADA' ORDER BY (f.situacao = 'FECHADA') DESC, f.numero LIMIT 1`,
    [tenantId, vendaId],
  );
  const f = ref[0] ? await carregarFatura(exec, tenantId, txt(ref[0].id)) : null;
  if (!f) return;
  const venda = o.venda_numero ? `A venda ${o.venda_numero}` : 'A venda';
  await lancarNota(exec, tenantId, {
    pessoa_id: f.pessoa_id, pessoa_nome: f.pessoa_nome, tipo: diferenca > 0 ? 'CREDITO' : 'DEBITO', valor_centavos: Math.abs(diferenca),
    origem_fatura_id: f.id, venda_id: vendaId,
    motivo: diferenca > 0
      ? `${venda} diminuiu ${brl(diferenca)} depois de faturada na fatura Nº ${f.numero}.`
      : `${venda} voltou a subir ${brl(-diferenca)}: desfaz o crédito dado antes por ela.`,
    chave: `venda-dif:${vendaId}:${Number(ja[0]?.n) + 1}`,
  }, { usuario: SISTEMA, hoje: o.hoje });
}

/**
 * Contas da venda que a regeração não pode mexer por causa da fatura: item de
 * fatura fechada, recebida (no todo ou em parte) ou com cobrança valendo.
 */
export async function contasTravadasPelaFatura(exec: ExecutorSQL, tenantId: string, vendaId: string): Promise<string[]> {
  if (!(await faturasDisponiveis(exec))) return [];
  const { rows } = await exec.query(
    `SELECT fi.conta_id FROM fatura_itens fi
       JOIN faturas f ON f.tenant_id = fi.tenant_id AND f.id = fi.fatura_id
       LEFT JOIN contas_receber t ON t.tenant_id = f.tenant_id AND t.id = f.titulo_id
      WHERE fi.tenant_id = $1 AND fi.venda_id = $2
        AND (f.situacao <> 'ABERTA' OR COALESCE(t.data->>'status', t.status, '') IN ('RECEBIDO','PARCIAL'))`,
    [tenantId, vendaId],
  );
  const ids = rows.map(r => txt(r.conta_id));
  if (await temCobrancas(exec)) {
    const { rows: cob } = await exec.query(
      `SELECT fi.conta_id FROM fatura_itens fi JOIN faturas f ON f.tenant_id = fi.tenant_id AND f.id = fi.fatura_id
         JOIN cobrancas c ON c.tenant_id = f.tenant_id AND c.titulo_tabela = 'contas_receber' AND c.titulo_id = f.titulo_id AND c.status IN ('emitindo','aberta','vencida')
        WHERE fi.tenant_id = $1 AND fi.venda_id = $2`,
      [tenantId, vendaId],
    );
    for (const r of cob) if (!ids.includes(txt(r.conta_id))) ids.push(txt(r.conta_id));
  }
  return ids;
}

/**
 * Para a posição da venda: a conta que está numa fatura aparece com a
 * situação da fatura (recebida, em parte, em aberto), e não como cancelada.
 */
export async function projetarContasNaFatura(exec: ExecutorSQL, tenantId: string, contas: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const naFatura = contas.filter(c => c.na_fatura && typeof c.na_fatura === 'object');
  if (!naFatura.length || !(await faturasDisponiveis(exec))) return contas;
  const ids = [...new Set(naFatura.map(c => txt((c.na_fatura as Record<string, unknown>).fatura_id)))];
  const { rows } = await exec.query(
    `SELECT f.id, f.numero, f.situacao, f.vencimento, t.data AS titulo FROM faturas f LEFT JOIN contas_receber t ON t.tenant_id = f.tenant_id AND t.id = f.titulo_id
      WHERE f.tenant_id = $1 AND f.id = ANY($2::text[])`,
    [tenantId, ids],
  );
  const porId = new Map(rows.map(r => [txt(r.id), r]));
  return contas.map(c => {
    const carimbo = c.na_fatura as Record<string, unknown> | undefined;
    if (!carimbo) return c;
    const r = porId.get(txt(carimbo.fatura_id));
    if (!r) return c;
    const t = (r.titulo ?? {}) as Record<string, unknown>;
    const st = txt(t.status) || 'PENDENTE';
    const valor = Number(c.valor_final) || 0;
    const fracao = Number(t.valor_final) > 0 ? Math.min(1, (Number(t.valor_recebido) || 0) / Number(t.valor_final)) : 0;
    const status = st === 'RECEBIDO' ? 'RECEBIDO' : st === 'PARCIAL' ? 'PARCIAL' : st === 'ATRASADO' ? 'ATRASADO' : 'PENDENTE';
    return {
      ...c, status, data_vencimento: dataISO(r.vencimento) ?? c.data_vencimento,
      valor_recebido: status === 'RECEBIDO' ? valor : status === 'PARCIAL' ? round2(valor * fracao) : null,
      data_recebimento: status === 'RECEBIDO' || status === 'PARCIAL' ? t.data_recebimento ?? null : null,
      fatura_numero: Number(r.numero) || 0, fatura_situacao: txt(r.situacao),
    };
  });
}

// ============================================================
// Leitura para as telas
// ============================================================

export interface ResumoDaFatura extends Fatura {
  situacao_visivel: SituacaoVisivel;
  quantidade_itens: number;
  recebido_centavos: number;
  cobranca: { id: string; status: string; tipo: string } | null;
}

export interface FiltroDasFaturas {
  de?: string;
  ate?: string;
  campo_data?: 'vencimento' | 'emissao' | 'criacao';
  situacao?: '' | 'em_aberto' | SituacaoVisivel;
  pessoa_id?: string;
  busca?: string;
  limite?: number;
  /** Empresas no recorte (E7). Ausente ou null = todas. */
  empresas?: readonly string[] | null;
}

export async function listarFaturas(exec: ExecutorSQL, tenantId: string, filtro: FiltroDasFaturas, hoje = hojeISO()): Promise<{ itens: ResumoDaFatura[]; totais: { quantidade: number; total_centavos: number; recebido_centavos: number; em_aberto_centavos: number } }> {
  const where = ['f.tenant_id = $1'];
  const args: unknown[] = [tenantId];
  const campo = filtro.campo_data === 'emissao' ? 'f.emissao' : filtro.campo_data === 'criacao' ? 'f.criado_em::date' : 'f.vencimento';
  if (filtro.de && DATA.test(filtro.de)) { args.push(filtro.de); where.push(`${campo} >= $${args.length}::date`); }
  if (filtro.ate && DATA.test(filtro.ate)) { args.push(filtro.ate); where.push(`${campo} <= $${args.length}::date`); }
  if (filtro.pessoa_id) { args.push(filtro.pessoa_id); where.push(`f.pessoa_id = $${args.length}`); }
  if (filtro.busca) {
    args.push(`%${filtro.busca.trim().toLowerCase()}%`);
    const n = args.length;
    where.push(`(lower(f.pessoa_nome) LIKE $${n} OR f.numero::text LIKE $${n} OR lower(f.descricao) LIKE $${n}
      OR EXISTS (SELECT 1 FROM fatura_itens fi WHERE fi.tenant_id = f.tenant_id AND fi.fatura_id = f.id AND (lower(fi.venda_numero) LIKE $${n} OR lower(fi.detalhes::text) LIKE $${n})))`);
  }
  if (filtro.situacao !== 'CANCELADA') where.push(`f.situacao <> 'CANCELADA'`);
  if (filtro.empresas) { args.push([...filtro.empresas]); where.push(`COALESCE(NULLIF(to_jsonb(f)->>'empresa_id', ''), 'principal') = ANY($${args.length}::text[])`); }
  const limite = Math.min(Math.max(Number(filtro.limite) || 500, 1), 2000);
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_FATURA.split(',').map(c => `f.${c.trim()}`).join(', ')},
            COALESCE(t.data->>'status', t.status, '') AS titulo_status, COALESCE((t.data->>'valor_recebido')::numeric, 0) AS recebido,
            (SELECT COUNT(*) FROM fatura_itens fi WHERE fi.tenant_id = f.tenant_id AND fi.fatura_id = f.id) AS qtd
       FROM faturas f LEFT JOIN contas_receber t ON t.tenant_id = f.tenant_id AND t.id = f.titulo_id
      WHERE ${where.join(' AND ')} ORDER BY f.vencimento DESC, f.numero DESC LIMIT ${limite}`,
    args,
  );
  const cobs = new Map<string, { id: string; status: string; tipo: string }>();
  if (rows.length && await temCobrancas(exec)) {
    const { rows: c } = await exec.query(
      `SELECT DISTINCT ON (titulo_id) titulo_id, id, status, tipo FROM cobrancas WHERE tenant_id = $1 AND titulo_tabela = 'contas_receber' AND titulo_id = ANY($2::text[]) ORDER BY titulo_id, criado_em DESC`,
      [tenantId, rows.map(r => txt(r.titulo_id)).filter(Boolean)],
    );
    for (const r of c) cobs.set(txt(r.titulo_id), { id: txt(r.id), status: txt(r.status), tipo: txt(r.tipo) });
  }
  let itens: ResumoDaFatura[] = rows.map(r => {
    const f = lerFatura(r);
    return {
      ...f, situacao_visivel: situacaoVisivel(f.situacao, txt(r.titulo_status), f.vencimento, hoje),
      quantidade_itens: Number(r.qtd) || 0, recebido_centavos: centavosDe(r.recebido), cobranca: cobs.get(f.titulo_id) ?? null,
    };
  });
  if (filtro.situacao === 'em_aberto') itens = itens.filter(i => ['ABERTA', 'FECHADA', 'EM_ATRASO', 'PARCIAL'].includes(i.situacao_visivel));
  else if (filtro.situacao) itens = itens.filter(i => i.situacao_visivel === filtro.situacao);
  const total = itens.reduce((a, i) => a + i.total_centavos, 0);
  const recebido = itens.reduce((a, i) => a + Math.min(i.recebido_centavos, i.total_centavos), 0);
  return { itens, totais: { quantidade: itens.length, total_centavos: total, recebido_centavos: recebido, em_aberto_centavos: total - recebido } };
}

export interface DetalheDaFatura {
  fatura: Fatura;
  situacao_visivel: SituacaoVisivel;
  itens: ItemDaFatura[];
  notas: AjusteDaFatura[];
  totais: TotaisDaFatura;
  titulo: TituloDaFatura | null;
  cobranca: { id: string; status: string; tipo: string; vencimento: string | null; linha_digitavel: string; pix_copia_cola: string; url_boleto: string; url_fatura: string } | null;
  eventos: EventoDaFatura[];
  anterior: { id: string; numero: number } | null;
  proxima: { id: string; numero: number } | null;
  editavel: boolean;
  regra: RegraDeFaturamento | null;
  notas_esperando: AjusteDaFatura[];
}

export async function detalheDaFatura(exec: ExecutorSQL, tenantId: string, id: string, hoje = hojeISO()): Promise<DetalheDaFatura | null> {
  const f = await carregarFatura(exec, tenantId, id);
  if (!f) return null;
  const itens = await itensDa(exec, tenantId, id);
  const notas = await ajustesDa(exec, tenantId, id);
  const titulo = await tituloDa(exec, tenantId, f);
  let cobranca: DetalheDaFatura['cobranca'] = null;
  if (f.titulo_id && await temCobrancas(exec)) {
    const { rows } = await exec.query(
      `SELECT id, status, tipo, vencimento, linha_digitavel, pix_copia_cola, url_boleto, url_fatura FROM cobrancas WHERE tenant_id = $1 AND titulo_tabela = 'contas_receber' AND titulo_id = $2 ORDER BY criado_em DESC LIMIT 1`,
      [tenantId, f.titulo_id],
    );
    if (rows[0]) cobranca = { id: txt(rows[0].id), status: txt(rows[0].status), tipo: txt(rows[0].tipo), vencimento: dataISO(rows[0].vencimento), linha_digitavel: txt(rows[0].linha_digitavel), pix_copia_cola: txt(rows[0].pix_copia_cola), url_boleto: txt(rows[0].url_boleto), url_fatura: txt(rows[0].url_fatura) };
  }
  // Fatura anterior e próxima do mesmo pagante (pelo vencimento, depois pelo número).
  const { rows: ant } = await exec.query(
    `SELECT id, numero FROM faturas WHERE tenant_id = $1 AND pessoa_id = $2 AND situacao <> 'CANCELADA' AND (vencimento, numero) < ($3::date, $4::int) ORDER BY vencimento DESC, numero DESC LIMIT 1`,
    [tenantId, f.pessoa_id, f.vencimento, f.numero],
  );
  const { rows: prox } = await exec.query(
    `SELECT id, numero FROM faturas WHERE tenant_id = $1 AND pessoa_id = $2 AND situacao <> 'CANCELADA' AND (vencimento, numero) > ($3::date, $4::int) ORDER BY vencimento, numero LIMIT 1`,
    [tenantId, f.pessoa_id, f.vencimento, f.numero],
  );
  let editavel = f.situacao === 'ABERTA';
  if (editavel) { try { await exigirEditavel(exec, tenantId, f); } catch { editavel = false; } }
  const { rows: esperando } = await exec.query(`SELECT ${COLUNAS_AJUSTE} FROM fatura_ajustes WHERE tenant_id = $1 AND pessoa_id = $2 AND fatura_id = '' ORDER BY criado_em`, [tenantId, f.pessoa_id]);
  return {
    fatura: f, situacao_visivel: situacaoVisivel(f.situacao, titulo?.status ?? '', f.vencimento, hoje), itens, notas,
    totais: totaisDaFatura(itens, notas, f.retencoes), titulo, cobranca, eventos: await eventosDa(exec, tenantId, id),
    anterior: ant[0] ? { id: txt(ant[0].id), numero: Number(ant[0].numero) } : null,
    proxima: prox[0] ? { id: txt(prox[0].id), numero: Number(prox[0].numero) } : null,
    editavel, regra: f.regra_id ? await carregarRegra(exec, tenantId, f.regra_id) : null,
    notas_esperando: esperando.map(lerAjuste),
  };
}

export interface ItemAFaturar {
  conta_id: string;
  descricao: string;
  pessoa_id: string;
  pessoa_nome: string;
  valor_centavos: number;
  vencimento: string;
  venda_id: string;
  motivo: 'SEM_REGRA' | 'TIRADO_DA_FATURA' | 'COBRANCA_EMITIDA' | 'AGUARDANDO';
}

/** Itens da forma Faturar ainda fora de fatura (e por quê). */
export async function itensAFaturar(exec: ExecutorSQL, tenantId: string, filtro: { pessoa_id?: string } = {}): Promise<ItemAFaturar[]> {
  const args: unknown[] = [tenantId, STATUS_LIVRES];
  let extra = '';
  if (filtro.pessoa_id) { args.push(filtro.pessoa_id); extra = ` AND c.data->>'cliente_id' = $${args.length}`; }
  const cob = await temCobrancas(exec);
  const { rows } = await exec.query(
    `SELECT c.id, c.data${cob ? `, EXISTS (SELECT 1 FROM cobrancas cb WHERE cb.tenant_id = c.tenant_id AND cb.titulo_tabela = 'contas_receber' AND cb.titulo_id = c.id AND cb.status IN ('emitindo','aberta','vencida')) AS cobrada` : ', FALSE AS cobrada'}
       FROM contas_receber c WHERE c.tenant_id = $1 AND c.data->>'faturar' = 'true'
        AND COALESCE(NULLIF(c.data->>'status',''), c.status, '') = ANY($2::text[])
        AND NOT EXISTS (SELECT 1 FROM fatura_itens fi WHERE fi.tenant_id = c.tenant_id AND fi.conta_id = c.id)${extra}
      ORDER BY c.data->>'cliente_nome', c.data->>'data_vencimento', c.id LIMIT 2000`,
    args,
  );
  const pessoas = [...new Set(rows.map(r => txt((r.data as Record<string, unknown>)?.cliente_id)).filter(Boolean))];
  const comRegra = new Set<string>();
  if (pessoas.length) {
    const { rows: rr } = await exec.query(`SELECT DISTINCT pessoa_id FROM regras_faturamento WHERE tenant_id = $1 AND pessoa_tipo = 'CLIENTE' AND ativa AND pessoa_id = ANY($2::text[])`, [tenantId, pessoas]);
    for (const r of rr) comRegra.add(txt(r.pessoa_id));
  }
  return rows.map(r => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    const pessoa = txt(d.cliente_id);
    const motivo: ItemAFaturar['motivo'] = r.cobrada === true ? 'COBRANCA_EMITIDA' : d.fatura_manual === true ? 'TIRADO_DA_FATURA' : !comRegra.has(pessoa) ? 'SEM_REGRA' : 'AGUARDANDO';
    return {
      conta_id: txt(r.id), descricao: txt(d.descricao), pessoa_id: pessoa, pessoa_nome: txt(d.cliente_nome), valor_centavos: centavosDe(d.valor_final),
      vencimento: txt(d.data_vencimento).slice(0, 10), venda_id: txt(d.origem_venda_id) || txt(d.venda_id), motivo,
    };
  });
}

export async function notasEsperando(exec: ExecutorSQL, tenantId: string): Promise<AjusteDaFatura[]> {
  const { rows } = await exec.query(`SELECT ${COLUNAS_AJUSTE} FROM fatura_ajustes WHERE tenant_id = $1 AND fatura_id = '' ORDER BY criado_em LIMIT 500`, [tenantId]);
  return rows.map(lerAjuste);
}

/** Faturar agora as notas que esperavam: vira uma fatura avulsa do pagante só com elas. */
export async function faturarNotasEsperando(exec: ExecutorSQL, tenantId: string, pessoaId: string, o: { usuario: UsuarioDaFatura; vencimento?: string; hoje?: string }): Promise<Fatura> {
  const hoje = o.hoje ?? hojeISO();
  await travarFaturas(exec, tenantId);
  const { rows } = await exec.query(`SELECT ${COLUNAS_AJUSTE} FROM fatura_ajustes WHERE tenant_id = $1 AND pessoa_id = $2 AND fatura_id = ''`, [tenantId, pessoaId]);
  if (!rows.length) throw new ErroFatura('SEM_NOTAS', 'Não há notas esperando a próxima fatura deste pagante.', 409);
  const notas = rows.map(lerAjuste);
  const f = await criarFatura(exec, tenantId, {
    pessoa_id: pessoaId, pessoa_nome: notas[0].pessoa_nome, chave: `avulsa|${generateId()}`, inicio: null, fim: null,
    vencimento: o.vencimento && ehDataValida(o.vencimento) ? o.vencimento : addDias(hoje, 7), avulsa: true,
  }, o.usuario, hoje);
  return (await recalcularFatura(exec, tenantId, f.id, hoje))!;
}

// ============================================================
// O cliente no portal
// ============================================================

export interface FaturaNoPortal {
  id: string;
  numero: number;
  vencimento: string;
  emissao: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  situacao: SituacaoVisivel;
  conferencia: ConferenciaDaFatura;
  conta_id: string;
  totais: TotaisDaFatura;
  itens: Array<{
    conta_id: string; descricao: string; venda: string; data_venda: string | null; valor_centavos: number; centro_custo: string;
    produtos: Array<{ descricao: string; localizador: string; data_inicio: string; data_fim: string; passageiros: string[] }>;
    contestacao: string; resposta: string;
  }>;
  notas: Array<{ tipo: 'CREDITO' | 'DEBITO'; valor_centavos: number; motivo: string }>;
}

/** Faturas fechadas do cliente do link (até 18 meses), para conferir. Só o que é dele. */
export async function faturasDoPortal(exec: ExecutorSQL, link: { tenant_id: string; cliente_id: string }, hoje: string): Promise<FaturaNoPortal[]> {
  if (!(await faturasDisponiveis(exec))) return [];
  const { rows } = await exec.query(
    `SELECT ${COLUNAS_FATURA.split(',').map(c => `f.${c.trim()}`).join(', ')}, COALESCE(t.data->>'status', t.status, '') AS titulo_status
       FROM faturas f LEFT JOIN contas_receber t ON t.tenant_id = f.tenant_id AND t.id = f.titulo_id
      WHERE f.tenant_id = $1 AND f.pessoa_id = $2 AND f.situacao = 'FECHADA' AND f.vencimento >= ($3::date - INTERVAL '18 months')
      ORDER BY f.vencimento DESC, f.numero DESC LIMIT 36`,
    [link.tenant_id, link.cliente_id, hoje],
  );
  const lista: FaturaNoPortal[] = [];
  for (const r of rows) {
    const f = lerFatura(r);
    const itens = await itensDa(exec, link.tenant_id, f.id);
    const notas = await ajustesDa(exec, link.tenant_id, f.id);
    lista.push({
      id: f.id, numero: f.numero, vencimento: f.vencimento, emissao: f.emissao, periodo_inicio: f.periodo_inicio, periodo_fim: f.periodo_fim,
      situacao: situacaoVisivel(f.situacao, txt(r.titulo_status), f.vencimento, hoje), conferencia: f.conferencia, conta_id: f.titulo_id,
      totais: totaisDaFatura(itens, notas, f.retencoes),
      itens: itens.map(i => ({
        conta_id: i.conta_id, descricao: i.descricao, venda: i.venda_numero, data_venda: i.data_venda, valor_centavos: i.valor_centavos,
        centro_custo: i.detalhes.centro_custo,
        produtos: i.detalhes.produtos.map(p => ({ descricao: p.descricao, localizador: p.localizador, data_inicio: p.data_inicio, data_fim: p.data_fim, passageiros: p.passageiros })),
        contestacao: i.contestacao, resposta: i.resposta,
      })),
      notas: notas.map(n => ({ tipo: n.tipo, valor_centavos: n.valor_centavos, motivo: n.motivo })),
    });
  }
  return lista;
}

async function faturaDoLink(exec: ExecutorSQL, link: { tenant_id: string; cliente_id: string }, faturaId: string): Promise<Fatura> {
  const f = typeof faturaId === 'string' && faturaId.length <= 100 ? await carregarFatura(exec, link.tenant_id, faturaId) : null;
  if (!f || f.pessoa_id !== link.cliente_id || f.situacao !== 'FECHADA') throw new ErroFatura('NAO_ACHOU', 'Fatura não encontrada.', 404);
  return f;
}

export async function aprovarNoPortal(exec: ExecutorSQL, link: { tenant_id: string; cliente_id: string }, faturaId: string, quem: string): Promise<Fatura> {
  await travarFaturas(exec, link.tenant_id);
  const f = await faturaDoLink(exec, link, faturaId);
  if (f.conferencia === 'APROVADA') return f;
  await exec.query(`UPDATE faturas SET conferencia = 'APROVADA', conferida_em = NOW(), atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [link.tenant_id, f.id]);
  await registrarEventoDaFatura(exec, link.tenant_id, f.id, 'aprovada_pelo_cliente', { usuario: { id: '', nome: quem.slice(0, 120) || 'Cliente (portal)' } });
  const { criarNotificacao } = await import('./notificacoes');
  await criarNotificacao({
    tenantId: link.tenant_id, tipo: 'FATURA_APROVADA', titulo: `Fatura Nº ${f.numero} aprovada por ${f.pessoa_nome || 'o cliente'}`,
    descricao: `O cliente conferiu a fatura no portal e aprovou ${brl(f.total_centavos)}.`, link: `/financeiro-ag/faturas/${f.id}`,
    chaveDeduplicacao: `fatura-aprovada:${f.id}`, data: { fatura_id: f.id },
  }, exec);
  return (await carregarFatura(exec, link.tenant_id, f.id))!;
}

export async function contestarNoPortal(
  exec: ExecutorSQL, link: { tenant_id: string; cliente_id: string }, faturaId: string,
  contestacoes: Array<{ conta_id: string; motivo: string }>, quem: string,
): Promise<Fatura> {
  const lista = (Array.isArray(contestacoes) ? contestacoes : []).slice(0, 200)
    .map(c => ({ conta_id: String(c?.conta_id ?? '').slice(0, 100), motivo: String(c?.motivo ?? '').trim().slice(0, 500) }))
    .filter(c => c.conta_id);
  if (!lista.length) throw new ErroFatura('DADOS', 'Escolha o item que não está certo.', 400);
  if (lista.some(c => c.motivo.length < 5)) throw new ErroFatura('MOTIVO', 'Conte em poucas palavras o que não está certo em cada item.', 400);
  await travarFaturas(exec, link.tenant_id);
  const f = await faturaDoLink(exec, link, faturaId);
  const itens = new Set((await itensDa(exec, link.tenant_id, f.id)).map(i => i.conta_id));
  if (lista.some(c => !itens.has(c.conta_id))) throw new ErroFatura('NAO_ACHOU', 'Item não encontrado nesta fatura.', 404);
  for (const c of lista) {
    await exec.query(`UPDATE fatura_itens SET contestacao = $4, contestado_em = NOW(), resposta = '' WHERE tenant_id = $1 AND fatura_id = $2 AND conta_id = $3`,
      [link.tenant_id, f.id, c.conta_id, c.motivo]);
  }
  await exec.query(`UPDATE faturas SET conferencia = 'CONTESTADA', conferida_em = NOW(), atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [link.tenant_id, f.id]);
  await registrarEventoDaFatura(exec, link.tenant_id, f.id, 'contestada_pelo_cliente', { usuario: { id: '', nome: quem.slice(0, 120) || 'Cliente (portal)' }, detalhe: { itens: lista } });
  const { criarNotificacao } = await import('./notificacoes');
  await criarNotificacao({
    tenantId: link.tenant_id, tipo: 'FATURA_CONTESTADA',
    titulo: `${f.pessoa_nome || 'O cliente'} contestou ${lista.length === 1 ? '1 item' : `${lista.length} itens`} da fatura Nº ${f.numero}`,
    descricao: lista.map(c => c.motivo).join(' · ').slice(0, 600), link: `/financeiro-ag/faturas/${f.id}`,
    chaveDeduplicacao: `fatura-contestada:${f.id}:${lista.map(c => c.conta_id).sort().join(',')}:${lista.map(c => c.motivo.length).join('-')}`,
    data: { fatura_id: f.id },
  }, exec);
  return (await carregarFatura(exec, link.tenant_id, f.id))!;
}

/** A agência responde a contestação de um item; sem contestação pendente, a fatura volta para o cliente conferir. */
export async function responderContestacao(
  exec: ExecutorSQL, tenantId: string, faturaId: string, contaId: string, resposta: string, o: { usuario: UsuarioDaFatura },
): Promise<Fatura> {
  const texto = String(resposta ?? '').trim();
  if (texto.length < 5) throw new ErroFatura('MOTIVO', 'Escreva a resposta ao cliente.', 400);
  await travarFaturas(exec, tenantId);
  const f = await exigirFatura(exec, tenantId, faturaId);
  const [item] = await itensDaFatura(exec, tenantId, f, [contaId]);
  if (!item.contestacao) throw new ErroFatura('SEM_CONTESTACAO', 'Este item não foi contestado.', 409);
  await exec.query(`UPDATE fatura_itens SET resposta = $4 WHERE tenant_id = $1 AND fatura_id = $2 AND conta_id = $3`, [tenantId, faturaId, contaId, texto.slice(0, 1000)]);
  const { rows } = await exec.query(`SELECT COUNT(*) AS n FROM fatura_itens WHERE tenant_id = $1 AND fatura_id = $2 AND contestacao <> '' AND resposta = ''`, [tenantId, faturaId]);
  if (Number(rows[0]?.n) === 0 && f.conferencia === 'CONTESTADA' && f.situacao === 'FECHADA') {
    await exec.query(`UPDATE faturas SET conferencia = 'AGUARDANDO', atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, [tenantId, faturaId]);
  }
  await registrarEventoDaFatura(exec, tenantId, faturaId, 'contestacao_respondida', { usuario: o.usuario, motivo: texto, detalhe: { conta_id: contaId } });
  return (await carregarFatura(exec, tenantId, faturaId))!;
}

export { ROTULO_TIPO_DE_PESSOA };
