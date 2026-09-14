/** Contrato, permissões e isolamento da API de planejamento contra Postgres real (PGlite). */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(import.meta.dirname, '..');
const database = new PGlite();
let checks = 0;

await database.exec(`
  CREATE TABLE planejamento_custos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    mes TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, mes)
  );
`);

const admin = {
  userId: 'admin-a',
  nome: 'Administrador',
  perfil: 'ADMIN',
  permissoes: {},
  tenantId: 'agencia-a',
  tenantSlug: 'agencia-a',
};

function plano(mes = '2026-09', extras = {}) {
  return {
    id: 'id-controlado-pelo-cliente',
    mes,
    custos_fixos: [
      { categoria: 'Aluguel/Sede', valor: 1000, observacao: '' },
      { categoria: 'Folha de pagamento', valor: 0, observacao: '' },
      { categoria: 'Ferramentas e software', valor: 0, observacao: '' },
      { categoria: 'Marketing fixo recorrente', valor: 0, observacao: '' },
      { categoria: 'Outros fixos', valor: 0, observacao: '' },
    ],
    custos_variaveis: [
      { nome: 'Comissão vendedor', percentual: 0, base: 'COMISSAO' },
      { nome: 'Impostos', percentual: 6, base: 'COMISSAO' },
      { nome: 'Taxa cartão/boleto', percentual: 4.5, base: 'VENDA' },
      { nome: 'Outros variáveis', percentual: 0, base: 'VENDA' },
    ],
    marketing: [
      { canal: 'Instagram Ads', valor: 800 },
      { canal: 'Google Ads', valor: 0 },
      { canal: 'Influenciadores', valor: 0 },
      { canal: 'Eventos', valor: 0 },
      { canal: 'Afiliados', valor: 0 },
      { canal: 'Outros', valor: 0 },
    ],
    ticket_medio: 8000,
    margem_comissao: 25,
    taxa_conversao: 10,
    lucro_desejado: 10000,
    dias_uteis: 22,
    vendedores_ativos: 1,
    ...extras,
  };
}

function ambiente(opcoes = {}) {
  const session = Object.hasOwn(opcoes, 'session') ? opcoes.session : admin;
  const queries = [];
  const errors = [];
  let inits = 0;

  const pool = opcoes.semBanco ? null : {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (opcoes.falharQuery?.test(sql)) throw new Error('DETALHE_PRIVADO_DO_BANCO');
      const result = await database.query(sql, values);
      return { rows: result.rows ?? [], rowCount: result.affectedRows ?? result.rows?.length ?? 0 };
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/db': {
      __esModule: true,
      default: pool,
      initDB: async () => { inits += 1; },
    },
    '@/lib/auth': { getSession: async () => session },
    'node:crypto': { randomUUID },
  };
  const loaded = new Map();

  function carregar(relativePath) {
    const filename = path.join(root, relativePath);
    if (loaded.has(filename)) return loaded.get(filename).exports;
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: filename,
    });
    const loadedModule = { exports: {} };
    loaded.set(filename, loadedModule);
    vm.runInNewContext(outputText, {
      module: loadedModule,
      exports: loadedModule.exports,
      require(name) {
        if (name in mocks) return mocks[name];
        if (name.startsWith('@/')) return carregar(`src/${name.slice(2)}.ts`);
        if (name.startsWith('.')) {
          const absolute = path.resolve(path.dirname(filename), name);
          return carregar(`${path.relative(root, absolute)}.ts`);
        }
        throw new Error(`Dependência não prevista: ${name}`);
      },
      Response,
      Request,
      URL,
      URLSearchParams,
      TextEncoder,
      Date,
      Error,
      JSON,
      Number,
      Math,
      String,
      console: { error: (...args) => errors.push(args) },
    }, { filename });
    return loadedModule.exports;
  }

  const api = carregar('src/app/api/planejamento/custos/route.ts');
  return {
    api,
    queries,
    errors,
    get inits() { return inits; },
    get(mes = '') {
      const suffix = mes ? `?mes=${encodeURIComponent(mes)}` : '';
      return api.GET(new Request(`https://example.test/api/planejamento/custos${suffix}`));
    },
    post(body, headers = {}) {
      return api.POST(new Request('https://example.test/api/planejamento/custos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }));
    },
  };
}

function noStore(response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
}

async function limpar() {
  await database.exec('TRUNCATE planejamento_custos');
}

async function testar(nome, fn) {
  await limpar();
  await fn();
  checks += 1;
  console.log(`PASS ${nome}`);
}

await testar('exige sessão e acesso financeiro antes de consultar o banco', async () => {
  for (const [session, status] of [
    [null, 401],
    [{ ...admin, perfil: 'VENDEDOR', permissoes: { ver_financeiro: true, editar_financeiro: true } }, 403],
  ]) {
    const a = ambiente({ session });
    for (const response of [await a.get('2026-09'), await a.post(plano())]) {
      assert.equal(response.status, status);
      noStore(response);
    }
    assert.equal(a.queries.length, 0);
    assert.equal(a.inits, 0);
  }
});

await testar('valida competência, corpo e limite antes de gravar', async () => {
  const a = ambiente();
  const getInvalido = await a.get('09/2026');
  assert.equal(getInvalido.status, 400);
  noStore(getInvalido);

  for (const invalido of [
    null,
    plano('2026-13'),
    plano('2026-09', { ticket_medio: -1 }),
    plano('2026-09', { marketing: [{ canal: 'Meta', valor: Number.NaN }] }),
  ]) {
    const response = await a.post(invalido);
    assert.equal(response.status, 400);
    noStore(response);
  }

  const grande = await a.post(plano(), { 'Content-Length': '200001' });
  assert.equal(grande.status, 413);
  noStore(grande);
  assert.equal(a.queries.length, 0);
  assert.equal(a.inits, 0);
});

await testar('salva com id do servidor e mantém id canônico ao atualizar o mesmo mês', async () => {
  const a = ambiente();
  const criada = await a.post(plano());
  assert.equal(criada.status, 200);
  noStore(criada);
  const primeira = await criada.json();
  assert.match(primeira.id, /^[0-9a-f-]{36}$/i);
  assert.notEqual(primeira.id, 'id-controlado-pelo-cliente');
  assert.equal(primeira.marketing.find(item => item.canal === 'Instagram Ads').valor, 800);

  const atualizada = await a.post(plano('2026-09', {
    id: 'tentativa-de-troca',
    marketing: plano().marketing.map(item => item.canal === 'Instagram Ads' ? { ...item, valor: 1234.56 } : item),
  }));
  assert.equal(atualizada.status, 200);
  const segunda = await atualizada.json();
  assert.equal(segunda.id, primeira.id);
  assert.equal(segunda.marketing.find(item => item.canal === 'Instagram Ads').valor, 1234.56);

  const rows = await database.query("SELECT id, data FROM planejamento_custos WHERE tenant_id = 'agencia-a' AND mes = '2026-09'");
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].id, primeira.id);
  assert.equal(rows.rows[0].data.id, primeira.id);
});

