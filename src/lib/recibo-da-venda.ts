/**
 * Recibo da venda para o cliente (tela /vendas/[id]/recibo).
 *
 * Bruno, 13/11/2026: "Para uma venda realizada, quero ter a possibilidade de
 * emitir um recibo para o cliente da venda com o valor total e descrição dos
 * valores."
 *
 * O recibo é do valor total da venda (valor final, depois do desconto). A
 * descrição dos valores sempre fecha com esse total: cada item entra pelo
 * valor de venda em reais (valor × câmbio, como na ficha da venda); se a soma
 * dos itens não bate com o total de venda gravado (venda que veio do CRM com
 * taxa, por exemplo), a diferença aparece numa linha própria, nunca some.
 *
 * Só regra: nada de banco nem de tela. Valores em centavos por dentro para
 * não somar com erro de ponto flutuante.
 */
import type { VendaCRM } from './crm-types';

export interface LinhaDoRecibo {
  descricao: string;
  detalhe: string;
  valor: number;
}

export interface Recibo {
  linhas: LinhaDoRecibo[];
  subtotal: number;
  desconto: number;
  total: number;
  totalPorExtenso: string;
  pagamento: string;
}

/** Venda que pode ter recibo: realizada (não orçamento, não cancelada). */
export function vendaTemRecibo(status: string | undefined): boolean {
  return status === 'RESERVADO' || status === 'CONFIRMADO' || status === 'CONCLUIDO';
}

const centavos = (v: unknown) => Math.round((Number(v) || 0) * 100);
const reais = (c: number) => c / 100;

const TIPO: Record<string, string> = {
  AEREO: 'Aéreo', HOTEL: 'Hospedagem', SEGURO: 'Seguro viagem', RECEPTIVO: 'Receptivo',
  CARRO: 'Locação de carro', CRUZEIRO: 'Cruzeiro', INGRESSO: 'Ingresso', PACOTE: 'Pacote',
  GRUPO: 'Viagem em grupo', OUTROS: 'Serviço',
};

const FORMA: Record<string, string> = {
  AVISTA_PIX: 'À vista / Pix', CARTAO: 'Cartão', BOLETO: 'Boleto', FATURADO: 'Faturado', MISTO: 'Misto',
};

const data = (d: string | undefined) => {
  if (!d) return '';
  const [a, m, dia] = d.slice(0, 10).split('-');
  return a && m && dia ? `${dia}/${m}/${a}` : '';
};

