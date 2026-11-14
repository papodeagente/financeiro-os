/**
 * Comissões por função e relatórios de vendas (E5, parte F) contra um
 * Postgres real (PGlite), rodando as ROTAS de produção com sessão de teste.
 *
 * O que se prova:
 *   (a) na regra de hoje nada muda: recalcular não grava, a tarefa do dia
 *       pula a agência, Fechar e Pagar recusam, a comissão antiga fica igual;
 *   (b) cadastro: funções do sistema, plano em matriz, metas;
 *   (c) prévia e Fechar até a data: liberar no recebimento parcial; Leo sem
 *       meta é recusado e a Bia fecha; fechar de novo não fecha nada;
 *   (d) Pagar parcial e total → uma conta por pessoa com o detalhe;
 *   (e) estorno automático: recebimento estornado e venda cancelada entram
 *       negativos no próximo fechamento e a pessoa passa a dever (conta a
 *       receber);
 *   (f) direitos: vendedor vê só o próprio painel e as próprias; não fecha
 *       nem paga; relatório sem o direito de ver o ganho não traz receita;
 *   (g) relatórios batem com as vendas (ficha), exportam CSV e XLSX.
 *
 * Uso: node --no-warnings scripts/test-sql-comissao-funcoes.mjs
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE itens_venda (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', sequencia INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_contas_receber_venda_parcela ON contas_receber (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE UNIQUE INDEX idx_contas_pagar_venda_item ON contas_pagar (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE agendador_execucoes (tarefa TEXT, tenant_id TEXT, janela TEXT);
`);

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
globalThis.__SESSAO_DE_TESTE__ = null;
register('./sessao-de-teste-hook.mjs', import.meta.url);

const { VENDA_SCHEMA_SQL } = await import('../src/lib/venda-schema.ts');
const { COMISSAO_FUNCOES_SCHEMA_SQL } = await import('../src/lib/comissao-funcoes-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(VENDA_SCHEMA_SQL);
await pg.exec(COMISSAO_FUNCOES_SCHEMA_SQL);
await pg.exec(COMISSAO_FUNCOES_SCHEMA_SQL); // idempotente

const { tarefaComissoesDoDia } = await import('../src/lib/comissao-funcoes-servidor.ts');
const { carregarVenda } = await import('../src/lib/venda-servidor.ts');
const { totaisDaVenda } = await import('../src/lib/venda-modelo.ts');
const { receitaDaVenda } = await import('../src/lib/venda-receita.ts');
const { salvarRestricaoDeUsuario, invalidarPermissoes } = await import('../src/lib/permissoes-servidor.ts');
const rotaVenda = await import('../src/app/api/vendas/completa/route.ts');
const R = {
  config: await import('../src/app/api/comissoes-por-funcao/config/route.ts'),
  cadastro: await import('../src/app/api/comissoes-por-funcao/cadastro/route.ts'),
  funcoes: await import('../src/app/api/comissoes-por-funcao/funcoes/route.ts'),
  planos: await import('../src/app/api/comissoes-por-funcao/planos/route.ts'),
  metas: await import('../src/app/api/comissoes-por-funcao/metas/route.ts'),
  recalcular: await import('../src/app/api/comissoes-por-funcao/recalcular/route.ts'),
  previa: await import('../src/app/api/comissoes-por-funcao/previa/route.ts'),
  fechar: await import('../src/app/api/comissoes-por-funcao/fechar/route.ts'),
  aPagar: await import('../src/app/api/comissoes-por-funcao/a-pagar/route.ts'),
  pagar: await import('../src/app/api/comissoes-por-funcao/pagar/route.ts'),
  painel: await import('../src/app/api/comissoes-por-funcao/painel/route.ts'),
  relatorio: await import('../src/app/api/relatorios/vendas/route.ts'),
};

const T = 'agencia-f';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const sessao = (perfil, userId = `u-${perfil.toLowerCase()}`) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const ADMIN = sessao('ADMIN', 'u-admin');
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; };

await query(`INSERT INTO usuarios (id, nome, data, tenant_id) VALUES ('u-bia', 'Bia', '{}', $1), ('u-leo', 'Leo', '{}', $1), ('u-admin', 'Ana Admin', '{}', $1), ('u-ope', 'Otto', '{"perfil":"OPERADOR"}', $1)`, [T]);
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ('cat-26', $1, '2.6', '{"codigo":"2.6"}')`, [T]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, '{"datas_pagamento_comissao":[20]}')`, [T]);
// A comissão de hoje (regra antiga), que não pode mudar.
await query(`INSERT INTO comissoes (id, tenant_id, venda_id, vendedor_id, status, data) VALUES ('comissao-antiga', $1, 'v-velha', 'u-bia', 'APROVADA', '{"valor_comissao": 123.45, "status": "APROVADA"}')`, [T]);

console.log('--- vendas ---');
como(ADMIN);
const lancar = async venda => (await json(await rotaVenda.POST(pedir('POST', '/api/vendas/completa', { venda })))).corpo.venda.id;
const vA = await lancar({
  data_venda: '2026-11-03', cliente: { id: 'cli-a', nome: 'Carla' }, vendedor: { id: 'u-bia', nome: 'Bia' },
  produtos: [{ id: 'pa', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f1', nome: 'Hotel Mar' },
    passageiros: [{ id: 'x', nome: 'Carla', tarifa_centavos: 100000 }], componentes: [{ id: 'c1', tipo: 'COMISSAO', valor_centavos: 10000 }, { id: 'c2', tipo: 'FEE', valor_centavos: 5000 }] }],
  pagamentos: [{ id: 'g1', forma: 'BOLETO', valor_centavos: 105000, parcelas: 2 }],
});
const vB = await lancar({
  data_venda: '2026-11-05', cliente: { id: 'cli-b', nome: 'Davi' }, vendedor: { id: 'u-bia', nome: 'Bia' },
  produtos: [{ id: 'pb', tipo: 'OUTROS', descricao: 'Passeio', quantidade: 1, valor_unitario_centavos: 50000, componentes: [{ id: 'c1', tipo: 'MARKUP', valor_centavos: 5000 }] }],
  pagamentos: [{ id: 'g1', forma: 'PIX', valor_centavos: 55000 }],
});
const vC = await lancar({
  data_venda: '2026-11-06', cliente: { id: 'cli-b', nome: 'Davi' }, vendedor: { id: 'u-leo', nome: 'Leo' }, centro_custo: 'Filial Sul',
  produtos: [{ id: 'pc', tipo: 'OUTROS', descricao: 'Passeio', quantidade: 1, valor_unitario_centavos: 50000, componentes: [{ id: 'c1', tipo: 'MARKUP', valor_centavos: 5000 }] }],
  pagamentos: [{ id: 'g1', forma: 'PIX', valor_centavos: 55000 }],
});
// Venda de antes (v1), só com a lista de produtos no cabeçalho.
await query(`INSERT INTO vendas_crm (id, tenant_id, cliente_id, vendedor_id, status, data) VALUES ('v-d', $1, 'cli-d', 'u-leo', 'CONFIRMADO', $2::jsonb)`, [T, JSON.stringify({
  numero: 'VND-0900', data_venda: '2026-11-07', status: 'CONFIRMADO', vendedor_id: 'u-leo', cliente_id: 'cli-d', cliente_nome: 'Eva',
  valor_final: 800, valor_total_custo: 600, forma_pagamento: 'CARTAO',
  produtos: [{ id: 'pd', tipo: 'HOTEL', descricao: 'Hotel antigo', fornecedor_id: '', fornecedor_nome: 'Pousada', valor_custo: 600, valor_venda: 800, moeda: 'BRL', cambio: 1, status: 'CONFIRMADO' }],
})]);
eq([vA, vB, vC].every(Boolean), true, 'três vendas lançadas pelo modelo completo');

console.log('--- (a) Regra de hoje: nada muda ---');
let r = await json(await R.recalcular.POST());
eq([r.status, r.corpo.regra, r.corpo.itens], [200, 'ATUAL', 0], 'recalcular na regra de hoje não calcula');
eq((await todos(`SELECT COUNT(*)::int AS n FROM comissao_lancamentos`))[0].n, 0, 'nenhum lançamento gravado');
const ctxTarefa = { exec: pool, emTransacao: fn => fn(pool), agora: new Date(), restanteMs: () => 60000 };
eq(await tarefaComissoesDoDia.agencias(ctxTarefa), [], 'a tarefa do dia pula quem está na regra de hoje');
r = await json(await R.fechar.POST(pedir('POST', '/x', { ate: '2026-11-30', participantes: ['fn-vendedor:u-bia'] })));
eq([r.status, r.corpo.codigo], [409, 'REGRA_ATUAL'], 'Fechar recusa na regra de hoje');
r = await json(await R.pagar.POST(pedir('POST', '/x', { modo: 'TOTAL', pessoas: ['u-bia'] })));
eq([r.status, r.corpo.codigo], [409, 'REGRA_ATUAL'], 'Pagar recusa na regra de hoje');

console.log('--- (b) Cadastro ---');
r = await json(await R.config.PUT(pedir('PUT', '/x', { regra: 'FUNCOES', liberar: 'RECEBIMENTO', meta_sobre: ['RECEITA'], data_inicial: '2026-11-01' })));
eq([r.status, r.corpo.regra, r.corpo.liberar], [200, 'FUNCOES', 'RECEBIMENTO'], 'agência escolhe a regra por função, liberando no recebimento');
eq(await tarefaComissoesDoDia.agencias(ctxTarefa), [T], 'a tarefa do dia passa a atender a agência');
r = await json(await R.planos.PUT(pedir('PUT', '/x', { plano: { nome: 'Plano Equipe', modo_faixa: 'DEGRAU', faixas: [
  { percentual_meta: 0, regras: [{ produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 10, sobre: ['RECEITA'] } }] },
  { percentual_meta: 100, regras: [{ produto: '*', funcao_id: '*', calculo: { tipo: 'PERCENTUAL', percentual: 20, sobre: ['RECEITA'] } }] },
] } })));
const planoId = r.corpo.id;
eq([r.status, r.corpo.versao, r.corpo.faixas.length], [200, 1, 2], 'plano em matriz gravado');
r = await json(await R.planos.PUT(pedir('PUT', '/x', { plano: { nome: 'Ruim', faixas: [{ percentual_meta: 0, regras: [{ produto: '*', calculo: { tipo: 'PERCENTUAL', percentual: 5, sobre: [] } }] }] } })));
eq(r.status, 400, 'plano com percentual sem base é recusado');
r = await json(await R.funcoes.PUT(pedir('PUT', '/x', { funcao: { id: 'fn-vendedor' }, pessoas: [
  { pessoa_id: 'u-bia', pessoa_nome: 'Bia', plano_id: planoId }, { pessoa_id: 'u-leo', pessoa_nome: 'Leo', plano_id: planoId },
] })));
eq([r.status, r.corpo.funcao.nome, r.corpo.pessoas.map(p => p.id)], [200, 'Vendedor', ['fn-vendedor:u-bia', 'fn-vendedor:u-leo']], 'Vendedor com Bia e Leo');
r = await json(await R.funcoes.PUT(pedir('PUT', '/x', { funcao: { nome: 'Gerente' } })));
eq(r.status, 400, 'função nova sem "ganha sobre" é recusada');
r = await json(await R.funcoes.DELETE(pedir('DELETE', '/x?id=fn-vendedor')));
eq(r.status, 409, 'função do sistema não se apaga');
const metas = Array(12).fill(0); metas[10] = 30000;
r = await json(await R.metas.PUT(pedir('PUT', '/x', { pessoa_funcao_id: 'fn-vendedor:u-bia', ano: 2026, meses: metas })));
eq([r.status, r.corpo], [200, [{ pessoa_funcao_id: 'fn-vendedor:u-bia', mes: '2026-11', centavos: 30000 }]], 'meta de novembro da Bia: R$ 300');
r = await json(await R.metas.PUT(pedir('PUT', '/x', { pessoa_funcao_id: 'fn-vendedor:u-bia', ano: 2026, meses: [-1] })));
eq(r.status, 400, 'meta negativa é recusada');
r = await json(await R.cadastro.GET());
eq([r.status, r.corpo.funcoes.map(f => f.nome), r.corpo.unidades], [200, ['Intermediário', 'Vendedor'], ['Filial Sul']], 'cadastro com as funções do sistema e as unidades');

console.log('--- (c) Prévia e Fechar até a data ---');
const contasA = await todos(`SELECT id, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 ORDER BY (data->>'parcela_numero')::int`, [T, vA]);
const contaB = (await todos(`SELECT id FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, vB]))[0].id;
eq(contasA.length, 2, 'venda A: 2 parcelas a receber');
const baixa = (id, titulo, data, centavos, tipo = 'baixa') => query(
  `INSERT INTO baixas (id, tenant_id, tipo, titulo_tabela, titulo_id, data_baixa, valor_centavos, origem) VALUES ($1, $2, $3, 'contas_receber', $4, $5::date, $6, 'teste')`,
  [id, T, tipo, titulo, data, centavos]);
await baixa('b1', contasA[0].id, '2026-11-10', 52500);
await baixa('b2', contaB, '2026-11-05', 55000);

r = await json(await R.previa.GET(pedir('GET', '/x?ate=2026-11-30')));
const linha = nome => r.corpo.linhas.find(l => l.pessoa_nome === nome);
eq([linha('Bia').percentual, linha('Bia').saldo_centavos, linha('Bia').itens.map(i => i.valor_centavos)], [66.67, 1250, [750, 500]], 'Bia: 67% da meta, faixa 0; hotel liberado pela metade (cliente pagou 1 de 2 parcelas)');
eq(linha('Leo').erros, ['Meta de 11/2026 não definida.'], 'Leo sem meta: erro na linha dele');
const assinatura = r.corpo.assinatura;
r = await json(await R.fechar.POST(pedir('POST', '/x', { ate: '2026-11-30', participantes: ['fn-vendedor:u-bia', 'fn-vendedor:u-leo'], assinatura })));
eq([r.status, r.corpo.fechados.map(f => [f.pessoa_nome, f.saldo_centavos]), r.corpo.recusados.map(f => f.pessoa_nome)], [200, [['Bia', 1250]], ['Leo']], 'Leo com erro não trava a Bia');
r = await json(await R.fechar.POST(pedir('POST', '/x', { ate: '2026-11-30', participantes: ['fn-vendedor:u-bia'] })));
eq([r.corpo.fechados.length, r.corpo.recusados[0].motivo], [0, 'Nada a fechar até esta data.'], 'fechar de novo: nada a mais');
r = await json(await R.fechar.POST(pedir('POST', '/x', { ate: '2026-11-30', participantes: ['fn-vendedor:u-bia'], assinatura })));
eq([r.status, r.corpo.codigo], [409, 'MUDOU'], 'prévia velha: pede para conferir de novo');

console.log('--- (d) Pagar parcial e total ---');
r = await json(await R.pagar.POST(pedir('POST', '/x', { modo: 'PARCIAL', pessoas: ['u-bia', 'u-leo'], valor_centavos: 100 })));
eq(r.status, 400, 'parcial é de uma pessoa por vez');
r = await json(await R.pagar.POST(pedir('POST', '/x', { modo: 'PARCIAL', pessoas: ['u-bia'], valor_centavos: 99999 })));
eq(r.status, 400, 'parcial acima do aberto é recusado');
r = await json(await R.pagar.POST(pedir('POST', '/x', { modo: 'PARCIAL', pessoas: ['u-bia'], valor_centavos: 1000 })));
const pg1 = r.corpo.pagos[0];
eq([r.status, pg1.valor_centavos, pg1.conta_tabela, pg1.vencimento], [200, 1000, 'contas_pagar', '2026-11-20'], 'parcial: R$ 10 em conta a pagar, no dia da agenda');
const cp1 = (await todos(`SELECT data FROM contas_pagar WHERE id = $1`, [pg1.conta_id]))[0].data;
eq([cp1.valor_final, cp1.categoria_id, cp1.is_custo_comercial, cp1.comissao_detalhe.length, cp1.observacoes.includes('Hotel Mar')], [10, 'cat-26', true, 2, true], 'conta da pessoa com o detalhe das vendas');
r = await json(await R.aPagar.GET());
eq(r.corpo.pessoas.map(p => [p.pessoa_nome, p.aberto_centavos]), [['Bia', 250]], 'resta R$ 2,50 em aberto');

console.log('--- (e) Estorno automático ---');
await baixa('b3', contasA[0].id, '2026-12-01', 52500, 'estorno');
await query(`UPDATE vendas_crm SET data = jsonb_set(data, '{status}', '"CANCELADO"'), status = 'CANCELADO' WHERE id = $1`, [vB]);
r = await json(await R.previa.GET(pedir('GET', '/x?ate=2026-12-05')));
eq(linha('Bia').itens.map(i => [i.valor_centavos, i.estorno]), [[-750, true], [-500, true]], 'recebimento estornado e venda cancelada entram negativos');
r = await json(await R.fechar.POST(pedir('POST', '/x', { ate: '2026-12-05', participantes: ['fn-vendedor:u-bia'] })));
eq(r.corpo.fechados.map(f => f.saldo_centavos), [-1250], 'fechamento com o estorno');
r = await json(await R.aPagar.GET());
eq(r.corpo.pessoas.map(p => p.aberto_centavos), [-1000], 'Bia recebeu R$ 10 e passou a dever R$ 10');
r = await json(await R.pagar.POST(pedir('POST', '/x', { modo: 'TOTAL', pessoas: ['u-bia'] })));
eq([r.corpo.pagos[0].valor_centavos, r.corpo.pagos[0].conta_tabela], [-1000, 'contas_receber'], 'pagar total com saldo negativo vira conta a receber da pessoa');
r = await json(await R.aPagar.GET());
eq(r.corpo.pessoas.length, 0, 'nada mais em aberto');
r = await json(await R.recalcular.POST());
eq([r.status, r.corpo.regra, r.corpo.pessoas_com_erro], [200, 'FUNCOES', 1], 'cálculo do dia grava (Leo segue com erro)');
const antiga = (await todos(`SELECT data FROM comissoes WHERE id = 'comissao-antiga'`))[0].data;
eq([antiga.valor_comissao, antiga.status], [123.45, 'APROVADA'], 'a comissão da regra de hoje não foi tocada');

console.log('--- (f) Direitos ---');
como(sessao('VENDEDOR', 'u-bia'));
r = await json(await R.painel.GET(pedir('GET', '/x?mes=2026-11')));
eq([r.status, r.corpo.resumos.map(x => [x.funcao_nome, x.percentual, x.falta_para_proxima_centavos])], [200, [['Vendedor', 50, 15000]]], 'painel da Bia: 50% da meta, faltam R$ 150 para a próxima faixa');
eq(r.corpo.itens.some(i => i.por_que.some(f => f.startsWith('Base: Receita da agência'))), true, '"por que recebi isto?" no painel');
r = await json(await R.painel.GET(pedir('GET', '/x?mes=2026-11&pessoa_id=u-leo')));
eq(r.status, 403, 'vendedor não vê o painel de outra pessoa');
r = await json(await R.previa.GET(pedir('GET', '/x?ate=2026-12-05')));
eq([r.status, r.corpo.so_as_suas, r.corpo.linhas.every(l => l.pessoa_id === 'u-bia')], [200, true, true], 'vendedor vê só as próprias na prévia');
r = await json(await R.fechar.POST(pedir('POST', '/x', { ate: '2026-12-05', participantes: ['fn-vendedor:u-bia'] })));
eq(r.status, 403, 'vendedor não fecha comissões');
r = await json(await R.pagar.POST(pedir('POST', '/x', { modo: 'TOTAL', pessoas: ['u-bia'] })));
eq(r.status, 403, 'vendedor não paga comissões');
r = await json(await R.cadastro.GET());
eq(r.status, 403, 'vendedor não abre o cadastro de planos');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=vendedor')));
eq(r.status, 403, 'vendedor não abre os relatórios');

console.log('--- (g) Relatórios batem com as vendas ---');
como(ADMIN);
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=vendedor&de=2026-11-01&ate=2026-11-30')));
eq(r.corpo.linhas.map(l => [l.grupo, l.vendas, l.faturamento, l.receita]), [['Leo', 2, 135000, 25000], ['Bia', 1, 105000, 15000]], 'por vendedor (a venda cancelada sai)');
// A venda de antes (só com a lista de produtos) entra pelo valor do cabeçalho: R$ 800, R$ 200 de margem.
let fat = 80000, rec = 20000;
for (const id of [vA, vC]) {
  const c = await carregarVenda(pool, T, id);
  fat += totaisDaVenda(c.venda).valor_cliente;
  rec += receitaDaVenda(c.venda).receita;
}
eq([r.corpo.totais.faturamento, r.corpo.totais.receita], [fat, rec], 'totais = soma das fichas das vendas (e o cabeçalho da venda de antes)');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=produto&colunas=venda_numero,tipo,comp_COMISSAO,comp_FEE,receita,faturamento')));
eq(r.corpo.colunas.map(c => c.id), ['venda_numero', 'tipo', 'comp_COMISSAO', 'comp_FEE', 'faturamento', 'receita'], 'colunas escolhidas, na ordem do catálogo');
const hotel = r.corpo.linhas.find(l => l.venda_id === vA);
eq([hotel.comp_COMISSAO, hotel.comp_FEE, hotel.receita], [10000, 5000, 15000], 'receita aberta por componente, com o id da venda para abrir');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=forma')));
eq(r.corpo.linhas.map(l => [l.forma, l.valor]), [['BOLETO', 105000], ['CARTAO', 80000], ['PIX', 55000]], 'por forma de pagamento (v1 pela forma do cabeçalho)');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=clientes')));
eq(r.corpo.linhas.map(l => [l.posicao, l.grupo]), [[1, 'Carla'], [2, 'Eva'], [3, 'Davi']], 'ranking de clientes por faturamento');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=unidade')));
eq(r.corpo.linhas.map(l => l.grupo).sort(), ['Filial Sul', 'Sem unidade'], 'por unidade');
const csv = await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=vendedor&formato=csv'));
const texto = await csv.text();
eq([csv.headers.get('content-type'), texto.split('\r\n')[0].replace('﻿', '').split(';').slice(0, 3), texto.includes('Total;')], ['text/csv; charset=utf-8', ['Vendedor', 'Vendas', 'Produtos'], true], 'CSV com cabeçalho e total');
const xl = await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=vendedor&formato=xlsx'));
const wb = XLSX.read(new Uint8Array(await xl.arrayBuffer()), { type: 'array' });
const folha = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
// E7: o arquivo abre com o título e os filtros; o cabeçalho vem depois.
const cab = folha.findIndex(l => l[0] === 'Vendedor');
eq([folha[0][0], cab > 0, folha[cab + 1][0], typeof folha[cab + 1][folha[cab].indexOf('Faturamento')]], ['Vendas por vendedor', true, 'Leo', 'number'], 'XLSX com título, filtros e números de verdade');
const pdf = await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=vendedor&formato=pdf&de=2026-11-01&ate=2026-11-30'));
eq([pdf.status, pdf.headers.get('content-type'), /vendas-por-vendedor-data-da-venda|vendas-por-vendedor-2026-11-01-a-2026-11-30/.test(pdf.headers.get('content-disposition') ?? '')], [200, 'application/pdf', true], 'PDF com o período no nome do arquivo');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=pagamentos&de=2026-11-01&ate=2026-11-30')));
eq([r.status, r.corpo.linhas.length > 0, r.corpo.linhas.every(l => ['Liquidado', 'Parcial', 'Em aberto', 'Compensado'].includes(l.situacao_pagamento))], [200, true, true], 'pagamentos das vendas, um por linha, com a situação');
const boleto = r.corpo.linhas.find(l => l.venda_id === vA);
eq([boleto?.grupo, boleto?.valor, boleto?.situacao_pagamento], ['Boleto', 105000, 'Em aberto'], 'boleto ainda não recebido');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=pagamentos&so_liquidados=1&de=2026-11-01&ate=2026-11-30')));
eq(r.corpo.linhas.some(l => l.venda_id === vA), false, 'só liquidados tira o boleto em aberto');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=produto&vendedor=id:u-bia')));
eq([...new Set(r.corpo.linhas.map(l => l.vendedor))], ['Bia'], 'filtro por vendedor');
eq(r.corpo.opcoes.vendedores.some(o => o.valor === 'id:u-leo'), true, 'as opções do filtro continuam com a equipe toda');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=produto&fornecedor=id:f1')));
eq([...new Set(r.corpo.linhas.map(l => l.fornecedor))], ['Hotel Mar'], 'filtro por fornecedor');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=clientes&ordem=receita')));
eq([r.corpo.ordem, r.corpo.linhas.every((l, i, a) => i === 0 || Number(a[i - 1].receita) >= Number(l.receita))], ['receita', true], 'ranking pela receita');

await salvarRestricaoDeUsuario(pool, T, { usuario_id: 'u-ope', acoes_negadas: ['ver_colunas_comissao', 'exportar'] });
invalidarPermissoes(T);
como(sessao('OPERADOR', 'u-ope'));
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=produto&colunas=receita,comp_COMISSAO,faturamento')));
eq([r.status, r.corpo.ver_receita, r.corpo.colunas.map(c => c.id), r.corpo.linhas.some(l => 'receita' in l || 'comp_COMISSAO' in l)], [200, false, ['faturamento'], false], 'sem o direito: nem a coluna nem o número da receita');
r = await json(await R.relatorio.GET(pedir('GET', '/api/relatorios/vendas?relatorio=produto&formato=csv')));
eq(r.status, 403, 'sem o direito de exportar: não baixa');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
