/**
 * O LADO DO FORNECEDOR NO BANCO (E5, parte C, 05/11/2026): fatura do
 * fornecedor pela regra (corte, vencimento, feriado), sinal com compensação
 * automática, acordos com vigência, Taxa CC DU/RAV com motivo e comissão
 * esperada × recebida por operadora. As contas puras moram em
 * fornecedor-regra.ts, fornecedor-acordos.ts, fornecedor-fatura.ts e
 * fornecedor-comissao.ts. Quem chama abre a transação (`emTransacao`) nas
 * funções que gravam.
 *
 * REGRAS QUE CUSTAM DINHEIRO SE QUEBRADAS:
 *  1. Uma conta da venda entra em UMA fatura valendo (índice único) e só se
 *     estiver em aberto (sem baixa). A fatura nasce sob trava do fornecedor e
 *     das vendas; se algum item mudou desde a prévia, nada é gravado (409).
 *  2. O total da fatura = soma dos itens; a conta a pagar = total − sinal
 *     compensado. As contas das vendas saem do caminho (canceladas e ligadas
 *     à fatura) para o mesmo dinheiro não aparecer duas vezes a pagar; a
 *     posição da venda as lê pela fatura (fornecedor-fatura-banco.ts).
 *  3. Só sinal JÁ PAGO compensa, e nunca mais do que o saldo dele.
 *  4. Desfazer a fatura só sem pagamento; nada é apagado (fica DESFEITA), as
 *     contas das vendas voltam e a venda regera as dela.
 */
import { createHash } from 'crypto';
import type { ExecutorSQL } from './caixa-atomico';
import { generateId } from './utils';
import { addDias, deCentavos, hojeISO, num, paraCentavos } from './money';
import { normalizarVenda, type Centavos, type ParteDaVenda, type Venda } from './venda-modelo';
import { posicaoDaVenda, type PosicaoDaVenda } from './venda-posicao';
import {
  carregarVenda, lerConfigVenda, MOTIVO_MINIMO, previaDasContas, regerarContasDaVenda, salvarVenda,
  type UsuarioDaAcao,
} from './venda-servidor';
import {
  corteDe, descreverRegra, normalizarRegra, periodoDoCorte, proximasFaturas, ultimoCortePassado, vencimentoDoCorte,
  dataBaseDoItem, type PeriodoDaFatura, type RegraDeFaturamento, type Vencimento,
} from './fornecedor-regra';
import {
  aplicarAcordosNaVenda, alterarTaxaCCDoProduto, conflitosDeVigencia, normalizarAcordo, taxasDoProduto, ErroTaxaCC,
  type AcordoComFornecedor, type AplicacaoDoAcordo, type LadoDaTaxaCC,
} from './fornecedor-acordos';
import {
  itemAFaturar, pagoDaFatura, previaDaFatura, saldoDoSinal,
  type Compensacao, type FaturaParaReflexo, type ItemAFaturar, type PreviaDaFatura, type SinalDisponivel,
} from './fornecedor-fatura';
import { faturasParaReflexo, refletirFaturasNasContas } from './fornecedor-fatura-banco';
import { lerCategoriasDosTitulos } from './categorias-padrao-titulos-servidor';
import { comissoesPorOperadora, type ComissoesPorOperadora, type LinhaDoExtrato } from './fornecedor-comissao';

export class ErroFornecedor extends Error {
  codigo: string;
  status: number;
  detalhes?: unknown;
  constructor(codigo: string, mensagem: string, status = 400, detalhes?: unknown) {
    super(mensagem);
    this.name = 'ErroFornecedor';
    this.codigo = codigo;
    this.status = status;
    this.detalhes = detalhes;
  }
}

const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataISO = (v: unknown): string => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const quando = (v: unknown): string => (v instanceof Date ? v.toISOString() : txt(v));
const brl = (v: unknown): Centavos => paraCentavos(num(v));

async function travar(exec: ExecutorSQL, tenantId: string, chave: string): Promise<void> {
  await exec.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [tenantId, chave]);
}
/** A mesma trava da venda (venda-servidor.ts): a regeração e a fatura não se cruzam. */
async function travarVendas(exec: ExecutorSQL, tenantId: string, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) await travar(exec, tenantId, `venda:${id}`);
}

// ============================================================
// Vendas em lote (modelo completo) e as contas delas
// ============================================================

export interface VendaDoLote {
  venda: Venda;
  /** ABERTA | FECHADA | CANCELADA. */
  situacao: string;
}

/** Vendas do modelo completo (v2), lidas de uma vez. As de antes (v1) não entram. */
export async function vendasEmLote(exec: ExecutorSQL, tenantId: string, ids: string[]): Promise<Map<string, VendaDoLote>> {
  const mapa = new Map<string, VendaDoLote>();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return mapa;
  const args = [tenantId, unicos];
  const { rows: ms } = await exec.query(
    `SELECT m.*, v.status AS status_cab, v.data->>'status' AS status_dado
       FROM vendas_modelo m JOIN vendas_crm v ON v.tenant_id = m.tenant_id AND v.id = m.venda_id
      WHERE m.tenant_id = $1 AND m.venda_id = ANY($2::text[]) AND m.versao_modelo = 2`,
    args,
  );
  if (!ms.length) return mapa;
  const [{ rows: ps }, { rows: xs }, { rows: cs }, { rows: gs }] = await Promise.all([
    exec.query(`SELECT * FROM venda_produtos WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) ORDER BY venda_id, sequencia, id`, args),
    exec.query(`SELECT * FROM venda_passageiros WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) ORDER BY venda_id, ordem, id`, args),
    exec.query(`SELECT * FROM venda_componentes WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) ORDER BY venda_id, ordem, id`, args),
    exec.query(`SELECT * FROM venda_pagamentos WHERE tenant_id = $1 AND venda_id = ANY($2::text[]) ORDER BY venda_id, ordem, id`, args),
  ]);
  const parte = (id: unknown, nome: unknown, ext: unknown): ParteDaVenda | null =>
    (txt(id) || txt(nome) || txt(ext)) ? { id: txt(id), nome: txt(nome), ...(txt(ext) ? { id_externo: txt(ext) } : {}) } : null;
  for (const m of ms) {
    const vid = txt(m.venda_id);
    const bruto = {
      id: vid, numero: txt(m.numero), data_venda: dataISO(m.data_venda),
      cliente: m.cliente, vendedor: m.vendedor, intermediario: m.intermediario,
      grupo_id: m.grupo_id, centro_custo: m.centro_custo, origem: m.origem, situacao: m.situacao,
      observacoes: m.observacoes, crm_venda_id: m.crm_venda_id,
      produtos: ps.filter(p => txt(p.venda_id) === vid).map(p => ({
        id: p.id, tipo: p.tipo, descricao: p.descricao,
        fornecedor: parte(p.fornecedor_id, p.fornecedor_nome, p.fornecedor_externo),
        representante: parte(p.representante_id, p.representante_nome, p.representante_externo),
        quem_cobra: p.quem_cobra, moeda: p.moeda, cambio: Number(p.cambio), localizador: p.localizador,
        data_inicio: dataISO(p.data_inicio), data_fim: dataISO(p.data_fim), data_pagamento_fornecedor: dataISO(p.data_pagamento_fornecedor),
        quantidade: p.quantidade, valor_unitario_centavos: Number(p.valor_unitario_centavos), taxas_centavos: Number(p.taxas_centavos),
        detalhes: p.detalhes, cancelado_em: dataISO(p.cancelado_em), produto_crm_id: p.produto_crm_id,
        passageiros: xs.filter(x => txt(x.venda_id) === vid && x.produto_id === p.id).map(x => ({
          id: x.id, nome: x.nome, tipo: x.tipo, documento: x.documento,
          tarifa_centavos: Number(x.tarifa_centavos), taxas_centavos: Number(x.taxas_centavos), outras_taxas_centavos: Number(x.outras_taxas_centavos),
          cancelado_em: dataISO(x.cancelado_em),
        })),
        componentes: cs.filter(c => txt(c.venda_id) === vid && c.produto_id === p.id).map(c => ({
          id: c.id, tipo: c.tipo, valor_centavos: Number(c.valor_centavos), percentual: c.percentual === null ? null : Number(c.percentual),
          passageiro_id: c.passageiro_id, descricao: c.descricao,
        })),
      })),
      pagamentos: gs.filter(g => txt(g.venda_id) === vid).map(g => ({
        id: g.id, forma: g.forma, valor_centavos: Number(g.valor_centavos), parcelas: g.parcelas,
        primeiro_vencimento: dataISO(g.primeiro_vencimento), intervalo_dias: g.intervalo_dias,
        pagante: g.pagante, fornecedor: g.fornecedor, conta_bancaria_id: g.conta_bancaria_id,
        cartao_tipo: g.cartao_tipo, detalhe: g.detalhe, venda_origem_credito: g.venda_origem_credito,
      })),
    };
    const cancelada = txt(m.status_cab).toUpperCase() === 'CANCELADO' || txt(m.status_dado).toUpperCase() === 'CANCELADO';
    mapa.set(vid, { venda: normalizarVenda(bruto).venda, situacao: cancelada ? 'CANCELADA' : (txt(m.situacao) === 'FECHADA' ? 'FECHADA' : 'ABERTA') });
  }
  return mapa;
}