function periodo(inicio?: string, fim?: string): string {
  const i = data(inicio), f = data(fim);
  if (i && f && i !== f) return `${i} a ${f}`;
  return i || f;
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export function montarRecibo(venda: Pick<VendaCRM, 'produtos' | 'valor_total_venda' | 'desconto' | 'valor_final' | 'forma_pagamento' | 'parcelas' | 'pagamento_detalhado'>): Recibo {
  const linhas: LinhaDoRecibo[] = [];
  let somaItens = 0;
  for (const p of Array.isArray(venda.produtos) ? venda.produtos : []) {
    const valor = Math.round(centavos(p.valor_venda) * (Number(p.cambio) || 1));
    somaItens += valor;
    const titulo = (p.descricao || '').trim() || TIPO[p.tipo] || 'Serviço';
    const detalhe = [
      p.descricao && TIPO[p.tipo] ? TIPO[p.tipo] : '',
      p.trecho || '',
      p.hotel_nome || '',
      periodo(p.data_inicio, p.data_fim),
      p.localizador ? `Localizador ${p.localizador}` : '',
      p.moeda && p.moeda !== 'BRL' && Number(p.cambio) > 0
        ? `${p.moeda} ${(Number(p.valor_venda) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} × câmbio ${Number(p.cambio).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}`
        : '',
    ].filter(Boolean).join(' · ');
    linhas.push({ descricao: titulo, detalhe, valor: reais(valor) });
  }

  const gravado = centavos(venda.valor_total_venda);
  const subtotal = gravado > 0 ? gravado : somaItens;
  if (subtotal !== somaItens) {
    linhas.push({
      descricao: linhas.length ? 'Outros valores da venda' : 'Serviços de viagem',
      detalhe: linhas.length ? 'Taxas e serviços incluídos no total da venda' : '',
      valor: reais(subtotal - somaItens),
    });
  }

  const final = centavos(venda.valor_final);
  const total = final > 0 ? final : Math.max(0, subtotal - Math.max(0, centavos(venda.desconto)));
  // O desconto mostrado é o que fecha a conta: subtotal − total. Total acima
  // do subtotal vira uma linha de acréscimo, para a soma continuar batendo.
  let subtotalFinal = subtotal;
  if (total > subtotal) {
    linhas.push({ descricao: 'Acréscimos', detalhe: '', valor: reais(total - subtotal) });
    subtotalFinal = total;
  }

  return {
    linhas,
    subtotal: reais(subtotalFinal),
    desconto: reais(subtotalFinal - total),
    total: reais(total),
    totalPorExtenso: valorPorExtenso(reais(total)),
    pagamento: descreverPagamento(venda),
  };
}

function descreverPagamento(v: Pick<VendaCRM, 'forma_pagamento' | 'parcelas' | 'pagamento_detalhado'>): string {
  const detalhado = Array.isArray(v.pagamento_detalhado) ? v.pagamento_detalhado.filter(p => Number(p.valor) > 0) : [];
  if (detalhado.length > 0) {
    return detalhado
      .map(p => `${FORMA[p.forma] || p.forma} ${brl(Number(p.valor))}${Number(p.parcelas) > 1 ? ` em ${p.parcelas}x` : ''}`)
      .join(' + ');
  }
  const forma = FORMA[v.forma_pagamento] || v.forma_pagamento || '';
  if (!forma) return '';
  return Number(v.parcelas) > 1 ? `${forma} em ${v.parcelas}x` : forma;
}

// ── Valor por extenso ──────────────────────────────────────────────────

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0 a 999 por extenso. */
function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 20) partes.push(UNIDADES[r]);
    else {
      const d = Math.floor(r / 10), u = r % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

const GRUPOS: [string, string][] = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];

function inteiroPorExtenso(n: number): string {
  if (n === 0) return 'zero';
  const grupos: number[] = [];
  while (n > 0) { grupos.push(n % 1000); n = Math.floor(n / 1000); }
  const partes: { texto: string; valor: number }[] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let texto: string;
    if (i === 1) texto = g === 1 ? 'mil' : `${ate999(g)} mil`;
    else if (i > 1) texto = `${ate999(g)} ${g === 1 ? GRUPOS[i][0] : GRUPOS[i][1]}`;
    else texto = ate999(g);
    partes.push({ texto, valor: g });
  }
  // "e" antes do último grupo quando ele é menor que 100 ou centena redonda
  // (mil e duzentos, dois mil e cinquenta); senão, vírgula/espaço.
  return partes.reduce((acc, p, idx) => {
    if (idx === 0) return p.texto;
    const ultimo = idx === partes.length - 1;
    const liga = ultimo && (p.valor < 100 || p.valor % 100 === 0) ? ' e ' : ' ';
    return acc + liga + p.texto;
  }, '');
}

/** R$ 1.234,56 → "mil duzentos e trinta e quatro reais e cinquenta e seis centavos". */
export function valorPorExtenso(valor: number): string {
  const total = Math.round(Math.abs(Number(valor) || 0) * 100);
  const inteiro = Math.floor(total / 100), cents = total % 100;
  const partes: string[] = [];
  if (inteiro > 0) {
    const texto = inteiroPorExtenso(inteiro);
    // "um milhão de reais", "dois milhões de reais"
    const de = inteiro % 1_000_000 === 0 ? ' de' : '';
    partes.push(`${texto}${de} ${inteiro === 1 ? 'real' : 'reais'}`);
  }
  if (cents > 0) partes.push(`${inteiroPorExtenso(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`);
  if (partes.length === 0) return 'zero real';
  return partes.join(' e ');
}
