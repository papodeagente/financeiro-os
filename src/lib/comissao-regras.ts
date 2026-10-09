/**
 * Regras de comissão por produto.
 *
 * O plano paga um percentual sobre a base da venda. Este módulo é a exceção
 * a isso: produtos escolhidos pela agência podem pagar OUTRO percentual, ou
 * um valor fixo em reais, para estimular a venda deles.
 *
 * As três decisões que governam o cálculo (Bruno, 08/10/2026):
 *
 *  1. VALOR FIXO É POR REGRA: cada regra diz se o valor é por VENDA (paga uma
 *     vez, apareceu o produto) ou por UNIDADE (multiplica pela quantidade).
 *
 *  2. A REGRA CONVIVE, NÃO SUBSTITUI. A regra vale só para a parte do produto
 *     dela; o resto da venda segue o plano normal. "R$ 500 do Produto X mais
 *     3% dos outros R$ 4.000". Duas regras na mesma venda somam. É o que faz
 *     a regra ser estímulo: ela acrescenta, não troca o que a pessoa já
 *     ganharia.
 *
 *  3. O VALOR FIXO FICA FORA DA ESCADA. A faixa do mês é uma tabela de
 *     percentuais sobre a base acumulada; um valor fixo não é percentual de
 *     nada. Ele é pago por cima, e não empurra o vendedor de faixa — senão o
 *     mesmo produto valeria diferente conforme o mês que a pessoa fez, e o
 *     rateio de centavos do mês deixaria de fechar.
 *
 * POR QUE A PARTE PERCENTUAL ENCOLHE. Se o Produto X paga R$ 500 fixos, o
 * valor dele não pode também entrar na base que recebe os 3% — seria pagar
 * duas vezes pelo mesmo produto. Então a base da venda é reduzida na mesma
 * proporção que o produto representa no total vendido.
 */

import { divSegura, num, percentual, round2, soma, somaPor } from './money';

/** Como a regra paga. */
export type PagamentoDaRegra =
  | { forma: 'PERCENTUAL'; percentual: number }
  | { forma: 'VALOR_FIXO'; valor: number; por: 'VENDA' | 'UNIDADE' };

/**
 * Uma regra do plano.
 *
 * `produto_id` é o produto do catálogo do CRM — é o que identifica "o Produto
 * X". `tipo_produto` é a categoria (AEREO, HOTEL...), que já existia e
 * continua valendo para quem quer a regra larga. Regra de produto específico
 * ganha da regra de tipo.
 */
export interface RegraDeProduto {
  produto_id?: string;
  /** Só para a tela mostrar: o casamento é sempre pelo id. */
  produto_nome?: string;
  tipo_produto?: string;
  pagamento: PagamentoDaRegra;
}

/** O produto como ele chega na venda. */
export interface ProdutoDaVenda {
  produto_id?: string | null;
  tipo?: string | null;
  /** Ausente vale 1: venda manual não registra quantidade. */
  quantidade?: number | null;
  /** Já em BRL. Converter antes de chamar. */
  valor_venda?: number | null;
}

export interface ParteDaVenda {
  /** A base que vai para a escada do mês, já descontada do que paga fixo. */
  base_percentual: number;
  /** Percentual de fallback da parte percentual. */
  pct_fallback: number;
  /** Pago por cima da escada. */
  bonus_fixo: number;
  /** Uma linha por regra que pegou, para a tela explicar o número. */
  aplicadas: Array<{
    produto_id: string;
    tipo_produto: string;
    forma: 'PERCENTUAL' | 'VALOR_FIXO';
    /** O percentual, ou o valor pago. */
    valor: number;
  }>;
}

/**
 * Aceita o formato antigo das regras.
 *
 * Até 08/10/2026 a regra era `{ tipo_produto, percentual }`. Os planos já
 * gravados no banco continuam assim, e reescrevê-los numa migração seria
 * mexer em dinheiro sem necessidade: normalizar na leitura resolve.
 */
export function normalizarRegras(cru: unknown): RegraDeProduto[] {
  if (!Array.isArray(cru)) return [];
  const fora: RegraDeProduto[] = [];
  for (const r of cru) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const produto_id = texto(o.produto_id);
    const tipo_produto = texto(o.tipo_produto);
    if (!produto_id && !tipo_produto) continue;

    const base: Omit<RegraDeProduto, 'pagamento'> = {
      ...(produto_id ? { produto_id } : {}),
      ...(texto(o.produto_nome) ? { produto_nome: texto(o.produto_nome) } : {}),
      ...(tipo_produto ? { tipo_produto } : {}),
    };

    const pag = o.pagamento as Record<string, unknown> | undefined;
    if (pag && pag.forma === 'VALOR_FIXO') {
      const valor = round2(num(pag.valor));
      if (valor <= 0) continue; // regra que paga zero não é regra
      fora.push({ ...base, pagamento: { forma: 'VALOR_FIXO', valor, por: pag.por === 'UNIDADE' ? 'UNIDADE' : 'VENDA' } });
      continue;
    }
    // Formato novo com percentual, ou o formato antigo (percentual solto).
    const pct = pag && pag.forma === 'PERCENTUAL' ? num(pag.percentual) : num(o.percentual);
    fora.push({ ...base, pagamento: { forma: 'PERCENTUAL', percentual: round2(pct) } });
  }
  return fora;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Regra de produto específico ganha da regra de tipo. */