interface ContasDaVenda { contas_receber: Array<Record<string, unknown>>; contas_pagar: Array<Record<string, unknown>> }

/** As contas de várias vendas (as em fatura já lidas pela fatura). */
export async function contasDasVendas(exec: ExecutorSQL, tenantId: string, ids: string[]): Promise<Map<string, ContasDaVenda>> {
  const mapa = new Map<string, ContasDaVenda>();
  const unicos = [...new Set(ids.filter(Boolean))];
  for (const id of unicos) mapa.set(id, { contas_receber: [], contas_pagar: [] });
  if (!unicos.length) return mapa;
  const juntar = (r: Record<string, unknown>) => ({ ...(r.data as Record<string, unknown>), id: txt(r.id), status: txt((r.data as Record<string, unknown>)?.status ?? r.status) });
  const vendaDe = (d: Record<string, unknown>, col?: unknown) => {
    for (const k of [txt(d.origem_venda_id), txt(col), txt(d.venda_id)]) if (k && mapa.has(k)) return k;
    return '';
  };
  const { rows: cr } = await exec.query(
    `SELECT id, status, venda_id, data FROM contas_receber
      WHERE tenant_id = $1 AND (venda_id = ANY($2::text[]) OR data->>'origem_venda_id' = ANY($2::text[]) OR data->>'venda_id' = ANY($2::text[]))`,
    [tenantId, unicos],
  );
  for (const r of cr) {
    const d = juntar(r);
    const k = vendaDe(d, r.venda_id);
    if (k) mapa.get(k)!.contas_receber.push(d);
  }
  const { rows: cp } = await exec.query(
    `SELECT id, status, data FROM contas_pagar
      WHERE tenant_id = $1 AND (data->>'origem_venda_id' = ANY($2::text[]) OR data->>'venda_id' = ANY($2::text[]))`,
    [tenantId, unicos],
  );
  const pagar = await refletirFaturasNasContas(exec, tenantId, cp.map(juntar));
  for (const d of pagar) {
    const k = vendaDe(d);
    if (k) mapa.get(k)!.contas_pagar.push(d);
  }
  return mapa;
}

async function posicoesDasVendas(exec: ExecutorSQL, tenantId: string, lote: Map<string, VendaDoLote>, hoje: string): Promise<Map<string, { posicao: PosicaoDaVenda; contas: ContasDaVenda }>> {
  const contas = await contasDasVendas(exec, tenantId, [...lote.keys()]);
  const config = await lerConfigVenda(exec, tenantId);
  const saida = new Map<string, { posicao: PosicaoDaVenda; contas: ContasDaVenda }>();
  for (const [id, v] of lote) {
    const c = contas.get(id) ?? { contas_receber: [], contas_pagar: [] };
    saida.set(id, { posicao: posicaoDaVenda({ venda: v.venda, contas_receber: c.contas_receber, contas_pagar: c.contas_pagar, hoje, config: config.receita }), contas: c });
  }
  return saida;
}

// ============================================================
// Regra de faturamento do fornecedor
// ============================================================

export interface RegraDoFornecedor {
  parte_id: string;
  nome: string;
  /** O cadastro existe nesta agência. */
  cadastrado: boolean;
  regra: RegraDeFaturamento;
  descricao: string;
}

export async function lerRegraDoFornecedor(exec: ExecutorSQL, tenantId: string, parteId: string): Promise<RegraDoFornecedor> {
  const { rows } = await exec.query(`SELECT data FROM fornecedores_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, parteId]);
  const d = (rows[0]?.data ?? {}) as Record<string, unknown>;
  const regra = normalizarRegra(d.regras_faturamento);
  return { parte_id: parteId, nome: txt(d.nome_fantasia) || txt(d.razao_social), cadastrado: rows.length > 0, regra, descricao: descreverRegra(regra) };
}

async function regrasDe(exec: ExecutorSQL, tenantId: string, ids: string[]): Promise<Map<string, RegraDeFaturamento>> {
  const mapa = new Map<string, RegraDeFaturamento>();
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return mapa;
  const { rows } = await exec.query(`SELECT id, data->'regras_faturamento' AS r FROM fornecedores_crm WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, unicos]);
  for (const r of rows) mapa.set(txt(r.id), normalizarRegra(r.r));
  return mapa;
}

