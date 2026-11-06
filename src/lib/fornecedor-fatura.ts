/**
 * FATURA DO FORNECEDOR (E5, parte C, 05/11/2026): a conta das linhas, da
 * prévia e do sinal. Arquivo puro; o banco fica em fornecedor-servidor.ts.
 *
 * O ITEM A FATURAR é a conta a pagar que a venda completa gerou para uma
 * pessoa do acerto (fornecedor, representante ou o repasse ao intermediário:
 * `v2:forn:…`, `v2:repasse:…` e os complementos), ainda em aberto e fora de
 * fatura. Montar a fatura junta os itens de várias vendas numa conta a pagar
 * só, com o vencimento da regra do fornecedor; as contas de cada venda saem
 * do caminho (ficam canceladas e ligadas à fatura) e a posição da venda passa
 * a ler o pagamento pela fatura (`refletirContaFaturada`).
 *
 * Ao lado de cada item, o que o CLIENTE daquela venda já pagou (Valor,
 * Liquidado e Saldo do cliente): é a conferência que impede pagar o
 * fornecedor com dinheiro que ainda não entrou.
 *
 * SINAL: adiantamento ao fornecedor. Só o que já foi pago dele pode ser
 * compensado, e a compensação é automática ao montar as próximas faturas
 * (o mais antigo primeiro; sinal de uma venda só compensa itens daquela
 * venda).
 */
import {
  ROTULO_TIPO_PRODUTO, parteDoAcerto, totaisDoProduto,
  type Centavos, type ProdutoDaVenda, type Venda,
} from './venda-modelo';
import type { PosicaoDaVenda } from './venda-posicao';
import { taxasDoProduto } from './fornecedor-acordos';
import { num, paraCentavos, deCentavos } from './money';
import type { Vencimento } from './fornecedor-regra';

export type PapelNaFatura = 'fornecedor' | 'intermediario';

export interface PassageiroDoItem {
  nome: string;
  documento: string;
  tarifa: Centavos;
  taxas: Centavos;
  taxa_du: Centavos;
  rav: Centavos;
}

export interface ProdutoDoItem {
  produto_id: string;
  tipo: string;
  descricao: string;
  fornecedor: string;
  representante: string;
  moeda: string;
  localizador: string;
  data_inicio: string;
  data_fim: string;
  /** Tem Taxa DU / RAV (a Taxa CC daquele lado pode ser alterada). */
  tem_du: boolean;
  tem_rav: boolean;
  taxa_cc_du: Centavos;
  taxa_cc_rav: Centavos;
  passageiros: PassageiroDoItem[];
}

export interface ItemAFaturar {
  conta_id: string;
  venda_id: string;
  venda_numero: string;
  data_venda: string;
  /** ABERTA | FECHADA | CANCELADA. */
  situacao_venda: string;
  parte_id: string;
  parte_nome: string;
  papel: PapelNaFatura;
  complemento: boolean;
  /** Textos para as colunas. */
  tipos: string;
  produto: string;
  fornecedores: string;
  representante: string;
  intermediario: string;
  cliente: string;
  localizador: string;
  destino: string;
  data_inicio: string;
  data_fim: string;
  /** A data que a regra usa para o período. */
  data_base: string;
  vencimento_atual: string;
  // Cliente (centavos de real), proporcional aos produtos deste item.
  valor_cliente: Centavos;
  liquidado_cliente: Centavos;
  saldo_cliente: Centavos;
  // Fornecedor.
  moeda_fornecedor: string;
  /** Na moeda do fornecedor (igual ao saldo quando é real). */
  saldo_moeda_fornecedor: Centavos;
  saldo_fornecedor: Centavos;
  valor_a_gerar: Centavos;
  valor_fornecedor: Centavos;
  liquidado_fornecedor: Centavos;
  // Composição (centavos de real).
  tarifa: Centavos;
  taxas: Centavos;
  taxa_du: Centavos;
  rav: Centavos;
  taxa_cc_du: Centavos;
  taxa_cc_rav: Centavos;
  comissao: Centavos;
  over: Centavos;
  produtos: ProdutoDoItem[];
  /** A Taxa CC só muda em venda completa aberta, antes de faturar. */
  pode_alterar_taxa_cc: boolean;
  alertas: AlertaDoItem[];
}

