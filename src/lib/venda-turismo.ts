/**
 * Venda de turismo lançada no Financeiro.
 *
 * Pedido do Bruno (09/10/2026): "Quando eu lançar uma nova venda (conta a
 * receber), considere que é uma venda de turismo, que múltiplos fornecedores
 * podem entrar nessa lista. Cada um tem uma margem (preço net e preço de
 * venda)."
 *
 * Uma venda de agência é uma cesta: aéreo de uma consolidadora, hotel de uma
 * operadora, seguro, receptivo, a taxa de serviço da própria agência. Cada
 * linha tem quanto a agência paga (net) e quanto cobra (venda); a margem é a
 * diferença. Quando o cliente paga direto ao fornecedor, a agência não cobra
 * o serviço: recebe a comissão dele.
 *
 * Este módulo é a tela sem React: a margem de cada linha, os totais, a
 * validação e a montagem da venda que o servidor grava. As contas a receber
 * e a pagar NÃO são calculadas aqui: saem de gerarContasVenda, o mesmo
 * gerador do servidor, para a prévia e a gravação nunca discordarem.
 */
import type { ItemVendaData, TipoProdutoVenda, VendaCRM } from './crm-types';
import { createVendaCRM } from './crm-types';
import { generateId } from './utils';
import { num, paraBRL, percentual, round2, somaPor } from './money';
import type { ItemVendaInput } from './venda-financeiro';

export const TIPOS_DE_SERVICO: ReadonlyArray<{ id: TipoProdutoVenda; rotulo: string }> = [
  { id: 'AEREO', rotulo: 'Aéreo' },
  { id: 'HOTEL', rotulo: 'Hospedagem' },
  { id: 'PACOTE', rotulo: 'Pacote' },
  { id: 'CRUZEIRO', rotulo: 'Cruzeiro' },
  { id: 'SEGURO', rotulo: 'Seguro viagem' },
  { id: 'RECEPTIVO', rotulo: 'Receptivo e passeios' },
  { id: 'CARRO', rotulo: 'Locação de carro' },
  { id: 'INGRESSO', rotulo: 'Ingressos' },
  { id: 'OUTROS', rotulo: 'Outros' },
];

/** Descrição padrão da linha de taxa de serviço (RAV/DU), receita própria da agência. */
export const DESCRICAO_TAXA_DE_SERVICO = 'Taxa de serviço da agência';

export type Moeda = 'BRL' | 'USD' | 'EUR';

export interface LinhaDeServico {
  id: string;
  tipo: TipoProdutoVenda;
  fornecedor_id: string;
  fornecedor_nome: string;
  descricao: string;
  /** Quanto a agência paga ao fornecedor, na moeda da linha. */
  net: number;
  /** Quanto cobra do cliente, na moeda da linha. */
  venda: number;
  moeda: Moeda;
  /** Reais por unidade da moeda. Ignorado em BRL. */
  cambio: number;
  /** O cliente paga direto ao fornecedor; a agência recebe comissão. */
  pagoDireto: boolean;
  /** Comissão do fornecedor, em % do valor do serviço (só quando pagoDireto). */
  comissaoPct: number;
  /** Quando pagar o fornecedor. Vazio: o prazo do cadastro dele. */
  dataPagamento: string;
  /** Linha da própria agência (taxa de serviço): sem fornecedor, sem custo. */
  daAgencia: boolean;
}

export function novaLinha(parcial: Partial<LinhaDeServico> = {}): LinhaDeServico {
  return {
    id: generateId(), tipo: 'AEREO', fornecedor_id: '', fornecedor_nome: '', descricao: '',
    net: 0, venda: 0, moeda: 'BRL', cambio: 1, pagoDireto: false, comissaoPct: 0, dataPagamento: '', daAgencia: false,
    ...parcial,
  };
}

export function linhaDeTaxa(): LinhaDeServico {
  return novaLinha({ tipo: 'OUTROS', descricao: DESCRICAO_TAXA_DE_SERVICO, daAgencia: true });
}

const emReais = (v: number, l: Pick<LinhaDeServico, 'moeda' | 'cambio'>) => paraBRL(num(v), l.moeda, num(l.cambio) || 1);