/** Grava a regra no cadastro do fornecedor (mantém o resto do cadastro e os outros campos da regra). */
export async function salvarRegraDoFornecedor(exec: ExecutorSQL, tenantId: string, parteId: string, entrada: unknown): Promise<RegraDoFornecedor> {
  const atual = await lerRegraDoFornecedor(exec, tenantId, parteId);
  if (!atual.cadastrado) throw new ErroFornecedor('NAO_ENCONTRADO', 'Fornecedor não encontrado.', 404);
  const o = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
  const nova = normalizarRegra({ ...atual.regra, ...o });
  const parcial = {
    dia_corte: nova.dia_corte, dia_vencimento: nova.dia_vencimento, ajuste_vencimento: nova.ajuste_vencimento,
    data_base: nova.data_base, gerar_sozinha: nova.gerar_sozinha,
  };
  await exec.query(
    `UPDATE fornecedores_crm SET data = jsonb_set(data, '{regras_faturamento}', COALESCE(data->'regras_faturamento', '{}'::jsonb) || $3::jsonb, true), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, parteId, JSON.stringify(parcial)],
  );
  return lerRegraDoFornecedor(exec, tenantId, parteId);
}

// ============================================================
// Itens a faturar
// ============================================================

const SQL_A_FATURAR = `SELECT id, status, data FROM contas_pagar
  WHERE tenant_id = $1
    AND COALESCE(data->>'status', '') = 'PENDENTE'
    AND COALESCE(data->>'venda_modelo', '') = '2'
    AND COALESCE(data->>'origem_venda_id', '') <> ''
    AND (data->>'origem_item_id' LIKE 'v2:forn:%' OR data->>'origem_item_id' LIKE 'v2:repasse:%')
    AND COALESCE(data->>'fatura_fornecedor_id', '') = ''
    AND COALESCE(data->>'fornecedor_id', '') <> ''`;

export interface FiltroAFaturar { parte_id?: string; conta_ids?: string[] }

/** As contas das vendas que ainda podem entrar numa fatura, já como linhas da tela. */
export async function itensAFaturar(exec: ExecutorSQL, tenantId: string, filtro: FiltroAFaturar = {}, hoje = hojeISO()): Promise<ItemAFaturar[]> {
  const args: unknown[] = [tenantId];
  let sql = SQL_A_FATURAR;
  if (filtro.parte_id) { args.push(filtro.parte_id); sql += ` AND data->>'fornecedor_id' = $${args.length}`; }
  if (filtro.conta_ids) { args.push(filtro.conta_ids); sql += ` AND id = ANY($${args.length}::text[])`; }
  const { rows } = await exec.query(`${sql} ORDER BY data->>'data_vencimento', id`, args);
  if (!rows.length) return [];
  const contas: Array<Record<string, unknown>> = rows.map(r => ({ ...(r.data as Record<string, unknown>), id: txt(r.id) }));
  const lote = await vendasEmLote(exec, tenantId, contas.map(c => txt(c.origem_venda_id)));
  const posicoes = await posicoesDasVendas(exec, tenantId, lote, hoje);
  const regras = await regrasDe(exec, tenantId, contas.map(c => txt(c.fornecedor_id)));
  const itens: ItemAFaturar[] = [];
  for (const c of contas) {
    const v = lote.get(txt(c.origem_venda_id));
    const p = posicoes.get(txt(c.origem_venda_id));
    if (!v || !p) continue;
    const regra = regras.get(txt(c.fornecedor_id)) ?? normalizarRegra(null);
    itens.push(itemAFaturar({
      conta: c, venda: v.venda, posicao: p.posicao, situacao_venda: v.situacao,
      data_base: x => dataBaseDoItem(x, regra),
      editavel: v.situacao === 'ABERTA',
    }));
  }
  return itens;
}

export interface ResumoDaParte {
  parte_id: string;
  parte_nome: string;
  itens: number;
  vendas: number;
  total: Centavos;
  saldo_cliente: Centavos;
  mais_antigo: string;
  /** O último corte que já passou e os itens até ele (a fatura que já pode ser montada). */
  corte: string;
  vencimento: Vencimento;
  itens_ate_o_corte: number;
  total_ate_o_corte: Centavos;
  regra: string;
  sinal_disponivel: Centavos;
}

/** Um resumo por fornecedor com itens a faturar (a primeira tela). */
export async function resumoAFaturar(exec: ExecutorSQL, tenantId: string, hoje = hojeISO()): Promise<ResumoDaParte[]> {
  const itens = await itensAFaturar(exec, tenantId, {}, hoje);
  const porParte = new Map<string, ItemAFaturar[]>();
  for (const i of itens) {
    if (!porParte.has(i.parte_id)) porParte.set(i.parte_id, []);
    porParte.get(i.parte_id)!.push(i);
  }
  const regras = await regrasDe(exec, tenantId, [...porParte.keys()]);
  const sinais = await sinaisComSaldo(exec, tenantId, { parte_ids: [...porParte.keys()], so_abertos: true });
  const saida: ResumoDaParte[] = [];
  for (const [parte, lista] of porParte) {
    const regra = regras.get(parte) ?? normalizarRegra(null);
    const corte = ultimoCortePassado(hoje, regra);
    const ate = lista.filter(i => i.data_base <= corte);
    saida.push({
      parte_id: parte, parte_nome: lista[0].parte_nome,
      itens: lista.length, vendas: new Set(lista.map(i => i.venda_id)).size,
      total: lista.reduce((a, i) => a + i.valor_a_gerar, 0),
      saldo_cliente: lista.reduce((a, i) => a + i.saldo_cliente, 0),
      mais_antigo: lista.map(i => i.data_base).sort()[0] ?? '',
      corte, vencimento: vencimentoDoCorte(corte, regra),
      itens_ate_o_corte: ate.length, total_ate_o_corte: ate.reduce((a, i) => a + i.valor_a_gerar, 0),
      regra: descreverRegra(regra),
      sinal_disponivel: sinais.filter(s => s.parte_id === parte).reduce((a, s) => a + s.disponivel, 0),
    });
  }
  return saida.sort((a, b) => b.total_ate_o_corte - a.total_ate_o_corte || a.parte_nome.localeCompare(b.parte_nome));
}

export interface AFaturarDaParte {
  parte_id: string;
  parte_nome: string;
  regra: RegraDoFornecedor;
  proximas: PeriodoDaFatura[];
  /** Período sugerido: o último corte que passou (ou o atual, se nada passou). */
  periodo_sugerido: PeriodoDaFatura;
  itens: ItemAFaturar[];
  sugeridos: string[];
  sinais: SinalComSaldo[];
}

export async function aFaturarDaParte(exec: ExecutorSQL, tenantId: string, parteId: string, hoje = hojeISO()): Promise<AFaturarDaParte> {
  const regra = await lerRegraDoFornecedor(exec, tenantId, parteId);
  const itens = await itensAFaturar(exec, tenantId, { parte_id: parteId }, hoje);
  const passado = ultimoCortePassado(hoje, regra.regra);
  const ateOPassado = itens.filter(i => i.data_base <= passado);
  const corte = ateOPassado.length ? passado : corteDe(hoje, regra.regra);
  const sugeridos = itens.filter(i => i.data_base <= corte).map(i => i.conta_id);
  return {
    parte_id: parteId, parte_nome: regra.nome || itens[0]?.parte_nome || '',
    regra, proximas: proximasFaturas(hoje, regra.regra, 3),
    periodo_sugerido: periodoDoCorte(corte, regra.regra),
    itens, sugeridos,
    sinais: await sinaisComSaldo(exec, tenantId, { parte_ids: [parteId], so_abertos: true }),
  };
}

// ============================================================
// Sinal ao fornecedor
// ============================================================

export interface SinalComSaldo extends SinalDisponivel {
  parte_nome: string;
  valor_centavos: Centavos;
  pago_centavos: Centavos;
  compensado_centavos: Centavos;
  vencimento: string;
  conta_pagar_id: string;
  conta_status: string;
  descricao: string;
  situacao: string;
  criado_por: string;
  criado_em: string;
  motivo_cancelamento: string;
  compensacoes: Array<{ fatura_id: string; fatura_numero: string; valor_centavos: Centavos; desfeita: boolean }>;
}

export async function sinaisComSaldo(exec: ExecutorSQL, tenantId: string, filtro: { parte_ids?: string[]; so_abertos?: boolean; ids?: string[] } = {}): Promise<SinalComSaldo[]> {
  const cond = ['s.tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (filtro.parte_ids) { args.push(filtro.parte_ids); cond.push(`s.parte_id = ANY($${args.length}::text[])`); }
  if (filtro.ids) { args.push(filtro.ids); cond.push(`s.id = ANY($${args.length}::text[])`); }
  if (filtro.so_abertos) cond.push(`s.situacao = 'ABERTO'`);
  const { rows } = await exec.query(
    `SELECT s.*, c.data AS conta FROM fornecedor_sinais s
       LEFT JOIN contas_pagar c ON c.tenant_id = s.tenant_id AND c.id = s.conta_pagar_id
      WHERE ${cond.join(' AND ')} ORDER BY s.data, s.id`,
    args,
  );
  if (!rows.length) return [];
  const { rows: ks } = await exec.query(
    `SELECT k.sinal_id, k.fatura_id, k.valor_centavos, k.desfeita_em, f.numero FROM fornecedor_sinal_compensacoes k
       LEFT JOIN faturas_fornecedor f ON f.tenant_id = k.tenant_id AND f.id = k.fatura_id
      WHERE k.tenant_id = $1 AND k.sinal_id = ANY($2::text[]) ORDER BY k.criado_em`,
    [tenantId, rows.map(r => txt(r.id))],
  );
  return rows.map(r => {
    const c = (r.conta ?? {}) as Record<string, unknown>;
    const st = txt(c.status);
    const valor = Number(r.valor_centavos) || 0;
    const pago = st === 'PAGO' ? Math.min(valor, brl(num(c.valor_pago) || num(c.valor_final))) : st === 'PARCIAL' ? Math.min(valor, brl(c.valor_pago)) : 0;
    const comp = ks.filter(k => txt(k.sinal_id) === txt(r.id));
    const compensado = comp.filter(k => !k.desfeita_em).reduce((a, k) => a + (Number(k.valor_centavos) || 0), 0);
    return {
      id: txt(r.id), parte_id: txt(r.parte_id), parte_nome: txt(r.parte_nome), venda_id: r.venda_id ? txt(r.venda_id) : null,
      data: dataISO(r.data), vencimento: dataISO(r.vencimento),
      valor_centavos: valor, pago_centavos: pago, compensado_centavos: compensado,
      disponivel: txt(r.situacao) === 'ABERTO' ? saldoDoSinal({ valor_centavos: valor, pago_centavos: pago, compensado_centavos: compensado }) : 0,
      conta_pagar_id: txt(r.conta_pagar_id), conta_status: st, descricao: txt(r.descricao), situacao: txt(r.situacao),
      criado_por: txt(r.criado_por), criado_em: quando(r.criado_em), motivo_cancelamento: txt(r.motivo_cancelamento),
      compensacoes: comp.map(k => ({ fatura_id: txt(k.fatura_id), fatura_numero: txt(k.numero), valor_centavos: Number(k.valor_centavos) || 0, desfeita: !!k.desfeita_em })),
    };
  });
}

export interface NovoSinal {
  parte_id: string;
  valor_centavos: Centavos;
  vencimento: string;
  venda_id?: string | null;
  descricao?: string;
}

async function nomeDoFornecedor(exec: ExecutorSQL, tenantId: string, id: string): Promise<string | null> {
  const { rows } = await exec.query(`SELECT data FROM fornecedores_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows.length) return null;
  const d = (rows[0].data ?? {}) as Record<string, unknown>;
  return txt(d.nome_fantasia) || txt(d.razao_social) || 'Fornecedor';
}

