/**
 * Configurações › Financeiro das contas (06/11/2026, E7) contra um Postgres
 * real (PGlite), chamando as ROTAS de produção:
 *  1. CAMPOS PERSONALIZADOS: só administrador grava; ler é do financeiro;
 *     definições normalizadas; campo que some da lista vira desativado (nunca
 *     some); limite de 30 contando os desativados; cada agência a sua.
 *  2. CATEGORIAS DAS CONTAS GERADAS: grava e confere (existe, ativa, tipo
 *     certo); reembolso aprovado nasce com a categoria escolhida (a pagar ao
 *     cliente e a receber do fornecedor); sem escolha, nasce vazia como antes.
 *
 * Uso: node --no-warnings scripts/test-sql-config-titulos-e7.mjs
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
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
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
process.env.JWT_SECRET = 'segredo-de-teste-config-e7';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { REEMBOLSOS_SCHEMA_SQL } = await import('../src/lib/reembolsos-servidor.ts');
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(REEMBOLSOS_SCHEMA_SQL);
const P = await import('../src/lib/permissoes-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { criarReembolso, aprovarReembolso } = await import('../src/lib/reembolsos-servidor.ts');
const RCampos = await import('../src/app/api/config/financeiro/campos-personalizados/route.ts');
const RCats = await import('../src/app/api/config/financeiro/categorias-dos-titulos/route.ts');

const T = 'ag-1', T2 = 'ag-2';
const sessao = (perfil, tenant = T) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json() });
for (const [id, perfil, t] of [['u-ADMIN', 'ADMIN', T], ['u-OPERADOR', 'OPERADOR', T], ['u-ADMIN2', 'ADMIN', T2]]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, t, JSON.stringify({ id, nome: id, perfil, ativo: true })]);
}

console.log('--- 1. Campos personalizados ---');
const camposDe = async () => (await json(await RCampos.GET())).corpo.campos;
como(sessao('OPERADOR'));
eq((await json(await RCampos.GET())).status, 200, 'quem trabalha no financeiro lê os campos');
eq((await json(await RCampos.PUT(req('/x', 'PUT', { campos: [{ nome: 'Pedido' }] })))).status, 403, 'só administrador grava');
como(sessao('ADMIN'));
let r = await json(await RCampos.PUT(req('/x', 'PUT', { campos: [
  { nome: ' Pedido do cliente ', tipo: 'texto', aplica_a: 'receber', obrigatorio: true },
  { nome: 'Região', tipo: 'lista', opcoes: ['Sul', 'Norte'] },
] })));
eq([r.status, r.corpo.campos.map(c => [c.id, c.nome, c.tipo, c.aplica_a, c.ativo])],
  [200, [['pedido_do_cliente', 'Pedido do cliente', 'texto', 'receber', true], ['regiao', 'Região', 'lista', 'ambos', true]]], 'grava normalizado, com id estável');
r = await json(await RCampos.PUT(req('/x', 'PUT', { campos: [{ id: 'pedido_do_cliente', nome: 'Nº do pedido', tipo: 'texto', aplica_a: 'receber' }] })));
eq(r.corpo.campos.map(c => [c.id, c.nome, c.ativo]), [['pedido_do_cliente', 'Nº do pedido', true], ['regiao', 'Região', false]],
  'renomear mantém o id; o campo que saiu da lista fica desativado');
eq((await json(await RCampos.PUT(req('/x', 'PUT', { campos: [{ nome: 'A' }, { nome: 'a' }] })))).status, 400, 'nome repetido recusado');
eq((await json(await RCampos.PUT(req('/x', 'PUT', { campos: [{ nome: 'L', tipo: 'lista', opcoes: [] }] })))).status, 400, 'lista sem opção recusada');
r = await json(await RCampos.PUT(req('/x', 'PUT', { campos: Array.from({ length: 29 }, (_, i) => ({ nome: `Campo ${i}` })) })));
eq([r.status, /contando os desativados/.test(r.corpo.error ?? '')], [400, true], 'limite de 30 conta os desativados (nada some)');
eq((await camposDe()).length, 2, 'a recusa não gravou nada');
como(sessao('ADMIN', T2));
eq(await camposDe(), [], 'outra agência não vê os campos desta');

console.log('--- 2. Categorias das contas geradas ---');
como(sessao('ADMIN'));
for (const [id, tipo, ativo] of [['cat-dev', 'DESPESA', true], ['cat-rec', 'RECEITA', true], ['cat-velha', 'DESPESA', false]]) {
  await query(`INSERT INTO plano_contas (id, tenant_id, tipo, data) VALUES ($1, $2, $3, $4)`, [id, T, tipo, JSON.stringify({ id, nome: `Nome ${id}`, tipo, ativo })]);
}
// Sem escolha: reembolso nasce sem categoria, como sempre.
let reemb = await emTransacao(e => criarReembolso(e, T, { tipo: 'CLIENTE', pessoa_id: 'c1', pessoa_nome: 'Ana', valor_centavos: 10000, descricao: 'Devolução' }, 'u'));
reemb = await emTransacao(e => aprovarReembolso(e, T, reemb.id, 'u'));
eq((await query(`SELECT data->>'categoria_id' AS c FROM contas_pagar WHERE id = $1`, [reemb.conta_id])).rows[0].c, '', 'sem escolha: conta nasce sem categoria');

eq((await json(await RCats.PUT(req('/x', 'PUT', { categorias: { reembolso_pagar: 'cat-rec' } })))).status, 400, 'categoria de receita numa conta a pagar: recusada');
eq((await json(await RCats.PUT(req('/x', 'PUT', { categorias: { reembolso_pagar: 'cat-velha' } })))).status, 400, 'categoria desativada: recusada');
eq((await json(await RCats.PUT(req('/x', 'PUT', { categorias: { reembolso_pagar: 'nao-existe' } })))).status, 400, 'categoria que não existe: recusada');
r = await json(await RCats.PUT(req('/x', 'PUT', { categorias: { reembolso_pagar: 'cat-dev', reembolso_receber: 'cat-rec', inventada: 'x' } })));
eq([r.status, r.corpo.categorias], [200, { reembolso_pagar: 'cat-dev', reembolso_receber: 'cat-rec' }], 'grava só as chaves conhecidas');
como(sessao('OPERADOR'));
eq((await json(await RCats.PUT(req('/x', 'PUT', { categorias: {} })))).status, 403, 'só administrador grava');
eq((await json(await RCats.GET())).corpo.categorias, { reembolso_pagar: 'cat-dev', reembolso_receber: 'cat-rec' }, 'quem trabalha no financeiro lê');

let r2 = await emTransacao(e => criarReembolso(e, T, { tipo: 'CLIENTE', pessoa_id: 'c1', pessoa_nome: 'Ana', valor_centavos: 5000, descricao: 'Devolução 2' }, 'u'));
r2 = await emTransacao(e => aprovarReembolso(e, T, r2.id, 'u'));
let r3 = await emTransacao(e => criarReembolso(e, T, { tipo: 'FORNECEDOR', pessoa_id: 'f1', pessoa_nome: 'Hotel', valor_centavos: 7000, descricao: 'Devolução do hotel' }, 'u'));
r3 = await emTransacao(e => aprovarReembolso(e, T, r3.id, 'u'));
eq([(await query(`SELECT data->>'categoria_id' AS c FROM contas_pagar WHERE id = $1`, [r2.conta_id])).rows[0].c,
  (await query(`SELECT data->>'categoria_id' AS c FROM contas_receber WHERE id = $1`, [r3.conta_id])).rows[0].c], ['cat-dev', 'cat-rec'],
  'reembolso aprovado nasce com a categoria escolhida (a pagar e a receber)');
eq((await query(`SELECT data->>'categoria_id' AS c FROM contas_pagar WHERE id = $1`, [reemb.conta_id])).rows[0].c, '', 'a conta antiga não mudou');

console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
