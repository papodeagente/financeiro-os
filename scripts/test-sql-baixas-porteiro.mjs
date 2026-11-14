/**
 * Porteiro da liquidação (05/11/2026) contra um Postgres real (PGlite),
 * chamando a ROTA /api/baixas de produção com sessões de teste.
 *
 * Prova:
 *  1. Sem perfis, alçadas nem limites (o padrão), quem liquidava continua
 *     liquidando igual.
 *  2. Direito de dar baixa e conta bancária liberada valem na liquidação,
 *     no estorno e na baixa pela edição direta da conta.
 *  3. Alçada: pagamento acima do limite é recusado com o caminho para pedir.
 *  4. Limites: desconto acima do limite vira pedido; aprovado, a baixa é
 *     gravada sozinha, uma vez, com quem pediu e quem aprovou.
 *
 * Uso: node --no-warnings scripts/test-sql-baixas-porteiro.mjs
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
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-porteiro';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);

await import('../src/lib/aprovacoes-executores.ts');
const AP = await import('../src/lib/aprovacoes-servidor.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const RB = await import('../src/app/api/baixas/route.ts');
const RE = await import('../src/app/api/baixas/[id]/estorno/route.ts');
const ICP = await import('../src/app/api/contas-pagar/[id]/route.ts');
const RBL = await import('../src/app/api/limites-e-aprovacao/route.ts');

const T = 'ag-1';
const sessao = (perfil, userId = `u-${perfil}`) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const admin = sessao('ADMIN');
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(T); };
let chaveN = 0;
const req = (url, metodo = 'GET', corpo, chave) => new Request(`http://localhost${url}`, {
  method: metodo,
  headers: { 'content-type': 'application/json', ...(chave !== false ? { 'idempotency-key': chave ?? `k${++chaveN}` } : {}) },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];
const titulo = async (tab, id) => (await um(`SELECT data FROM ${tab} WHERE id = $1`, [id])).data;
const liquidar = (itens, extra = {}, chave) => RB.POST(req('/api/baixas', 'POST', { modo: 'gravar', itens, ...extra }, chave)).then(json);

for (const [id, perfil] of [['u-ADMIN', 'ADMIN'], ['u-OPERADOR', 'OPERADOR'], ['u-op2', 'OPERADOR']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, T, JSON.stringify({ id, nome: `Nome ${id}`, perfil, ativo: true })]);
}
for (const b of ['b1', 'b2']) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, $3)`, [b, T, JSON.stringify({ id: b, nome: `Conta ${b}`, saldo_inicial: 0, saldo_atual: 0 })]);
}
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));
const cr = (id, data) => query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1,$2,'PENDENTE',$3)`,
  [id, T, JSON.stringify({ id, cliente_nome: 'Cliente', descricao: `Conta ${id}`, data_vencimento: '2026-10-01', status: 'PENDENTE', ...data })]);
const cp = (id, data) => query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1,$2,'PENDENTE',$3)`,
  [id, T, JSON.stringify({ id, fornecedor_nome: 'Operadora', descricao: `Conta ${id}`, data_vencimento: '2026-10-01', status: 'PENDENTE', ...data })]);
const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

console.log('--- 1. Sem perfis, alçadas nem limites: igual a antes ---');
como(sessao('OPERADOR'));
await cr('r1', { valor_final: 1000 });
let r = await liquidar([{ titulo_tabela: 'contas_receber', titulo_id: 'r1', data: hoje, conta_bancaria_id: 'b1', valor: 400 }]);
eq([r.status, (await titulo('contas_receber', 'r1')).status], [200, 'PARCIAL'], 'operador liquida como hoje');
r = await json(await RB.POST(req('/api/baixas', 'POST', { modo: 'previa', itens: [{ titulo_tabela: 'contas_receber', titulo_id: 'r1', data: hoje, valor: 600 }] })));
eq([r.status, r.corpo.porteiro], [200, { ok: true }], 'prévia diz que não precisa de aprovação');

console.log('--- 2. Direitos e conta liberada ---');
como(admin);
r = await json(await (await import('../src/app/api/perfis-de-acesso/route.ts')).POST(req('/api/perfis-de-acesso', 'POST',
  { restricao: { usuario_id: 'u-op2', contas_liberadas: ['b2'], acoes_negadas: ['liquidar_pagar', 'estornar_baixa'] } }, false)));
eq(r.status, 200, 'admin restringe o operador 2 (só conta b2, sem pagar, sem estornar)');
como(sessao('OPERADOR', 'u-op2'));
await cp('p1', { valor_final: 300 });
r = await liquidar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p1', data: hoje, conta_bancaria_id: 'b2', valor: 300 }]);
eq([r.status, r.corpo.error], [403, 'Seu acesso não inclui dar baixa em contas a pagar.'], 'sem o direito, não paga');
await cr('r2', { valor_final: 200 });
r = await liquidar([{ titulo_tabela: 'contas_receber', titulo_id: 'r2', data: hoje, conta_bancaria_id: 'b1', valor: 200 }]);
eq([r.status, r.corpo.error], [403, 'Esta conta bancária não está liberada para você.'], 'conta não liberada: recusa');
eq((await titulo('contas_receber', 'r2')).status, 'PENDENTE', 'nada foi gravado');
r = await liquidar([{ titulo_tabela: 'contas_receber', titulo_id: 'r2', data: hoje, conta_bancaria_id: 'b2', valor: 200 }]);
eq([r.status, (await titulo('contas_receber', 'r2')).status], [200, 'RECEBIDO'], 'na conta liberada, recebe');
const baixaR2 = r.corpo.itens[0].baixa_id;
r = await json(await RE.POST(req(`/api/baixas/${baixaR2}/estorno`, 'POST', { motivo: 'lançado errado' }), { params: Promise.resolve({ id: baixaR2 }) }));
eq(r.status, 403, 'sem o direito de estornar, não estorna');
como(sessao('OPERADOR'));
const baixaR1 = (await um(`SELECT id FROM baixas WHERE tenant_id = $1 AND titulo_id = 'r1' AND tipo = 'baixa'`, [T])).id;
como(sessao('OPERADOR', 'u-op2'));
r = await json(await RE.POST(req(`/api/baixas/${baixaR1}/estorno`, 'POST', { motivo: 'teste' }), { params: Promise.resolve({ id: baixaR1 }) }));
eq(r.status, 403, 'estorno de baixa em conta não liberada é recusado');
await cp('p2', { valor_final: 50 });
r = await json(await ICP.PUT(req('/api/contas-pagar/p2', 'PUT', { ...(await titulo('contas_pagar', 'p2')), status: 'PAGO', valor_pago: 50, conta_bancaria_id: 'b2' }, false), { params: Promise.resolve({ id: 'p2' }) }));
eq([r.status, (await titulo('contas_pagar', 'p2')).status], [403, 'PENDENTE'], 'marcar como pago pela edição também respeita o direito');

console.log('--- 3. Alçada de pagamento ---');
como(admin);
r = await json(await RBL.PUT(req('/api/limites-e-aprovacao', 'PUT', {
  bloqueios: {}, alcadas: [{ nome: 'Acima de mil', valor_min_centavos: 100000, aprovadores: [], niveis: 1 }],
}, false)));
eq(r.status, 200, 'admin cria a alçada acima de R$ 1.000');
como(sessao('OPERADOR'));
await cp('p3', { valor_final: 1500 });
r = await liquidar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p3', data: hoje, conta_bancaria_id: 'b1', valor: 1500 }]);
eq([r.status, r.corpo.pedir_aprovacao?.tipo, r.corpo.pedir_aprovacao?.conta_pagar_id], [409, 'pagamento', 'p3'], 'acima da alçada: recusa e diz como pedir');
const pd = await AP.pedirAprovacaoDoPagamento({ tenantId: T, contaPagarId: 'p3', solicitante: { id: 'u-OPERADOR', nome: 'Op' } });
await AP.decidirPedido({ id: pd.pedido.id, decisao: 'aprovar', sessao: admin });
r = await liquidar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p3', data: hoje, conta_bancaria_id: 'b1', valor: 1500 }]);
eq([r.status, (await titulo('contas_pagar', 'p3')).status], [200, 'PAGO'], 'aprovado: paga');
como(admin);
await RBL.PUT(req('/api/limites-e-aprovacao', 'PUT', { bloqueios: {}, alcadas: [] }, false));

console.log('--- 4. Limites: desconto vira pedido e a aprovação grava a baixa ---');
como(admin);
r = await json(await RBL.PUT(req('/api/limites-e-aprovacao', 'PUT', { bloqueios: { desconto_max_reais: 50 }, alcadas: [] }, false)));
eq(r.status, 200, 'admin limita o desconto em R$ 50');
como(sessao('OPERADOR'));
await cr('r3', { valor_final: 1000 });
const item = { titulo_tabela: 'contas_receber', titulo_id: 'r3', data: hoje, conta_bancaria_id: 'b1', valor: 900, tratamento_diferenca: 'desconto',
  esperado: { status_depois: 'RECEBIDO', valor_baixado_depois: 900 } };
r = await liquidar([item]);
eq([r.status, r.corpo.pedir_aprovacao?.tipo, /Desconto de R\$\s100,00 acima do limite de R\$\s50,00/.test(r.corpo.error)], [409, 'limites', true], 'desconto de R$ 100 com limite de R$ 50: recusa explicando');
r = await json(await RB.POST(req('/api/baixas', 'POST', { modo: 'previa', itens: [item] })));
eq([r.corpo.porteiro.ok, r.corpo.porteiro.pedir_aprovacao?.tipo], [false, 'limites'], 'a prévia já avisa');
r = await liquidar([item], { pedir_aprovacao: true, motivo: 'cliente antigo' }, 'pedido-r3');
eq([r.status, r.corpo.aguardando_aprovacao], [202, true], 'pedir aprovação abre o pedido');
eq((await titulo('contas_receber', 'r3')).status, 'PENDENTE', 'a conta continua em aberto até aprovar');
const r2x = await liquidar([item], { pedir_aprovacao: true }, 'pedido-r3');
eq([r2x.status, r2x.corpo.pedido_id, r2x.corpo.ja_existia], [202, r.corpo.pedido_id, true], 'pedir de novo devolve o mesmo pedido');
let pedido = await AP.lerPedido(pool, T, r.corpo.pedido_id);
eq([pedido.tipo, pedido.descricao.startsWith('Receber R$'), pedido.motivo], ['baixa', true, 'cliente antigo'], 'pedido com descrição e motivo');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM notificacoes WHERE tipo = 'APROVACAO_PEDIDA'`)).n) >= 1, true, 'aviso no sino');
let erroDec = null;
try { await AP.decidirPedido({ id: pedido.id, decisao: 'aprovar', sessao: sessao('OPERADOR') }); } catch (e) { erroDec = e.status; }
eq(erroDec, 403, 'quem pediu não aprova');
const dec = await AP.decidirPedido({ id: pedido.id, decisao: 'aprovar', sessao: admin });
eq(dec.status, 'EXECUTADO', 'admin aprova e a baixa é executada');
const d3 = await titulo('contas_receber', 'r3');
eq([d3.status, d3.valor_recebido, d3.desconto], ['RECEBIDO', 900, 100], 'conta quitada com o desconto pedido');
const bx = (await query(`SELECT usuario_nome FROM baixas WHERE tenant_id = $1 AND titulo_id = 'r3' AND tipo = 'baixa'`, [T])).rows;
eq([bx.length, bx[0]?.usuario_nome], [1, 'Pessoa u-OPERADOR (aprovado por Pessoa u-ADMIN)'], 'uma baixa só, com quem pediu e quem aprovou');

console.log('--- 5. Pedido cuja conta mudou não grava ---');
await cr('r4', { valor_final: 1000 });
const item4 = { ...item, titulo_id: 'r4' };
r = await liquidar([item4], { pedir_aprovacao: true }, 'pedido-r4');
eq(r.status, 202, 'pedido aberto');
como(admin);
await liquidar([{ titulo_tabela: 'contas_receber', titulo_id: 'r4', data: hoje, conta_bancaria_id: 'b1', valor: 100 }]);
const dec4 = await AP.decidirPedido({ id: r.corpo.pedido_id, decisao: 'aprovar', sessao: admin });
eq([dec4.status, (await titulo('contas_receber', 'r4')).valor_recebido], ['EXPIRADO', 100], 'a conta mudou: o pedido expira e nada novo é gravado');

console.log('--- 6. Quem aprova exceções liquida sem pedido ---');
await cr('r5', { valor_final: 1000 });
r = await liquidar([{ ...item, titulo_id: 'r5' }]);
eq([r.status, (await titulo('contas_receber', 'r5')).status], [200, 'RECEBIDO'], 'admin dá o desconto direto');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