/** Lança o sinal: nasce a conta a pagar dele (paga-se pela baixa de sempre). */
export async function criarSinal(exec: ExecutorSQL, tenantId: string, e: NovoSinal, usuario: UsuarioDaAcao, hoje = hojeISO()): Promise<SinalComSaldo> {
  const valor = Math.round(Number(e.valor_centavos));
  if (!(valor > 0)) throw new ErroFornecedor('DADOS', 'Informe o valor do sinal.');
  const venc = dataISO(e.vencimento);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) throw new ErroFornecedor('DADOS', 'Informe quando o sinal será pago.');
  const nome = await nomeDoFornecedor(exec, tenantId, txt(e.parte_id));
  if (nome === null) throw new ErroFornecedor('NAO_ENCONTRADO', 'Fornecedor não encontrado.', 404);
  let vendaNumero = '';
  if (e.venda_id) {
    const { rows } = await exec.query(`SELECT data->>'numero' AS n FROM vendas_crm WHERE tenant_id = $1 AND id = $2`, [tenantId, e.venda_id]);
    if (!rows.length) throw new ErroFornecedor('DADOS', 'A venda do sinal não existe.');
    vendaNumero = txt(rows[0].n);
  }
  const id = generateId();
  const contaId = generateId();
  const descricao = txt(e.descricao).trim().slice(0, 300);
  const reais = deCentavos(valor);
  const conta = {
    id: contaId, origem: 'VENDA', venda_id: null, grupo_id: null,
    fornecedor_id: e.parte_id, fornecedor_nome: nome,
    descricao: `Sinal - ${nome}${vendaNumero ? ` - Venda ${vendaNumero}` : ''}${descricao ? ` - ${descricao}` : ''}`,
    // Categoria padrão de pagamento ao fornecedor (06/11/2026); vazia sem escolha.
    categoria_id: (await lerCategoriasDosTitulos(exec, tenantId)).pagamento_fornecedor ?? '',
    centro_custo: '', valor_original: reais, juros: 0, multa: 0, desconto: 0, valor_final: reais,
    moeda: 'BRL', cambio: 1, valor_brl: reais, data_emissao: hoje, data_vencimento: venc, data_pagamento: null, valor_pago: null,
    conta_bancaria_id: null, forma_pagamento: '', cartao_id: null, comprovante: '', parcela_numero: 1, total_parcelas: 1,
    natureza_custo: 'VARIAVEL', is_custo_comercial: false, status: 'PENDENTE', rateio: [], anexos: [],
    observacoes: 'Adiantamento ao fornecedor: o que for pago é descontado sozinho das próximas faturas dele.',
    auto_gerado: true, sinal_fornecedor_id: id, tipo_titulo: 'SINAL_FORNECEDOR',
  };
  await exec.query(
    `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at) VALUES ($1, $2, $3, 'PENDENTE', $4::jsonb, NOW(), NOW())`,
    [contaId, tenantId, e.parte_id, JSON.stringify(conta)],
  );
  await exec.query(
    `INSERT INTO fornecedor_sinais (tenant_id, id, parte_id, parte_nome, venda_id, valor_centavos, data, vencimento, conta_pagar_id, descricao, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11)`,
    [tenantId, id, e.parte_id, nome, e.venda_id || null, valor, hoje, venc, contaId, descricao, usuario.nome || usuario.id],
  );
  return (await sinaisComSaldo(exec, tenantId, { ids: [id] }))[0];
}

/** Cancela o sinal que ainda não foi pago nem compensado. */
export async function cancelarSinal(exec: ExecutorSQL, tenantId: string, id: string, motivo: string, usuario: UsuarioDaAcao): Promise<SinalComSaldo> {
  const m = txt(motivo).trim();
  if (m.length < MOTIVO_MINIMO) throw new ErroFornecedor('MOTIVO', `Diga o motivo (pelo menos ${MOTIVO_MINIMO} letras).`);
  const [s] = await sinaisComSaldo(exec, tenantId, { ids: [id] });
  if (!s) throw new ErroFornecedor('NAO_ENCONTRADO', 'Sinal não encontrado.', 404);
  await travar(exec, tenantId, `fatura-forn:${s.parte_id}`);
  if (s.situacao !== 'ABERTO') throw new ErroFornecedor('JA_CANCELADO', 'O sinal já foi cancelado.', 409);
  if (s.compensado_centavos > 0) throw new ErroFornecedor('COMPENSADO', 'Parte do sinal já foi descontada numa fatura. Desfaça a fatura antes.', 409);
  if (s.conta_status === 'PAGO' || s.conta_status === 'PARCIAL') {
    throw new ErroFornecedor('PAGO', 'O sinal já foi pago: ele será descontado da próxima fatura deste fornecedor. Para cancelar, estorne o pagamento antes.', 409);
  }
  await exec.query(
    `UPDATE contas_pagar SET status = 'CANCELADO', data = data || jsonb_build_object('status', 'CANCELADO', 'motivo_cancelamento', $3::text), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, s.conta_pagar_id, `Sinal cancelado: ${m}`],
  );
  await exec.query(
    `UPDATE fornecedor_sinais SET situacao = 'CANCELADO', cancelado_em = NOW(), cancelado_por = $3, motivo_cancelamento = $4 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, usuario.nome || usuario.id, m],
  );
  return (await sinaisComSaldo(exec, tenantId, { ids: [id] }))[0];
}

// ============================================================
// Prévia, gerar e desfazer a fatura
// ============================================================

export interface PedidoDeFatura {
  parte_id: string;
  conta_ids: string[];
  /** Corte da fatura (padrão: o do item mais novo). */
  corte?: string;
  /** Vencimento escolhido à mão (padrão: o da regra, ajustado para dia útil). */
  vencimento?: string;
  observacoes?: string;
}

export interface PreviaComAssinatura {
  previa: PreviaDaFatura;
  assinatura: string;
  periodo: { inicio: string; corte: string };
}

function assinar(previa: PreviaDaFatura): string {
  const base = {
    p: previa.parte_id,
    i: previa.itens.map(i => [i.conta_id, i.valor_a_gerar]).sort(),
    c: previa.compensacoes.map(c => [c.sinal_id, c.valor_centavos]),
    v: previa.vencimento.data,
  };
  return createHash('sha256').update(JSON.stringify(base)).digest('hex').slice(0, 32);
}

export async function previaDaFaturaNoBanco(exec: ExecutorSQL, tenantId: string, pedido: PedidoDeFatura, hoje = hojeISO()): Promise<PreviaComAssinatura> {
  const ids = [...new Set((pedido.conta_ids ?? []).map(txt).filter(Boolean))];
  if (!pedido.parte_id) throw new ErroFornecedor('DADOS', 'Escolha o fornecedor.');
  if (!ids.length) throw new ErroFornecedor('DADOS', 'Escolha ao menos um item para a fatura.');
  const itens = await itensAFaturar(exec, tenantId, { conta_ids: ids }, hoje);
  if (itens.length !== ids.length) {
    const achados = new Set(itens.map(i => i.conta_id));
    throw new ErroFornecedor('ITENS_MUDARAM', 'Algum item já foi pago, faturado ou mudou desde que a lista foi aberta. Atualize a lista.', 409, { faltando: ids.filter(i => !achados.has(i)) });
  }
  if (itens.some(i => i.parte_id !== pedido.parte_id)) throw new ErroFornecedor('PARTE_MISTURADA', 'Há itens de outro fornecedor na seleção.');
  const { regra, nome } = await lerRegraDoFornecedor(exec, tenantId, pedido.parte_id);
  const maisNovo = itens.map(i => i.data_base).sort().pop() ?? hoje;
  const corte = /^\d{4}-\d{2}-\d{2}$/.test(txt(pedido.corte)) ? corteDe(txt(pedido.corte), regra) : corteDe(maisNovo, regra);
  const periodo = periodoDoCorte(corte, regra);
  let vencimento: Vencimento = periodo.vencimento;
  const manual = dataISO(pedido.vencimento);
  if (/^\d{4}-\d{2}-\d{2}$/.test(manual) && manual !== vencimento.data) {
    vencimento = { data: manual, pela_regra: periodo.vencimento.data, motivo_ajuste: 'escolhido na hora' };
  }
  const sinais = await sinaisComSaldo(exec, tenantId, { parte_ids: [pedido.parte_id], so_abertos: true });
  const previa = previaDaFatura({ parte_id: pedido.parte_id, parte_nome: nome || itens[0].parte_nome, itens, sinais, vencimento, corte });
  return { previa, assinatura: assinar(previa), periodo: { inicio: periodo.inicio, corte } };
}

async function proximoNumeroDeFatura(exec: ExecutorSQL, tenantId: string): Promise<string> {
  await travar(exec, tenantId, 'fatura-forn:numero');
  const { rows } = await exec.query(`SELECT COUNT(*) AS c FROM faturas_fornecedor WHERE tenant_id = $1`, [tenantId]);
  return `FF-${String(Number(rows[0]?.c ?? 0) + 1).padStart(4, '0')}`;
}

