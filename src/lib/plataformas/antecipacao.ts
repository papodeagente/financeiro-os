/**
 * Venda parcelada que a plataforma ANTECIPA: um lançamento só.
 *
 * Pedido do Bruno (08/10/2026): "Pagarme tem antecipação de crédito e deve
 * ter apenas um lançamento; ao clicar no lançamento, ele pode detalhar como
 * aconteceu, em 12x, o valor da parcela, cartão ou forma de pagamento."
 *
 * O comprador parcela no cartão, mas com a antecipação a agência recebe a
 * venda inteira de uma vez (descontadas a taxa e o custo da antecipação).
 * Doze contas de R$ 321,67 vencendo um mês depois da outra prometiam um
 * dinheiro que já tinha caído: o caixa projetado ficava errado e a
 * conciliação do extrato não fechava.
 *
 * O parcelamento do comprador não some: fica em `parcelas_do_comprador` e
 * `valor_parcela_do_comprador`, para o detalhe do lançamento.
 *
 * Módulo puro.
 */
import { num, round2 } from '../money';
import type { ParcelaNormalizada, StatusParcelaPlataforma } from './tipos';
import type { ContaDaTransacao } from './hotmart-regras';

/** Gravidade para decidir o status da venda inteira: o pior estado manda. */
const ORDEM_FINAL: StatusParcelaPlataforma[] = ['CHARGEBACK', 'ESTORNADO', 'CANCELADO'];
const ORDEM_ABERTA: StatusParcelaPlataforma[] = ['ATRASADO', 'PENDENTE', 'AGUARDANDO', 'CONFIRMADO'];

/** O status da venda inteira a partir das parcelas. */
export function statusDaVenda(parcelas: readonly ParcelaNormalizada[]): StatusParcelaPlataforma {
  const st = parcelas.map(p => p.status);
  for (const s of ORDEM_FINAL) if (st.includes(s)) return s;
  if (st.length > 0 && st.every(s => s === 'RECEBIDO')) return 'RECEBIDO';
  for (const s of ORDEM_ABERTA) if (st.includes(s)) return s;
  return st[0] ?? 'PENDENTE';
}

const maior = (datas: Array<string | undefined>) => datas.filter((d): d is string => Boolean(d)).sort().at(-1) ?? '';
const menor = (datas: Array<string | undefined>) => datas.filter((d): d is string => Boolean(d)).sort()[0] ?? '';

/**
 * As N parcelas viram uma.
 *
 * Valores somados (bruto, taxa, líquido), então nada se perde no
 * arredondamento. A data em que o dinheiro cai é a do repasse antecipado
 * (o extrato de recebíveis põe a mesma data em todas as parcelas); sem o
 * extrato, a data do pagamento.
 */
export function parcelaUnicaAntecipada(parcelas: readonly ParcelaNormalizada[]): ParcelaNormalizada | null {
  if (parcelas.length === 0) return null;
  const ordenadas = [...parcelas].sort((a, b) => a.numero - b.numero);
  const primeira = ordenadas[0];
  const status = statusDaVenda(ordenadas);
  const soma = (f: (p: ParcelaNormalizada) => number) => round2(ordenadas.reduce((s, p) => s + num(f(p)), 0));
  const repasse = maior(ordenadas.map(p => p.data_prevista_recebimento));
  const pagamento = menor(ordenadas.map(p => p.data_pagamento));
  return {
    ...primeira,
    numero: 1,
    total: 1,
    valor_bruto: soma(p => p.valor_bruto),
    valor_taxa: soma(p => p.valor_taxa),
    valor_liquido: soma(p => p.valor_liquido),
    desconto: soma(p => p.desconto),
    juros: soma(p => p.juros),
    status,
    data_vencimento: repasse || pagamento || primeira.data_vencimento,
    data_prevista_recebimento: repasse || pagamento || primeira.data_prevista_recebimento,
    data_pagamento: pagamento,
    data_recebimento: status === 'RECEBIDO' ? maior(ordenadas.map(p => p.data_recebimento)) : '',
    antecipada: true,
  };
}