export interface ContaDaLinha {
  /** O que o cliente paga à agência por esta linha (0 se paga direto ao fornecedor). */
  cobradoDoCliente: number;
  /** O que a agência paga ao fornecedor (0 se paga direto ou se é da agência). */
  custo: number;
  /** Comissão que o fornecedor deve à agência (só pago direto). */
  comissao: number;
  /** O que fica para a agência. */
  margem: number;
  /** margem ÷ valor do serviço. Null sem valor. */
  margemPct: number | null;
}

/** A conta de uma linha, em reais. */
export function contaDaLinha(l: LinhaDeServico): ContaDaLinha {
  const venda = emReais(l.venda, l);
  if (l.pagoDireto) {
    const comissao = percentual(venda, num(l.comissaoPct));
    return { cobradoDoCliente: 0, custo: 0, comissao, margem: comissao, margemPct: venda > 0 ? round2((comissao / venda) * 100) : null };
  }
  const custo = l.daAgencia ? 0 : emReais(l.net, l);
  const margem = round2(venda - custo);
  return { cobradoDoCliente: venda, custo, comissao: 0, margem, margemPct: venda > 0 ? round2((margem / venda) * 100) : null };
}

export interface TotaisDaVenda {
  /** O que o cliente paga à agência: é o que vira contas a receber. */
  cliente: number;
  /** Valor dos serviços que o cliente paga direto aos fornecedores. */
  pagoDireto: number;
  custo: number;
  comissoes: number;
  margem: number;
  /** margem ÷ (cliente + pago direto). */
  margemPct: number | null;
  /** (cliente − custo) ÷ custo, sobre os serviços que a agência revende. */
  markupPct: number | null;
}

export function totaisDaVenda(linhas: readonly LinhaDeServico[]): TotaisDaVenda {
  const contas = linhas.map(contaDaLinha);
  const cliente = somaPor(contas, c => c.cobradoDoCliente);
  const pagoDireto = somaPor(linhas.filter(l => l.pagoDireto), l => emReais(l.venda, l));
  const custo = somaPor(contas, c => c.custo);
  const comissoes = somaPor(contas, c => c.comissao);
  const margem = round2(cliente - custo + comissoes);
  const base = round2(cliente + pagoDireto);
  return {
    cliente, pagoDireto, custo, comissoes, margem,
    margemPct: base > 0 ? round2((margem / base) * 100) : null,
    markupPct: custo > 0 ? round2(((cliente - custo) / custo) * 100) : null,
  };
}

// ─── Validação ─────────────────────────────────────────────────────────────

export interface ErrosDaVenda {
  cliente?: string;
  linhas?: string;
  /** Por id da linha. */
  porLinha: Record<string, string>;
  primeiroVencimento?: string;
}

/** O que impede gravar. Margem negativa NÃO impede: é um aviso (às vezes é de propósito). */
export function validarVenda(v: {
  cliente_id: string;
  linhas: readonly LinhaDeServico[];
  primeiroVencimento: string;
  dataVenda: string;
}): ErrosDaVenda {
  const e: ErrosDaVenda = { porLinha: {} };
  if (!v.cliente_id) e.cliente = 'Escolha o cliente.';
  if (v.linhas.length === 0) e.linhas = 'Inclua ao menos um serviço.';
  for (const l of v.linhas) {
    if (!(num(l.venda) > 0)) { e.porLinha[l.id] = l.pagoDireto ? 'Informe o valor do serviço.' : 'Informe o preço de venda.'; continue; }
    if (num(l.net) < 0) { e.porLinha[l.id] = 'O net não pode ser negativo.'; continue; }
    if (l.moeda !== 'BRL' && !(num(l.cambio) > 0)) { e.porLinha[l.id] = 'Informe o câmbio.'; continue; }
    if (l.pagoDireto && !l.fornecedor_id && !l.fornecedor_nome.trim()) { e.porLinha[l.id] = 'Escolha o fornecedor que paga a comissão.'; continue; }
    if (l.pagoDireto && !(num(l.comissaoPct) > 0)) { e.porLinha[l.id] = 'Informe a comissão do fornecedor.'; continue; }
  }
  if (v.primeiroVencimento && v.dataVenda && v.primeiroVencimento < v.dataVenda) {
    e.primeiroVencimento = 'O 1º vencimento não pode ser antes da venda.';
  }
  return e;
}

export function temErros(e: ErrosDaVenda): boolean {
  return Boolean(e.cliente || e.linhas || e.primeiroVencimento || Object.keys(e.porLinha).length > 0);
}