export type CodigoDoAlerta = 'CLIENTE_NAO_PAGOU' | 'CLIENTE_EM_ATRASO' | 'VENDA_CANCELADA' | 'FORNECEDOR_PAGO_ANTES' | 'MOEDA_ESTRANGEIRA';

export interface AlertaDoItem {
  codigo: CodigoDoAlerta;
  gravidade: 'aviso' | 'atencao';
  mensagem: string;
  valor?: Centavos;
}

const brl = (v: unknown): Centavos => paraCentavos(num(v));
const reaisTxt = (c: Centavos) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** O item é de que pessoa e com que papel, pela chave da conta. */
export function papelDaConta(d: Record<string, unknown>): PapelNaFatura {
  return String(d.venda_chave ?? d.origem_item_id ?? '').startsWith('v2:repasse') ? 'intermediario' : 'fornecedor';
}

/** Os produtos da venda que a conta acerta. */
export function produtosDaConta(d: Record<string, unknown>, venda: Venda): ProdutoDaVenda[] {
  if (papelDaConta(d) === 'intermediario') return [];
  const ids = Array.isArray(d.venda_produtos) ? (d.venda_produtos as unknown[]).map(String) : [];
  if (ids.length) return venda.produtos.filter(p => ids.includes(p.id) && !p.cancelado_em);
  const parte = String(d.fornecedor_id ?? '');
  return venda.produtos.filter(p => !p.cancelado_em && parteDoAcerto(p).parte?.id === parte);
}

export interface EntradaDoItem {
  /** O JSON da conta a pagar (com id e status). */
  conta: Record<string, unknown>;
  venda: Venda;
  posicao: PosicaoDaVenda;
  situacao_venda: string;
  /** Data base pela regra do fornecedor. */
  data_base: (v: { data_venda: string; data_inicio?: string; data_fim?: string }) => string;
  /** Venda no modelo completo e aberta (a Taxa CC pode mudar). */
  editavel: boolean;
}