/** Categoria e centro mais comuns entre os itens (a fatura herda o que a pessoa já tinha escolhido). */
function maisComum(valores: string[]): string {
  const cont = new Map<string, number>();
  for (const v of valores) if (v) cont.set(v, (cont.get(v) ?? 0) + 1);
  return [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

export async function gerarFatura(
  exec: ExecutorSQL, tenantId: string, pedido: PedidoDeFatura & { assinatura?: string; automatica?: boolean },
  usuario: UsuarioDaAcao, hoje = hojeISO(),
): Promise<DetalheDaFatura> {
  await travar(exec, tenantId, `fatura-forn:${pedido.parte_id}`);
  // Trava as vendas antes de ler os itens (a regeração da venda usa a mesma trava).
  const { rows: vs } = await exec.query(
    `SELECT DISTINCT data->>'origem_venda_id' AS v FROM contas_pagar WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, (pedido.conta_ids ?? []).map(txt)],
  );
  await travarVendas(exec, tenantId, vs.map(r => txt(r.v)).filter(Boolean));
  const { previa, assinatura, periodo } = await previaDaFaturaNoBanco(exec, tenantId, pedido, hoje);
  if (!pedido.automatica && pedido.assinatura !== assinatura) {
    throw new ErroFornecedor('PREVIA_MUDOU', 'Os valores mudaram desde a prévia. Confira de novo antes de gerar.', 409, { previa, assinatura });
  }
  const bloqueio = previa.alertas.find(a => a.codigo === 'SEM_ITENS' || a.codigo === 'PARTE_MISTURADA');
  if (bloqueio) throw new ErroFornecedor(bloqueio.codigo, bloqueio.mensagem);
  const numero = await proximoNumeroDeFatura(exec, tenantId);
  const id = generateId();
  const { rows: contasItens } = await exec.query(`SELECT id, data FROM contas_pagar WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, previa.itens.map(i => i.conta_id)]);
  const dados = contasItens.map(r => (r.data ?? {}) as Record<string, unknown>);
  let contaId: string | null = null;
  if (previa.a_pagar > 0) {
    contaId = generateId();
    const reais = deCentavos(previa.a_pagar);
    const conta = {
      id: contaId, origem: 'VENDA', venda_id: null, grupo_id: null,
      fornecedor_id: pedido.parte_id, fornecedor_nome: previa.parte_nome,
      descricao: `Fatura ${numero} - ${previa.parte_nome} (${previa.quantidade} ${previa.quantidade === 1 ? 'item' : 'itens'} de ${previa.vendas} ${previa.vendas === 1 ? 'venda' : 'vendas'})`,
      // A dos itens; sem ela, a padrão da fatura do fornecedor (06/11/2026).
      categoria_id: maisComum(dados.map(d => txt(d.categoria_id))) || ((await lerCategoriasDosTitulos(exec, tenantId)).fatura_fornecedor ?? ''),
      centro_custo: maisComum(dados.map(d => txt(d.centro_custo))),
      valor_original: reais, juros: 0, multa: 0, desconto: 0, valor_final: reais, moeda: 'BRL', cambio: 1, valor_brl: reais,
      data_emissao: hoje, data_vencimento: previa.vencimento.data, data_pagamento: null, valor_pago: null,
      conta_bancaria_id: null, forma_pagamento: '', cartao_id: null, comprovante: '', parcela_numero: 1, total_parcelas: 1,
      natureza_custo: 'VARIAVEL', is_custo_comercial: false, status: 'PENDENTE', rateio: [], anexos: [],
      observacoes: [
        `Período ${periodo.inicio.split('-').reverse().join('/')} a ${periodo.corte.split('-').reverse().join('/')}.`,
        previa.total_sinal > 0 ? `Já descontado o sinal de ${deCentavos(previa.total_sinal).toFixed(2)}.` : '',
        txt(pedido.observacoes).slice(0, 500),
      ].filter(Boolean).join(' '),
      numero_documento: numero, auto_gerado: true, fatura_fornecedor_id: id, fatura_fornecedor_numero: numero, tipo_titulo: 'FATURA_FORNECEDOR',
    };
    await exec.query(
      `INSERT INTO contas_pagar (id, tenant_id, fornecedor_id, status, data, created_at, updated_at) VALUES ($1, $2, $3, 'PENDENTE', $4::jsonb, NOW(), NOW())`,
      [contaId, tenantId, pedido.parte_id, JSON.stringify(conta)],
    );
  }
  const { regra } = await lerRegraDoFornecedor(exec, tenantId, pedido.parte_id);
  await exec.query(
    `INSERT INTO faturas_fornecedor (tenant_id, id, numero, parte_id, parte_nome, situacao, periodo_inicio, corte, vencimento, vencimento_pela_regra,
       motivo_ajuste, valor_itens_centavos, sinal_centavos, valor_centavos, conta_pagar_id, regra, observacoes, automatica, criada_por)
     VALUES ($1,$2,$3,$4,$5,'GERADA',$6::date,$7::date,$8::date,$9::date,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)`,
    [tenantId, id, numero, pedido.parte_id, previa.parte_nome, periodo.inicio, periodo.corte, previa.vencimento.data, previa.vencimento.pela_regra,
      previa.vencimento.motivo_ajuste ?? '', previa.total_itens, previa.total_sinal, previa.a_pagar, contaId, JSON.stringify(regra),
      txt(pedido.observacoes).slice(0, 1000), !!pedido.automatica, usuario.nome || usuario.id],
  );
  for (const i of previa.itens) {
    await exec.query(
      `INSERT INTO fatura_fornecedor_itens (tenant_id, fatura_id, conta_pagar_id, venda_id, venda_numero, valor_centavos, moeda, valor_moeda_centavos, saldo_cliente_centavos, descricao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tenantId, id, i.conta_id, i.venda_id, i.venda_numero, i.valor_a_gerar, i.moeda_fornecedor, i.saldo_moeda_fornecedor, i.saldo_cliente, `${i.tipos}: ${i.produto}`.slice(0, 300)],
    );
  }
  const r = await exec.query(
    `UPDATE contas_pagar SET status = 'CANCELADO',
        data = data || jsonb_build_object('status', 'CANCELADO', 'fatura_fornecedor_id', $3::text, 'fatura_fornecedor_numero', $4::text, 'faturada_em', $5::text),
        updated_at = NOW()
      WHERE tenant_id = $1 AND id = ANY($2::text[]) AND COALESCE(data->>'status', '') = 'PENDENTE' AND COALESCE(data->>'fatura_fornecedor_id', '') = ''`,
    [tenantId, previa.itens.map(i => i.conta_id), id, numero, hoje],
  );
  if ((r.rowCount ?? 0) !== previa.itens.length) {
    throw new ErroFornecedor('ITENS_MUDARAM', 'Algum item mudou enquanto a fatura era gerada. Nada foi gravado; tente de novo.', 409);
  }
  for (const c of previa.compensacoes) {
    await exec.query(
      `INSERT INTO fornecedor_sinal_compensacoes (tenant_id, id, sinal_id, fatura_id, valor_centavos) VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, generateId(), c.sinal_id, id, c.valor_centavos],
    );
  }
  return (await detalheDaFatura(exec, tenantId, id, hoje))!;
}

export type SituacaoDoPagamento = 'EM_ABERTO' | 'VENCIDA' | 'PARCIAL' | 'PAGA' | 'DESFEITA';

export interface FaturaResumo {
  id: string;
  numero: string;
  parte_id: string;
  parte_nome: string;
  situacao: 'GERADA' | 'DESFEITA';
  pagamento: SituacaoDoPagamento;
  periodo_inicio: string;
  corte: string;
  vencimento: string;
  vencimento_pela_regra: string;
  motivo_ajuste: string;
  itens: number;
  vendas: number;
  valor_itens: Centavos;
  sinal: Centavos;
  valor: Centavos;
  pago: Centavos;
  conta_pagar_id: string | null;
  automatica: boolean;
  criada_por: string;
  criada_em: string;
  desfeita_em: string | null;
  desfeita_por: string | null;
  motivo_desfazer: string;
  observacoes: string;
}

export interface DetalheDaFatura extends FaturaResumo {
  linhas: ItemAFaturar[];
  compensacoes: Array<Compensacao & { sinal_descricao: string; sinal_data: string; desfeita: boolean }>;
}

function situacaoDoPagamento(f: { situacao: string; vencimento: string }, reflexo: FaturaParaReflexo, hoje: string): SituacaoDoPagamento {
  if (f.situacao === 'DESFEITA') return 'DESFEITA';
  const pago = pagoDaFatura(reflexo);
  if (pago >= reflexo.valor_itens_centavos) return 'PAGA';
  if (pago > reflexo.sinal_centavos) return 'PARCIAL';
  return f.vencimento < hoje ? 'VENCIDA' : 'EM_ABERTO';
}

