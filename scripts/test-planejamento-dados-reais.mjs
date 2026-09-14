/** Integração real dos dados usados pelo planejamento e pelo simulador de funis. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(import.meta.dirname, '..');
const database = new PGlite();
let checks = 0;

await database.exec(`
  CREATE TABLE vendas_crm (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE propostas (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE cac_mensal (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, mes TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE planejamento_custos (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, mes TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb
  );
`);

async function query(sql, params = []) {
  const result = await database.query(sql, params);
  return { ...result, rows: result.rows ?? [] };
}

const pool = { query };
const loaded = new Map();
function carregarTS(relativePath, mocks = {}) {
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
      if (name === './db') return { __esModule: true, default: pool };
      if (name.startsWith('./')) {
        const child = path.relative(root, path.resolve(path.dirname(filename), `${name}.ts`));
        return carregarTS(child, mocks);
      }
      throw new Error(`Mock ausente para ${name}`);
    },
    Date,
    Number,
    Math,
    String,
    console,
  }, { filename });
  return loadedModule.exports;
}

const dadosReais = carregarTS('src/lib/funil-dados-reais.ts');

async function testar(nome, fn) {
  await fn();
  checks += 1;
  console.log(`PASS ${nome}`);
}

await testar('marketing por canal é somado, arredondado e não vira zero', () => {
  assert.equal(dadosReais.investimentoMarketingDoPlano({
    marketing: [
      { canal: 'Instagram Ads', valor: 1000.1 },
      { canal: 'Google Ads', valor: '250,25' },
      { canal: 'Inválido', valor: -90 },
      null,
    ],
    marketing_total: 99999,
  }), 1250.35);
});

await testar('lista presente prevalece sobre total legado e escalares continuam compatíveis', () => {
  assert.equal(dadosReais.investimentoMarketingDoPlano({ marketing: [], marketing_total: 9000 }), 0);
  assert.equal(dadosReais.investimentoMarketingDoPlano({ marketing_total: '1.234,56' }), 1234.56);
  assert.equal(dadosReais.investimentoMarketingDoPlano({ investimento_marketing: 800 }), 800);
});

await query(
  `INSERT INTO vendas_crm (id, tenant_id, status, data) VALUES
    ('v1','agencia-a','CONFIRMADO','{"valor_final":10000}'),
    ('v2','agencia-a','CONCLUIDO','{"valor_total_venda":8000}'),
    ('v3','agencia-a','fechada','{"valor_total":6000}'),
    ('v4','agencia-a','RESERVADO','{"valor_final":100000}'),
    ('v5','agencia-a','CANCELADO','{"valor_final":100000}'),
    ('v6','agencia-a','CONFIRMADO','{"valor_final":"valor-invalido"}'),
    ('v7','agencia-b','CONFIRMADO','{"valor_final":999999}')`,
);
await query(
  `INSERT INTO propostas (id, tenant_id, status) VALUES
    ('p1','agencia-a','RASCUNHO'),
    ('p2','agencia-a','ENVIADO'),
    ('p3','agencia-a','ACEITO'),
    ('p4','agencia-a','CONVERTIDO'),
    ('p5','agencia-a','RECUSADO'),
    ('p6','agencia-b','ACEITO')`,
);
await query(
  `INSERT INTO cac_mensal (id, tenant_id, mes, data) VALUES
    ('c1','agencia-a','2026-08','{"cac":321.45}'),
    ('c2','agencia-a','2999-01','{"cac":99999}'),
    ('c3','agencia-b','2026-09','{"cac":77777}')`,
);
await query(
  `INSERT INTO planejamento_custos (id, tenant_id, mes, data) VALUES
    ('pc1','agencia-a','2026-09',
      '{"margem_comissao":25,"marketing":[{"canal":"Instagram Ads","valor":8700},{"canal":"Google Ads","valor":300.55}]}'),
    ('pc2','agencia-a','2999-01',
      '{"margem_comissao":99,"marketing":[{"canal":"Instagram Ads","valor":99999}]}'),
    ('pc3','agencia-b','2026-09',
      '{"margem_comissao":88,"marketing":[{"canal":"Instagram Ads","valor":77777}]}')`,
);

await testar('dados reais usam status/campos canônicos e isolam o tenant', async () => {
  const result = await dadosReais.getDadosReaisAgencia('agencia-a');
  assert.equal(result.ticket_medio, 8000);
  assert.equal(result.taxa_proposta_aceita, 50);
  assert.equal(result.cac_medio, 321.45);
  assert.equal(result.margem_minima, 25);
  assert.equal(result.investimento_marketing, 9000.55);
  assert.match(result.ultima_atualizacao, /^\d{4}-\d{2}-\d{2}T/);
});

await testar('planos futuros não substituem o mês corrente', async () => {
  const result = await dadosReais.getDadosReaisAgencia('agencia-a');
  assert.notEqual(result.cac_medio, 99999);
  assert.notEqual(result.investimento_marketing, 99999);
  assert.notEqual(result.margem_minima, 99);
});

await testar('agência sem dados recebe apenas métricas finitas zeradas', async () => {
  const result = await dadosReais.getDadosReaisAgencia('sem-dados');
  for (const [key, value] of Object.entries(result)) {
    if (key !== 'ultima_atualizacao') assert.equal(value, 0, key);
  }
});

console.log(`\n${checks}/${checks} testes passaram`);
await database.close();