/** Monta a linha da "Fatura do fornecedor" para uma conta a faturar. */
export function itemAFaturar(e: EntradaDoItem): ItemAFaturar {
  const d = e.conta;
  const { venda, posicao } = e;
  const papel = papelDaConta(d);
  const produtos = produtosDaConta(d, venda);
  const parteId = String(d.fornecedor_id ?? '');
  const parteNome = String(d.fornecedor_nome ?? '');
  let valorCliente = 0, tarifa = 0, taxas = 0, taxaDu = 0, rav = 0, ccDu = 0, ccRav = 0, comissao = 0, over = 0, valorForn = 0;
  const detalhes: ProdutoDoItem[] = [];
  for (const p of produtos) {
    const t = totaisDoProduto(p);
    const x = taxasDoProduto(p);
    const r = (c: Centavos) => (p.moeda === 'BRL' ? c : Math.round(c * p.cambio));
    valorCliente += t.brl.valor_cliente;
    tarifa += t.brl.tarifa;
    taxas += t.brl.taxas;
    taxaDu += r(x.taxa_du);
    rav += r(x.rav);
    ccDu += r(x.taxa_cc_du);
    ccRav += r(x.taxa_cc_rav);
    comissao += t.brl.componentes.COMISSAO;
    over += t.brl.componentes.OVER;
    valorForn += t.brl.valor_fornecedor;
    const porPax = (id: string, tipo: 'TAXA_DU' | 'RAV') => p.componentes.filter(c => c.tipo === tipo && c.passageiro_id === id).reduce((a, c) => a + r(c.valor_centavos), 0);
    detalhes.push({
      produto_id: p.id, tipo: ROTULO_TIPO_PRODUTO[p.tipo], descricao: p.descricao,
      fornecedor: p.fornecedor?.nome ?? '', representante: p.representante?.nome ?? '', moeda: p.moeda,
      localizador: p.localizador, data_inicio: p.data_inicio, data_fim: p.data_fim,
      tem_du: x.taxa_du > 0, tem_rav: x.rav > 0, taxa_cc_du: r(x.taxa_cc_du), taxa_cc_rav: r(x.taxa_cc_rav),
      passageiros: p.passageiros.filter(px => !px.cancelado_em).map(px => ({
        nome: px.nome, documento: px.documento, tarifa: r(px.tarifa_centavos), taxas: r(px.taxas_centavos + px.outras_taxas_centavos),
        taxa_du: porPax(px.id, 'TAXA_DU'), rav: porPax(px.id, 'RAV'),
      })),
    });
  }
  // O que o cliente já pagou da venda, repartido pelos produtos do item.
  const pagoDaVenda = posicao.cliente.recebido + posicao.cliente.coberto_pelo_fornecedor + posicao.cliente.coberto_por_credito;
  const totalDaVenda = posicao.cliente.total;
  const liquidado = totalDaVenda > 0 ? Math.min(valorCliente, Math.round(Math.min(pagoDaVenda, totalDaVenda) * valorCliente / totalDaVenda)) : 0;
  const saldo = valorCliente - liquidado;
  const lado = posicao.fornecedores.find(f => f.papel === papel && (f.parte_id ? f.parte_id === parteId : f.nome === parteNome));
  const saldoForn = brl(d.valor_final);
  const moeda = String(d.moeda ?? 'BRL') || 'BRL';
  const datasIni = produtos.map(p => p.data_inicio).filter(Boolean).sort();
  const datasFim = produtos.map(p => p.data_fim).filter(Boolean).sort();
  const dataInicio = datasIni[0] ?? '';
  const dataFim = datasFim[datasFim.length - 1] ?? '';
  const alertas: AlertaDoItem[] = [];
  if (e.situacao_venda === 'CANCELADA') {
    alertas.push({ codigo: 'VENDA_CANCELADA', gravidade: 'atencao', mensagem: 'A venda foi cancelada. Confira com o fornecedor antes de pagar.' });
  }
  if (saldo > 0) {
    alertas.push({ codigo: 'CLIENTE_NAO_PAGOU', gravidade: 'atencao', valor: saldo, mensagem: `O cliente ainda deve ${reaisTxt(saldo)} desta venda${posicao.cliente.ultimo_vencimento ? ` (termina de pagar em ${dataBR(posicao.cliente.ultimo_vencimento)})` : ''}.` });
  }
  for (const a of posicao.alertas) {
    if (a.tipo === 'CLIENTE_EM_ATRASO') alertas.push({ codigo: 'CLIENTE_EM_ATRASO', gravidade: 'atencao', valor: a.valor, mensagem: a.mensagem });
    if (a.tipo === 'FORNECEDOR_PAGO_ANTES') alertas.push({ codigo: 'FORNECEDOR_PAGO_ANTES', gravidade: 'atencao', valor: a.valor, mensagem: a.mensagem });
  }
  if (moeda !== 'BRL') {
    alertas.push({ codigo: 'MOEDA_ESTRANGEIRA', gravidade: 'aviso', mensagem: `Item em ${moeda}: entra na fatura em reais, pelo câmbio da venda.` });
  }
  return {
    conta_id: String(d.id ?? ''),
    venda_id: venda.id, venda_numero: venda.numero, data_venda: venda.data_venda, situacao_venda: e.situacao_venda,
    parte_id: parteId, parte_nome: parteNome, papel,
    complemento: String(d.origem_item_id ?? '').includes(':complemento'),
    tipos: papel === 'intermediario' ? 'Repasse ao intermediário' : [...new Set(detalhes.map(x => x.tipo))].join(', '),
    produto: papel === 'intermediario' ? `Repasse da venda ${venda.numero}` : detalhes.map(x => x.descricao || x.tipo).join(' + '),
    fornecedores: [...new Set(detalhes.map(x => x.fornecedor).filter(Boolean))].join(', '),
    representante: [...new Set(detalhes.map(x => x.representante).filter(Boolean))].join(', '),
    intermediario: venda.intermediario?.nome ?? '',
    cliente: venda.cliente.nome,
    localizador: [...new Set(detalhes.map(x => x.localizador).filter(Boolean))].join(', '),
    destino: [...new Set(produtos.map(p => p.detalhes.destino ?? '').filter(Boolean))].join(', '),
    data_inicio: dataInicio, data_fim: dataFim,
    data_base: e.data_base({ data_venda: venda.data_venda, data_inicio: dataInicio, data_fim: dataFim }),
    vencimento_atual: String(d.data_vencimento ?? '').slice(0, 10),
    valor_cliente: valorCliente, liquidado_cliente: liquidado, saldo_cliente: saldo,
    moeda_fornecedor: moeda,
    saldo_moeda_fornecedor: moeda === 'BRL' ? saldoForn : brl(d.valor_original),
    saldo_fornecedor: saldoForn, valor_a_gerar: saldoForn,
    valor_fornecedor: papel === 'intermediario' ? saldoForn : valorForn,
    liquidado_fornecedor: lado?.pago ?? 0,
    tarifa, taxas, taxa_du: taxaDu, rav, taxa_cc_du: ccDu, taxa_cc_rav: ccRav, comissao, over,
    produtos: detalhes,
    pode_alterar_taxa_cc: e.editavel && detalhes.some(x => x.tem_du || x.tem_rav),
    alertas,
  };
}

