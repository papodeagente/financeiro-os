/**
 * Acompanhamento do plano do mês, lado do banco (src/lib/plano-do-mes-servidor.ts),
 * contra um Postgres real (PGlite). Nenhum banco de verdade é tocado.
 *
 * O que se prova:
 *   (a) o realizado é o do relatório Lucro real: venda com lançamento no mês,
 *       comissão = venda menos custo, venda cancelada e de outro mês fora;
 *   (b) as contas do custo do mês, conta a conta: estrutura e marketing
 *       separados; repasse ao fornecedor, imposto, conta de outro mês e
 *       cancelada ficam fora; o pago sai do valor baixado (parcial conta);
 *   (c) registros de progresso: gravar, listar e apagar só da própria
 *       empresa; dia futuro, número quebrado e item sem registro recusados;
 *   (d) salvar o plano (que troca o documento inteiro) não apaga registro.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-plano-do-mes.mjs
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE planejamento_custos (id TEXT PRIMARY KEY, mes TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_planejamento_custos_tenant_mes ON planejamento_custos(tenant_id, mes);
  CREATE TABLE planejamento_progresso (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, mes TEXT NOT NULL, chave TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX idx_planejamento_progresso_tenant_mes ON planejamento_progresso(tenant_id, mes);
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const {
  carregarRealizadoDoMes, gravarRegistro, listarRegistros, apagarRegistro,
} = await import('../src/lib/plano-do-mes-servidor.ts');
const { montarAcompanhamento } = await import('../src/lib/plano-do-mes.ts');

const T1 = 'agencia-a', T2 = 'agencia-b';
const exec = { query };
const ins = (tabela, tenant, data) => query(`INSERT INTO ${tabela} (id, tenant_id, data) VALUES ($1, $2, $3::jsonb)`, [data.id, tenant, JSON.stringify(data)]);
const venda = (id, data_venda, valor_final, valor_total_custo, extra = {}) =>
  ({ id, numero: id.toUpperCase(), data_venda, valor_final, valor_total_custo, status: 'CONFIRMADO', cliente_id: 'c1', vendedor_id: 'v1', produtos: [], ...extra });
const comissaoDe = (vendaId, valor) => ({ id: `co-${vendaId}`, origem: 'COMISSAO_FORNECEDOR', origem_venda_id: vendaId, venda_id: vendaId, valor_final: valor, data_vencimento: '2026-11-10', status: 'PENDENTE' });
const cp = (id, valor, venc, extra = {}) => ({ id, descricao: id, fornecedor_nome: '', valor_final: valor, data_vencimento: venc, status: 'PENDENTE', origem: 'DESPESA_FIXA', categoria_id: 'cat-op', ...extra });

await ins('plano_contas', T1, { id: 'cat-op', codigo: '2.2', nome: 'Operacionais', is_custo_comercial: false });
await ins('plano_contas', T1, { id: 'cat-imp', codigo: '2.3', nome: 'Impostos', is_custo_comercial: false });
await ins('plano_contas', T1, { id: 'cat-mkt', codigo: '2.6', nome: 'Marketing', is_custo_comercial: true });

// Vendas de outubro: Grupo Japão (paga direto ao fornecedor) e uma própria.
await ins('vendas_crm', T1, venda('japao', '2026-10-09', 390.63, 312.5));
await ins('contas_receber', T1, comissaoDe('japao', 78.13));
await ins('vendas_crm', T1, venda('lisboa', '2026-10-14', 10000, 8000));
await ins('contas_receber', T1, comissaoDe('lisboa', 2000));
// Fora do mês, cancelada, e sem lançamento (não conta, mesma régua do DRE).
await ins('vendas_crm', T1, venda('setembro', '2026-09-28', 5000, 4000));
await ins('contas_receber', T1, comissaoDe('setembro', 1000));
await ins('vendas_crm', T1, venda('cancelada', '2026-10-10', 9000, 7000, { status: 'CANCELADO' }));
await ins('contas_receber', T1, comissaoDe('cancelada', 2000));
await ins('vendas_crm', T1, venda('sem-conta', '2026-10-11', 7000, 5000));
// A outra empresa, no mesmo mês.
await ins('vendas_crm', T2, venda('b1', '2026-10-05', 50000, 10000));
await ins('contas_receber', T2, comissaoDe('b1', 40000));

// Contas do mês.
await ins('contas_pagar', T1, cp('aluguel', 3000, '2026-10-05', { status: 'PAGO', valor_pago: 3000 }));
await ins('contas_pagar', T1, cp('sistema', 500, '2026-10-10'));
await ins('contas_pagar', T1, cp('contador', 400, '2026-10-25', { status: 'PARCIAL', valor_pago: 150 }));
await ins('contas_pagar', T1, cp('ads', 800, '2026-10-02', { categoria_id: 'cat-mkt', status: 'PAGO', valor_pago: 800 }));
await ins('contas_pagar', T1, cp('impulso', 300, '2026-10-12', { is_custo_comercial: true }));
await ins('contas_pagar', T1, cp('iss', 120, '2026-10-20', { categoria_id: 'cat-imp' }));
await ins('contas_pagar', T1, cp('repasse', 312.5, '2026-10-20', { origem: 'VENDA', auto_gerado: true }));
await ins('contas_pagar', T1, cp('novembro', 999, '2026-11-05'));
await ins('contas_pagar', T1, cp('cancelada', 777, '2026-10-06', { status: 'CANCELADO' }));
await ins('contas_pagar', T2, cp('aluguel-b', 9000, '2026-10-05'));

// ══════════════════════════════════════════════════════════════════════
console.log('--- (a) o realizado do mês ---');
const r = await carregarRealizadoDoMes(exec, T1, '2026-10', '2026-10-20', null);
eq([r.vendas, r.faturamento, r.comissao], [2, 10390.63, 2078.13], 'duas vendas com lançamento em outubro; comissão = venda menos custo (78,13 + 2.000)');
eq([r.mes, r.hoje], ['2026-10', '2026-10-20'], 'o mês e o dia de referência');
eq(r.impostos, 120, 'imposto lançado no mês (2.3) entra como imposto, não como custo fixo');

console.log('\n--- (b) as contas do custo do mês ---');
const porId = Object.fromEntries(r.contas.map(c => [c.id, c]));
eq(Object.keys(porId).sort(), ['ads', 'aluguel', 'contador', 'impulso', 'sistema'], 'só as contas de custo do mês: repasse, imposto, outro mês e cancelada ficam fora');
eq([porId.aluguel.grupo, porId.ads.grupo, porId.impulso.grupo], ['fixo', 'marketing', 'marketing'], 'marketing pela categoria comercial ou pela conta marcada');
eq([porId.aluguel.pago, porId.contador.pago, porId.sistema.pago], [3000, 150, 0], 'o pago é o valor baixado: pago inteiro, parcial e em aberto');
eq(r.custo_fixo, 5000, 'o custo fixo da escada é a soma dessas contas (mesma régua do Lucro real)');
const outra = await carregarRealizadoDoMes(exec, T2, '2026-10', '2026-10-20', null);
eq([outra.vendas, outra.contas.map(c => c.id)], [1, ['aluguel-b']], 'a outra empresa só vê o que é dela');

console.log('\n--- (c) registros de progresso ---');
const g = await gravarRegistro(exec, T1, { chave: 'atendimentos', valor: 35, data: '2026-10-09', observacao: ' pelo relatório do CRM ' }, 'Karen', '2026-10-20');
eq([g.ok, g.registro?.valor, g.registro?.autor, g.registro?.observacao], [true, 35, 'Karen', 'pelo relatório do CRM'], 'grava com quem registrou e a observação aparada');
await gravarRegistro(exec, T1, { chave: 'atendimentos', valor: 55, data: '2026-10-19' }, 'Bruno', '2026-10-20');
eq((await gravarRegistro(exec, T1, { chave: 'atendimentos', valor: 60, data: '2026-10-21' }, 'Bruno', '2026-10-20')).erro, 'O registro não pode ser de um dia que ainda não chegou.', 'dia que ainda não chegou: recusado');
eq((await gravarRegistro(exec, T1, { chave: 'atendimentos', valor: 2.5, data: '2026-10-19' }, 'Bruno', '2026-10-20')).erro, 'Informe um número inteiro de atendimentos.', 'número quebrado: recusado');
eq((await gravarRegistro(exec, T1, { chave: 'vendas', valor: 3, data: '2026-10-19' }, 'Bruno', '2026-10-20')).erro, 'Este item não aceita registro manual.', 'vendas vêm do sistema: não aceita registro');
await gravarRegistro(exec, T2, { chave: 'atendimentos', valor: 999, data: '2026-10-19' }, 'Outra', '2026-10-20');
const lista = await listarRegistros(exec, T1, '2026-10');
eq(lista.map(x => [x.valor, x.data]), [[55, '2026-10-19'], [35, '2026-10-09']], 'lista da empresa, do dia mais recente para o mais antigo');
eq((await listarRegistros(exec, T1, '2026-09')).length, 0, 'o registro é do mês do dia a que se refere');
const comRegistros = await carregarRealizadoDoMes(exec, T1, '2026-10', '2026-10-20', null);
eq(comRegistros.registros.map(x => x.valor), [55, 35], 'o realizado leva os registros do mês');
const doOutro = (await listarRegistros(exec, T2, '2026-10'))[0];
eq(await apagarRegistro(exec, T1, doOutro.id), false, 'não apaga registro da outra empresa');
eq(await apagarRegistro(exec, T1, lista[1].id), true, 'apaga o próprio');
eq((await listarRegistros(exec, T1, '2026-10')).map(x => x.valor), [55], 'e ele some da lista');

console.log('\n--- (d) salvar o plano não apaga registro ---');
const salvar = (data) => query(
  `INSERT INTO planejamento_custos (id, tenant_id, mes, data) VALUES ($1, $2, $3, $4::jsonb)
   ON CONFLICT (tenant_id, mes) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
  ['p1', T1, '2026-10', JSON.stringify(data)],
);
await salvar({ id: 'p1', mes: '2026-10', ticket_medio: 8000, lucro_desejado: 10000 });
await salvar({ id: 'p1', mes: '2026-10', ticket_medio: 9000, lucro_desejado: 15000 });
eq((await listarRegistros(exec, T1, '2026-10')).map(x => x.valor), [55], 'o plano foi salvo duas vezes e o registro continua lá');
const painel = montarAcompanhamento({ plano: null, rel: null, realizado: await carregarRealizadoDoMes(exec, T1, '2026-10', '2026-10-20', null) });
eq(painel.areas.flatMap(a => a.itens).find(i => i.chave === 'atendimentos').realizado, 55, 'e o acompanhamento lê o registro mesmo sem plano');

console.log(`\n${total - falhas}/${total} testes do acompanhamento do plano (banco) passaram`);
if (falhas > 0) process.exit(1);
