/**
 * Resultado do mês: FATURAMENTO, RECEITA e LUCRO, pelo caixa.
 *
 * Pedido do Bruno (09/10/2026): três palavras, uma só definição cada, e que
 * se subtraiam entre si sem ninguém precisar refazer a conta de cabeça.
 *
 *   FATURAMENTO   o dinheiro de cliente que ENTROU no mês.
 *   RECEITA       a comissão que sobrou disso para a agência.
 *   LUCRO         o que sobrou da receita depois das contas PAGAS no mês.
 *
 * TUDO PELO CAIXA, nos dois lados. É a diferença que mais muda número aqui:
 * o "Resultado do mês" anterior cortava contas por data de VENCIMENTO e somava
 * o valor DEVIDO. Uma conta que venceu e não foi paga já aparecia descontada;
 * uma conta de outro mês, paga neste, não aparecia. Agora o corte é a data da
 * baixa e o valor é o que de fato se movimentou.
 *
 * A PARTE DO FORNECEDOR É ATRIBUÍDA, NÃO É O REPASSE PAGO. Numa agência, a
 * maior parte do que o cliente paga pertence ao fornecedor — mas o repasse
 * costuma sair num mês diferente daquele em que o cliente pagou. Descontar o
 * repasse PAGO do faturamento RECEBIDO faria a receita saltar e despencar sem
 * que nada tivesse mudado no negócio. Então a parte do fornecedor é a fatia
 * proporcional da venda (custo ÷ valor da venda) aplicada ao que entrou, e por
 * construção FATURAMENTO − PARTE DO FORNECEDOR = RECEITA.
 *
 * O repasse que de fato saiu do banco não some: ele é saída de caixa e aparece
 * no fluxo de caixa, que é a tela de "tenho dinheiro?". Aqui a pergunta é
 * outra: "quanto a agência ganhou e quanto sobrou".
 *
 * COMISSÃO DE FORNECEDOR é receita pura: ela não tem fatia de ninguém e entra
 * inteira na receita, sem passar pelo faturamento — somá-la ao faturamento
 * faria o volume de vendas crescer sem venda nenhuma.
 */

import { num, round2, soma, somaPor, divSegura, mesDe } from './money';
import { valorMovimentado } from './saldo-bancario';

/** Adapta ao formato de `valorMovimentado`, cujo `status` não aceita null. */
function movimentado(
  conta: { status?: string | null; valor_recebido?: number | null; valor_pago?: number | null; valor_final?: number | null },
  campo: 'valor_recebido' | 'valor_pago',
): number {
  return valorMovimentado({ ...conta, status: conta.status ?? undefined }, campo);
}

/** O que o cálculo precisa de uma conta a receber. */
export interface ReceberDoMes {
  origem?: string | null;
  venda_id?: string | null;
  status?: string | null;
  valor_final?: number | null;
  valor_recebido?: number | null;
  data_recebimento?: string | null;
  data_vencimento?: string | null;
}

/** O que o cálculo precisa de uma conta a pagar. */
export interface PagarDoMes {
  origem?: string | null;
  /** 'true' + origem VENDA = repasse ao fornecedor, gerado pela venda. */
  auto_gerado?: string | boolean | null;
  categoria_id?: string | null;
  status?: string | null;
  valor_final?: number | null;
  valor_pago?: number | null;
  data_pagamento?: string | null;
  data_vencimento?: string | null;
}

/** O que o cálculo precisa de uma venda, para saber a fatia do fornecedor. */
export interface VendaDoMes {
  id?: string | null;
  valor_final?: number | null;
  valor_total_custo?: number | null;
}

export interface ResultadoDoMes {
  /** Dinheiro de cliente que entrou no mês. */
  faturamento: number;
  /** A fatia do que entrou que pertence ao fornecedor. Atribuída, não paga. */
  parte_do_fornecedor: number;
  /** Comissão de fornecedor recebida no mês: receita sem faturamento. */
  comissao_de_fornecedor: number;
  /** O que a agência ganhou: (faturamento − fornecedor) + comissão recebida. */
  receita: number;
  /** As contas da própria agência efetivamente pagas no mês. */
  despesas_pagas: number;
  /** O que sobrou. */
  lucro: number;
  /** lucro ÷ receita, em %. Null quando não houve receita. */
  margem_sobre_receita: number | null;
  /** receita ÷ faturamento, em %. Null quando não houve faturamento. */
  margem_sobre_faturamento: number | null;
  /** Vendas sem custo cadastrado: a fatia do fornecedor delas é desconhecida. */
  faturamento_sem_custo: number;
}

/**
 * A data que coloca o lançamento no mês: a da baixa.
 *
 * Lançamento antigo baixado sem data gravada cai no vencimento — é o mesmo
 * acordo que o resto do sistema faz (ver dataDoCaixa em dashboard-sql.ts), e
 * sem ele dinheiro que entrou sumiria do mês por falta de um campo.
 */
export function mesDoCaixa(
  conta: { data_recebimento?: string | null; data_pagamento?: string | null; data_vencimento?: string | null },
): string {
  const baixa = String(conta.data_recebimento ?? conta.data_pagamento ?? '').trim();
  return mesDe(baixa || String(conta.data_vencimento ?? ''));
}