export function regraDoProduto(regras: RegraDeProduto[], produto: ProdutoDaVenda): RegraDeProduto | null {
  const id = texto(produto.produto_id);
  if (id) {
    const exata = regras.find(r => texto(r.produto_id) === id);
    if (exata) return exata;
  }
  const tipo = texto(produto.tipo).toUpperCase();
  if (tipo) {
    const porTipo = regras.find(r => !texto(r.produto_id) && texto(r.tipo_produto).toUpperCase() === tipo);
    if (porTipo) return porTipo;
  }
  return null;
}

/** Quantidade efetiva: ausente, zero ou quebrada valem 1. */
export function quantidadeDoProduto(produto: ProdutoDaVenda): number {
  const q = Math.floor(num(produto.quantidade));
  return q >= 1 ? q : 1;
}

/**
 * Reparte a venda entre a parte que segue o plano e a parte que paga fixo.
 *
 * `base` é o valor base da venda que o plano já apurou (markup, receita da
 * agência, valor de venda...). Ela não é a soma dos produtos: por isso o que
 * se faz com ela é ENCOLHER na proporção do que saiu para o fixo, nunca
 * somar valores de produto nela.
 */
export function repartirVenda(entrada: {
  base: number;
  produtos: ProdutoDaVenda[];
  regras: RegraDeProduto[];
  percentual_padrao: number;
}): ParteDaVenda {
  const base = round2(num(entrada.base));
  const padrao = round2(num(entrada.percentual_padrao));
  const produtos = (entrada.produtos ?? []).filter(Boolean);
  const regras = entrada.regras ?? [];
  const vazio: ParteDaVenda = { base_percentual: base, pct_fallback: padrao, bonus_fixo: 0, aplicadas: [] };

  if (regras.length === 0 || produtos.length === 0) return vazio;

  const totalProdutos = somaPor(produtos, p => num(p.valor_venda));
  if (totalProdutos <= 0) return vazio;

  const aplicadas: ParteDaVenda['aplicadas'] = [];
  const fixos: number[] = [];
  let valorQuePagaFixo = 0;
  // A parte percentual: comissão ponderada e o valor que a sustenta.
  let comissaoPonderada = 0;
  let valorPercentual = 0;

  for (const p of produtos) {
    const valor = round2(num(p.valor_venda));
    const regra = regraDoProduto(regras, p);

    if (regra && regra.pagamento.forma === 'VALOR_FIXO') {
      const vezes = regra.pagamento.por === 'UNIDADE' ? quantidadeDoProduto(p) : 1;
      const pago = round2(regra.pagamento.valor * vezes);
      fixos.push(pago);
      valorQuePagaFixo = round2(valorQuePagaFixo + valor);
      aplicadas.push({
        produto_id: texto(p.produto_id), tipo_produto: texto(p.tipo),
        forma: 'VALOR_FIXO', valor: pago,
      });
      continue;
    }

    const pct = regra && regra.pagamento.forma === 'PERCENTUAL' ? round2(num(regra.pagamento.percentual)) : padrao;
    comissaoPonderada = round2(comissaoPonderada + percentual(valor, pct));
    valorPercentual = round2(valorPercentual + valor);
    if (regra) {
      aplicadas.push({
        produto_id: texto(p.produto_id), tipo_produto: texto(p.tipo),
        forma: 'PERCENTUAL', valor: pct,
      });
    }
  }

  // A base encolhe na proporção do que saiu para o fixo. Sem isto, o produto
  // de valor fixo pagaria duas vezes: o fixo e mais o percentual da venda.
  const fracao = divSegura(round2(totalProdutos - valorQuePagaFixo), totalProdutos);
  const base_percentual = round2(base * Math.min(Math.max(fracao, 0), 1));

  return {
    base_percentual,
    pct_fallback: valorPercentual > 0 ? round2(divSegura(comissaoPonderada, valorPercentual) * 100) : padrao,
    bonus_fixo: soma(fixos),
    aplicadas,
  };
}
