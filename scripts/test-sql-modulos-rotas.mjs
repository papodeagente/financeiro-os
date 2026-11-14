/**
 * Rotas da versão completa por agência (14/11/2026), chamando os handlers de
 * verdade contra PGlite, SEM atalho de teste para a versão (as agências e a
 * liberação geral estão no banco, como em produção).
 *
 * O que se prova:
 *   (a) agência simples: rota de módulo responde 404 (como se não existisse);
 *       com o módulo, a mesma rota responde; sem sessão, o 401 de sempre;
 *   (b) dependência: cobrança sem o núcleo não vale;
 *   (c) Super Admin entrando como a agência vê o que a agência vê;
 *   (d) liberar para todas liga na simples; exceção da agência desliga só nela;
 *   (e) portal do cliente (público): o link de agência sem o módulo responde
 *       igual a um link que não existe; com o módulo, abre.
 *
 * Uso: node --no-warnings scripts/test-sql-modulos-rotas.mjs
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
  CREATE TABLE tenants (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE saas_config (key TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE clientes (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id));
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, usuario_id TEXT, acao TEXT, modulo TEXT, entidade TEXT, entidade_id TEXT,
    data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
  INSERT INTO tenants (id, data) VALUES
    ('agS', '{"nome":"Agência Simples"}'),
    ('agN', '{"nome":"Só o núcleo","modulos":{"nucleo":true}}'),
    ('agC', '{"nome":"Núcleo e cobrança","modulos":{"nucleo":true,"cobranca":true}}'),
    ('agD', '{"nome":"Cobrança sem núcleo","modulos":{"cobranca":true}}'),
    ('agX', '{"nome":"Completa","fin_versao":"completa"}');
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
process.env.JWT_SECRET = 'segredo-de-teste-modulos';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { ESQUEMA_ASSUMIDO_DO_PORTAL, criarLink } = await import('../src/lib/cobranca/portal-servidor.ts');
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(ESQUEMA_ASSUMIDO_DO_PORTAL);

const P = await import('../src/lib/permissoes-servidor.ts');
const { esquecerModulos } = await import('../src/lib/modulos-servidor.ts');
const { limparLimitePublicoParaTeste } = await import('../src/lib/limite-publico.ts');
const RLista = await import('../src/app/api/contas-pagar-receber/route.ts');
const RMinhas = await import('../src/app/api/permissoes/minhas/route.ts');
const RLinks = await import('../src/app/api/portal-links/route.ts');
const RPortal = await import('../src/app/api/portal/[token]/route.ts');

const AGENCIAS = ['agS', 'agN', 'agC', 'agD', 'agX'];
for (const t of AGENCIAS) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [`u-${t}`, t, JSON.stringify({ id: `u-${t}`, nome: `Admin ${t}`, perfil: 'ADMIN', ativo: true })]);
  await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ($1, $2, '{"nome_fantasia":"Agência"}')`, [`a-${t}`, t]);
  await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, data) VALUES ('cli-1', $1, 'Ana', '12345678909', '{"nome":"Ana"}')`, [t]);
  await query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ($1, $2, 'cli-1', 'PENDENTE', $3)`,
    [`cr-${t}`, t, JSON.stringify({ cliente_id: 'cli-1', cliente_nome: 'Ana', descricao: 'Pacote', valor_final: 100, data_vencimento: '2026-12-01', status: 'PENDENTE' })]);
}
const sessao = t => ({ userId: `u-${t}`, nome: `Admin ${t}`, email: 'a@x.com', perfil: 'ADMIN', permissoes: {}, tenantId: t, tenantSlug: t });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo, ip = '10.0.0.9') => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json', 'x-real-ip': ip },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const lista = async () => RLista.GET(req('/api/contas-pagar-receber?por_pagina=50'));
const status = async (t, fn) => { como(t ? sessao(t) : null); return (await fn()).status; };

console.log('--- (a) a rota do módulo some para a agência sem ele ---');
let r = await (como(sessao('agS')), lista());
eq([r.status, (await r.json()).error], [404, 'Recurso indisponível para esta conta.'], 'simples: Contas a Pagar/Receber (núcleo) responde 404');
eq(await status('agS', () => RMinhas.GET()), 404, 'simples: as permissões da tela completa também 404');
eq(await status('agN', lista), 200, 'com o núcleo: a lista responde');
eq(await status('agX', lista), 200, 'versão completa: a lista responde');
eq(await status(null, lista), 401, 'sem sessão: o 401 de sempre (a guarda não muda isso)');
eq(await status('agN', () => RLinks.GET(req('/api/portal-links?cliente_id=cli-1'))), 404, 'núcleo sem cobrança: link do portal 404');
eq(await status('agC', () => RLinks.GET(req('/api/portal-links?cliente_id=cli-1'))), 200, 'núcleo + cobrança: link do portal responde');

console.log('--- (b) dependência ---');
eq(await status('agD', () => RLinks.GET(req('/api/portal-links?cliente_id=cli-1'))), 404, 'cobrança sem o núcleo não vale');
eq(await status('agD', lista), 404, 'e o núcleo não veio junto');

console.log('--- (c) Super Admin entrando como a agência ---');
const SA = (alvo) => ({ userId: 'sa-1', nome: 'Bruno', email: 'b@entur.com.br', perfil: 'SUPER_ADMIN', permissoes: {}, tenantId: '__platform__', tenantSlug: '__platform__',
  isSuperAdmin: true, plataforma: 'SUPER_ADMIN', impersonatingTenantId: alvo, impersonatingTenantSlug: alvo });
como(SA('agS'));
eq((await lista()).status, 404, 'como a simples: 404, igual à agência');
como(SA('agX'));
eq((await lista()).status, 200, 'como a completa: responde');

console.log('--- (d) liberar para todas e exceção da agência ---');
await query(`INSERT INTO saas_config (key, data) VALUES ('modulos_liberados', '{"modulos":["nucleo"]}')`);
eq(await status('agS', lista), 404, 'cache de 30 s: sem esvaziar, segue como estava');
esquecerModulos();
eq(await status('agS', lista), 200, 'núcleo liberado para todas: a simples passa a ter');
await query(`UPDATE tenants SET data = data || '{"modulos":{"nucleo":false}}' WHERE id = 'agS'`);
esquecerModulos('agS');
eq(await status('agS', lista), 404, 'a exceção da agência (desligado) vence a liberação geral');
await query(`DELETE FROM saas_config`);
await query(`UPDATE tenants SET data = '{"nome":"Agência Simples"}' WHERE id = 'agS'`);
esquecerModulos();

console.log('--- (e) portal do cliente: vale o módulo da agência dona do link ---');
const tokenDe = async t => (await criarLink(pool, t, 'cli-1', null)).caminho.split('/c/')[1];
const tS = await tokenDe('agS');
const tC = await tokenDe('agC');
const portal = async (token, ip) => {
  limparLimitePublicoParaTeste?.();
  const res = await RPortal.GET(req(`/api/portal/${token}`, 'GET', undefined, ip), { params: Promise.resolve({ token }) });
  return { status: res.status, corpo: await res.json() };
};
como(null);
const inexistente = await portal('x'.repeat(tS.length), '10.0.1.1');
const daSimples = await portal(tS, '10.0.1.2');
eq([daSimples.status, daSimples.corpo], [inexistente.status, inexistente.corpo], 'link da agência simples: a mesma resposta de um link que não existe');
eq(daSimples.status, 404, '...que é 404');
const daCobranca = await portal(tC, '10.0.1.3');
eq([daCobranca.status, daCobranca.corpo.cliente?.primeiro_nome, daCobranca.corpo.em_aberto?.length], [200, 'Ana', 1], 'link da agência com cobrança: abre');
como(sessao('agS'));
const comSessaoDeOutra = await portal(tC, '10.0.1.4');
eq(comSessaoDeOutra.status, 200, 'quem abre o link (mesmo logado numa agência simples) não importa: vale a agência dona');
await query(`UPDATE tenants SET data = data || '{"modulos":{"nucleo":true,"cobranca":false}}' WHERE id = 'agC'`);
esquecerModulos('agC');
eq((await portal(tC, '10.0.1.5')).status, 404, 'cobrança desligada na agência: o link dela para de abrir');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
