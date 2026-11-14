/**
 * Conta previsão padrão da agência (06/11/2026, E7) contra um Postgres real
 * (PGlite), chamando a ROTA de produção com sessões de teste.
 *
 * Prova: lê vazia; administrador grava uma conta ativa da agência; recusa
 * conta desativada, de outra agência e formato inválido; tirar a padrão
 * (null) volta a "nenhuma"; operador lê mas não grava; agências isoladas;
 * gravar não apaga as outras chaves da agência.
 *
 * Uso: node --no-warnings scripts/test-sql-conta-previsao.mjs
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
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-previsao';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
await pg.exec(PERMISSOES_SCHEMA_SQL);
const P = await import('../src/lib/permissoes-servidor.ts');
const R = await import('../src/app/api/config/financeiro/conta-previsao/route.ts');

const T = 'ag-1';
const T2 = 'ag-2';
const sessao = (perfil, tenant = T) => ({ userId: `u-${perfil}-${tenant}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (metodo, corpo) => new Request('http://localhost/api/config/financeiro/conta-previsao', {
  method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json() });
const ler = async () => json(await R.GET());
const gravar = async valor => json(await R.PUT(req('PUT', { conta_previsao_padrao: valor })));

for (const [id, t, data] of [
  ['inter', T, { id: 'inter', nome: 'Inter', saldo_atual: 0 }],
  ['velha', T, { id: 'velha', nome: 'Conta velha', ativo: false }],
  ['outra', T2, { id: 'outra', nome: 'Outra agência' }],
]) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ($1, $2, $3, $4)`, [id, t, data.nome, JSON.stringify(data)]);
}
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, $2)`, [T, JSON.stringify({ nome: 'Agência Um', politica_cobranca: { juros_am_pct: 1 } })]);

como(sessao('ADMIN'));
eq(await ler(), { status: 200, corpo: { conta_previsao_padrao: null } }, 'sem padrão: null');
eq(await gravar('inter'), { status: 200, corpo: { conta_previsao_padrao: 'inter' } }, 'administrador grava uma conta ativa');
eq((await ler()).corpo, { conta_previsao_padrao: 'inter' }, 'lê a gravada');
const ag = (await query(`SELECT data FROM agencia WHERE tenant_id = $1`, [T])).rows[0].data;
eq([ag.nome, ag.politica_cobranca], ['Agência Um', { juros_am_pct: 1 }], 'as outras chaves da agência ficam intactas');

const desativada = await gravar('velha');
eq([desativada.status, desativada.corpo.error], [400, 'Esta conta bancária está desativada. Escolha uma conta ativa.'], 'conta desativada é recusada');
const deOutra = await gravar('outra');
eq([deOutra.status, deOutra.corpo.error], [404, 'Esta conta bancária não existe nesta agência.'], 'conta de outra agência é recusada');
eq((await gravar(123)).status, 400, 'formato inválido é recusado');
eq((await ler()).corpo, { conta_previsao_padrao: 'inter' }, 'recusas não mudam a gravada');

como(sessao('OPERADOR'));
eq((await ler()).status, 200, 'operador lê');
eq((await gravar('inter')).status, 403, 'operador não grava');

como(sessao('ADMIN', T2));
eq((await ler()).corpo, { conta_previsao_padrao: null }, 'outra agência não vê a padrão desta');
eq(await gravar('outra'), { status: 200, corpo: { conta_previsao_padrao: 'outra' } }, 'outra agência sem cadastro de agência: cria a linha dela');

como(sessao('ADMIN'));
eq(await gravar(null), { status: 200, corpo: { conta_previsao_padrao: null } }, 'tirar a padrão');
eq((await ler()).corpo, { conta_previsao_padrao: null }, 'volta a nenhuma');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