/** Repasse ao fornecedor: saiu do banco, mas já estava descontado da margem. */
export function ehRepasse(cp: PagarDoMes): boolean {
  const auto = cp.auto_gerado === true || String(cp.auto_gerado ?? '') === 'true';
  return auto && String(cp.origem ?? '') === 'VENDA';
}

/**
 * Que fatia de uma venda pertence ao fornecedor, de 0 a 1.
 *
 * Venda sem custo cadastrado devolve null em vez de 0: tratar "não sei" como
 * "não tem custo" faria o faturamento inteiro virar receita, que é o erro mais
 * caro possível aqui. Quem chama separa esse valor e a tela o declara.
 */
export function fatiaDoFornecedor(venda: VendaDoMes | undefined | null): number | null {
  if (!venda) return null;
  const valor = round2(num(venda.valor_final));
  const custo = round2(num(venda.valor_total_custo));
  if (valor <= 0) return null;
  if (custo <= 0) return null;
  // Custo maior que a venda: a venda inteira é do fornecedor, nunca mais.
  return Math.min(custo / valor, 1);
}

export function calcularResultadoDoMes(entrada: {
  mes: string;
  receber: ReceberDoMes[];
  pagar: PagarDoMes[];
  vendas: VendaDoMes[];
}): ResultadoDoMes {
  const mes = String(entrada.mes ?? '');
  const porVenda = new Map<string, VendaDoMes>();
  for (const v of entrada.vendas ?? []) {
    const id = String(v?.id ?? '');
    if (id) porVenda.set(id, v);
  }

  const viva = (s: unknown) => String(s ?? '') !== 'CANCELADO';
  const noMes = (entrada.receber ?? []).filter(cr => cr && viva(cr.status) && mesDoCaixa(cr) === mes);

  const deCliente = noMes.filter(cr => String(cr.origem ?? 'VENDA') !== 'COMISSAO_FORNECEDOR');
  const deFornecedor = noMes.filter(cr => String(cr.origem ?? '') === 'COMISSAO_FORNECEDOR');

  const faturamento = somaPor(deCliente, cr => movimentado(cr, 'valor_recebido'));
  const comissao_de_fornecedor = somaPor(deFornecedor, cr => movimentado(cr, 'valor_recebido'));

  // A fatia do fornecedor, venda a venda. O que não tem venda ligada ou não
  // tem custo cadastrado fica de fora e é declarado.
  const fatias: number[] = [];
  const semCusto: number[] = [];
  for (const cr of deCliente) {
    const entrou = movimentado(cr, 'valor_recebido');
    if (entrou <= 0) continue;
    const fatia = fatiaDoFornecedor(porVenda.get(String(cr.venda_id ?? '')));
    if (fatia === null) { semCusto.push(entrou); continue; }
    fatias.push(round2(entrou * fatia));
  }
  const parte_do_fornecedor = soma(fatias);
  const faturamento_sem_custo = soma(semCusto);

  const receita = round2(faturamento - parte_do_fornecedor + comissao_de_fornecedor);

  const despesas_pagas = somaPor(
    (entrada.pagar ?? []).filter(cp => cp && viva(cp.status) && !ehRepasse(cp) && mesDoCaixa(cp) === mes),
    cp => movimentado(cp, 'valor_pago'),
  );

  const lucro = round2(receita - despesas_pagas);

  return {
    faturamento,
    parte_do_fornecedor,
    comissao_de_fornecedor,
    receita,
    despesas_pagas,
    lucro,
    margem_sobre_receita: receita > 0 ? round2(divSegura(lucro, receita) * 100) : null,
    margem_sobre_faturamento: faturamento > 0 ? round2(divSegura(receita, faturamento) * 100) : null,
    faturamento_sem_custo,
  };
}

/** Uma linha de "para onde foi o dinheiro que saiu". */
export interface DespesaPorCategoria {
  categoria_id: string;
  valor: number;
}

/**
 * As despesas pagas do mês, agrupadas por categoria.
 *
 * É o detalhamento do LUCRO: a soma destas linhas é exatamente
 * `despesas_pagas`. O repasse ao fornecedor continua fora — ele não é despesa
 * da agência, e o demonstrativo que o incluísse contradiria os três números
 * do topo da tela.
 *
 * Conta paga sem categoria entra com `categoria_id` vazio em vez de sumir:
 * dinheiro que saiu e não aparece em lugar nenhum é pior do que dinheiro mal
 * classificado.
 */
export function despesasPagasPorCategoria(entrada: {
  mes: string;
  pagar: PagarDoMes[];
}): DespesaPorCategoria[] {
  const mes = String(entrada.mes ?? '');
  const porCategoria = new Map<string, number>();
  for (const cp of entrada.pagar ?? []) {
    if (!cp || String(cp.status ?? '') === 'CANCELADO') continue;
    if (ehRepasse(cp)) continue;
    if (mesDoCaixa(cp) !== mes) continue;
    const valor = movimentado(cp, 'valor_pago');
    if (valor === 0) continue;
    const chave = String(cp.categoria_id ?? '').trim();
    porCategoria.set(chave, round2((porCategoria.get(chave) ?? 0) + valor));
  }
  return [...porCategoria.entries()]
    .map(([categoria_id, valor]) => ({ categoria_id, valor }))
    .sort((a, b) => b.valor - a.valor);
}
