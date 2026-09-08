/**
 * Financeiro por produto (src/lib/produtos-vendidos.ts).
 *
 * A visão passou a espelhar o que foi VENDIDO no CRM, e não mais o
 * cadastro interno. Estes testes fixam o que entra, o que fica de fora, e
 * como custo e venda em moeda estrangeira viram BRL.
 */
import { montarPainelProdutos } from '../src/lib/produtos-vendidos.ts';
import { soma } from '../src/lib/money.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

const venda = (id: string, numero: string, status = 'CONFIRMADO', data = '2026-09-10') =>
  ({ id, numero, data_venda: data, status, cliente_nome: 'Cliente ' + numero, vendedor_nome: 'Ana' });

const item = (id: string, venda_id: string, tipo: string, custo: number, vnd: number, extra = {}) =>
  ({ id, venda_id, data: {
    tipo, descricao: `${tipo} ${id}`, fornecedor_nome: 'Forn X',
    valor_custo: custo, valor_venda: vnd, moeda: 'BRL', cambio: 1,
    localizador: '', ...extra,
  } } as never);

console.log('--- o que entra e o que fica de fora ---');
{
  const vendas = [
    venda('v1', 'VND-0001'),
    venda('v2', 'VND-0002', 'CANCELADO'),
    venda('v3', 'VND-0003', 'ORCAMENTO'),
  ];
  const itens = [
    item('i1', 'v1', 'AEREO', 1000, 1500),
    item('i2', 'v2', 'HOTEL', 900, 1200),      // venda cancelada
    item('i3', 'v3', 'PACOTE', 500, 800),      // ainda orçamento
    item('i4', 'orfao', 'AEREO', 100, 200),    // venda inexistente
  ];
  const p = montarPainelProdutos(itens, vendas);
  eq(p.quantidade, 1, 'só produto de venda confirmada ou concluída entra');
  eq(p.itens[0].venda_numero, 'VND-0001', 'e é o da venda válida');
}

console.log('--- margem ---');
{
  const p = montarPainelProdutos([item('i1', 'v1', 'AEREO', 1000, 1500)], [venda('v1', 'VND-0001')]);
  eq([p.total_custo, p.total_venda, p.total_margem], [1000, 1500, 500], 'custo, venda e margem');
  eq(p.margem_pct, 33.33, 'margem é sobre a venda, não sobre o custo');
  eq(p.itens[0].margem_pct, 33.33, 'a do item também');
}
{
  // Produto vendido no prejuízo: a conta não pode esconder isso.
  const p = montarPainelProdutos([item('i1', 'v1', 'HOTEL', 2000, 1500)], [venda('v1', 'VND-0001')]);
  eq([p.total_margem, p.margem_pct], [-500, -33.33], 'margem negativa aparece como negativa');
}
{
  const p = montarPainelProdutos([item('i1', 'v1', 'CORTESIA', 0, 0)], [venda('v1', 'VND-0001')]);
  eq([p.margem_pct, p.ticket_medio], [0, 0], 'venda zero não divide por zero');
}

console.log('--- moeda estrangeira ---');
{
  // USD 1.000 de custo e USD 1.400 de venda, câmbio 5,50.
  const p = montarPainelProdutos(
    [item('i1', 'v1', 'AEREO', 1000, 1400, { moeda: 'USD', cambio: 5.5 })],
    [venda('v1', 'VND-0001')],
  );
  eq([p.total_custo, p.total_venda], [5500, 7700], 'converte custo e venda pelo câmbio gravado');
  eq(p.itens[0].moeda_original, 'USD', 'a moeda original fica registrada');
}
{
  // Câmbio ausente não pode multiplicar por zero e sumir com o dinheiro.
  const p = montarPainelProdutos(
    [item('i1', 'v1', 'AEREO', 100, 200, { moeda: 'USD', cambio: 0 })],
    [venda('v1', 'VND-0001')],
  );
  eq([p.total_custo, p.total_venda], [100, 200], 'câmbio zero trata o valor como já em BRL');
}

console.log('--- agrupamento por tipo ---');
{
  const vendas = [venda('v1', 'VND-0001'), venda('v2', 'VND-0002')];
  const itens = [
    item('i1', 'v1', 'AEREO', 1000, 1500),
    item('i2', 'v1', 'AEREO', 2000, 2500),
    item('i3', 'v2', 'HOTEL', 500, 1500),
  ];
  const p = montarPainelProdutos(itens, vendas);
  eq(p.por_tipo.map(t => t.tipo), ['AEREO', 'HOTEL'], 'ordena por receita, maior primeiro');
  eq(p.por_tipo[0], { tipo: 'AEREO', quantidade: 2, custo: 3000, venda: 4000, margem: 1000, margem_pct: 25, share_receita_pct: 72.73 },
     'agrega quantidade, custo, venda, margem e participação');
  eq(soma(p.por_tipo.map(t => t.venda)), p.total_venda, 'a soma dos tipos bate com o total');
  eq(p.ticket_medio, 1833.33, 'ticket médio é por produto vendido, não por venda');
}

console.log('--- filtros ---');
{
  const vendas = [venda('v1', 'VND-0001', 'CONFIRMADO', '2026-09-10'), venda('v2', 'VND-0002', 'CONFIRMADO', '2026-08-20')];
  const itens = [
    item('i1', 'v1', 'AEREO', 100, 200, { descricao: 'Voo GRU LIS', fornecedor_nome: 'TAP' }),
    item('i2', 'v2', 'HOTEL', 300, 500, { descricao: 'Hotel Lisboa', fornecedor_nome: 'Booking' }),
  ];
  eq(montarPainelProdutos(itens, vendas, { mes: '2026-09' }).quantidade, 1, 'filtra por mês da venda');
  eq(montarPainelProdutos(itens, vendas, { tipo: 'HOTEL' }).quantidade, 1, 'filtra por tipo');
  eq(montarPainelProdutos(itens, vendas, { busca: 'tap' }).quantidade, 1, 'busca por fornecedor, sem caixa');
  eq(montarPainelProdutos(itens, vendas, { busca: 'lis' }).quantidade, 2, 'busca casa descrição parcial');
  eq(montarPainelProdutos(itens, vendas, { busca: 'VND-0002' }).quantidade, 1, 'busca pelo número da venda');
  eq(montarPainelProdutos(itens, vendas, { busca: '   ' }).quantidade, 2, 'busca só com espaço não filtra nada');
}

console.log('--- vazio ---');
{
  const p = montarPainelProdutos([], []);
  eq([p.quantidade, p.total_venda, p.margem_pct, p.por_tipo.length], [0, 0, 0, 0], 'sem produto não quebra');
}

console.log(`\n${total - falhas}/${total} testes de produtos vendidos passaram`);
process.exit(falhas > 0 ? 1 : 0);