export interface FiltroDeFaturas { parte_id?: string; situacao?: string; de?: string; ate?: string; ids?: string[] }

export async function listarFaturas(exec: ExecutorSQL, tenantId: string, filtro: FiltroDeFaturas = {}, hoje = hojeISO()): Promise<FaturaResumo[]> {
  const cond = ['f.tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (filtro.parte_id) { args.push(filtro.parte_id); cond.push(`f.parte_id = $${args.length}`); }
  if (filtro.situacao === 'GERADA' || filtro.situacao === 'DESFEITA') { args.push(filtro.situacao); cond.push(`f.situacao = $${args.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt(filtro.de))) { args.push(filtro.de); cond.push(`f.vencimento >= $${args.length}::date`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt(filtro.ate))) { args.push(filtro.ate); cond.push(`f.vencimento <= $${args.length}::date`); }
  if (filtro.ids) { args.push(filtro.ids); cond.push(`f.id = ANY($${args.length}::text[])`); }
  const { rows } = await exec.query(
    `SELECT f.*, (SELECT COUNT(*) FROM fatura_fornecedor_itens i WHERE i.tenant_id = f.tenant_id AND i.fatura_id = f.id) AS itens,
            (SELECT COUNT(DISTINCT venda_id) FROM fatura_fornecedor_itens i WHERE i.tenant_id = f.tenant_id AND i.fatura_id = f.id) AS vendas
       FROM faturas_fornecedor f WHERE ${cond.join(' AND ')} ORDER BY f.vencimento DESC, f.numero DESC LIMIT 500`,
    args,
  );
  const reflexos = await faturasParaReflexo(exec, tenantId, rows.map(r => txt(r.id)));
  return rows.map(r => {
    const reflexo = reflexos.get(txt(r.id))!;
    const venc = dataISO(r.vencimento);
    return {
      id: txt(r.id), numero: txt(r.numero), parte_id: txt(r.parte_id), parte_nome: txt(r.parte_nome),
      situacao: txt(r.situacao) === 'DESFEITA' ? 'DESFEITA' : 'GERADA',
      pagamento: situacaoDoPagamento({ situacao: txt(r.situacao), vencimento: venc }, reflexo, hoje),
      periodo_inicio: dataISO(r.periodo_inicio), corte: dataISO(r.corte), vencimento: venc, vencimento_pela_regra: dataISO(r.vencimento_pela_regra),
      motivo_ajuste: txt(r.motivo_ajuste), itens: Number(r.itens) || 0, vendas: Number(r.vendas) || 0,
      valor_itens: Number(r.valor_itens_centavos) || 0, sinal: Number(r.sinal_centavos) || 0, valor: Number(r.valor_centavos) || 0,
      pago: txt(r.situacao) === 'DESFEITA' ? 0 : pagoDaFatura(reflexo),
      conta_pagar_id: r.conta_pagar_id ? txt(r.conta_pagar_id) : null, automatica: r.automatica === true,
      criada_por: txt(r.criada_por), criada_em: quando(r.criada_em),
      desfeita_em: r.desfeita_em ? quando(r.desfeita_em) : null, desfeita_por: r.desfeita_por ? txt(r.desfeita_por) : null,
      motivo_desfazer: txt(r.motivo_desfazer), observacoes: txt(r.observacoes),
    };
  });
}

export async function detalheDaFatura(exec: ExecutorSQL, tenantId: string, id: string, hoje = hojeISO()): Promise<DetalheDaFatura | null> {
  const [resumo] = await listarFaturas(exec, tenantId, { ids: [id] }, hoje);
  if (!resumo) return null;
  const { rows: its } = await exec.query(`SELECT conta_pagar_id FROM fatura_fornecedor_itens WHERE tenant_id = $1 AND fatura_id = $2`, [tenantId, id]);
  const { rows: cs } = await exec.query(`SELECT id, data FROM contas_pagar WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, its.map(r => txt(r.conta_pagar_id))]);
  const contas: Array<Record<string, unknown>> = cs.map(r => ({ ...(r.data as Record<string, unknown>), id: txt(r.id) }));
  const lote = await vendasEmLote(exec, tenantId, contas.map(c => txt(c.origem_venda_id)));
  const posicoes = await posicoesDasVendas(exec, tenantId, lote, hoje);
  const regra = normalizarRegra((await lerRegraDoFornecedor(exec, tenantId, resumo.parte_id)).regra);
  const linhas: ItemAFaturar[] = [];
  for (const c of contas) {
    const v = lote.get(txt(c.origem_venda_id));
    const p = posicoes.get(txt(c.origem_venda_id));
    if (!v || !p) continue;
    linhas.push(itemAFaturar({ conta: c, venda: v.venda, posicao: p.posicao, situacao_venda: v.situacao, data_base: x => dataBaseDoItem(x, regra), editavel: false }));
  }
  const { rows: ks } = await exec.query(
    `SELECT k.sinal_id, k.valor_centavos, k.desfeita_em, s.descricao, s.data FROM fornecedor_sinal_compensacoes k
       LEFT JOIN fornecedor_sinais s ON s.tenant_id = k.tenant_id AND s.id = k.sinal_id
      WHERE k.tenant_id = $1 AND k.fatura_id = $2 ORDER BY k.criado_em`,
    [tenantId, id],
  );
  return {
    ...resumo,
    linhas: linhas.sort((a, b) => (a.data_venda < b.data_venda ? -1 : a.data_venda > b.data_venda ? 1 : 0)),
    compensacoes: ks.map(k => ({ sinal_id: txt(k.sinal_id), valor_centavos: Number(k.valor_centavos) || 0, sinal_descricao: txt(k.descricao), sinal_data: dataISO(k.data), desfeita: !!k.desfeita_em })),
  };
}

/** Desfaz a fatura que ainda não foi paga: as contas voltam para as vendas e o sinal volta a ficar disponível. */
export async function desfazerFatura(exec: ExecutorSQL, tenantId: string, id: string, motivo: string, usuario: UsuarioDaAcao, hoje = hojeISO()): Promise<DetalheDaFatura> {
  const m = txt(motivo).trim();
  if (m.length < MOTIVO_MINIMO) throw new ErroFornecedor('MOTIVO', `Diga o motivo para desfazer (pelo menos ${MOTIVO_MINIMO} letras).`);
  const { rows } = await exec.query(`SELECT parte_id, situacao, conta_pagar_id FROM faturas_fornecedor WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (!rows.length) throw new ErroFornecedor('NAO_ENCONTRADA', 'Fatura não encontrada.', 404);
  await travar(exec, tenantId, `fatura-forn:${txt(rows[0].parte_id)}`);
  const { rows: [f] } = await exec.query(`SELECT situacao, conta_pagar_id FROM faturas_fornecedor WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  if (txt(f.situacao) !== 'GERADA') throw new ErroFornecedor('JA_DESFEITA', 'A fatura já foi desfeita.', 409);
  if (f.conta_pagar_id) {
    const { rows: c } = await exec.query(`SELECT data->>'status' AS s FROM contas_pagar WHERE tenant_id = $1 AND id = $2`, [tenantId, f.conta_pagar_id]);
    const st = txt(c[0]?.s);
    if (st === 'PAGO' || st === 'PARCIAL') {
      throw new ErroFornecedor('FATURA_PAGA', 'A fatura já tem pagamento. Estorne o pagamento antes de desfazer.', 409);
    }
  }
  const { rows: its } = await exec.query(
    `SELECT i.conta_pagar_id, i.venda_id, v.status AS st, v.data->>'status' AS st2 FROM fatura_fornecedor_itens i
       LEFT JOIN vendas_crm v ON v.tenant_id = i.tenant_id AND v.id = i.venda_id
      WHERE i.tenant_id = $1 AND i.fatura_id = $2 AND i.ativo`,
    [tenantId, id],
  );
  await travarVendas(exec, tenantId, its.map(r => txt(r.venda_id)));
  const vendasVivas = new Set<string>();
  for (const it of its) {
    const cancelada = txt(it.st).toUpperCase() === 'CANCELADO' || txt(it.st2).toUpperCase() === 'CANCELADO';
    const volta = cancelada ? 'CANCELADO' : 'PENDENTE';
    if (!cancelada) vendasVivas.add(txt(it.venda_id));
    await exec.query(
      `UPDATE contas_pagar SET status = $3,
          data = (data - 'fatura_fornecedor_id' - 'fatura_fornecedor_numero' - 'faturada_em') || jsonb_build_object('status', $3::text),
          updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2 AND data->>'fatura_fornecedor_id' = $4`,
      [tenantId, txt(it.conta_pagar_id), volta, id],
    );
  }
  await exec.query(`UPDATE fatura_fornecedor_itens SET ativo = FALSE WHERE tenant_id = $1 AND fatura_id = $2`, [tenantId, id]);
  await exec.query(`UPDATE fornecedor_sinal_compensacoes SET desfeita_em = NOW() WHERE tenant_id = $1 AND fatura_id = $2 AND desfeita_em IS NULL`, [tenantId, id]);
  if (f.conta_pagar_id) {
    await exec.query(
      `UPDATE contas_pagar SET status = 'CANCELADO', data = data || jsonb_build_object('status', 'CANCELADO', 'motivo_cancelamento', $3::text), updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, f.conta_pagar_id, `Fatura desfeita: ${m}`],
    );
  }
  await exec.query(
    `UPDATE faturas_fornecedor SET situacao = 'DESFEITA', desfeita_em = NOW(), desfeita_por = $3, motivo_desfazer = $4 WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, usuario.nome || usuario.id, m],
  );
  // A venda refaz as contas dela: o que mudou enquanto estava na fatura se acerta sozinho.
  for (const vid of [...vendasVivas].sort()) {
    const c = await carregarVenda(exec, tenantId, vid);
    if (!c || c.versao_modelo !== 2) continue;
    await regerarContasDaVenda(exec, tenantId, vid, await previaDasContas(exec, tenantId, c.venda));
  }
  return (await detalheDaFatura(exec, tenantId, id, hoje))!;
}

// ============================================================
// Taxa CC DU/RAV
// ============================================================

export interface PedidoTaxaCC {
  venda_id: string;
  produto_id: string;
  lado: LadoDaTaxaCC;
  valor_centavos: Centavos;
  motivo: string;
}

/** Altera a Taxa CC (DU ou RAV) de um produto ainda a faturar. A venda refaz as contas e guarda o motivo no histórico. */
export async function alterarTaxaCC(exec: ExecutorSQL, tenantId: string, e: PedidoTaxaCC, usuario: UsuarioDaAcao): Promise<{ venda: Venda; de: Centavos; para: Centavos }> {
  const motivo = txt(e.motivo).trim();
  if (motivo.length < MOTIVO_MINIMO) throw new ErroFornecedor('MOTIVO', `Diga o motivo da mudança (pelo menos ${MOTIVO_MINIMO} letras).`);
  if (e.lado !== 'DU' && e.lado !== 'RAV') throw new ErroFornecedor('DADOS', 'Escolha Taxa CC DU ou Taxa CC RAV.');
  await travarVendas(exec, tenantId, [e.venda_id]);
  const c = await carregarVenda(exec, tenantId, e.venda_id);
  if (!c) throw new ErroFornecedor('NAO_ENCONTRADA', 'Venda não encontrada.', 404);
  if (c.versao_modelo !== 2) throw new ErroFornecedor('VENDA_ANTIGA', 'A Taxa CC só existe na venda completa. Abra a venda e lance os produtos no modelo novo.', 409);
  if (c.situacao !== 'ABERTA') throw new ErroFornecedor('VENDA_FECHADA', 'A venda está fechada. Reabra a venda para mudar a Taxa CC.', 409);
  const produto = c.venda.produtos.find(p => p.id === e.produto_id);
  if (!produto) throw new ErroFornecedor('NAO_ENCONTRADO', 'Produto não encontrado na venda.', 404);
  const { rows: fat } = await exec.query(
    `SELECT data->>'fatura_fornecedor_numero' AS n FROM contas_pagar
      WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND COALESCE(data->>'fatura_fornecedor_id', '') <> ''
        AND data->'venda_produtos' ? $3`,
    [tenantId, e.venda_id, e.produto_id],
  );
  if (fat.length) throw new ErroFornecedor('JA_FATURADO', `Este produto já está na fatura ${txt(fat[0].n)} do fornecedor. Desfaça a fatura para mudar a Taxa CC.`, 409);
  const antes = taxasDoProduto(produto);
  let novo;
  try {
    novo = alterarTaxaCCDoProduto(produto, e.lado, Math.round(Number(e.valor_centavos)));
  } catch (x) {
    if (x instanceof ErroTaxaCC) throw new ErroFornecedor(x.codigo, x.message);
    throw x;
  }
  const venda: Venda = { ...c.venda, produtos: c.venda.produtos.map(p => (p.id === produto.id ? novo : p)) };
  await salvarVenda(exec, tenantId, venda, {
    usuario, origem: c.venda.origem, evento: 'alterada',
    detalheDoEvento: { acao: 'taxa_cc_alterada', produto_id: produto.id, lado: e.lado, de: e.lado === 'DU' ? antes.taxa_cc_du : antes.taxa_cc_rav, para: Math.round(Number(e.valor_centavos)), motivo },
  });
  return { venda, de: e.lado === 'DU' ? antes.taxa_cc_du : antes.taxa_cc_rav, para: Math.round(Number(e.valor_centavos)) };
}

// ============================================================
// Acordos com fornecedores
// ============================================================

export interface AcordoGravado extends AcordoComFornecedor {
  criado_por: string;
  atualizado_em: string;
}

function acordoDaLinha(r: Record<string, unknown>): AcordoGravado {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: txt(r.id),
    fornecedor: { id: txt(r.fornecedor_id), nome: txt(r.fornecedor_nome) },
    representante: txt(r.representante_id) ? { id: txt(r.representante_id), nome: txt(r.representante_nome) } : null,
    tipo_produto: (txt(r.tipo_produto) || null) as AcordoComFornecedor['tipo_produto'],
    produto_crm_id: txt(r.produto_crm_id), produto_nome: txt(r.produto_nome),
    comissao_percentual: n(r.comissao_percentual), comissao_valor_centavos: n(r.comissao_valor_centavos),
    over_percentual: n(r.over_percentual), over_valor_centavos: n(r.over_valor_centavos),
    taxa_cc_du_percentual: n(r.taxa_cc_du_percentual), taxa_cc_rav_percentual: n(r.taxa_cc_rav_percentual),
    vigencia_inicio: dataISO(r.vigencia_inicio), vigencia_fim: r.vigencia_fim ? dataISO(r.vigencia_fim) : null,
    observacoes: txt(r.observacoes), criado_por: txt(r.criado_por), atualizado_em: quando(r.atualizado_em),
  };
}

export async function listarAcordos(exec: ExecutorSQL, tenantId: string, filtro: { fornecedor_id?: string; ids?: string[] } = {}): Promise<AcordoGravado[]> {
  const cond = ['tenant_id = $1'];
  const args: unknown[] = [tenantId];
  if (filtro.fornecedor_id) { args.push(filtro.fornecedor_id); cond.push(`(fornecedor_id = $${args.length} OR representante_id = $${args.length})`); }
  if (filtro.ids) { args.push(filtro.ids); cond.push(`id = ANY($${args.length}::text[])`); }
  const { rows } = await exec.query(`SELECT * FROM fornecedor_acordos WHERE ${cond.join(' AND ')} ORDER BY fornecedor_nome, tipo_produto, vigencia_inicio DESC, id`, args);
  return rows.map(acordoDaLinha);
}

export async function salvarAcordo(exec: ExecutorSQL, tenantId: string, entrada: unknown, usuario: UsuarioDaAcao): Promise<AcordoGravado> {
  const { acordo, erros } = normalizarAcordo(entrada);
  if (erros.length) throw new ErroFornecedor('DADOS', erros[0].mensagem, 400, { erros });
  const nomeForn = await nomeDoFornecedor(exec, tenantId, acordo.fornecedor.id);
  if (nomeForn === null) throw new ErroFornecedor('DADOS', 'Fornecedor não encontrado no cadastro.', 400, { erros: [{ campo: 'fornecedor', mensagem: 'Fornecedor não encontrado no cadastro.' }] });
  acordo.fornecedor.nome = nomeForn;
  if (acordo.representante?.id) {
    const nomeRep = await nomeDoFornecedor(exec, tenantId, acordo.representante.id);
    if (nomeRep === null) throw new ErroFornecedor('DADOS', 'Representante não encontrado no cadastro.', 400, { erros: [{ campo: 'representante', mensagem: 'Representante não encontrado no cadastro.' }] });
    acordo.representante.nome = nomeRep;
  } else {
    acordo.representante = null;
  }
  await travar(exec, tenantId, `acordo:${acordo.fornecedor.id}`);
  if (acordo.id) {
    const { rows } = await exec.query(`SELECT 1 FROM fornecedor_acordos WHERE tenant_id = $1 AND id = $2`, [tenantId, acordo.id]);
    if (!rows.length) throw new ErroFornecedor('NAO_ENCONTRADO', 'Acordo não encontrado.', 404);
  }
  const existentes = await listarAcordos(exec, tenantId, { fornecedor_id: acordo.fornecedor.id });
  const conflitos = conflitosDeVigencia(acordo, existentes.filter(x => x.fornecedor.id === acordo.fornecedor.id));
  if (conflitos.length) {
    const c = conflitos[0];
    throw new ErroFornecedor('VIGENCIA_SOBREPOSTA',
      `Já existe acordo igual valendo de ${c.vigencia_inicio.split('-').reverse().join('/')}${c.vigencia_fim ? ` a ${c.vigencia_fim.split('-').reverse().join('/')}` : ' em diante'}. Encerre a vigência dele um dia antes deste começar.`,
      409, { conflitos: conflitos.map(x => x.id) });
  }
  const id = acordo.id || generateId();
  const args = [tenantId, id, acordo.fornecedor.id, acordo.fornecedor.nome, acordo.representante?.id ?? '', acordo.representante?.nome ?? '',
    acordo.tipo_produto ?? '', acordo.produto_crm_id, acordo.produto_nome, acordo.comissao_percentual, acordo.comissao_valor_centavos,
    acordo.over_percentual, acordo.over_valor_centavos, acordo.taxa_cc_du_percentual, acordo.taxa_cc_rav_percentual,
    acordo.vigencia_inicio, acordo.vigencia_fim, acordo.observacoes, usuario.nome || usuario.id];
  await exec.query(
    `INSERT INTO fornecedor_acordos (tenant_id, id, fornecedor_id, fornecedor_nome, representante_id, representante_nome, tipo_produto, produto_crm_id, produto_nome,
       comissao_percentual, comissao_valor_centavos, over_percentual, over_valor_centavos, taxa_cc_du_percentual, taxa_cc_rav_percentual,
       vigencia_inicio, vigencia_fim, observacoes, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::date,$17::date,$18,$19)
     ON CONFLICT (tenant_id, id) DO UPDATE SET fornecedor_id = EXCLUDED.fornecedor_id, fornecedor_nome = EXCLUDED.fornecedor_nome,
       representante_id = EXCLUDED.representante_id, representante_nome = EXCLUDED.representante_nome, tipo_produto = EXCLUDED.tipo_produto,
       produto_crm_id = EXCLUDED.produto_crm_id, produto_nome = EXCLUDED.produto_nome, comissao_percentual = EXCLUDED.comissao_percentual,
       comissao_valor_centavos = EXCLUDED.comissao_valor_centavos, over_percentual = EXCLUDED.over_percentual, over_valor_centavos = EXCLUDED.over_valor_centavos,
       taxa_cc_du_percentual = EXCLUDED.taxa_cc_du_percentual, taxa_cc_rav_percentual = EXCLUDED.taxa_cc_rav_percentual,
       vigencia_inicio = EXCLUDED.vigencia_inicio, vigencia_fim = EXCLUDED.vigencia_fim, observacoes = EXCLUDED.observacoes, atualizado_em = NOW()`,
    args,
  );
  return (await listarAcordos(exec, tenantId, { ids: [id] }))[0];
}

export async function excluirAcordo(exec: ExecutorSQL, tenantId: string, id: string): Promise<boolean> {
  const r = await exec.query(`DELETE FROM fornecedor_acordos WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return (r.rowCount ?? 0) > 0;
}

let acordosProntos = false;
async function temAcordos(exec: ExecutorSQL): Promise<boolean> {
  if (acordosProntos) return true;
  const { rows } = await exec.query(`SELECT to_regclass('public.fornecedor_acordos') IS NOT NULL AS ok`);
  acordosProntos = rows[0]?.ok === true;
  return acordosProntos;
}

/**
 * A venda lançada à mão ganha, pelo acordo vigente na data dela, a Comissão,
 * o Over e a Taxa CC que faltam. A venda do CRM fica como o CRM mandou (a
 * diferença aparece na comissão esperada × recebida).
 */
export async function aplicarAcordosDaAgencia(exec: ExecutorSQL, tenantId: string, venda: Venda): Promise<{ venda: Venda; aplicados: AplicacaoDoAcordo[] }> {
  if (venda.origem !== 'manual' || !(await temAcordos(exec))) return { venda, aplicados: [] };
  const ids = [...new Set(venda.produtos.flatMap(p => [p.fornecedor?.id ?? '', p.representante?.id ?? '']).filter(Boolean))];
  if (!ids.length) return { venda, aplicados: [] };
  const { rows } = await exec.query(
    `SELECT * FROM fornecedor_acordos WHERE tenant_id = $1 AND fornecedor_id = ANY($2::text[])`,
    [tenantId, ids],
  );
  return aplicarAcordosNaVenda(venda, rows.map(acordoDaLinha));
}

// ============================================================
// Comissão esperada × recebida
// ============================================================

export async function comissoesNoPeriodo(exec: ExecutorSQL, tenantId: string, periodo: { de: string; ate: string }, hoje = hojeISO()): Promise<ComissoesPorOperadora & { de: string; ate: string; extrato_disponivel: boolean }> {
  const de = /^\d{4}-\d{2}-\d{2}$/.test(periodo.de) ? periodo.de : addDias(hoje, -90);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(periodo.ate) ? periodo.ate : hoje;
  const { rows } = await exec.query(
    `SELECT m.venda_id FROM vendas_modelo m JOIN vendas_crm v ON v.tenant_id = m.tenant_id AND v.id = m.venda_id
      WHERE m.tenant_id = $1 AND m.versao_modelo = 2 AND m.data_venda BETWEEN $2::date AND $3::date
        AND UPPER(COALESCE(v.status, '')) <> 'CANCELADO' AND UPPER(COALESCE(v.data->>'status', '')) <> 'CANCELADO'
      ORDER BY m.data_venda LIMIT 5000`,
    [tenantId, de, ate],
  );
  const lote = await vendasEmLote(exec, tenantId, rows.map(r => txt(r.venda_id)));
  const posicoes = await posicoesDasVendas(exec, tenantId, lote, hoje);
  const { rows: ac } = await exec.query(`SELECT * FROM fornecedor_acordos WHERE tenant_id = $1`, [tenantId]);
  const { rows: ex } = await exec.query(
    `SELECT parte_id, venda_id, localizador, valor_centavos FROM fornecedor_extrato_comissoes WHERE tenant_id = $1 AND data BETWEEN $2::date AND $3::date`,
    [tenantId, de, ate],
  );
  const extrato: LinhaDoExtrato[] = ex.map(r => ({ parte_id: txt(r.parte_id), venda_id: r.venda_id ? txt(r.venda_id) : null, localizador: txt(r.localizador), valor_centavos: Number(r.valor_centavos) || 0 }));
  const vendas = [...lote.values()].map(v => {
    const p = posicoes.get(v.venda.id)!;
    return { venda: v.venda, posicao: p.posicao, contas_receber: p.contas.contas_receber };
  });
  return { ...comissoesPorOperadora({ vendas, acordos: ac.map(acordoDaLinha), extrato, hoje }), de, ate, extrato_disponivel: ex.length > 0 };
}

/**
 * Para a conferência de extrato de operadora (E6): grava o que a operadora
 * diz que pagou. Idempotente pela referência (a linha do arquivo).
 */
export async function registrarComissoesDoExtrato(
  exec: ExecutorSQL, tenantId: string,
  linhas: Array<{ parte_id: string; data: string; valor_centavos: Centavos; venda_id?: string | null; localizador?: string; referencia: string; origem?: 'extrato' | 'manual' }>,
): Promise<number> {
  let n = 0;
  for (const l of linhas) {
    const ref = txt(l.referencia).slice(0, 200);
    if (!ref || !l.parte_id || !/^\d{4}-\d{2}-\d{2}$/.test(l.data)) continue;
    const { rows } = await exec.query(`SELECT 1 FROM fornecedor_extrato_comissoes WHERE tenant_id = $1 AND referencia = $2`, [tenantId, ref]);
    if (rows.length) continue;
    await exec.query(
      `INSERT INTO fornecedor_extrato_comissoes (tenant_id, id, parte_id, venda_id, localizador, data, valor_centavos, origem, referencia) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9)`,
      [tenantId, generateId(), l.parte_id, l.venda_id || null, txt(l.localizador), l.data, Math.round(l.valor_centavos), l.origem ?? 'extrato', ref],
    );
    n++;
  }
  return n;
}