// ============================================================
// Sinal
// ============================================================

export interface SinalDisponivel {
  id: string;
  parte_id: string;
  /** Sinal de uma venda só compensa itens daquela venda. */
  venda_id: string | null;
  data: string;
  /** Pago e ainda não compensado. */
  disponivel: Centavos;
}

export interface Compensacao { sinal_id: string; valor_centavos: Centavos }

/** Saldo do sinal que pode ser compensado: o que foi pago dele, menos o já compensado. */
export function saldoDoSinal(s: { valor_centavos: Centavos; pago_centavos: Centavos; compensado_centavos: Centavos }): Centavos {
  return Math.max(0, Math.min(s.valor_centavos, s.pago_centavos) - s.compensado_centavos);
}

/** Quanto de cada sinal entra na fatura: o mais antigo primeiro, até o total dos itens. */
export function planejarCompensacao(itens: ReadonlyArray<Pick<ItemAFaturar, 'venda_id' | 'valor_a_gerar'>>, sinais: readonly SinalDisponivel[]): Compensacao[] {
  const porVenda = new Map<string, Centavos>();
  let total = 0;
  for (const i of itens) {
    porVenda.set(i.venda_id, (porVenda.get(i.venda_id) ?? 0) + i.valor_a_gerar);
    total += i.valor_a_gerar;
  }
  const ordem = [...sinais].filter(s => s.disponivel > 0).sort((a, b) => {
    // Os de uma venda primeiro (são os mais restritos), depois por data.
    if (!!a.venda_id !== !!b.venda_id) return a.venda_id ? -1 : 1;
    return a.data < b.data ? -1 : a.data > b.data ? 1 : a.id.localeCompare(b.id);
  });
  const saida: Compensacao[] = [];
  let resto = total;
  for (const s of ordem) {
    if (resto <= 0) break;
    let teto = resto;
    if (s.venda_id) {
      const daVenda = porVenda.get(s.venda_id) ?? 0;
      teto = Math.min(teto, daVenda);
      if (teto <= 0) continue;
      porVenda.set(s.venda_id, daVenda - Math.min(daVenda, s.disponivel, resto));
    }
    const v = Math.min(s.disponivel, teto);
    if (v <= 0) continue;
    saida.push({ sinal_id: s.id, valor_centavos: v });
    resto -= v;
  }
  return saida;
}

// ============================================================
// Prévia
// ============================================================

export interface AlertaDaFatura {
  codigo: CodigoDoAlerta | 'SEM_ITENS' | 'PARTE_MISTURADA';
  gravidade: 'aviso' | 'atencao';
  mensagem: string;
  valor?: Centavos;
  itens?: number;
}

export interface PreviaDaFatura {
  parte_id: string;
  parte_nome: string;
  itens: ItemAFaturar[];
  quantidade: number;
  vendas: number;
  total_itens: Centavos;
  compensacoes: Compensacao[];
  total_sinal: Centavos;
  a_pagar: Centavos;
  vencimento: Vencimento;
  corte: string;
  /** Do cliente: quanto das vendas desta fatura ainda não entrou. */
  saldo_cliente: Centavos;
  alertas: AlertaDaFatura[];
}

