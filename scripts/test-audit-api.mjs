/** Handler, filtros, permissões e exportador reais contra Postgres isolado (PGlite). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(import.meta.dirname, '..');
const pg = new PGlite();
let cenarios = 0;
const admin = {
  userId: 'admin-1', nome: 'Administrador', perfil: 'ADMIN', permissoes: {},
  tenantId: 'agencia-1', tenantSlug: 'agencia-1',
};

await pg.exec(`
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, usuario_id TEXT NOT NULL DEFAULT '',
    acao TEXT NOT NULL, modulo TEXT NOT NULL, entidade TEXT NOT NULL DEFAULT '',
    entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE audit_config (id TEXT PRIMARY KEY, data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
  INSERT INTO audit_config (id, data, created_at)
    VALUES ('capture-v1', '{"tables":["clientes","contas_receber"]}', '2026-09-01T00:00:00Z');
`);

const eventosBase = [
  { id: 'e01', tenant: 'agencia-1', data: '2026-09-01T00:00:00Z', modulo: 'Financeiro', acao: 'CRIAR', user: 'pessoa-1', nome: 'Nome antigo', descricao: 'Criou recebimento antigo' },
  { id: 'e02', tenant: 'agencia-1', data: '2026-09-09T15:00:00Z', modulo: 'Financeiro', acao: 'EDITAR', user: 'pessoa-1', nome: 'Nome intermediário', descricao: 'Quitou 100% pedido_A no caminho C:\\tmp' },
  { id: 'e03', tenant: 'agencia-1', data: '2026-09-09T15:00:00Z', modulo: 'Financeiro', acao: 'CRIAR', user: 'pessoa-1', nome: 'Nome atualizado', descricao: 'Criou recebimento', origem: 'SISTEMA' },
  { id: 'e04', tenant: 'agencia-1', data: '2026-09-10T01:00:00Z', modulo: 'Fiscal', acao: 'CRIAR', user: 'pessoa-2', nome: 'Equipe fiscal', descricao: 'Gerou nota fiscal', origem: 'INTEGRACAO' },
  { id: 'e05', tenant: 'agencia-1', data: '2026-09-11T00:00:00Z', modulo: 'Segurança', acao: 'LOGIN_FALHOU', user: '', nome: 'Visitante', descricao: 'Credenciais inválidas', origem: 'PUBLICO' },
  { id: 'z01', tenant: 'agencia-2', data: '2026-09-12T00:00:00Z', modulo: 'MODULO_OUTRA_AGENCIA', acao: 'EXCLUIR', user: 'outra-pessoa', nome: 'Pessoa de outra agência', descricao: 'DADO_OUTRA_AGENCIA' },
  { id: 'p01', tenant: '__platform__', data: '2026-09-12T00:00:00Z', modulo: 'Plataforma', acao: 'LOGIN', user: 'super-1', nome: 'Super administrador', descricao: 'DADO_PLATAFORMA' },
];
for (const evento of eventosBase) {
  await pg.query(`INSERT INTO audit_log
    (id, tenant_id, created_at, modulo, acao, usuario_id, entidade, entidade_id, data)
    VALUES ($1,$2,$3,$4,$5,$6,'contas_receber',$1,$7)`, [
    evento.id, evento.tenant, evento.data, evento.modulo, evento.acao, evento.user,
    JSON.stringify({
      usuario_nome: evento.nome, descricao: evento.descricao, origem: evento.origem || 'USUARIO',
      perfil: 'ADMIN', alteracoes: [], timestamp: 'DATA_CLIENTE_NAO_CONFIAVEL',
    }),
  ]);
}

function ambiente(opcoes = {}) {
  const session = Object.hasOwn(opcoes, 'session') ? opcoes.session : admin;
  const queries = [];
  const errors = [];
  let releases = 0;
  let inits = 0;
  const query = async (sql, values = []) => {
    queries.push({ sql, values });
    if (opcoes.falharQuery?.test(sql)) throw new Error('DETALHE_PRIVADO_DO_BANCO');
    const resultado = await pg.query(sql, values);
    return { rows: resultado.rows, rowCount: resultado.affectedRows ?? resultado.rows.length };
  };
  const pool = { query, connect: async () => ({ query, release() { releases++; } }) };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/db': {
      __esModule: true, default: opcoes.semBanco ? null : pool,
      initDB: async () => { inits++; },
    },
    '@/lib/auth': { getSession: async () => session },
    '@/lib/audit-context': { getAuditContext: async () => ({ requestId: 'requisicao-1', path: '/api/audit-log', method: 'GET' }) },
    'node:crypto': { randomUUID },
  };
  const carregados = new Map();
  function carregar(relativo) {
    const filename = path.join(root, relativo);
    if (carregados.has(filename)) return carregados.get(filename);
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename,
    });
    const loadedModule = { exports: {} };
    carregados.set(filename, loadedModule.exports);
    vm.runInNewContext(outputText, {
      module: loadedModule, exports: loadedModule.exports,
      require(nome) {
        const absoluto = nome.startsWith('.') ? path.resolve(path.dirname(filename), nome) : null;
        const alias = absoluto ? `@/${path.relative(path.join(root, 'src'), absoluto)}` : nome;
        if (alias in mocks) return mocks[alias];
        if (alias.startsWith('@/')) return carregar(`src/${alias.slice(2)}.ts`);
        throw new Error(`Dependência não prevista: ${nome}`);
      },
      Response, Request, URL, URLSearchParams, Date, Error,
      console: { error: (...args) => errors.push(args) },
    }, { filename });
    return loadedModule.exports;
  }
  const api = carregar('src/app/api/audit-log/route.ts');
  return {
    api, queries, errors,
    get releases() { return releases; },
    get inits() { return inits; },
    async get(params = {}) {
      const qs = new URLSearchParams(params);
      return api.GET(new Request(`https://example.test/api/audit-log?${qs}`));
    },
  };
}

function noStore(response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
}
async function testar(nome, fn) {
  await fn();
  cenarios++;
  console.log(`PASS ${nome}`);
}

try {
  await testar('endpoint é somente leitura e não exporta mutações', async () => {
    const a = ambiente();
    assert.equal(typeof a.api.GET, 'function');
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(a.api[metodo], undefined);
  });

  await testar('sem sessão: 401; perfis sem administração: 403, inclusive com permissão forjada', async () => {
    for (const session of [null, ...['VENDEDOR', 'OPERADOR', 'GERENTE', 'FINANCEIRO', 'SUPER_ADMIN'].map(perfil => ({
      ...admin, perfil, permissoes: { gerenciar_usuarios: true },
    }))]) {
      const a = ambiente({ session });
      for (const format of ['', 'csv']) {
        const resposta = await a.get({ format });
        assert.equal(resposta.status, session ? 403 : 401);
        noStore(resposta);
      }
      assert.equal(a.queries.length, 0);
      assert.equal(a.inits, 0);
    }
  });

  await testar('ADMIN e owner leem somente agência da sessão, ignorando tenant enviado', async () => {
    for (const perfil of ['ADMIN', 'owner']) {
      const a = ambiente({ session: { ...admin, perfil } });
      const resposta = await a.get({ tenantId: 'agencia-2', tenant_id: 'agencia-2' });
      assert.equal(resposta.status, 200);
      noStore(resposta);
      const body = await resposta.json();
      assert.equal(body.total, 5);
      assert.ok(body.items.every(item => item.id.startsWith('e')));
      assert.ok(!JSON.stringify(body).includes('DADO_OUTRA_AGENCIA'));
      assert.ok(!JSON.stringify(body.facets).includes('MODULO_OUTRA_AGENCIA'));
      assert.ok(!JSON.stringify(body.facets).includes('outra-pessoa'));
      assert.equal(body.facets.usuarios.find(u => u.id === 'pessoa-1').nome, 'Nome atualizado');
      assert.equal(body.coverage.tables, 2);
      assert.equal(body.coverage.startedAt, '2026-09-01T00:00:00.000Z');
      assert.equal(body.items[0].timestamp, '2026-09-11T00:00:00.000Z');
      assert.equal(a.releases, 1);
    }
  });

  await testar('tenant obrigatório também para administradores e superadmins', async () => {
    for (const isSuperAdmin of [false, true]) {
      const a = ambiente({ session: { ...admin, tenantId: '', isSuperAdmin } });
      const resposta = await a.get({ tenantId: 'agencia-1' });
      assert.equal(resposta.status, 403);
      noStore(resposta);
      assert.equal(a.queries.length, 0);
    }
  });

  await testar('superadmin consulta plataforma ou agência impersonada sem misturar os escopos', async () => {
    for (const impersonatingTenantId of [undefined, 'agencia-2']) {
      const a = ambiente({ session: {
        ...admin, userId: 'super-1', perfil: 'SUPER_ADMIN', isSuperAdmin: true,
        tenantId: '__platform__', impersonatingTenantId,
      } });
      const resposta = await a.get();
      assert.equal(resposta.status, 200);
      const body = await resposta.json();
      assert.equal(body.total, 1);
      assert.equal(body.items[0].id, impersonatingTenantId ? 'z01' : 'p01');
      assert.equal(body.facets.usuarios[0].id, impersonatingTenantId ? 'outra-pessoa' : 'super-1');
    }
  });

  await testar('paginação tem ordem estável nos empates, total consistente e limita página inexistente', async () => {
    const a = ambiente();
    const paginas = [];
    for (const page of ['1', '2', '99']) {
      const resposta = await a.get({ page, pageSize: '2' });
      assert.equal(resposta.status, 200);
      const body = await resposta.json();
      assert.equal(body.total, 5);
      assert.equal(body.totalPages, 3);
      assert.equal(body.pageSize, 2);
      assert.equal(body.page, page === '99' ? 3 : Number(page));
      paginas.push(body.items.map(item => item.id));
    }
    assert.deepEqual(paginas, [['e05', 'e04'], ['e03', 'e02'], ['e01']]);
    assert.equal(a.queries.filter(q => q.sql.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')).length, 3);
    assert.equal(a.queries.filter(q => q.sql === 'COMMIT').length, 3);
    assert.equal(a.releases, 3);
    const vazio = await (await a.get({ modulo: 'INEXISTENTE', page: '99' })).json();
    assert.deepEqual([vazio.total, vazio.page, vazio.totalPages, vazio.items.length], [0, 1, 1, 0]);
  });

  await testar('filtros combinados de período, módulo, usuário, ação e origem usam SQL real', async () => {
    const a = ambiente();
    const resposta = await a.get({
      inicio: '2026-09-09T12:00:00-03:00', fim: '2026-09-09T15:00:00Z',
      modulo: 'Financeiro', usuario: 'pessoa-1', acao: 'EDITAR', origem: 'USUARIO',
    });
    assert.equal(resposta.status, 200);
    const body = await resposta.json();
    assert.equal(body.total, 1);
    assert.equal(body.items[0].id, 'e02');
    for (const consulta of a.queries.filter(q => /FROM audit_log/i.test(q.sql))) {
      assert.ok(consulta.sql.includes('tenant_id = $1'));
      assert.equal(consulta.values[0], 'agencia-1');
    }
  });

  await testar('busca trata percentual, sublinhado e barra como literais e não permite injeção', async () => {
    // Todas as entidades são contas_receber: o '_' literal também ocorre ali.
    for (const [q, esperado] of [['%', 1], ['pedido_', 1], ['_', 5], ['\\', 1], ["' OR 1=1 --", 0], ['DADO_OUTRA_AGENCIA', 0]]) {
      const a = ambiente();
      const resposta = await a.get({ q });
      assert.equal(resposta.status, 200);
      const body = await resposta.json();
      assert.equal(body.total, esperado, `busca ${q}`);
      if (esperado === 1) assert.equal(body.items[0].id, 'e02');
    }
  });

  await testar('filtros inválidos retornam 400 sem consultar banco e com no-store', async () => {
    for (const params of [
      { page: '0' }, { page: '-1' }, { pageSize: '101' }, { page: '1.5' },
      { inicio: 'ontem' }, { inicio: '2026-02-30T00:00:00Z' }, { inicio: '2026-09-09T24:00:00Z' },
      { inicio: '2026-09-11T00:00:00Z', fim: '2026-09-10T00:00:00Z' },
      { q: 'a'.repeat(201) }, { usuario: 'a'.repeat(201) },
    ]) {
      const a = ambiente();
      const resposta = await a.get(params);
      assert.equal(resposta.status, 400, JSON.stringify(params));
      noStore(resposta);
      assert.equal(a.queries.length, 0);
    }
  });

  await testar('CSV exporta todas correspondências do filtro, não só a página, e registra exportação', async () => {
    const a = ambiente();
    const resposta = await a.get({ format: 'csv', modulo: 'Financeiro', page: '2', pageSize: '1', tenantId: 'agencia-2' });
    assert.equal(resposta.status, 200);
    noStore(resposta);
    assert.ok(resposta.headers.get('Content-Type').startsWith('text/csv'));
    assert.ok(resposta.headers.get('Content-Disposition').includes('attachment'));
    const csv = await resposta.text();
    assert.equal(csv.split('\r\n').length, 4);
    for (const id of ['e01', 'e02', 'e03']) assert.ok(csv.includes(`"${id}"`));
    for (const proibido of ['"e04"', 'DADO_OUTRA_AGENCIA', 'DADO_PLATAFORMA']) assert.ok(!csv.includes(proibido));
    const { rows } = await pg.query("SELECT * FROM audit_log WHERE acao = 'EXPORTAR' AND tenant_id = 'agencia-1'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].usuario_id, admin.userId);
    assert.equal(rows[0].data.descricao, 'Exportou 3 registros de auditoria em CSV.');
    assert.equal(rows[0].data.request_id, 'requisicao-1');
  });

  await testar('CSV de superadmin em impersonação e seu evento pertencem à agência alvo', async () => {
    const a = ambiente({ session: { ...admin, userId: 'super-1', perfil: 'SUPER_ADMIN', isSuperAdmin: true,
      tenantId: '__platform__', impersonatingTenantId: 'agencia-2' } });
    const resposta = await a.get({ format: 'csv' });
    assert.equal(resposta.status, 200);
    const csv = await resposta.text();
    assert.ok(csv.includes('DADO_OUTRA_AGENCIA'));
    assert.ok(!csv.includes('DADO_PLATAFORMA'));
    assert.ok(!csv.includes('Quitou 100%'));
    const { rows } = await pg.query("SELECT usuario_id FROM audit_log WHERE acao = 'EXPORTAR' AND tenant_id = 'agencia-2'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].usuario_id, 'super-1');
  });

  await testar('banco ausente, falha de consulta e falha de registro CSV retornam erro sem dados privados', async () => {
    for (const [opcoes, params, status] of [
      [{ semBanco: true }, {}, 503],
      [{ falharQuery: /SELECT COUNT/ }, {}, 500],
      [{ falharQuery: /INSERT INTO audit_log/ }, { format: 'csv' }, 500],
    ]) {
      const a = ambiente(opcoes);
      const resposta = await a.get(params);
      assert.equal(resposta.status, status);
      noStore(resposta);
      assert.ok(resposta.headers.get('Content-Type').includes('application/json'));
      assert.ok(!(await resposta.text()).includes('DETALHE_PRIVADO_DO_BANCO'));
      if (opcoes.falharQuery?.source === 'SELECT COUNT') {
        assert.ok(a.queries.some(q => q.sql === 'ROLLBACK'));
        assert.equal(a.releases, 1);
      }
    }
  });

  await testar('exportação recusa 50.001 registros e aceita 50.000 sem truncar nem misturar tenants', async () => {
    await pg.exec(`INSERT INTO audit_log (id, tenant_id, usuario_id, acao, modulo, entidade, entidade_id, data)
      SELECT 'limite-' || n, 'agencia-1', 'pessoa-1', 'CRIAR', 'Limite', 'clientes', n::text,
        jsonb_build_object('descricao', 'REGISTRO_LIMITE_' || n, 'usuario_nome', 'Pessoa')
      FROM generate_series(1, 50001) n`);
    const a = ambiente();
    const negado = await a.get({ format: 'csv', modulo: 'Limite' });
    assert.equal(negado.status, 422);
    noStore(negado);
    assert.ok(!a.queries.some(q => /INSERT INTO audit_log/.test(q.sql)));
    await pg.query("DELETE FROM audit_log WHERE id = 'limite-50001'");
    const aceito = await a.get({ format: 'csv', modulo: 'Limite', pageSize: '1' });
    assert.equal(aceito.status, 200);
    const csv = await aceito.text();
    assert.equal(csv.split('\r\n').length, 50001);
    assert.ok(csv.includes('REGISTRO_LIMITE_1"'));
    assert.ok(csv.includes('REGISTRO_LIMITE_50000"'));
    assert.ok(!csv.includes('DADO_OUTRA_AGENCIA'));
    const { rows } = await pg.query("SELECT data FROM audit_log WHERE acao = 'EXPORTAR' AND tenant_id = 'agencia-1' ORDER BY created_at DESC LIMIT 1");
    assert.equal(rows[0].data.descricao, 'Exportou 50000 registros de auditoria em CSV.');
  });

  console.log(`\n${cenarios} cenários da API de auditoria passaram com SQL real.`);
} finally {
  await pg.close();
}