export interface PlanoDeParcelaUnica {
  /** Já está num lançamento só: nada a fazer. */
  em_dia: boolean;
  /** Motivo de não mexer (conta tocada por uma pessoa). */
  pulada: string | null;
  parcela: ParcelaNormalizada | null;
  /** A conta que representa a venda (a da parcela 1). */
  conta_principal: string | null;
  /** Contas que sobram: parcelas 2..N. */
  cancelar: string[];
  /** Quanto o caixa já recebeu desta venda, somando todas as parcelas. */
  creditado: number;
}

/**
 * O que corrigir numa venda antecipada gravada em N contas.
 *
 * Conta que uma pessoa tocou (conciliada no extrato, com nota, baixada à
 * mão) faz a venda ser pulada e listada: a correção não apaga trabalho de
 * ninguém. Mesmo princípio da revisão da Hotmart.
 */
export function planoDeParcelaUnica(
  parcelas: readonly ParcelaNormalizada[],
  contas: readonly ContaDaTransacao[],
  creditado: Record<string, number>,
): PlanoDeParcelaUnica {
  const jaCreditado = round2(Object.values(creditado ?? {}).reduce((s, v) => s + num(v), 0));
  const parcela = parcelaUnicaAntecipada(parcelas);
  const daParcela1 = contas.filter(c => c.numero === 1);
  const principal = daParcela1.find(c => /-1$/.test(c.id)) ?? daParcela1[0] ?? null;
  const cancelar = contas.filter(c => c !== principal && c.status !== 'CANCELADO').map(c => c.id);
  const em_dia = parcelas.length <= 1 && cancelar.length === 0;
  // Parte já caiu no banco e parte não: as datas são diferentes, então
  // juntar mudaria o caixa de um dinheiro que já entrou. Uma pessoa confere.
  const vivas = parcelas.filter(p => p.status !== 'CANCELADO' && p.status !== 'ESTORNADO' && p.status !== 'CHARGEBACK');
  const recebidas = vivas.filter(p => p.status === 'RECEBIDO').length;
  if (!em_dia && recebidas > 0 && recebidas < vivas.length) {
    return { em_dia: false, pulada: `${recebidas} de ${vivas.length} parcelas já caíram no banco em datas diferentes`, parcela, conta_principal: principal?.id ?? null, cancelar: [], creditado: jaCreditado };
  }
  const tocada = contas.find(c => c.tocada_por_humano);
  if (!em_dia && tocada) {
    return { em_dia: false, pulada: `${tocada.id}: ${tocada.tocada_por_humano}`, parcela, conta_principal: principal?.id ?? null, cancelar: [], creditado: jaCreditado };
  }
  return { em_dia, pulada: null, parcela, conta_principal: principal?.id ?? null, cancelar, creditado: jaCreditado };
}

/** "12x de R$ 321,67", "à vista". */
export function descreverParcelamento(
  parcelas: number | undefined,
  valorDaParcela: number | undefined,
  formatar: (v: number) => string,
): string {
  const n = Math.max(1, Math.trunc(num(parcelas)) || 1);
  if (n === 1) return 'à vista';
  return num(valorDaParcela) > 0 ? `${n}x de ${formatar(num(valorDaParcela))}` : `${n}x`;
}

/** "Cartão de crédito Visa •••• 4242", "Pix", "Boleto". */
export function descreverFormaDePagamento(forma: string | undefined, bandeira?: string, final?: string): string {
  const f = String(forma ?? '').toLowerCase();
  const nome =
    f === 'credit_card' || f === 'credito' || f === 'cartao' ? 'Cartão de crédito'
      : f === 'debit_card' ? 'Cartão de débito'
        : f === 'pix' ? 'Pix'
          : f === 'boleto' || f === 'billet' ? 'Boleto'
            : forma ? String(forma) : 'Não informada';
  const marca = String(bandeira ?? '').trim();
  const fim = String(final ?? '').trim();
  const cartao = [marca ? marca.charAt(0).toUpperCase() + marca.slice(1).toLowerCase() : '', fim ? `•••• ${fim}` : ''].filter(Boolean).join(' ');
  return cartao && nome.startsWith('Cartão') ? `${nome} ${cartao}` : nome;
}
