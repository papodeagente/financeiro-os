/** Integração isolada do compartilhamento de mapas mentais contra PostgreSQL real (PGlite). */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(import.meta.dirname, '..');
const requireNative = createRequire(import.meta.url);
const database = new PGlite();
let session = null;
let checks = 0;
const failures = [];
const auditEvents = [];

async function executar(sql, params) {
  if (params === undefined) {
    const results = await database.exec(sql);
    const last = results.at(-1) || { rows: [] };
    return { ...last, rows: last.rows || [], rowCount: last.affectedRows ?? 0 };
  }
  const result = await database.query(sql, params);
  return {
    ...result,
    rows: result.rows || [],
    rowCount: Number.isInteger(result.affectedRows) ? result.affectedRows : result.rows?.length ?? 0,
  };
}

const pool = {
  query: executar,
  async connect() {
    return { query: executar, release() {} };
  },
};

const mocks = {
  'next/server': {
    NextRequest: class NextRequest {},
    NextResponse: {
      json: (body, init) => Response.json(body, init),
      next: () => new Response(null),
      redirect: url => new Response(null, { status: 302, headers: { Location: String(url) } }),
    },
  },
  '@/lib/db': { __esModule: true, default: pool, initDB: async () => undefined },
  '@/lib/auth': { getSession: async () => session },
  '@/lib/audit': {
    registrarEventoAuditoria: async evento => { auditEvents.push(evento); },
  },
  '@/lib/canonical-hosts': { getCanonicalBaseUrl: () => 'https://fin.enturos.com' },
  './lib/canonical-hosts': {
    getCanonicalBaseUrl: () => 'https://fin.enturos.com',
    extractHost: () => 'fin.enturos.com',
    isCanonicalHost: () => true,
  },
  jose: { jwtVerify: async () => ({ payload: {} }) },
};

