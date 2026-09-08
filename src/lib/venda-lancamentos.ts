/**
 * Uma venda só produz resultado enquanto tiver lançamento financeiro.
 *
 * O PROBLEMA QUE ISTO RESOLVE. O DRE, o painel e o relatório de rentabilidade
 * liam a receita direto de `vendas_crm` (margem = valor_final − custo), sem
 * olhar as contas. Quem apagava as contas a receber e a pagar de uma venda via
 * o dinheiro sumir das telas de contas e do fluxo de caixa, mas o DRE
 * continuava mostrando volume e receita da venda. O número existia num lugar
 * só do sistema e não podia ser conferido em nenhum outro.
 *
 * A REGRA. Venda sem nenhuma conta viva (a receber ou a pagar) não entra em
 * relatório de resultado. Não é a venda que deixa de existir — ela continua em
 * Vendas fechadas, e é lá que se exclui de vez, com as contas junto. O que
 * deixa de existir é a receita sem lastro.
 *
 * Conta CANCELADA não conta como lançamento vivo: cancelar é justamente dizer
 * que aquele dinheiro não acontece.
 */

/** O mínimo que uma conta precisa expor para ser ligada a uma venda. */
export interface LancamentoDeVenda {
  origem_venda_id?: string | null;
  venda_id?: string | null;
  status?: string | null;
}

function vendaDoLancamento(c: LancamentoDeVenda): string {
  return String(c.origem_venda_id || c.venda_id || '').trim();
}

/**
 * Ids das vendas que ainda têm ao menos uma conta viva.
 * Aceita várias listas (contas a receber, contas a pagar) de uma vez.
 */
export function vendasComLancamento(
  ...listas: Array<readonly LancamentoDeVenda[] | null | undefined>
): Set<string> {
  const ids = new Set<string>();
  for (const lista of listas) {
    for (const c of lista ?? []) {
      if (String(c?.status ?? '') === 'CANCELADO') continue;
      const id = vendaDoLancamento(c);
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * Filtra vendas para as que ainda têm lastro financeiro.
 *
 * Sem exceção por data: venda que nunca gerou conta também não tem lastro, e
 * mostrar a receita dela no DRE é justamente o que não se pode conferir em
 * nenhuma outra tela.
 */
export function apenasVendasComLastro<T extends { id: string }>(
  vendas: readonly T[],
  comLancamento: Set<string>,
): T[] {
  return vendas.filter(v => comLancamento.has(v.id));
}