/** Linhas vendidas abaixo do custo: aviso, não bloqueio. */
export function linhasComPrejuizo(linhas: readonly LinhaDeServico[]): string[] {
  return linhas.filter(l => !l.pagoDireto && !l.daAgencia && contaDaLinha(l).margem < 0).map(l => l.id);
}

// ─── Montagem para o servidor ──────────────────────────────────────────────

export interface CabecalhoDaVenda {
  cliente_id: string;
  dataVenda: string;
  vendedor_id: string;
  formaPagamento: VendaCRM['forma_pagamento'];
  parcelas: number;
  primeiroVencimento: string;
  observacoes: string;
}

/**
 * A venda e os itens no formato do POST /api/vendas-crm, o mesmo da tela
 * /vendas/nova. Valores dos itens na MOEDA da linha: a conversão acontece uma
 * vez só, no gerador (contrato de moeda de venda-financeiro.ts).
 */
export function montarVenda(cab: CabecalhoDaVenda, linhas: readonly LinhaDeServico[], numero: string): {
  venda: VendaCRM;
  itens: ItemVendaInput[];
} {
  const base = createVendaCRM(numero);
  const totais = totaisDaVenda(linhas);
  const venda: VendaCRM = {
    ...base,
    data_venda: cab.dataVenda || base.data_venda,
    cliente_id: cab.cliente_id,
    vendedor_id: cab.vendedor_id,
    // Lançada aqui é venda fechada, não orçamento.
    status: 'CONFIRMADO',
    forma_pagamento: cab.formaPagamento,
    parcelas: Math.min(24, Math.max(1, Math.trunc(num(cab.parcelas)) || 1)),
    primeiro_vencimento: cab.primeiroVencimento || undefined,
    observacoes: cab.observacoes,
    valor_total_custo: totais.custo,
    valor_total_venda: round2(totais.cliente + totais.pagoDireto),
    // Percentual sobre o custo, como a tela /vendas/nova grava (ver venda-dash.ts).
    markup_realizado: totais.markupPct ?? 0,
    desconto: 0,
    valor_final: totais.cliente,
    produtos: linhas.map(l => ({
      id: l.id, tipo: l.tipo, descricao: l.descricao, fornecedor_id: l.fornecedor_id, fornecedor_nome: l.fornecedor_nome,
      data_inicio: '', data_fim: '', localizador: '', cia_aerea: '', trecho: '', hotel_nome: '', tipo_apto: '', regime: '',
      valor_custo: l.pagoDireto || l.daAgencia ? 0 : round2(num(l.net)), valor_venda: round2(num(l.venda)),
      comissao_fornecedor: l.pagoDireto ? round2(num(l.comissaoPct)) : 0,
      moeda: l.moeda, cambio: l.moeda === 'BRL' ? 1 : num(l.cambio), status: 'CONFIRMADO',
      aprovador: '', solicitante: '', centro_custo: '', projeto: '',
    })),
  };
  const itens: ItemVendaInput[] = linhas.map((l, i) => {
    const data: ItemVendaData = {
      tipo: l.tipo,
      descricao: l.descricao.trim() || (l.daAgencia ? DESCRICAO_TAXA_DE_SERVICO : ''),
      fornecedor_nome: l.daAgencia ? '' : l.fornecedor_nome.trim(),
      meio_pagamento: l.pagoDireto ? 'fornecedor' : 'proprio',
      valor_custo: l.pagoDireto || l.daAgencia ? 0 : round2(num(l.net)),
      valor_venda: round2(num(l.venda)),
      comissao_percentual: l.pagoDireto ? round2(num(l.comissaoPct)) : 0,
      comissao_valor: 0,
      moeda: l.moeda,
      cambio: l.moeda === 'BRL' ? 1 : num(l.cambio),
      localizador: '', data_inicio: '', data_fim: '', observacoes: '',
      contas_geradas_ids: [],
      data_pagamento_fornecedor: l.pagoDireto || l.daAgencia ? undefined : (l.dataPagamento || undefined),
    };
    return { id: l.id, venda_id: venda.id, fornecedor_id: l.daAgencia ? '' : l.fornecedor_id, sequencia: i + 1, status: 'ativo', data };
  });
  return { venda, itens };
}

/** Número da venda, no mesmo formato da tela /vendas/nova. */
export function numeroDeVenda(agora = Date.now()): string {
  return `V${agora.toString(36)}`;
}