const loaded = new Map();
function carregar(relativePath) {
  const filename = path.isAbsolute(relativePath)
    ? relativePath
    : path.resolve(root, relativePath);
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const loadedModule = { exports: {} };
  loaded.set(filename, loadedModule);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  vm.runInNewContext(outputText, {
    module: loadedModule,
    exports: loadedModule.exports,
    require(name) {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/')) return carregar(path.resolve(root, 'src', `${name.slice(2)}.ts`));
      if (name.startsWith('.')) return carregar(`${path.resolve(path.dirname(filename), name)}.ts`);
      return requireNative(name);
    },
    Buffer,
    Request,
    Response,
    URL,
    URLSearchParams,
    Headers,
    TextEncoder,
    structuredClone,
    crypto,
    process,
    console,
  }, { filename });
  return loadedModule.exports;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function body(response) {
  return response.json();
}

async function testar(nome, fn) {
  try {
    await fn();
    checks += 1;
    console.log(`PASS ${nome}`);
  } catch (error) {
    failures.push({ nome, error });
    console.error(`FAIL ${nome}: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  }
}

function sessao(userId, tenantId, extras = {}) {
  return {
    userId,
    nome: userId,
    email: `${userId}@example.test`,
    perfil: 'ADMIN',
    permissoes: {},
    tenantId,
    tenantSlug: tenantId,
    ...extras,
  };
}

function mapa(id, nome = 'Plano comercial') {
  return {
    id,
    nome: 'Nome não autoritativo',
    rootId: 'root',
    nodes: {
      root: {
        id: 'id-falso', text: 'Ideia central', parentId: null, ordem: 0,
        segredoInterno: 'não pode vazar',
        image: { url: 'javascript:alert(1)', alt: 'perigosa' },
        links: [
          { label: 'Site', url: 'https://example.test/seguro' },
          { label: 'Credencial', url: 'https://usuario:senha@example.test/' },
        ],
      },
      child: {
        id: 'child', text: 'Canal principal', parentId: 'root', ordem: 7,
        attachments: [
          { name: 'Briefing', url: '/uploads/briefing.pdf' },
          { name: 'Script', url: 'javascript:alert(2)' },
        ],
        style: { shape: 'pill', bold: true, html: '<script>' },
      },
      orphan: { id: 'orphan', text: 'Órfão', parentId: 'inexistente', ordem: -10 },
    },
    theme: 'ocean',
    layout: 'map',
    view: { zoom: 99, x: Infinity, y: 12 },
    tenant_id: 'tenant-secreto',
    apiToken: 'não pode vazar',
    nomeAutoritativo: nome,
  };
}

const helper = carregar('src/lib/mapas-mentais-compartilhamento.ts');
const schema = helper.MAPAS_MENTAIS_COMPARTILHAMENTO_SCHEMA_SQL;
const management = carregar('src/app/api/mapas-mentais/[id]/compartilhar/route.ts');
const exportar = carregar('src/app/api/mapas-mentais/[id]/exportar/route.ts');
const publico = carregar('src/app/api/mapas-mentais/compartilhados/[token]/route.ts');
const copiar = carregar('src/app/api/mapas-mentais/compartilhados/[token]/copiar/route.ts');

await executar(`
  CREATE TABLE mapas_mentais (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    nome TEXT NOT NULL DEFAULT 'Sem título',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);
await executar(schema);
await executar(schema);
const secretRows = await executar(
  `SELECT secret_value FROM mapas_mentais_compartilhamento_segredos WHERE version = 1`,
  [],
);
const shareSecret = secretRows.rows[0]?.secret_value;
assert.match(shareSecret, /^[0-9a-f]{64}$/);
const gerarTokenTeste = id => helper.gerarTokenCompartilhamento(id, shareSecret);

const owner = sessao('owner-a', 'tenant-a');
const receiver = sessao('receiver-b', 'tenant-b');
const sourceMap = mapa('map-owner');
await executar(
  `INSERT INTO mapas_mentais (id, tenant_id, nome, data) VALUES ($1, $2, $3, $4::jsonb)`,
  ['map-owner', 'tenant-a', 'Plano 2027', JSON.stringify(sourceMap)],
);

function contexto(id) {
  return { params: Promise.resolve({ id }) };
}

function contextoToken(token) {
  return { params: Promise.resolve({ token }) };
}

function requisicaoPost(url, payload = {}, extraHeaders = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(payload),
  });
}

function requisicaoCopia(extraHeaders = {}, payload = {}) {
  return requisicaoPost('https://fin.enturos.com/api', payload, extraHeaders);
}

await testar('schema é idempotente, vincula tenant+mapa e permite só um link ativo', async () => {
  const columns = await executar(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'mapas_mentais_compartilhamentos' ORDER BY column_name`,
    [],
  );
  assert.deepEqual(Array.from(columns.rows, row => row.column_name), [
    'allow_copy', 'created_at', 'created_by', 'id', 'mapa_id',
    'revoked_at', 'secret_version', 'tenant_id', 'token_hash',
  ]);

  const token1 = gerarTokenTeste('share-schema-1');
  await executar(
    `INSERT INTO mapas_mentais (id, tenant_id, nome, data) VALUES ('map-schema', 'tenant-a', 'Schema', '{}'::jsonb)`,
    [],
  );
  await executar(
    `INSERT INTO mapas_mentais_compartilhamentos
       (id, tenant_id, mapa_id, token_hash) VALUES ($1, 'tenant-a', 'map-schema', $2)`,
    ['share-schema-1', token1.tokenHash],
  );
  await assert.rejects(
    executar(
      `INSERT INTO mapas_mentais_compartilhamentos
         (id, tenant_id, mapa_id, token_hash) VALUES ('share-schema-2', 'tenant-a', 'map-schema', $1)`,
      [gerarTokenTeste('share-schema-2').tokenHash],
    ),
  );
  await assert.rejects(
    executar(
      `INSERT INTO mapas_mentais_compartilhamentos
         (id, tenant_id, mapa_id, token_hash) VALUES ('share-wrong-tenant', 'tenant-b', 'map-schema', $1)`,
      [gerarTokenTeste('share-wrong-tenant').tokenHash],
    ),
  );
  await assert.rejects(
    executar(
      `INSERT INTO mapas_mentais_compartilhamentos
         (id, tenant_id, mapa_id, token_hash) VALUES ('share-bad-hash', 'tenant-a', 'map-schema', 'bruto')`,
      [],
    ),
  );
  await executar(
    `UPDATE mapas_mentais_compartilhamentos SET revoked_at = NOW() WHERE id = 'share-schema-1'`,
    [],
  );
  await executar(
    `INSERT INTO mapas_mentais_compartilhamentos
       (id, tenant_id, mapa_id, token_hash) VALUES ('share-schema-2', 'tenant-a', 'map-schema', $1)`,
    [gerarTokenTeste('share-schema-2').tokenHash],
  );
  await executar(`DELETE FROM mapas_mentais WHERE id = 'map-schema'`, []);
  const cascata = await executar(
    `SELECT count(*)::int AS total FROM mapas_mentais_compartilhamentos WHERE mapa_id = 'map-schema'`,
    [],
  );
  assert.equal(cascata.rows[0].total, 0);
});

await testar('token é estável, opaco, contextualizado e independe da chave de login', async () => {
  const a = plain(gerarTokenTeste('share-estavel'));
  const b = plain(gerarTokenTeste('share-estavel'));
  process.env.JWT_SECRET = 'uma-chave-rotacionada';
  const depoisDaRotacao = plain(gerarTokenTeste('share-estavel'));
  const c = plain(gerarTokenTeste('share-distinto'));
  assert.deepEqual(a, b);
  assert.deepEqual(a, depoisDaRotacao);
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(a.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(a.token, c.token);
  assert.equal(helper.hashTokenCompartilhamento(a.token), a.tokenHash);
  assert.equal(helper.hashTokenCompartilhamento('curto'), null);
  assert.equal(helper.tokenPertenceAoCompartilhamento(a.token, 'share-estavel', shareSecret), true);
  assert.equal(helper.tokenPertenceAoCompartilhamento(a.token, 'share-distinto', shareSecret), false);

  const unicodeGrande = mapa('map-unicode');
  unicodeGrande.nodes.root.notes = '😀'.repeat(1_300_000);
  assert.ok(JSON.stringify(unicodeGrande).length < 5_000_000);
  assert.equal(
    helper.prepararMapaCompartilhado(unicodeGrande, 'map-unicode', 'Unicode'),
    null,
  );
});

await testar('rotas de gestão exigem sessão, validam input e escondem mapas de outro tenant', async () => {
  session = null;
  assert.equal((await management.GET(new Request('https://fin.enturos.com/api'), contexto('map-owner'))).status, 401);
  assert.equal((await management.POST(requisicaoPost('https://fin.enturos.com/api'), contexto('map-owner'))).status, 401);
  assert.equal((await management.DELETE(new Request('https://fin.enturos.com/api', { method: 'DELETE' }), contexto('map-owner'))).status, 401);

  session = receiver;
  assert.equal((await management.GET(new Request('https://fin.enturos.com/api'), contexto('map-owner'))).status, 404);
  assert.equal((await management.POST(requisicaoPost('https://fin.enturos.com/api'), contexto('map-owner'))).status, 404);

  session = sessao('operator-a', 'tenant-a', { perfil: 'OPERADOR' });
  assert.equal((await management.GET(new Request('https://fin.enturos.com/api'), contexto('map-owner'))).status, 403);
  assert.equal((await management.POST(requisicaoPost('https://fin.enturos.com/api'), contexto('map-owner'))).status, 403);
  assert.equal((await management.DELETE(new Request('https://fin.enturos.com/api', { method: 'DELETE' }), contexto('map-owner'))).status, 403);

  session = owner;
  const crossSite = requisicaoPost(
    'https://fin.enturos.com/api',
    { allowCopy: true },
    { Origin: 'https://malicioso.enturos.com', 'Sec-Fetch-Site': 'same-site' },
  );
  assert.equal((await management.POST(crossSite, contexto('map-owner'))).status, 403);
  assert.equal((await management.POST(new Request('https://fin.enturos.com/api', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  }), contexto('map-owner'))).status, 415);
  assert.equal((await management.GET(new Request('https://fin.enturos.com/api'), contexto('../map-owner'))).status, 400);
  assert.equal((await management.POST(requisicaoPost('https://fin.enturos.com/api', { allowCopy: 'sim' }), contexto('map-owner'))).status, 400);
  assert.equal((await management.POST(requisicaoPost('https://fin.enturos.com/api', { allowCopy: true, tenantId: 'tenant-b' }), contexto('map-owner'))).status, 400);
  const declaredLarge = new Request('https://fin.enturos.com/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '2049' },
    body: '{}',
  });
  assert.equal((await management.POST(declaredLarge, contexto('map-owner'))).status, 413);
  const actualLarge = requisicaoPost('https://fin.enturos.com/api', {
    allowCopy: true,
    padding: 'x'.repeat(3_000),
  });
  assert.equal((await management.POST(actualLarge, contexto('map-owner'))).status, 413);
});

await testar('exportação PDF exige permissão, tenant, mesma origem e registra evento mínimo', async () => {
  auditEvents.length = 0;

  session = null;
  assert.equal((await exportar.POST(
    requisicaoPost('https://fin.enturos.com/api/mapas-mentais/map-owner/exportar'),
    contexto('map-owner'),
  )).status, 401);

  session = sessao('operator-a', 'tenant-a', { perfil: 'OPERADOR' });
  assert.equal((await exportar.POST(
    requisicaoPost('https://fin.enturos.com/api/mapas-mentais/map-owner/exportar'),
    contexto('map-owner'),
  )).status, 403);

  session = receiver;
  assert.equal((await exportar.POST(
    requisicaoPost('https://fin.enturos.com/api/mapas-mentais/map-owner/exportar'),
    contexto('map-owner'),
  )).status, 404);

  session = owner;
  assert.equal((await exportar.POST(requisicaoPost(
    'https://fin.enturos.com/api/mapas-mentais/map-owner/exportar',
    {},
    { Origin: 'https://malicioso.enturos.com', 'Sec-Fetch-Site': 'same-site' },
  ), contexto('map-owner'))).status, 403);
  assert.equal((await exportar.POST(new Request(
    'https://fin.enturos.com/api/mapas-mentais/map-owner/exportar',
    { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' },
  ), contexto('map-owner'))).status, 415);
  assert.equal((await exportar.POST(requisicaoPost(
    'https://fin.enturos.com/api/mapas-mentais/map-owner/exportar',
    { tenantId: 'tenant-b' },
  ), contexto('map-owner'))).status, 400);
  assert.equal(auditEvents.length, 0);

  const response = await exportar.POST(
    requisicaoPost('https://fin.enturos.com/api/mapas-mentais/map-owner/exportar'),
    contexto('map-owner'),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  assert.deepEqual(plain(await body(response)), { ok: true });
  assert.equal(auditEvents.length, 1);
  const event = auditEvents[0];
  assert.equal(event.session, owner);
  assert.equal(event.tenantId, 'tenant-a');
  assert.equal(event.acao, 'EXPORTAR');
  assert.equal(event.modulo, 'Planejamento');
  assert.equal(event.entidade, 'mapas_mentais');
  assert.equal(event.entidadeId, 'map-owner');
  assert.equal(event.descricao, 'Exportou um mapa mental em PDF.');
  assert.equal(event.alteracoes, undefined);
  assert.equal(Object.hasOwn(event, 'data'), false);
  assert.equal(Object.hasOwn(event, 'token'), false);
});

let token;
let primeiraResposta;
await testar('POST cria um link e GET recupera exatamente as mesmas URLs', async () => {
  session = owner;
  const criada = await management.POST(
    requisicaoPost('https://fin.enturos.com/api', { allowCopy: true }),
    contexto('map-owner'),
  );
  assert.equal(criada.status, 201);
  assert.match(criada.headers.get('Cache-Control') || '', /no-store/);
  primeiraResposta = plain(await body(criada));
  token = new URL(primeiraResposta.publicUrl).pathname.split('/').at(-1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    primeiraResposta.publicUrl,
    `https://fin.enturos.com/mapas-mentais/publico/${token}`,
  );
  assert.equal(
    primeiraResposta.copyUrl,
    `https://fin.enturos.com/planejamento/mapas-mentais/importar/${token}`,
  );
  assert.equal(primeiraResposta.allowCopy, true);
  assert.ok(Number.isFinite(Date.parse(primeiraResposta.createdAt)));

  const rows = await executar(
    `SELECT id, token_hash, allow_copy, created_at FROM mapas_mentais_compartilhamentos
      WHERE mapa_id = 'map-owner' AND revoked_at IS NULL`,
    [],
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].token_hash, helper.hashTokenCompartilhamento(token));
  assert.equal(JSON.stringify(rows.rows[0]).includes(token), false);

  const recuperada = await management.GET(
    new Request('https://fin.enturos.com/api'),
    contexto('map-owner'),
  );
  assert.equal(recuperada.status, 200);
  assert.deepEqual(plain(await body(recuperada)), { active: true, ...primeiraResposta });
});

await testar('alterar permissão não gira o token nem duplica o compartilhamento', async () => {
  session = owner;
  const desabilitada = await management.POST(
    requisicaoPost('https://fin.enturos.com/api', { allowCopy: false }),
    contexto('map-owner'),
  );
  assert.equal(desabilitada.status, 200);
  const semCopia = plain(await body(desabilitada));
  assert.equal(semCopia.publicUrl, primeiraResposta.publicUrl);
  assert.equal(semCopia.copyUrl, null);
  assert.equal(semCopia.createdAt, primeiraResposta.createdAt);

  const reabilitada = await management.POST(
    requisicaoPost('https://fin.enturos.com/api', { allowCopy: true }),
    contexto('map-owner'),
  );
  assert.equal(reabilitada.status, 200);
  assert.deepEqual(plain(await body(reabilitada)), primeiraResposta);
  const total = await executar(
    `SELECT count(*)::int AS total FROM mapas_mentais_compartilhamentos
      WHERE mapa_id = 'map-owner' AND revoked_at IS NULL`,
    [],
  );
  assert.equal(total.rows[0].total, 1);
});

await testar('GET público entrega somente projeção segura, readonly e sem cache/referrer', async () => {
  session = null;
  const response = await publico.GET(
    new Request(`https://fin.enturos.com/api/mapas-mentais/compartilhados/${token}`),
    contextoToken(token),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(response.headers.get('X-Robots-Tag') || '', /noindex/);
  const payload = plain(await body(response));
  assert.equal(payload.mapa.id, 'map-owner');
  assert.equal(payload.mapa.nome, 'Plano 2027');
  assert.equal(payload.mapa.tenant_id, undefined);
  assert.equal(payload.mapa.apiToken, undefined);
  assert.equal(payload.mapa.nodes.root.segredoInterno, undefined);
  assert.equal(payload.mapa.nodes.root.id, 'root');
  assert.equal(payload.mapa.nodes.root.image, undefined);
  assert.deepEqual(payload.mapa.nodes.root.links, [
    { label: 'Site', url: 'https://example.test/seguro' },
  ]);
  assert.deepEqual(payload.mapa.nodes.child.attachments, [
    { name: 'Briefing', url: '/uploads/briefing.pdf' },
  ]);
  assert.equal(payload.mapa.nodes.orphan.parentId, 'root');
  assert.equal(payload.mapa.view.zoom, 4);
  assert.equal(payload.mapa.view.x, undefined);
  assert.equal(payload.allowCopy, true);
  assert.equal(payload.publicUrl, primeiraResposta.publicUrl);
  assert.equal(payload.copyUrl, primeiraResposta.copyUrl);

  assert.equal((await publico.GET(new Request('https://fin.enturos.com/api'), contextoToken('curto'))).status, 400);
  assert.equal((await publico.GET(new Request('https://fin.enturos.com/api'), contextoToken('A'.repeat(43)))).status, 404);
});

await testar('cópia exige login/permissão e grava exclusivamente no tenant da sessão', async () => {
  session = null;
  assert.equal((await copiar.POST(new Request('https://fin.enturos.com/api', { method: 'POST' }), contextoToken(token))).status, 401);

  session = owner;
  await management.POST(
    requisicaoPost('https://fin.enturos.com/api', { allowCopy: false }),
    contexto('map-owner'),
  );
  session = receiver;
  assert.equal((await copiar.POST(requisicaoCopia(), contextoToken(token))).status, 404);

  session = owner;
  await management.POST(
    requisicaoPost('https://fin.enturos.com/api', { allowCopy: true }),
    contexto('map-owner'),
  );
  session = receiver;
  assert.equal((await copiar.POST(requisicaoCopia(
    { Origin: 'https://malicioso.enturos.com', 'Sec-Fetch-Site': 'same-site' },
  ), contextoToken(token))).status, 403);
  assert.equal((await copiar.POST(new Request('https://fin.enturos.com/api', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}',
  }), contextoToken(token))).status, 415);
  assert.equal((await copiar.POST(
    requisicaoCopia({}, { tenantId: 'tenant-a' }),
    contextoToken(token),
  )).status, 400);
  const response = await copiar.POST(
    requisicaoCopia(),
    contextoToken(token),
  );
  assert.equal(response.status, 201);
  const result = plain(await body(response));
  assert.match(result.id, /^[0-9a-f-]{36}$/i);
  assert.equal(result.redirectUrl, `/planejamento/mapas-mentais/${result.id}`);
  const rows = await executar(
    `SELECT tenant_id, nome, data FROM mapas_mentais WHERE id = $1`,
    [result.id],
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].tenant_id, 'tenant-b');
  assert.equal(rows.rows[0].nome, 'Plano 2027 (cópia)');
  assert.equal(rows.rows[0].data.id, result.id);
  assert.equal(rows.rows[0].data.rootId, 'root');
  assert.equal(rows.rows[0].data.nodes.root.segredoInterno, undefined);
  assert.equal(rows.rows[0].data.tenant_id, undefined);

  const original = await executar(
    `SELECT tenant_id, nome, data FROM mapas_mentais WHERE id = 'map-owner'`,
    [],
  );
  assert.equal(original.rows[0].tenant_id, 'tenant-a');
  assert.equal(original.rows[0].nome, 'Plano 2027');
  assert.equal(original.rows[0].data.apiToken, 'não pode vazar');
});

