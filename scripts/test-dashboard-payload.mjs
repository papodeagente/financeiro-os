/**
 * Roda carregarDashboard() DE PRODUÇÃO contra um Postgres real (PGlite) com
 * uma agência de viagens inteira montada à mão.
 *
 * POR QUE É INDISPENSÁVEL. Erro de sintaxe de SQL, JOIN errado, GROUP BY
 * faltando e coluna inexistente NÃO quebram o typecheck: eles quebram em
 * produção, na cara do usuário, com a tela em branco. As quinze consultas do
 * dashboard precisam ser EXECUTADAS por um teste, e é isto.
 *
 * A agência de exemplo é pequena de propósito: dá para conferir cada número
 * na mão, e é assim que se prova que o payload diz o que promete.
 *
 * Roda com: node --experimental-strip-types --no-warnings scripts/test-dashboard-payload.mjs
 */
import { PGlite } from '@electric-sql/pglite';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

register('./ts-resolve-hook.mjs', import.meta.url);
const lib = async n => import(pathToFileURL(path.resolve(import.meta.dirname, `../src/lib/${n}.ts`)).href);
const { carregarDashboard } = await lib('dashboard-financeiro');

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar   (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas   (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE itens_venda    (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', fornecedor_id TEXT DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE vendas_crm     (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT DEFAULT '', vendedor_id TEXT DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());
`);

const exec = { async query(text, values) { const r = await pg.query(text, values); return { rows: r.rows }; } };
const ins = (t, id, tenant, doc, extra = {}) => {
  const cols = ['id', 'tenant_id', 'data', ...Object.keys(extra)];
  const vals = [id, tenant, JSON.stringify(doc), ...Object.values(extra)];
  return pg.query(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, vals);
};

// ══════════════════════════════════════════════════════════════════════
// A AGÊNCIA. Setembro de 2026; hoje é dia 15.
//
// Uma viagem de R$ 20.000 vendida em 02/09 com R$ 16.500 de fornecedores.
// A agência ganha R$ 3.500 de margem mais R$ 1.200 de comissão da operadora.
// ══════════════════════════════════════════════════════════════════════
const T = 'ag1';
const HOJE = '2026-09-15';

await ins('contas_bancarias', 'b1', T, { nome: 'Itaú', saldo_inicial: 10000, saldo_atual: 999999, ativo: true });
await ins('contas_bancarias', 'b2', T, { nome: 'Caixa da loja', saldo_inicial: 500, ativo: true });
await ins('contas_bancarias', 'b3', T, { nome: 'Conta encerrada', saldo_inicial: 90000, ativo: false });

await ins('plano_contas', 'cat-mkt', T, { codigo: '4.01', descricao: 'Marketing', tipo: 'DESPESA', ativo: true });
await ins('plano_contas', 'cat-sede', T, { codigo: '4.02', descricao: 'Aluguel e sede', tipo: 'DESPESA', ativo: true });

await ins('vendas_crm', 'v1', T, {
  numero: '1042', data_venda: '2026-09-02', status: 'CONFIRMADO',
  valor_final: 20000, valor_total_custo: 16500, cliente_nome: 'Maria Aparecida',
}, { status: 'CONFIRMADO', cliente_id: 'cli1', vendedor_id: 'u1' });

// Venda de reserva de grupo: status MINÚSCULO, fora do enum da interface.
await ins('vendas_crm', 'v2', T, {
  numero: '1043', data_venda: '2026-09-10', status: 'vendido',
  valor_final: 8000, valor_total_custo: 6000, cliente_nome: 'Grupo Bariloche',
}, { status: 'vendido' });

// Venda confirmada que ninguém lançou no financeiro: receita que não existe.
await ins('vendas_crm', 'v3', T, {
  numero: '1044', data_venda: '2026-09-12', status: 'CONFIRMADO',
  valor_final: 5000, valor_total_custo: 4000, cliente_nome: 'Sem lastro',
}, { status: 'CONFIRMADO' });

// Cliente paga em 3: a primeira já entrou, a segunda entrou pela metade.
await ins('contas_receber', 'r1', T, { origem: 'VENDA', status: 'RECEBIDO', valor_final: 7000, valor_recebido: 7000, data_vencimento: '2026-09-05', data_recebimento: '2026-09-05', cliente_nome: 'Maria Aparecida', descricao: 'Parcela 1 de 3', origem_venda_id: 'v1' }, { cliente_id: 'cli1', venda_id: 'v1' });
await ins('contas_receber', 'r2', T, { origem: 'VENDA', status: 'PARCIAL',  valor_final: 7000, valor_recebido: 3000, data_vencimento: '2026-09-20', cliente_nome: 'Maria Aparecida', descricao: 'Parcela 2 de 3', origem_venda_id: 'v1' }, { cliente_id: 'cli1', venda_id: 'v1' });
await ins('contas_receber', 'r3', T, { origem: 'VENDA', status: 'PENDENTE', valor_final: 6000, data_vencimento: '2026-10-20', cliente_nome: 'Maria Aparecida', descricao: 'Parcela 3 de 3', origem_venda_id: 'v1' }, { cliente_id: 'cli1', venda_id: 'v1' });
// Comissão da operadora: receita PURA, e o cliente_nome aqui é o FORNECEDOR.
await ins('contas_receber', 'r4', T, { origem: 'COMISSAO_FORNECEDOR', status: 'RECEBIDO', valor_final: 1200, valor_recebido: 1200, data_vencimento: '2026-09-08', data_recebimento: '2026-09-08', cliente_nome: 'CVC Operadora', origem_venda_id: 'v1' }, { cliente_id: 'forn-cvc' });
// Parcela vencida e não paga: inadimplência de verdade.
await ins('contas_receber', 'r5', T, { origem: 'VENDA', status: 'PENDENTE', valor_final: 2400, data_vencimento: '2026-08-01', cliente_nome: 'João Atrasado', descricao: 'Parcela única' }, { cliente_id: 'cli2' });
// Cancelada: não existe para número nenhum.
await ins('contas_receber', 'r6', T, { origem: 'VENDA', status: 'CANCELADO', valor_final: 50000, data_vencimento: '2026-09-09', cliente_nome: 'Desistiu' }, { cliente_id: 'cli3' });

// Repasse ao fornecedor: saiu do caixa, mas NÃO é despesa da agência.
await ins('contas_pagar', 'p1', T, { origem: 'VENDA', auto_gerado: true, status: 'PAGO', valor_final: 12000, valor_pago: 12000, data_vencimento: '2026-09-04', data_pagamento: '2026-09-04', fornecedor_nome: 'CVC Operadora', origem_venda_id: 'v1' }, { fornecedor_id: 'forn-cvc' });
await ins('contas_pagar', 'p2', T, { origem: 'VENDA', auto_gerado: true, status: 'PENDENTE', valor_final: 4500, data_vencimento: '2026-09-25', fornecedor_nome: 'Azul Viagens', origem_venda_id: 'v1' }, { fornecedor_id: 'forn-azul' });
// Despesas próprias da agência.
await ins('contas_pagar', 'p3', T, { origem: 'DESPESA_FIXA', status: 'PAGO', valor_final: 3200, valor_pago: 3200, data_vencimento: '2026-09-10', data_pagamento: '2026-09-10', fornecedor_nome: 'Imobiliária', categoria_id: 'cat-sede' }, { fornecedor_id: 'forn-imob' });
await ins('contas_pagar', 'p4', T, { origem: 'OUTROS', status: 'PAGO', valor_final: 1800, valor_pago: 1800, data_vencimento: '2026-09-12', data_pagamento: '2026-09-12', fornecedor_nome: 'Agência de mídia', categoria_id: 'cat-mkt', is_custo_comercial: true }, { fornecedor_id: 'forn-midia' });
// Despesa sem categoria: o balde honesto tem que mostrar isto.
await ins('contas_pagar', 'p5', T, { origem: 'OUTROS', status: 'PAGO', valor_final: 900, valor_pago: 900, data_vencimento: '2026-09-11', data_pagamento: '2026-09-11', fornecedor_nome: 'Diversos' }, { fornecedor_id: 'forn-div' });
// Conta a pagar vencida e sem fornecedor identificado.
await ins('contas_pagar', 'p6', T, { origem: 'VENDA', status: 'PENDENTE', valor_final: 700, data_vencimento: '2026-09-01', fornecedor_pendente: true, fornecedor_nome: '' }, { fornecedor_id: '' });
// Conta sem data de vencimento: não pode sumir em silêncio.
await ins('contas_pagar', 'p7', T, { origem: 'OUTROS', status: 'PENDENTE', valor_final: 340, data_vencimento: '', fornecedor_nome: 'Sem data' }, { fornecedor_id: 'forn-sd' });

// O APERTO CLÁSSICO DE AGÊNCIA: a Latam cobra em 18/09 e o cliente só paga
// em 10/10. Os 8.000 saem do bolso da agência por 22 dias.
await ins('vendas_crm', 'v4', T, {
  numero: '1045', data_venda: '2026-09-08', status: 'CONFIRMADO',
  valor_final: 10000, valor_total_custo: 8000, cliente_nome: 'Empresa Descasada',
}, { status: 'CONFIRMADO', cliente_id: 'cli4' });
await ins('contas_pagar', 'p8', T, { origem: 'VENDA', auto_gerado: true, status: 'PENDENTE', valor_final: 8000, data_vencimento: '2026-09-18', fornecedor_nome: 'Latam', origem_venda_id: 'v4' }, { fornecedor_id: 'forn-latam' });
await ins('contas_receber', 'r7', T, { origem: 'VENDA', status: 'PENDENTE', valor_final: 10000, data_vencimento: '2026-10-10', cliente_nome: 'Empresa Descasada', descricao: 'Parcela única', origem_venda_id: 'v4' }, { cliente_id: 'cli4', venda_id: 'v4' });

// Itens da venda: é daqui que sai margem POR FORNECEDOR.
await ins('itens_venda', 'i1', T, { fornecedor_nome: 'CVC Operadora', valor_venda: 14000, valor_custo: 12000, cambio: 1 }, { venda_id: 'v1', fornecedor_id: 'forn-cvc', status: 'ativo' });
await ins('itens_venda', 'i2', T, { fornecedor_nome: 'Azul Viagens', valor_venda: 6000, valor_custo: 4500, cambio: 1 }, { venda_id: 'v1', fornecedor_id: 'forn-azul', status: 'ativo' });
await ins('itens_venda', 'i3', T, { fornecedor_nome: 'Cancelado', valor_venda: 9000, valor_custo: 8000, cambio: 1 }, { venda_id: 'v1', fornecedor_id: 'forn-x', status: 'cancelado' });

// A OUTRA agência. Nada dela pode aparecer.
await ins('contas_bancarias', 'z0', 'ag2', { nome: 'Outra', saldo_inicial: 777777 });
await ins('contas_receber', 'z1', 'ag2', { origem: 'VENDA', status: 'RECEBIDO', valor_final: 888888, valor_recebido: 888888, data_vencimento: '2026-09-05', data_recebimento: '2026-09-05' });
await ins('contas_pagar', 'z2', 'ag2', { origem: 'OUTROS', status: 'PAGO', valor_final: 555555, valor_pago: 555555, data_vencimento: '2026-09-05', data_pagamento: '2026-09-05' });
await ins('vendas_crm', 'z3', 'ag2', { numero: 'X', data_venda: '2026-09-03', status: 'CONFIRMADO', valor_final: 999999 }, { status: 'CONFIRMADO' });

const d = await carregarDashboard(exec, {
  tenantId: T, de: '2026-09-01', ate: '2026-09-30', hoje: HOJE,
  deAnterior: '2026-08-01', ateAnterior: '2026-08-31',
});

// ══════════════════════════════════════════════════════════════════════
console.log('--- caixa: entrou, saiu, sobrou ---');
// r1 7.000 + r4 1.200 + r2 3.000 (parcial, vence 20/09 sem data de baixa, cai no vencimento)
eq(d.caixa.entradas.atual, 11200, 'entradas do mês pelo regime de caixa');
// p1 12.000 + p3 3.200 + p4 1.800 + p5 900
eq(d.caixa.saidas.atual, 17900, 'saídas do mês incluem o repasse: o dinheiro saiu');
eq(d.caixa.repasses, 12000, 'o repasse é isolado para poder ser explicado');
eq(d.caixa.despesasProprias.atual, 5900, 'despesa PRÓPRIA exclui o repasse — 3.200 + 1.800 + 900');
eq(d.caixa.resultado.atual, -6700, 'resultado de caixa do mês');
eq(d.caixa.entradas.variacao, null, 'mês anterior zerado não vira +100%, vira "sem base"');

console.log('\n--- saldo em caixa hoje ---');
// 10.000 + 500 (a conta inativa fica de fora) + todas as entradas 11.200 − todas as saídas 17.900
eq(d.caixa.saldoInicialDasContas, 10500, 'conta encerrada não entra no saldo inicial');
eq(d.caixa.saldo, 3800, 'saldo computado pelo histórico de baixas, não pelo campo persistido');

console.log('\n--- posição: quanto falta entrar e sair ---');
eq(d.posicao.receber.emAberto, 22400, 'a receber em aberto: 4.000 + 6.000 + 2.400 + 10.000');
eq(d.posicao.receber.vencido, 2400, 'vencido é estritamente antes de hoje');
eq(d.posicao.receber.contasVencidas, 1, 'uma parcela em atraso');
eq(d.posicao.pagar.emAberto, 13540, 'a pagar em aberto: 4.500 + 700 + 340 + 8.000');
eq(d.posicao.pagar.vencido, 700, 'a conta de 01/09 está vencida');

console.log('\n--- aging soma o SALDO, nunca o valor cheio da parcela ---');
{
  const r = Object.fromEntries(d.aging.receber.map(f => [f.id, f.valor]));
  // 01/08 contra 15/09 são 45 dias: é a faixa mais grave, não a intermediária.
  eq(r.vencido_30, 2400, 'parcela vencida há 45 dias cai na faixa mais grave');
  // r2 vence 20/09 (5 dias) com 4.000 em aberto, não com os 7.000 cheios.
  eq(r.ate_7, 4000, 'parcial entra pelo saldo de 4.000, não pelos 7.000 da parcela');
  eq(d.aging.receber.reduce((s, f) => s + f.valor, 0), 22400, 'as faixas somam o total em aberto');
  const p = Object.fromEntries(d.aging.pagar.map(f => [f.id, f.valor]));
  eq(p.sem_data, 340, 'conta sem vencimento aparece numa faixa própria, não some');
}

console.log('\n--- projeção de caixa ---');
{
  const j = Object.fromEntries(d.projecao.map(p => [p.dias, p]));
  // Até 22/09 entram 2.400 (já vencido) + 4.000 (20/09) = 6.400.
  // Saem 700 (vencido) + 8.000 da Latam (18/09) = 8.700. A Azul vence 25/09,
  // fora da janela — e é isso que uma projeção por janela precisa acertar.
  eq(j[7].entradas, 6400, 'o que já venceu e não entrou conta na primeira janela');
  eq(j[7].saidas, 8700, 'saídas até 22/09, sem puxar o que vence depois');
  eq(j[7].saldoProjetado, 1500, 'saldo projetado em 7 dias: 3.800 + 6.400 − 8.700');
  eq(j[90].saldoProjetado > j[7].saldoProjetado, true, 'a parcela de outubro melhora a janela longa');
  eq(d.projecao.map(p => p.dias), [7, 15, 30, 60, 90], 'cinco janelas');
}

console.log('\n--- receita por origem: venda e comissão não se somam ---');
{
  const o = Object.fromEntries(d.receitaPorOrigem.map(x => [x.id, x.valor]));
  eq(o.VENDA, 10000, 'do cliente: 7.000 + 3.000');
  eq(o.COMISSAO_FORNECEDOR, 1200, 'comissão de operadora é receita pura, em linha separada');
}

console.log('\n--- despesa por categoria com o balde honesto ---');
{
  const c = Object.fromEntries(d.despesaPorCategoria.map(x => [x.nome, x.valor]));
  eq(c['Aluguel e sede'], 3200, 'categoria do plano de contas');
  eq(c['Marketing'], 1800, 'marketing');
  eq(c['Não categorizadas'], 900, 'o que ninguém categorizou aparece, não some');
  eq(Object.values(c).reduce((s, v) => s + v, 0), 5900, 'a soma bate com a despesa própria');
}

console.log('\n--- fornecedores e margem por fornecedor ---');
{
  const f = Object.fromEntries(d.fornecedores.map(x => [x.nome, x.valor]));
  eq(f['CVC Operadora'], 12000, 'ranking de saída inclui o repasse: é para onde o dinheiro foi');
  const m = Object.fromEntries(d.margemPorFornecedor.map(x => [x.nome, [x.venda, x.custo, x.margem, x.margemPct]]));
  eq(m['CVC Operadora'], [14000, 12000, 2000, 14.29], 'quem dá volume');
  eq(m['Azul Viagens'], [6000, 4500, 1500, 25], 'quem dá margem — e não é o mesmo');
  eq(Object.keys(m).includes('Cancelado'), false, 'item cancelado fica de fora');
}

console.log('\n--- clientes: operadora não é cliente ---');
{
  const nomes = d.clientes.map(c => c.nome);
  eq(nomes.includes('CVC Operadora'), false, 'a comissão de operadora não inventa um cliente');
  eq(Object.fromEntries(d.clientes.map(c => [c.nome, c.valor]))['Maria Aparecida'], 10000, 'o cliente de verdade');
}

console.log('\n--- vendas do período ---');
eq(d.vendas.quantidade, 4, 'as quatro vendas realizadas, inclusive a de status minúsculo');
eq(d.vendas.volume, 43000, 'volume vendido: 20.000 + 8.000 + 5.000 + 10.000');
// 3.500 + 2.000 + 1.000 + 2.000. É SETE VEZES MENOR que o volume — a diferença
// entre os dois números é a razão de este módulo existir.
eq(d.vendas.receitaAgencia, 8500, 'receita da agência é a MARGEM, não o volume');
eq(d.vendas.margemPct, 19.77, 'margem sobre o volume');
eq(d.vendas.ticketVolume, 10750, 'ticket de volume');
eq(d.vendas.ticketReceita, 2125, 'ticket de RECEITA: o que a agência de fato ganha por venda');
eq(d.vendas.semLastro, { quantidade: 2, volume: 13000 }, 'as duas vendas sem conta nenhuma são sinalizadas');

console.log('\n--- descasamento cliente x fornecedor ---');
{
  // A venda 1042 NÃO descasa: o cliente paga 20/09 e a Azul só vence 25/09.
  // A 1045 descasa: a Latam vence 18/09 e o cliente só paga 10/10.
  eq(d.descasamento.length, 1, 'só a venda que de fato descasa aparece');
  const x = d.descasamento[0];
  eq([x.numero, x.diasDeGap, x.exposicao], ['1045', 22, 8000],
     'a agência banca 8.000 por 22 dias nesta venda');
  eq([x.primeiroPagamento, x.primeiroRecebimento], ['2026-09-18', '2026-10-10'],
     'as duas datas que formam o aperto ficam explícitas');
}

console.log('\n--- central de atenção ---');
eq(d.atencao.pagarVencido, { valor: 700, contas: 1 }, 'conta a pagar vencida');
eq(d.atencao.receberVencido, { valor: 2400, contas: 1 }, 'parcela do cliente em atraso');
eq(d.atencao.semFornecedor, 1, 'uma conta sem fornecedor identificado');
eq(d.atencao.semVencimento, 1, 'uma conta sem data de vencimento');
eq(d.atencao.naoCategorizadas.valor, 900, 'despesa sem categoria');

console.log('\n--- agenda dos próximos 30 dias ---');
{
  eq(d.agenda.linhas.length > 0, true, 'a agenda tem lançamentos');
  eq(d.agenda.total, d.agenda.linhas.length, 'a contagem é real, não o teto da consulta');
  eq(d.agenda.linhas.every(l => l.valor > 0), true, 'só entra o que ainda falta movimentar');
  eq(d.agenda.linhas[0].data <= d.agenda.linhas[d.agenda.linhas.length - 1].data, true, 'em ordem de data');
  // A agenda começa HOJE. Sem esse piso, uma agência com quarenta parcelas
  // atrasadas de 2024 enche as sessenta linhas com passado e "Próximos
  // movimentos" não mostra um único movimento futuro — nem o pagamento grande
  // de amanhã. O vencido tem bloco próprio, com total próprio.
  eq(d.agenda.linhas.every(l => l.data >= HOJE), true, 'a agenda olha para a frente, não para trás');
  eq(d.agenda.linhas.some(l => l.data === '2026-08-01'), false, 'a parcela vencida em agosto não ocupa a agenda');
  eq(d.agenda.linhas.some(l => l.data === '2026-10-20'), false, 'nada além de 30 dias');
  eq(d.agenda.linhas.some(l => l.data === '2026-10-10'), true, 'o que vence dentro de 30 dias entra');
}

console.log('\n--- cobertura de caixa ---');
eq(d.cobertura.despesaMensal, 5900, 'setembro inteiro: a despesa do período já é mensal');
eq(d.cobertura.meses, 0.64, 'o caixa cobre menos de um mês de despesa própria');

console.log('\n--- isolamento de tenant em TODAS as consultas ---');
{
  const texto = JSON.stringify(d);
  for (const vazado of ['888888', '555555', '999999', '777777']) {
    eq(texto.includes(vazado), false, `nada da outra agência aparece (${vazado})`);
  }
}

console.log('\n--- a série mensal existe e fecha com o caixa ---');
{
  const set = d.serie.find(p => p.mes === '2026-09');
  eq([set.entradas, set.saidas], [11200, 17900], 'o mês da série bate com o card de caixa');
}

// ══════════════════════════════════════════════════════════════════════
// DRILL-DOWN: do total até o lançamento.
//
// Um número agregado sem caminho de volta é um número em que a pessoa tem que
// acreditar. Estes testes provam que o detalhe FECHA com o agregado — que é a
// única coisa que torna o drill-down confiável.
// ══════════════════════════════════════════════════════════════════════
const { listarLancamentos, somarDetalhe } = await lib('dashboard-detalhe');
const janela = { tenantId: T, de: '2026-09-01', ate: '2026-09-30', hoje: HOJE };

console.log('\n--- o detalhe fecha com o agregado ---');
{
  const r = await listarLancamentos(exec, { ...janela, lado: 'receber', recorte: 'em-aberto' });
  eq(somarDetalhe(r.linhas, 'valorEmAberto'), d.posicao.receber.emAberto,
     'a soma das linhas bate com o card de "a receber em aberto"');
  eq(r.total, r.linhas.length, 'a contagem bate com o que voltou');
}
{
  const p = await listarLancamentos(exec, { ...janela, lado: 'pagar', recorte: 'em-aberto' });
  eq(somarDetalhe(p.linhas, 'valorEmAberto'), d.posicao.pagar.emAberto,
     'o mesmo do lado de pagar');
}
{
  const v = await listarLancamentos(exec, { ...janela, lado: 'receber', recorte: 'vencido' });
  eq(somarDetalhe(v.linhas, 'valorEmAberto'), d.posicao.receber.vencido, 'vencido fecha com o card');
  eq(v.linhas.length, 1, 'uma parcela vencida');
  eq(v.linhas[0].diasDeAtraso, 45, 'e o detalhe diz há quantos dias — que é o que faz ligar para o cliente');
  eq(v.linhas[0].contraparte, 'João Atrasado', 'com nome de quem deve');
}
{
  const r = await listarLancamentos(exec, { ...janela, lado: 'receber', recorte: 'realizado' });
  eq(somarDetalhe(r.linhas, 'valorRealizado'), d.caixa.entradas.atual,
     'o realizado do detalhe fecha com as entradas do período');
}

console.log('\n--- recortes por referência ---');
{
  const f = await listarLancamentos(exec, { ...janela, lado: 'pagar', recorte: 'contraparte', referencia: 'forn-azul' });
  eq(f.linhas.map(l => l.id), ['p2'], 'o que está em aberto com um fornecedor');
}
{
  const c = await listarLancamentos(exec, { ...janela, lado: 'pagar', recorte: 'categoria', referencia: 'cat-mkt' });
  eq(somarDetalhe(c.linhas, 'valorRealizado'), 1800, 'a categoria fecha com a barra de marketing');
}
{
  const sc = await listarLancamentos(exec, { ...janela, lado: 'pagar', recorte: 'categoria', referencia: 'sem-categoria' });
  eq(somarDetalhe(sc.linhas, 'valorRealizado'), 900, 'o balde "não categorizadas" também abre');
}
{
  const o = await listarLancamentos(exec, { ...janela, lado: 'receber', recorte: 'origem', referencia: 'COMISSAO_FORNECEDOR' });
  eq(o.linhas.map(l => l.id), ['r4'], 'a comissão de operadora abre sozinha');
}
{
  const v = await listarLancamentos(exec, { ...janela, lado: 'receber', recorte: 'venda', referencia: 'v1' });
  eq(v.linhas.map(l => l.id).sort(), ['r1', 'r2', 'r3', 'r4'], 'tudo que a venda gerou, inclusive a comissão');
}
{
  const h = await listarLancamentos(exec, { ...janela, lado: 'pagar', recorte: 'vence-hoje' });
  eq(h.linhas.length, 0, 'nada vence exatamente hoje neste cenário');
}

console.log('\n--- clicar numa faixa abre exatamente aquela faixa ---');
{
  // O defeito que isto trava: antes, clicar em "vencido há 8 a 30 dias" abria
  // TODO o vencido, com um título prometendo a faixa. Detalhe que não fecha
  // com o número que ele abre destrói a confiança no painel inteiro.
  for (const lado of ['receber', 'pagar']) {
    for (const faixa of d.aging[lado]) {
      const r = await listarLancamentos(exec, { ...janela, lado, recorte: 'aging', referencia: faixa.id });
      eq(r.somaEmAberto, faixa.valor, `${lado} · a faixa "${faixa.rotulo}" abre exatamente o que ela mostra`);
      eq(r.total, faixa.contas, `${lado} · e a contagem também bate`);
    }
  }
}
{
  const inexistente = await listarLancamentos(exec, { ...janela, lado: 'receber', recorte: 'aging', referencia: 'faixa_que_nao_existe' });
  eq(inexistente.total, 0, 'faixa desconhecida não abre a base inteira');
}

console.log('\n--- a soma da gaveta é do recorte inteiro, não das linhas devolvidas ---');
{
  // Somar só as 200 linhas devolvidas e imprimir ao lado da contagem total faz
  // o cabeçalho dizer "347 lançamentos · R$ 58.000" quando os 347 somam mais.
  const r = await listarLancamentos(exec, { ...janela, lado: 'receber', recorte: 'em-aberto', limite: 2 });
  eq(r.linhas.length, 2, 'o limite corta as linhas');
  eq(r.truncado, true, 'e a resposta admite que cortou');
  eq(r.somaEmAberto, d.posicao.receber.emAberto, 'mas a SOMA continua sendo a do recorte inteiro');
  eq(r.total > r.linhas.length, true, 'e a contagem também');
}

console.log('\n--- conta sem vencimento não fura a fila ---');
{
  // COALESCE(x,'') nunca devolve NULL, então o NULLS LAST era decorativo e a
  // string vazia ordenava ANTES de tudo: as contas sem data comiam o corte e
  // empurravam para fora justamente o que vence amanhã.
  const r = await listarLancamentos(exec, { ...janela, lado: 'pagar', recorte: 'em-aberto' });
  const semData = r.linhas.findIndex(l => !l.vencimento);
  eq(semData === -1 || semData === r.linhas.length - 1, true, 'a conta sem vencimento vai para o FIM da lista');
}

console.log('\n--- o drill-down não vaza entre agências ---');
{
  const outra = await listarLancamentos(exec, { ...janela, tenantId: 'ag2', lado: 'receber', recorte: 'realizado' });
  eq(outra.linhas.map(l => l.id), ['z1'], 'a outra agência só enxerga o que é dela');
  const nossa = await listarLancamentos(exec, { ...janela, lado: 'receber', recorte: 'realizado' });
  eq(nossa.linhas.some(l => l.id === 'z1'), false, 'e nós não enxergamos a dela');
}

console.log('\n--- recorte desconhecido não abre a base ---');
{
  // Nome fora da lista cai no recorte mais restrito, nunca em "tudo".
  const x = await listarLancamentos(exec, { ...janela, lado: 'receber', recorte: 'OR 1=1' });
  eq(x.linhas.every(l => l.valorEmAberto > 0), true, 'recorte inválido vira "em aberto", não uma lista solta');
}

// ══════════════════════════════════════════════════════════════════════
// O MODELO "O CLIENTE PAGA A OPERADORA DIRETO".
//
// É um modo de operar comum em agência de viagens, e o sistema tem um seletor
// para ele em /vendas/nova ("Cliente paga fornecedor"). Nele a venda é gravada
// com custo IGUAL ao valor (repasse integral) e a receita inteira da agência
// mora numa conta a receber de COMISSAO_FORNECEDOR.
//
// Com `receita = max(valor − custo, 0)` isso dá ZERO: a tela estampava
// "Receita da agência R$ 0,00", o painel de saúde marcava "margem 0% — risco",
// e na MESMA tela outro bloco dizia "100% do que entrou é comissão de
// operadora, que é receita da agência por inteiro". Enquanto isso o DRE do
// mesmo mês mostrava a receita certa.
// ══════════════════════════════════════════════════════════════════════
console.log('\n--- comissão de operadora É receita da agência ---');
{
  const C = 'ag-comissao';
  await ins('contas_bancarias', 'cb1', C, { nome: 'Conta', saldo_inicial: 0, ativo: true });
  // Venda de 20.000 repassada integralmente; a operadora paga 10% de volta.
  await ins('vendas_crm', 'cv1', C, {
    numero: '2001', data_venda: '2026-09-05', status: 'CONFIRMADO',
    valor_final: 20000, valor_total_custo: 20000, cliente_nome: 'Cliente Direto',
  }, { status: 'CONFIRMADO' });
  await ins('contas_receber', 'cr1', C, {
    origem: 'COMISSAO_FORNECEDOR', status: 'RECEBIDO', valor_final: 2000, valor_recebido: 2000,
    data_vencimento: '2026-09-20', data_recebimento: '2026-09-20',
    cliente_nome: 'CVC Operadora', origem_venda_id: 'cv1',
  }, { cliente_id: 'forn-cvc' });

  const c = await carregarDashboard(exec, {
    tenantId: C, de: '2026-09-01', ate: '2026-09-30', hoje: HOJE,
    deAnterior: '2026-08-01', ateAnterior: '2026-08-31',
  });

  eq(c.vendas.volume, 20000, 'o volume é o que o cliente contratou');
  eq(c.vendas.receitaAgencia, 2000, 'a RECEITA é a comissão — não zero');
  eq(c.vendas.comissaoDeOperadora, 2000, 'e a comissão é nomeada à parte');
  eq(c.vendas.margemPct, 10, 'a margem é 10%, que é o que a agência de fato ganha');

  // A cascata precisa fechar com a receita nova.
  const { montarCascataDoResultado } = await lib('dashboard-insights');
  const passos = montarCascataDoResultado(c, v => String(v));
  eq(Math.round((passos[0].valor - passos[1].valor) * 100) / 100, passos[2].valor,
     'a cascata fecha: 20.000 − 18.000 = 2.000');
}
{
  // E a comissão NÃO pode ser somada quando já está dentro da margem: a venda
  // do CRM grava a comissão como rentabilidade, e somar as duas dobraria.
  const C = 'ag-dupla';
  await ins('vendas_crm', 'dv1', C, {
    numero: '3001', data_venda: '2026-09-05', status: 'CONFIRMADO',
    valor_final: 20000, valor_total_custo: 16500,
  }, { status: 'CONFIRMADO' });
  await ins('contas_receber', 'dr1', C, {
    origem: 'COMISSAO_FORNECEDOR', status: 'PENDENTE', valor_final: 1200,
    data_vencimento: '2026-09-20', origem_venda_id: 'dv1',
  }, {});

  const c = await carregarDashboard(exec, {
    tenantId: C, de: '2026-09-01', ate: '2026-09-30', hoje: HOJE,
    deAnterior: '2026-08-01', ateAnterior: '2026-08-31',
  });
  // A margem (3.500) já cobre a comissão (1.200): a receita é 3.500, não 4.700.
  eq(c.vendas.receitaAgencia, 3500, 'comissão dentro da margem não é somada duas vezes');
}
{
  // Comissão MAIOR que a margem: o excedente é receita própria, como o DRE faz.
  const C = 'ag-excedente';
  await ins('vendas_crm', 'ev1', C, {
    numero: '4001', data_venda: '2026-09-05', status: 'CONFIRMADO',
    valor_final: 10000, valor_total_custo: 9500,
  }, { status: 'CONFIRMADO' });
  await ins('contas_receber', 'er1', C, {
    origem: 'COMISSAO_FORNECEDOR', status: 'PENDENTE', valor_final: 1500,
    data_vencimento: '2026-09-20', origem_venda_id: 'ev1',
  }, {});

  const c = await carregarDashboard(exec, {
    tenantId: C, de: '2026-09-01', ate: '2026-09-30', hoje: HOJE,
    deAnterior: '2026-08-01', ateAnterior: '2026-08-31',
  });
  // margem 500, comissão 1.500 -> a receita é 1.500 (500 capturados + 1.000 de excedente)
  eq(c.vendas.receitaAgencia, 1500, 'a comissão que a margem não cobre vira receita');
}

console.log('\n--- data fora do formato não derruba o painel ---');
{
  // Uma única conta gravada com '30/09/2026' fazia o ::date da faixa de aging
  // estourar e derrubava a tela INTEIRA — não a faixa, a tela.
  const C = 'ag-datasuja';
  await ins('contas_receber', 'sr1', C, { origem: 'VENDA', status: 'PENDENTE', valor_final: 1000, data_vencimento: '30/09/2026', cliente_nome: 'Data BR' }, {});
  await ins('contas_receber', 'sr2', C, { origem: 'VENDA', status: 'PENDENTE', valor_final: 500, data_vencimento: 'amanhã', cliente_nome: 'Data texto' }, {});
  await ins('contas_receber', 'sr3', C, { origem: 'VENDA', status: 'PENDENTE', valor_final: 300, data_vencimento: '2026-09-20', cliente_nome: 'Data boa' }, {});

  const c = await carregarDashboard(exec, {
    tenantId: C, de: '2026-09-01', ate: '2026-09-30', hoje: HOJE,
    deAnterior: '2026-08-01', ateAnterior: '2026-08-31',
  });
  eq(c.posicao.receber.emAberto, 1800, 'o painel carrega, com as três contas somadas');
  const faixas = Object.fromEntries(c.aging.receber.map(f => [f.id, f.valor]));
  eq(faixas.sem_data, 1500, 'as datas fora do formato caem em "sem data", não derrubam a query');
  eq(faixas.ate_7, 300, 'e a data boa vai para a faixa certa');
}

console.log(`\n${total - falhas}/${total} testes do payload do dashboard passaram`);
process.exit(falhas > 0 ? 1 : 0);
