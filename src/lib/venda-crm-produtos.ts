/**
 * Os produtos vendidos que o CRM manda junto com a venda.
 *
 * POR QUE ISTO EXISTE. A regra de comissão por produto precisa saber QUAL
 * produto foi vendido. Até 08/10/2026 a venda vinda do CRM nascia com
 * `produtos: []` — o CRM mandava só os fornecedores, com os nomes dos
 * produtos colados numa string ("Passagem GRU-LIS, Seguro viagem"). Com a
 * lista vazia, a regra por produto era ignorada EM SILÊNCIO e a comissão
 * saía no percentual padrão.
 *
 * A IDENTIDADE DO PRODUTO. Um produto do catálogo pode ter nascido em dois
 * lugares, e o id tem que ser o mesmo nos dois casos, senão a regra
 * cadastrada não casa:
 *
 *  • Grupo publicado por esta agência (Financeiro → PRODUTO_PUBLICADO →
 *    catálogo do CRM): a identidade é o id do grupo AQUI, porque é esse que
 *    a agência vê e escolhe na tela do plano.
 *  • Produto criado dentro do CRM: a identidade é o id do catálogo do CRM,
 *    prefixado para nunca colidir com um id de grupo daqui.
 */

import { num, paraBRL, round2 } from './money';
import { createProdutoVenda, type ProdutoVenda, type TipoProdutoVenda } from './crm-types';

const TIPOS: TipoProdutoVenda[] = [
  'AEREO', 'HOTEL', 'PACOTE', 'SEGURO', 'RECEPTIVO', 'CRUZEIRO', 'CARRO', 'INGRESSO', 'GRUPO', 'OUTROS',
];

/** Prefixo do produto nascido no CRM, para não colidir com id de grupo daqui. */
export const PREFIXO_CRM = 'crm_prod_';

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/**
 * O id com que a regra de comissão conhece este produto.
 *
 * O grupo do Financeiro ganha: é o id que aparece na lista da tela do plano.
 */
export function identidadeDoProduto(cru: Record<string, unknown>): string {
  const externo = texto(cru.produto_externo_id) || texto(cru.entur_grupo_id);
  if (externo) return externo;
  const doCrm = texto(cru.produto_id);
  return doCrm ? `${PREFIXO_CRM}${doCrm}` : '';
}

export function tipoDoProduto(v: unknown): TipoProdutoVenda {
  const t = texto(v).toUpperCase() as TipoProdutoVenda;
  return TIPOS.includes(t) ? t : 'OUTROS';
}

/**
 * Converte a lista do payload em produtos da venda.
 *
 * Produto sem identidade NÃO é descartado: ele ainda conta para o total
 * vendido, e descartá-lo faria a parte percentual ser calculada sobre um
 * total menor do que a venda realmente teve. Ele só não casa com regra
 * nenhuma, que é o correto.
 */
export function produtosDoPayload(payload: Record<string, unknown>): ProdutoVenda[] {
  const lista = payload?.produtos;
  if (!Array.isArray(lista)) return [];
  const fora: ProdutoVenda[] = [];
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const cru = item as Record<string, unknown>;
    const quantidade = Math.max(Math.floor(num(cru.quantidade)), 1);
    const moeda = texto(cru.moeda).toUpperCase();
    const cambio = num(cru.cambio) > 0 ? num(cru.cambio) : 1;
    // valor_total manda; sem ele, unitário × quantidade.
    const total = num(cru.valor_total) > 0
      ? num(cru.valor_total)
      : round2(num(cru.valor_unitario) * quantidade);
    const custoTotal = num(cru.custo_total) > 0
      ? num(cru.custo_total)
      : round2(num(cru.custo_unitario) * quantidade);

    fora.push({
      ...createProdutoVenda(),
      id: texto(cru.id) || `${identidadeDoProduto(cru) || 'produto'}-${fora.length + 1}`,
      produto_id: identidadeDoProduto(cru),
      quantidade,
      tipo: tipoDoProduto(cru.tipo ?? cru.servico),
      descricao: texto(cru.nome) || texto(cru.descricao),
      fornecedor_id: texto(cru.fornecedor_id),
      fornecedor_nome: texto(cru.fornecedor_nome),
      valor_venda: round2(paraBRL(total, moeda || 'BRL', cambio)),
      valor_custo: round2(paraBRL(custoTotal, moeda || 'BRL', cambio)),
      moeda: 'BRL',
      cambio: 1,
      status: 'CONFIRMADO',
    });
  }
  return fora;
}
