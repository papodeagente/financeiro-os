/** Integração isolada do backend real de notificações: SQL, escopo, leitura, preferências e rotas. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(import.meta.dirname, '..');
const database = new PGlite();
let generatedIds = 0;
let checks = 0;
const failures = [];

function carregarTS(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath);
  const source = readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  const loadedModule = { exports: {} };
  vm.runInNewContext(outputText, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(name) {
      if (!(name in mocks)) throw new Error(`Mock ausente para ${name} em ${relativePath}`);
      return mocks[name];
    },
    structuredClone,
    Request,
    Response,
    URL,
    console,
  }, { filename });
  return loadedModule.exports;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function testar(nome, fn) {
  try {
    await fn();
    checks += 1;
    console.log(`PASS ${nome}`);
  } catch (error) {
    failures.push({ nome, error });
    console.error(`FAIL ${nome}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const config = carregarTS('src/lib/notificacoes-config.ts');
const schema = carregarTS('src/lib/notificacoes-schema.ts');
const permissoes = carregarTS('src/lib/permissoes.ts');

await database.exec(`
  CREATE TABLE notificacoes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '',
    titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    vendedor_id TEXT NOT NULL DEFAULT '',
    lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE usuarios (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE propostas (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    vendedor_id TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE vendas_crm (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    vendedor_id TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb
  );
`);
await database.exec(schema.NOTIFICACOES_SCHEMA_SQL);
await database.exec(schema.NOTIFICACOES_SCHEMA_SQL);

async function executar(sql, params = []) {
  const result = await database.query(sql, params);
  const rows = result.rows || [];
  return {
    ...result,
    rows,
    rowCount: Number.isInteger(result.affectedRows) ? result.affectedRows : rows.length,
  };
}

const pool = {
  query: executar,
  async connect() {
    return { query: executar, release() {} };
  },
};

const backend = carregarTS('src/lib/notificacoes.ts', {
  './db': { __esModule: true, default: pool },
  './utils': { generateId: () => `generated-${++generatedIds}` },
  './permissoes': permissoes,
  './notificacoes-config': config,
});

function sessao(userId, tenantId, perfil = 'VENDEDOR') {
  return {
    userId,
    nome: userId,
    email: `${userId}@example.test`,
    perfil,
    permissoes: {},
    tenantId,
    tenantSlug: tenantId,
  };
}

function preferencias(overrides = {}) {
  return {
    tipos: Object.fromEntries(config.TIPOS_NOTIFICACAO.map(({ tipo }) => [tipo, true])),
    mostrar_contador: true,
    atualizacao_automatica: true,
    ...overrides,
  };
}

async function inserirNotificacao({
  id, tenantId, tipo = 'PROPOSTA_ACEITA', vendedorId = '', data = {}, lida = false,
  link = `/notificacoes/${id}`, createdAt = '2026-09-10T12:00:00.000Z', titulo = id,
}) {
  await executar(
    `INSERT INTO notificacoes
       (id, tenant_id, tipo, titulo, descricao, link, vendedor_id, lida, data, created_at)
     VALUES ($1, $2, $3, $4, '', $5, $6, $7, $8::jsonb, $9)`,
    [id, tenantId, tipo, titulo, link, vendedorId, lida, JSON.stringify(data), createdAt],
  );
}

async function consultar(session, options = {}) {
  return backend.consultarNotificacoes(session, {
    page: 1,
    limit: 50,
    apenasNaoLidas: false,
    ...options,
  });
}

function ids(result) {
  return Array.from(result.items, item => String(item.id));
}

await testar('schema é idempotente e cria coluna, índices e tabelas uma única vez', async () => {
  const columns = await executar(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'notificacoes' AND column_name = 'chave_deduplicacao'`,
  );
  assert.equal(columns.rows.length, 1);
  const indexes = await executar(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'notificacoes' AND indexname = 'idx_notificacoes_deduplicacao'`,
  );
  assert.equal(indexes.rows.length, 1);
  const tables = await executar(
    `SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('notificacoes_leituras', 'notificacoes_preferencias')`,
  );
  assert.deepEqual(Array.from(tables.rows, row => row.table_name).sort(), [
    'notificacoes_leituras', 'notificacoes_preferencias',
  ]);
});

await testar('criação deduplica por tenant/chave e não cruza tenants', async () => {
  const base = {
    tipo: 'PROPOSTA_ACEITA', titulo: 'Primeira', link: '/propostas/1',
    vendedorId: 'seller', data: { proposta_id: 'p-1' }, chaveDeduplicacao: ' evento-1 ',
  };
  await backend.criarNotificacao({ ...base, tenantId: 'dedupe-a' });
  await backend.criarNotificacao({ ...base, tenantId: 'dedupe-a', titulo: 'Duplicada', chaveDeduplicacao: 'evento-1' });
  await backend.criarNotificacao({ ...base, tenantId: 'dedupe-b', titulo: 'Outra tenant' });
  await backend.criarNotificacao({ ...base, tenantId: 'dedupe-a', titulo: 'Sem chave 1', chaveDeduplicacao: '' });
  await backend.criarNotificacao({ ...base, tenantId: 'dedupe-a', titulo: 'Sem chave 2', chaveDeduplicacao: undefined });
  await backend.criarNotificacao({ ...base, tenantId: 'dedupe-a', tipo: 'TIPO_INVALIDO', chaveDeduplicacao: 'inválida' });
  const a = await executar(`SELECT titulo FROM notificacoes WHERE tenant_id = 'dedupe-a' ORDER BY titulo`);
  const b = await executar(`SELECT titulo FROM notificacoes WHERE tenant_id = 'dedupe-b'`);
  assert.deepEqual(Array.from(a.rows, row => row.titulo), ['Primeira', 'Sem chave 1', 'Sem chave 2']);
  assert.deepEqual(Array.from(b.rows, row => row.titulo), ['Outra tenant']);
});

await testar('links persistidos e devolvidos são estritamente locais', async () => {
  const casos = [
    ['Local', '/propostas/segura?aba=1', '/propostas/segura?aba=1'],
    ['Externo', 'https://evil.example/phishing', ''],
    ['Protocol relative', '//evil.example/phishing', ''],
    ['Backslash', '/\\evil.example', ''],
    ['Controle', '/propostas/1\nSet-Cookie:x', ''],
  ];
  for (const [titulo, link] of casos) {
    await backend.criarNotificacao({
      tenantId: 'links-t', tipo: 'PROPOSTA_ACEITA', titulo, link,
      chaveDeduplicacao: `link-${titulo}`,
    });
  }
  for (const [titulo, , esperado] of casos) {
    const result = await executar(`SELECT link FROM notificacoes WHERE tenant_id = 'links-t' AND titulo = $1`, [titulo]);
    assert.equal(result.rows[0].link, esperado);
  }
  await inserirNotificacao({
    id: 'link-legado-malicioso', tenantId: 'links-t', link: 'https://evil.example/legado',
  });
  const result = await consultar(sessao('links-admin', 'links-t', 'ADMIN'));
  assert.equal(result.items.find(item => item.id === 'link-legado-malicioso').link, '');
});

await testar('preferências ausentes usam defaults e validação é estrita', async () => {
  const defaults = plain(await backend.carregarPreferencias(sessao('prefs-default', 'prefs-default-t', 'ADMIN')));
  assert.deepEqual(defaults, preferencias());
  const validas = preferencias({ mostrar_contador: false, atualizacao_automatica: false });
  assert.deepEqual(plain(config.validarPreferencias(validas)), validas);
  const invalidas = [
    null,
    [],
    {},
    { ...validas, extra: true },
    { ...validas, mostrar_contador: 'sim' },
    { ...validas, tipos: { ...validas.tipos, TIPO_DESCONHECIDO: true } },
    { ...validas, tipos: { ...validas.tipos, PROPOSTA_LEAD: 'sim' } },
    { ...validas, tipos: Object.fromEntries(Object.entries(validas.tipos).filter(([tipo]) => tipo !== 'PROPOSTA_LEAD')) },
  ];
  for (const invalida of invalidas) assert.equal(config.validarPreferencias(invalida), null);
});

const scopeTenant = 'scope-t';
const seller = sessao('seller-user', scopeTenant, 'VENDEDOR');
const admin = sessao('scope-admin', scopeTenant, 'ADMIN');
const operador = sessao('scope-operador', scopeTenant, 'OPERADOR');
await executar(
  `INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3::jsonb)`,
  [seller.userId, scopeTenant, JSON.stringify({ membro_id: 'member-now', membro_ids_legado: ['member-old'] })],
);
await executar(
  `INSERT INTO propostas (id, tenant_id, vendedor_id) VALUES
    ('prop-own', $1, 'member-now'), ('prop-other', $1, 'member-other')`,
  [scopeTenant],
);
await executar(
  `INSERT INTO vendas_crm (id, tenant_id, vendedor_id) VALUES
    ('sale-own', $1, 'member-old'), ('sale-other', $1, 'member-other')`,
  [scopeTenant],
);
await inserirNotificacao({ id: 'n-prop-own', tenantId: scopeTenant, vendedorId: 'member-other', data: { proposta_id: 'prop-own' } });
await inserirNotificacao({ id: 'n-prop-other', tenantId: scopeTenant, vendedorId: 'member-now', data: { proposta_id: 'prop-other' } });
await inserirNotificacao({ id: 'n-sale-own', tenantId: scopeTenant, vendedorId: 'member-other', data: { venda_id: 'sale-own' } });
await inserirNotificacao({ id: 'n-sale-other', tenantId: scopeTenant, vendedorId: 'member-old', data: { venda_id: 'sale-other' } });
await inserirNotificacao({ id: 'n-fallback-alias', tenantId: scopeTenant, vendedorId: 'member-old' });
await inserirNotificacao({ id: 'n-fallback-user', tenantId: scopeTenant, vendedorId: seller.userId });
await inserirNotificacao({ id: 'n-fallback-other', tenantId: scopeTenant, vendedorId: 'member-other' });
await inserirNotificacao({
  id: 'n-vendedor-desconhecido', tenantId: scopeTenant,
  tipo: 'VENDA_VENDEDOR_NAO_CADASTRADO', vendedorId: 'member-now',
});
await inserirNotificacao({ id: 'n-other-tenant', tenantId: 'scope-other-t', vendedorId: seller.userId });

await testar('admin e operador veem todos os alertas, somente no tenant da sessão', async () => {
  const esperados = [
    'n-fallback-alias', 'n-fallback-other', 'n-fallback-user', 'n-prop-other',
    'n-prop-own', 'n-sale-other', 'n-sale-own', 'n-vendedor-desconhecido',
  ];
  for (const session of [admin, operador]) {
    const result = await consultar(session);
    assert.deepEqual(ids(result).sort(), esperados);
    assert.ok(!ids(result).includes('n-other-tenant'));
  }
});

await testar('vendedor vê objetos próprios, id de usuário e aliases atual/legado', async () => {
  const result = await consultar(seller);
  assert.deepEqual(ids(result).sort(), [
    'n-fallback-alias', 'n-fallback-user', 'n-prop-own', 'n-sale-own',
  ]);
  assert.ok(!ids(result).includes('n-vendedor-desconhecido'));
  assert.ok(!ids(result).includes('n-other-tenant'));
});

await testar('reatribuição atual remove imediatamente o acesso do vendedor antigo', async () => {
  await executar(`UPDATE propostas SET vendedor_id = 'member-other' WHERE id = 'prop-own'`);
  await executar(`UPDATE vendas_crm SET vendedor_id = 'member-other' WHERE id = 'sale-own'`);
  const result = await consultar(seller);
  assert.deepEqual(ids(result).sort(), ['n-fallback-alias', 'n-fallback-user']);
  await executar(`UPDATE propostas SET vendedor_id = 'member-now' WHERE id = 'prop-own'`);
  await executar(`UPDATE vendas_crm SET vendedor_id = 'member-old' WHERE id = 'sale-own'`);
});

await testar('leitura individual é isolada, reversível e respeita visibilidade', async () => {
  assert.equal(await backend.marcarComoLida(seller, 'n-prop-own', true), true);
  let sellerResult = await consultar(seller);
  let adminResult = await consultar(admin);
  assert.equal(sellerResult.items.find(item => item.id === 'n-prop-own').lida, true);
  assert.equal(adminResult.items.find(item => item.id === 'n-prop-own').lida, false);
  assert.equal(await backend.marcarComoLida(seller, 'n-prop-own', false), true);
  sellerResult = await consultar(seller);
  assert.equal(sellerResult.items.find(item => item.id === 'n-prop-own').lida, false);
  assert.equal(await backend.marcarComoLida(seller, 'n-prop-other', true), false);
  assert.equal(await backend.marcarComoLida(sessao('outsider', 'scope-other-t'), 'n-prop-own', true), false);
  const reads = await executar(
    `SELECT usuario_id, lida FROM notificacoes_leituras WHERE notificacao_id = 'n-prop-own'`,
  );
  assert.deepEqual(plain(reads.rows), [{ usuario_id: seller.userId, lida: false }]);
});

await testar('estado legado global pode ser desmarcado por um usuário sem afetar outro', async () => {
  await inserirNotificacao({
    id: 'n-legado-lido', tenantId: scopeTenant, vendedorId: 'member-now', lida: true,
  });
  assert.equal((await consultar(seller)).items.find(item => item.id === 'n-legado-lido').lida, true);
  assert.equal(await backend.marcarComoLida(seller, 'n-legado-lido', false), true);
  assert.equal((await consultar(seller)).items.find(item => item.id === 'n-legado-lido').lida, false);
  assert.equal((await consultar(admin)).items.find(item => item.id === 'n-legado-lido').lida, true);
});

const prefsTenant = 'prefs-flow-t';
const prefsAdmin = sessao('prefs-admin', prefsTenant, 'ADMIN');
const prefsOperador = sessao('prefs-operador', prefsTenant, 'OPERADOR');
for (const [id, tipo] of [
  ['pf-aceite', 'PROPOSTA_ACEITA'],
  ['pf-feedback', 'PROPOSTA_FEEDBACK'],
  ['pf-view', 'PROPOSTA_VISUALIZADA'],
  ['pf-lead', 'PROPOSTA_LEAD'],
]) await inserirNotificacao({ id, tenantId: prefsTenant, tipo });

await testar('tipo desabilitado some sem apagar histórico e marcar todas respeita tipos ativos', async () => {
  const tiposComFeedbackDesligado = preferencias();
  tiposComFeedbackDesligado.tipos.PROPOSTA_FEEDBACK = false;
  await backend.salvarPreferencias(prefsAdmin, tiposComFeedbackDesligado);
  let result = await consultar(prefsAdmin);
  assert.equal(result.total, 3);
  assert.equal(result.unread, 3);
  assert.ok(!ids(result).includes('pf-feedback'));
  assert.equal(await backend.marcarTodasComoLidas(prefsAdmin), 3);
  assert.equal(await backend.marcarTodasComoLidas(prefsAdmin, 'PROPOSTA_FEEDBACK'), 0);
  const feedbackReads = await executar(
    `SELECT id FROM notificacoes_leituras WHERE usuario_id = $1 AND notificacao_id = 'pf-feedback'`,
    [prefsAdmin.userId],
  );
  assert.equal(feedbackReads.rows.length, 0);

  await backend.salvarPreferencias(prefsAdmin, preferencias());
  result = await consultar(prefsAdmin);
  assert.equal(result.total, 4);
  assert.equal(result.unread, 1);
  assert.equal(result.items.find(item => item.id === 'pf-feedback').lida, false);
});

await testar('leituras e preferências são isoladas por usuário', async () => {
  const result = await consultar(prefsOperador);
  assert.equal(result.total, 4);
  assert.equal(result.unread, 4);
  assert.deepEqual(plain(result.preferences), preferencias());
});

await testar('marcar todas por tipo não altera outros tipos ativos', async () => {
  await inserirNotificacao({ id: 'pf-aceite-2', tenantId: prefsTenant, tipo: 'PROPOSTA_ACEITA' });
  await inserirNotificacao({ id: 'pf-view-2', tenantId: prefsTenant, tipo: 'PROPOSTA_VISUALIZADA' });
  assert.equal(await backend.marcarTodasComoLidas(prefsAdmin, 'PROPOSTA_ACEITA'), 1);
  const result = await consultar(prefsAdmin, { apenasNaoLidas: true });
  assert.ok(!ids(result).includes('pf-aceite-2'));
  assert.ok(ids(result).includes('pf-view-2'));
  assert.ok(ids(result).includes('pf-feedback'));
});

await testar('ocultar o selo preserva itens e o total real de não lidas', async () => {
  await backend.salvarPreferencias(prefsAdmin, preferencias({ mostrar_contador: false }));
  const result = await consultar(prefsAdmin, { apenasNaoLidas: true });
  assert.ok(result.unread > 0);
  assert.ok(result.total > 0);
  await backend.salvarPreferencias(prefsAdmin, preferencias());
});

const pageTenant = 'pagination-t';
const pageAdmin = sessao('pagination-admin', pageTenant, 'ADMIN');
for (const id of ['page-a', 'page-b', 'page-c', 'page-d', 'page-e']) {
  await inserirNotificacao({ id, tenantId: pageTenant, createdAt: '2026-09-10T15:00:00.000Z' });
}
await testar('paginação é determinística para timestamps iguais e limita página excedente', async () => {
  const first = await consultar(pageAdmin, { page: 1, limit: 2 });
  const second = await consultar(pageAdmin, { page: 2, limit: 2 });
  const last = await consultar(pageAdmin, { page: 999, limit: 2 });
  assert.deepEqual(ids(first), ['page-e', 'page-d']);
  assert.deepEqual(ids(second), ['page-c', 'page-b']);
  assert.deepEqual(ids(last), ['page-a']);
  assert.equal(last.page, 3);
  assert.equal(last.totalPages, 3);
  assert.equal(new Set([...ids(first), ...ids(second), ...ids(last)]).size, 5);
});

let routeSession = null;
const routeMocks = {
  'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
  '@/lib/db': { initDB: async () => {} },
  '@/lib/auth': { getSession: async () => routeSession },
  '@/lib/notificacoes': backend,
  '@/lib/notificacoes-config': config,
};
const listRoute = carregarTS('src/app/api/notificacoes/route.ts', routeMocks);
const itemRoute = carregarTS('src/app/api/notificacoes/[id]/route.ts', routeMocks);
const allRoute = carregarTS('src/app/api/notificacoes/marcar-lidas/route.ts', routeMocks);
const preferencesRoute = carregarTS('src/app/api/notificacoes/preferencias/route.ts', routeMocks);

function request(pathname, method = 'GET', body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(`https://fin.enturos.com${pathname}`, init);
}

await testar('todas as rotas exigem sessão e respondem sem cache privado', async () => {
  routeSession = null;
  const responses = [
    await listRoute.GET(request('/api/notificacoes')),
    await itemRoute.PUT(request('/api/notificacoes/id', 'PUT', {}), { params: Promise.resolve({ id: 'id' }) }),
    await allRoute.POST(request('/api/notificacoes/marcar-lidas', 'POST', {})),
    await preferencesRoute.GET(),
    await preferencesRoute.PUT(request('/api/notificacoes/preferencias', 'PUT', preferencias())),
  ];
  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

await testar('listagem rejeita paginação e tipo inválidos', async () => {
  routeSession = pageAdmin;
  for (const query of ['page=0', 'page=-1', 'page=x', 'limit=0', 'limit=51', 'tipo=DESCONHECIDO']) {
    assert.equal((await listRoute.GET(request(`/api/notificacoes?${query}`))).status, 400, query);
  }
});

await testar('listagem rejeita flag unread inválida em vez de tratá-la como false', async () => {
  routeSession = pageAdmin;
  assert.equal((await listRoute.GET(request('/api/notificacoes?unread=talvez'))).status, 400);
});

await testar('alteração individual valida entrada e oculta registros sem acesso com 404', async () => {
  routeSession = seller;
  assert.equal((await itemRoute.PUT(
    request('/api/notificacoes/x', 'PUT', { outro: true }),
    { params: Promise.resolve({ id: 'n-prop-own' }) },
  )).status, 400);
  assert.equal((await itemRoute.PUT(
    request('/api/notificacoes/x', 'PUT', { lida: 'sim' }),
    { params: Promise.resolve({ id: 'n-prop-own' }) },
  )).status, 400);
  assert.equal((await itemRoute.PUT(
    request('/api/notificacoes/x', 'PUT', {}),
    { params: Promise.resolve({ id: '' }) },
  )).status, 400);
  assert.equal((await itemRoute.PUT(
    request('/api/notificacoes/x', 'PUT', {}),
    { params: Promise.resolve({ id: 'x'.repeat(501) }) },
  )).status, 400);
  assert.equal((await itemRoute.PUT(
    request('/api/notificacoes/x', 'PUT', {}),
    { params: Promise.resolve({ id: 'n-prop-other' }) },
  )).status, 404);
  assert.equal((await itemRoute.PUT(
    request('/api/notificacoes/x', 'PUT', {}),
    { params: Promise.resolve({ id: 'inexistente' }) },
  )).status, 404);
});

await testar('corpo JSON malformado é rejeitado nas mutações', async () => {
  routeSession = seller;
  assert.equal((await itemRoute.PUT(
    request('/api/notificacoes/x', 'PUT', '{'),
    { params: Promise.resolve({ id: 'n-prop-own' }) },
  )).status, 400);
  assert.equal((await allRoute.POST(
    request('/api/notificacoes/marcar-lidas', 'POST', '{'),
  )).status, 400);
});

await testar('marcar todas e preferências rejeitam payloads fora do contrato', async () => {
  routeSession = prefsAdmin;
  for (const body of [null, [], { extra: true }, { tipo: 'DESCONHECIDO' }, { tipo: 1 }]) {
    assert.equal((await allRoute.POST(request('/api/notificacoes/marcar-lidas', 'POST', body))).status, 400);
  }
  for (const body of [null, {}, { ...preferencias(), extra: true }, { ...preferencias(), mostrar_contador: 'sim' }]) {
    assert.equal((await preferencesRoute.PUT(
      request('/api/notificacoes/preferencias', 'PUT', body),
    )).status, 400);
  }
});

await testar('rotas válidas preservam paginação, mark/unmark e preferências', async () => {
  routeSession = pageAdmin;
  const listed = await listRoute.GET(request('/api/notificacoes?page=2&limit=2&unread=1'));
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'private, no-store');
  assert.equal((await listed.json()).page, 2);
  assert.equal((await itemRoute.PUT(
    request('/api/notificacoes/x', 'PUT', { lida: true }),
    { params: Promise.resolve({ id: 'page-a' }) },
  )).status, 200);
  assert.equal((await itemRoute.PUT(
    request('/api/notificacoes/x', 'PUT', { lida: false }),
    { params: Promise.resolve({ id: 'page-a' }) },
  )).status, 200);
  assert.equal((await allRoute.POST(
    request('/api/notificacoes/marcar-lidas', 'POST', { tipo: 'PROPOSTA_ACEITA' }),
  )).status, 200);

  const novas = preferencias({ mostrar_contador: false, atualizacao_automatica: false });
  assert.equal((await preferencesRoute.PUT(
    request('/api/notificacoes/preferencias', 'PUT', novas),
  )).status, 200);
  const loaded = await preferencesRoute.GET();
  assert.deepEqual((await loaded.json()).preferences, novas);
});

await database.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} falha(s) em ${checks + failures.length} cenários do backend de notificações.`);
  process.exitCode = 1;
} else {
  console.log(`\n${checks} cenários do backend de notificações passaram.`);
}
