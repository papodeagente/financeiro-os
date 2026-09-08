/**
 * Regra: venda só produz resultado enquanto tiver lançamento financeiro.
 *
 * Pedido do Bruno (2026-09-08), depois de excluir entradas e saídas e ver os
 * valores continuarem no DRE:
 *
 *   "Mesmo após excluir entradas e saídas, elas continuaram aparecendo no DRE.
 *    Ao apagar entrada e saída ela deve sair de todo sistema."
 *
 * A causa: DRE, painel e rentabilidade liam a receita direto de vendas_crm
 * (margem = valor_final − custo), sem olhar as contas. Apagar as contas
 * limpava Contas a pagar/receber e o fluxo de caixa, mas não o resultado.
 *
 * Roda com: node --experimental-strip-types scripts/test-venda-lancamentos.ts
 */
import {
  vendasComLancamento,
  apenasVendasComLastro,
  type LancamentoDeVenda,
} from '../src/lib/venda-lancamentos.ts';

let falhas = 0;
let total = 0;

function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

const venda = (id: string) => ({ id, valor_final: 1000, valor_total_custo: 400 });
const ids = (s: Set<string>) => [...s].sort();

// ══════════════════════════════════════════════════════════════════════
console.log('--- quais vendas ainda têm lançamento ---');
{
  const cr: LancamentoDeVenda[] = [{ origem_venda_id: 'v1', status: 'PENDENTE' }];
  const cp: LancamentoDeVenda[] = [{ origem_venda_id: 'v2', status: 'PENDENTE' }];
  eq(ids(vendasComLancamento(cr, cp)), ['v1', 'v2'], 'receber e pagar somam');
}
{
  // venda_id é o campo antigo; as duas formas de ligação valem.
  const cr: LancamentoDeVenda[] = [{ venda_id: 'v9', status: 'RECEBIDO' }];
  eq(ids(vendasComLancamento(cr)), ['v9'], 'venda_id também liga');
}
{
  const cr: LancamentoDeVenda[] = [
    { origem_venda_id: 'v1', venda_id: 'outra', status: 'PENDENTE' },
  ];
  eq(ids(vendasComLancamento(cr)), ['v1'], 'origem_venda_id manda sobre venda_id');
}
{
  // Conta cancelada não é lançamento vivo: cancelar é dizer que não acontece.
  const cr: LancamentoDeVenda[] = [{ origem_venda_id: 'v1', status: 'CANCELADO' }];
  eq(ids(vendasComLancamento(cr)), [], 'conta cancelada não sustenta a venda');
}
{
  // Uma cancelada e uma viva na mesma venda: a viva sustenta.
  const cr: LancamentoDeVenda[] = [
    { origem_venda_id: 'v1', status: 'CANCELADO' },
    { origem_venda_id: 'v1', status: 'PENDENTE' },
  ];
  eq(ids(vendasComLancamento(cr)), ['v1'], 'basta uma conta viva');
}
{
  // Conta avulsa (despesa fixa, aporte) não aponta para venda nenhuma.
  const cp: LancamentoDeVenda[] = [
    { origem_venda_id: '', status: 'PENDENTE' },
    { venda_id: null, status: 'PENDENTE' },
    { origem_venda_id: '   ', status: 'PENDENTE' },
  ];
  eq(ids(vendasComLancamento(cp)), [], 'conta sem venda não cria id fantasma');
}
{
  eq(ids(vendasComLancamento(null, undefined, [])), [], 'listas ausentes não quebram');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o filtro das vendas ---');
{
  const vendas = [venda('v1'), venda('v2'), venda('v3')];
  const com = vendasComLancamento([
    { origem_venda_id: 'v1', status: 'PENDENTE' },
    { origem_venda_id: 'v3', status: 'PAGO' },
  ]);
  eq(apenasVendasComLastro(vendas, com).map(v => v.id), ['v1', 'v3'], 'v2 sai do resultado');
}
{
  // O caso do Bruno: apagou entrada e saída, a venda perdeu o lastro.
  const vendas = [venda('v42')];
  const com = vendasComLancamento([], []);
  eq(apenasVendasComLastro(vendas, com).length, 0, 'sem contas, a venda não gera resultado');
}
{
  // Só a entrada apagada: a saída ainda sustenta a venda (é dinheiro devido).
  const vendas = [venda('v42')];
  const com = vendasComLancamento([], [{ origem_venda_id: 'v42', status: 'PENDENTE' }]);
  eq(apenasVendasComLastro(vendas, com).map(v => v.id), ['v42'], 'a conta a pagar sozinha sustenta');
}
{
  // Apagar uma parcela de três não derruba a venda.
  const vendas = [venda('v7')];
  const com = vendasComLancamento([
    { origem_venda_id: 'v7', status: 'RECEBIDO' },
    { origem_venda_id: 'v7', status: 'PENDENTE' },
  ]);
  eq(apenasVendasComLastro(vendas, com).map(v => v.id), ['v7'], 'venda parcelada continua inteira');
}
{
  eq(apenasVendasComLastro([], vendasComLancamento([])), [], 'sem vendas, lista vazia');
}

// ══════════════════════════════════════════════════════════════════════
console.log('--- o efeito no resultado do mês ---');
{
  // Reproduz o DRE: volume e margem saem das vendas, filtradas pelo lastro.
  const vendas = [
    { id: 'v1', data_venda: '2026-09-03', valor_final: 42000, valor_total_custo: 20000 },
    { id: 'v2', data_venda: '2026-09-05', valor_final: 10000, valor_total_custo: 6000 },
  ];
  const soVendaDois = vendasComLancamento([{ origem_venda_id: 'v2', status: 'PENDENTE' }]);
  const vivas = apenasVendasComLastro(vendas, soVendaDois);

  const volume = vivas.reduce((s, v) => s + v.valor_final, 0);
  const margem = vivas.reduce((s, v) => s + (v.valor_final - v.valor_total_custo), 0);
  eq(volume, 10000, 'volume perde a venda sem lastro');
  eq(margem, 4000, 'a receita da agência acompanha');

  const nenhuma = apenasVendasComLastro(vendas, vendasComLancamento([]));
  eq(nenhuma.reduce((s, v) => s + v.valor_final, 0), 0, 'sem contas, mês zerado');
}

// ══════════════════════════════════════════════════════════════════════
console.log(`\n${total - falhas}/${total} testes do lastro da venda passaram`);
if (falhas > 0) process.exit(1);