await testar('isola meses por tenant e respeita impersonação', async () => {
  const a = ambiente();
  const b = ambiente({ session: { ...admin, userId: 'admin-b', tenantId: 'agencia-b' } });
  const impersonada = ambiente({ session: { ...admin, tenantId: '__platform__', isSuperAdmin: true, impersonatingTenantId: 'agencia-b' } });
  await a.post(plano('2026-09', { ticket_medio: 8000 }));
  await b.post(plano('2026-09', { ticket_medio: 22000 }));

  assert.equal((await (await a.get('2026-09')).json()).ticket_medio, 8000);
  assert.equal((await (await b.get('2026-09')).json()).ticket_medio, 22000);
  assert.equal((await (await impersonada.get('2026-09')).json()).ticket_medio, 22000);
  assert.equal(await (await a.get('2026-08')).json(), null);

  const listaA = await (await a.get()).json();
  assert.equal(listaA.length, 1);
  assert.ok(!JSON.stringify(listaA).includes('22000'));
  for (const query of a.queries.filter(item => /planejamento_custos/i.test(item.sql))) {
    assert.equal(query.values.includes('agencia-b'), false);
  }
});

await testar('hidrata contratos legados sem perder marketing e categorias', async () => {
  await database.query(
    `INSERT INTO planejamento_custos (id, tenant_id, mes, data) VALUES ($1,$2,$3,$4::jsonb)`,
    ['legado', 'agencia-a', '2026-08', JSON.stringify({
      id: 'legado',
      custos_fixos: [{ categoria: 'Aluguel', valor: 500, observacao: '' }],
      custos_variaveis: [{ nome: 'Imposto', percentual: 5, base: 'COMISSAO' }],
      marketing: [{ canal: 'Meta Ads', valor: 900 }],
      ticket_medio: 7000,
      margem_comissao: 20,
      taxa_conversao: 8,
      lucro_desejado: 5000,
      dias_uteis: 21,
      vendedores_ativos: 2,
    })],
  );
  const response = await ambiente().get('2026-08');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, 'legado');
  assert.equal(body.custos_fixos.find(item => item.categoria === 'Aluguel/Sede').valor, 500);
  assert.equal(body.custos_fixos.some(item => item.categoria === 'Folha de pagamento'), true);
  assert.equal(body.marketing.find(item => item.canal === 'Instagram Ads').valor, 900);
});

await testar('indisponibilidade e falhas retornam mensagens genéricas sem vazar detalhes', async () => {
  const semBanco = ambiente({ semBanco: true });
  for (const response of [await semBanco.get(), await semBanco.post(plano())]) {
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('DETALHE_PRIVADO'));
  }

  const falha = ambiente({ falharQuery: /planejamento_custos/i });
  for (const response of [await falha.get(), await falha.post(plano())]) {
    assert.equal(response.status, 500);
    assert.ok(!(await response.text()).includes('DETALHE_PRIVADO_DO_BANCO'));
  }
  assert.equal(falha.errors.length, 2);
});

console.log(`\n${checks}/${checks} testes passaram`);
await database.close();