export function previaDaFatura(e: {
  parte_id: string; parte_nome: string; itens: ItemAFaturar[]; sinais: readonly SinalDisponivel[]; vencimento: Vencimento; corte: string;
}): PreviaDaFatura {
  const total = e.itens.reduce((a, i) => a + i.valor_a_gerar, 0);
  const compensacoes = planejarCompensacao(e.itens, e.sinais);
  const sinal = compensacoes.reduce((a, c) => a + c.valor_centavos, 0);
  const saldoCliente = e.itens.reduce((a, i) => a + i.saldo_cliente, 0);
  const alertas: AlertaDaFatura[] = [];
  if (!e.itens.length) alertas.push({ codigo: 'SEM_ITENS', gravidade: 'atencao', mensagem: 'Escolha ao menos um item para a fatura.' });
  if (e.itens.some(i => i.parte_id !== e.parte_id)) alertas.push({ codigo: 'PARTE_MISTURADA', gravidade: 'atencao', mensagem: 'Há itens de outra pessoa nesta seleção.' });
  const naoPagos = e.itens.filter(i => i.saldo_cliente > 0);
  if (naoPagos.length) {
    alertas.push({
      codigo: 'CLIENTE_NAO_PAGOU', gravidade: 'atencao', valor: saldoCliente, itens: naoPagos.length,
      mensagem: `${naoPagos.length === 1 ? '1 item' : `${naoPagos.length} itens`} desta fatura ${naoPagos.length === 1 ? 'tem' : 'têm'} ${reaisTxt(saldoCliente)} que os clientes ainda não pagaram. Pagar em ${dataBR(e.vencimento.data)} tira esse valor do caixa antes de ele entrar.`,
    });
  }
  const atraso = e.itens.filter(i => i.alertas.some(a => a.codigo === 'CLIENTE_EM_ATRASO'));
  if (atraso.length) alertas.push({ codigo: 'CLIENTE_EM_ATRASO', gravidade: 'atencao', itens: atraso.length, mensagem: `${atraso.length === 1 ? '1 venda' : `${atraso.length} vendas`} com cliente em atraso.` });
  const canceladas = e.itens.filter(i => i.situacao_venda === 'CANCELADA');
  if (canceladas.length) alertas.push({ codigo: 'VENDA_CANCELADA', gravidade: 'atencao', itens: canceladas.length, mensagem: `${canceladas.length === 1 ? '1 item é' : `${canceladas.length} itens são`} de venda cancelada.` });
  const moedas = [...new Set(e.itens.map(i => i.moeda_fornecedor).filter(m => m !== 'BRL'))];
  if (moedas.length) alertas.push({ codigo: 'MOEDA_ESTRANGEIRA', gravidade: 'aviso', mensagem: `Itens em ${moedas.join(', ')} entram em reais, pelo câmbio de cada venda.` });
  return {
    parte_id: e.parte_id, parte_nome: e.parte_nome, itens: e.itens,
    quantidade: e.itens.length, vendas: new Set(e.itens.map(i => i.venda_id)).size,
    total_itens: total, compensacoes, total_sinal: sinal, a_pagar: total - sinal,
    vencimento: e.vencimento, corte: e.corte, saldo_cliente: saldoCliente, alertas,
  };
}

// ============================================================
// A conta da venda que entrou na fatura, vista pela posição da venda
// ============================================================

export interface FaturaParaReflexo {
  id: string;
  numero: string;
  situacao: string;
  vencimento: string;
  valor_itens_centavos: Centavos;
  sinal_centavos: Centavos;
  /** A conta a pagar da fatura (null quando o sinal cobriu tudo). */
  conta_status: string | null;
  conta_valor_centavos: Centavos;
  conta_pago_centavos: Centavos;
}

/** Quanto da fatura já foi pago (sinal + baixa da conta), em centavos. */
export function pagoDaFatura(f: FaturaParaReflexo): Centavos {
  let pago = f.sinal_centavos;
  if (f.conta_status === 'PAGO') pago += f.conta_valor_centavos;
  else if (f.conta_status === 'PARCIAL') pago += Math.min(f.conta_pago_centavos, f.conta_valor_centavos);
  return Math.min(pago, f.valor_itens_centavos);
}

/**
 * A conta da venda que a fatura absorveu volta à posição como se estivesse
 * viva: mesmo valor, vencimento da fatura e o pagamento na proporção do que
 * a fatura já recebeu.
 */
export function refletirContaFaturada(d: Record<string, unknown>, f: FaturaParaReflexo): Record<string, unknown> {
  const valor = brl(d.valor_final);
  const pagoFatura = pagoDaFatura(f);
  const pago = f.valor_itens_centavos > 0 ? Math.min(valor, Math.round(valor * pagoFatura / f.valor_itens_centavos)) : 0;
  const status = pago >= valor && valor > 0 ? 'PAGO' : pago > 0 ? 'PARCIAL' : 'PENDENTE';
  return {
    ...d,
    status,
    valor_pago: pago > 0 ? deCentavos(pago) : null,
    data_vencimento: f.vencimento || d.data_vencimento,
    fatura_fornecedor_numero: f.numero,
    na_fatura_do_fornecedor: true,
  };
}
