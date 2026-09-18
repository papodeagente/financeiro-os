/** Leitura tolerante de payload de terceiro. Cada plataforma muda nome de
 *  campo entre versões, e quebrar por causa disso perde venda. */
import { round2, num, ratearTotal, addMeses } from '../money';
import type { ParcelaNormalizada, StatusParcelaPlataforma } from './tipos';

export function em(o: unknown, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>(
    (acc, p) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[p] : undefined),
    o,
  );
}

export function texto(o: unknown, ...caminhos: string[]): string {
  for (const c of caminhos) {
    const v = em(o, c);
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

export function numero(o: unknown, ...caminhos: string[]): number {
  for (const c of caminhos) {
    const v = em(o, c);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

/** Centavos para reais. Pagar.me e Hotmart falam em centavos em vários
 *  campos, e somar centavo como real multiplica a receita por cem. */
export function deCentavos(v: unknown): number {
  return round2(num(v) / 100);
}

/** Data civil 'YYYY-MM-DD' a partir de ISO, epoch em ms ou 'DD/MM/YYYY'. */
export function data(o: unknown, ...caminhos: string[]): string {
  for (const c of caminhos) {
    const v = em(o, c);
    if (typeof v === 'number' && v > 0) {
      // Epoch em segundos ou em ms: abaixo de 1e12 é segundos.
      const ms = v < 1e12 ? v * 1000 : v;
      return new Date(ms).toISOString().slice(0, 10);
    }
    if (typeof v === 'string' && v.trim()) {
      const t = v.trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
      const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    }
  }
  return '';
}

export function digitos(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** Comparação de segredo que não vaza tamanho nem posição por tempo. */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (x.length !== y.length) return false;
  let diferenca = 0;
  for (let i = 0; i < x.length; i++) diferenca |= x[i] ^ y[i];
  return diferenca === 0;
}

/**
 * Monta as parcelas de uma transação a partir dos totais.
 *
 * Existe porque cada plataforma informa a mesma venda de um jeito:
 * o cartão parcelado é UM pagamento do comprador com N liberações
 * mensais para o vendedor; o boleto parcelado são N cobranças de
 * verdade. Os dois viram a mesma lista aqui, e o financeiro passa a ler
 * um formato só.
 *
 * Invariante: a soma do bruto das parcelas é exatamente o total. Por isso
 * o rateio usa `ratearTotal` (resíduo na maior), e nunca `total / n`.
 */
export function montarParcelas(o: {
  total: number;
  taxaTotal?: number;
  liquidoTotal?: number;
  desconto?: number;
  juros?: number;
  quantidade: number;
  status: StatusParcelaPlataforma;
  /** Vencimento da primeira. As seguintes andam de mês em mês. */
  primeiroVencimento: string;
  /** Quando o comprador pagou. No cartão parcelado é o mesmo em todas. */
  dataPagamento?: string;
  /** Quando caiu na conta. Só no que já liquidou. */
  dataRecebimento?: string;
  /** Previsão de repasse da PRIMEIRA parcela. Anda junto com o vencimento. */
  primeiraPrevisao?: string;
  /** Prefixo do id externo de cada parcela, quando a plataforma não dá um. */
  idBase?: string;
}): ParcelaNormalizada[] {
  const quantidade = Math.max(1, Math.trunc(num(o.quantidade)) || 1);
  const total = round2(num(o.total));
  const pesos = Array.from({ length: quantidade }, () => 1);

  const brutos = ratearTotal(total, pesos);
  // Taxa e líquido seguem a proporção do bruto de cada parcela: ratear por
  // peso igual jogaria o resíduo na parcela errada quando o bruto não é
  // divisível, e a soma deixaria de fechar com o que a plataforma informou.
  const taxas = ratearTotal(round2(num(o.taxaTotal)), brutos);
  const liquidos = o.liquidoTotal !== undefined && num(o.liquidoTotal) > 0
    ? ratearTotal(round2(num(o.liquidoTotal)), brutos)
    : brutos.map((b, i) => round2(b - taxas[i]));
  const descontos = ratearTotal(round2(num(o.desconto)), brutos);
  const jurosPorParcela = ratearTotal(round2(num(o.juros)), brutos);

  return brutos.map((valor, i) => ({
    numero: i + 1,
    total: quantidade,
    id_externo: o.idBase ? `${o.idBase}-${i + 1}` : '',
    valor_bruto: valor,
    valor_taxa: taxas[i],
    valor_liquido: liquidos[i],
    desconto: descontos[i],
    juros: jurosPorParcela[i],
    status: o.status,
    data_vencimento: o.primeiroVencimento ? addMeses(o.primeiroVencimento, i) : '',
    data_prevista_recebimento: o.primeiraPrevisao ? addMeses(o.primeiraPrevisao, i) : '',
    // O comprador paga uma vez: a data do pagamento é a mesma em todas as
    // parcelas. O que anda no tempo é a LIBERAÇÃO, não o pagamento.
    data_pagamento: o.dataPagamento ?? '',
    // Recebido de verdade só a primeira, e só se a plataforma disse que
    // liquidou. Marcar todas como recebidas antecipa receita que não entrou.
    data_recebimento: i === 0 ? (o.dataRecebimento ?? '') : '',
    antecipada: false,
  }));
}

/** Soma dos brutos das parcelas. Usada nos invariantes e nos testes. */
export function somaBruto(parcelas: readonly ParcelaNormalizada[]): number {
  return round2(parcelas.reduce((a, p) => a + num(p.valor_bruto), 0));
}