await testar('impersonação copia para o tenant impersonado, nunca para a plataforma', async () => {
  session = sessao('super-admin', '__platform__', {
    isSuperAdmin: true,
    impersonatingTenantId: 'tenant-c',
    impersonatingTenantSlug: 'tenant-c',
  });
  const response = await copiar.POST(
    requisicaoCopia(),
    contextoToken(token),
  );
  assert.equal(response.status, 201);
  const result = await body(response);
  const row = await executar(`SELECT tenant_id FROM mapas_mentais WHERE id = $1`, [result.id]);
  assert.equal(row.rows[0].tenant_id, 'tenant-c');
});

await testar('DELETE revoga imediatamente e um novo compartilhamento recebe outro token', async () => {
  session = owner;
  const apagada = await management.DELETE(
    new Request('https://fin.enturos.com/api', { method: 'DELETE' }),
    contexto('map-owner'),
  );
  assert.equal(apagada.status, 200);
  assert.deepEqual(plain(await body(apagada)), { ok: true });

  session = null;
  assert.equal((await publico.GET(new Request('https://fin.enturos.com/api'), contextoToken(token))).status, 404);
  session = receiver;
  assert.equal((await copiar.POST(requisicaoCopia(), contextoToken(token))).status, 404);

  session = owner;
  const estado = await management.GET(new Request('https://fin.enturos.com/api'), contexto('map-owner'));
  assert.deepEqual(plain(await body(estado)), {
    active: false, publicUrl: null, copyUrl: null, allowCopy: false, createdAt: null,
  });
  assert.equal((await management.DELETE(new Request('https://fin.enturos.com/api', { method: 'DELETE' }), contexto('map-owner'))).status, 200);

  const nova = await management.POST(
    requisicaoPost('https://fin.enturos.com/api', { allowCopy: true }),
    contexto('map-owner'),
  );
  assert.equal(nova.status, 201);
  const novoToken = new URL((await body(nova)).publicUrl).pathname.split('/').at(-1);
  assert.notEqual(novoToken, token);
  const historico = await executar(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE revoked_at IS NULL)::int AS ativos
       FROM mapas_mentais_compartilhamentos WHERE mapa_id = 'map-owner'`,
    [],
  );
  assert.deepEqual(plain(historico.rows[0]), { total: 2, ativos: 1 });
});

await testar('middleware libera apenas leitura pública exata e mantém /copiar autenticado', async () => {
  const middleware = carregar('src/lib/mapa-mental-public-path.ts');
  const tokenTeste = 'A'.repeat(43);
  assert.equal(middleware.isPublicMindMapShareRequest(`/api/mapas-mentais/compartilhados/${tokenTeste}`, 'GET'), true);
  assert.equal(middleware.isPublicMindMapShareRequest(`/api/mapas-mentais/compartilhados/${tokenTeste}`, 'HEAD'), true);
  assert.equal(middleware.isPublicMindMapShareRequest(`/mapas-mentais/publico/${tokenTeste}`, 'GET'), true);
  assert.equal(middleware.isPublicMindMapShareRequest(`/api/mapas-mentais/compartilhados/${tokenTeste}`, 'POST'), false);
  assert.equal(middleware.isPublicMindMapShareRequest(`/api/mapas-mentais/compartilhados/${tokenTeste}/copiar`, 'GET'), false);
  assert.equal(middleware.isPublicMindMapShareRequest('/api/mapas-mentais/compartilhados', 'GET'), false);
  assert.equal(middleware.isPublicMindMapShareRequest('/mapas-mentais/publico/token-curto', 'GET'), false);
  assert.equal(middleware.isPublicMindMapShareRequest(`/mapas-mentais/publico/${tokenTeste}/extra`, 'GET'), false);
  assert.equal(middleware.isMindMapImportPath(`/planejamento/mapas-mentais/importar/${tokenTeste}`), true);
  assert.equal(middleware.isMindMapImportPath(`/planejamento/mapas-mentais/importar/${tokenTeste}/extra`), false);
});

await testar('auditoria classifica o recurso e remove token de caminho e payload', async () => {
  const auditContext = carregar('src/lib/audit-context.ts');
  const raw = 'Z'.repeat(43);
  const sanitized = auditContext.sanitizarCaminhoAuditoria(
    `/api/mapas-mentais/compartilhados/${raw}/copiar?token=outro`,
  );
  assert.equal(sanitized, '/api/mapas-mentais/compartilhados/[token]/copiar');
  assert.equal(sanitized.includes(raw), false);
  assert.equal(
    auditContext.sanitizarCaminhoAuditoria(`/planejamento/mapas-mentais/importar/${raw}`),
    '/planejamento/mapas-mentais/importar/[token]',
  );

  const auditSchema = carregar('src/lib/audit-schema.ts');
  await executar(`
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      usuario_id TEXT NOT NULL DEFAULT '',
      acao TEXT NOT NULL DEFAULT '',
      modulo TEXT NOT NULL DEFAULT '',
      entidade TEXT NOT NULL DEFAULT '',
      entidade_id TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await executar(auditSchema.AUDIT_SCHEMA_SQL);
  const moduleResult = await executar(
    `SELECT audit_module('mapas_mentais_compartilhamentos') AS modulo,
            audit_display(to_jsonb($1::text), 'token_hash') AS protegido`,
    ['a'.repeat(64)],
  );
  assert.equal(moduleResult.rows[0].modulo, 'Planejamento');
  assert.equal(moduleResult.rows[0].protegido, '[PROTEGIDO]');
});

try {
  if (failures.length > 0) {
    console.error(`\n${failures.length} de ${checks + failures.length} grupos falharam.`);
    process.exitCode = 1;
  } else {
    console.log(`\n${checks} grupos de integração de mapas mentais passaram.`);
  }
} finally {
  await database.close();
}
