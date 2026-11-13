import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { AuditPool } from '../src/lib/audit-pool.ts';

// Exercita o callback real usado por pg.Pool.query, além de transações explícitas.
const originalConnect = Pool.prototype.connect;
const client = new EventEmitter();
let current = null;
let failContext = false;
let released = 0;
const commands = [];
client.release = () => { released++; };
client.query = (sql, values, callback) => {
  const execute = async () => {
    commands.push(sql);
    if (sql.startsWith('SELECT set_config')) {
      if (failContext) throw new Error('context-failed');
      current = JSON.parse(values[1]);
    }
    return { rows: [{ actor: current?.userId }], rowCount: 1 };
  };
  const pending = execute();
  if (callback) { void pending.then(result => callback(null, result), callback); return; }
  return pending;
};
Pool.prototype.connect = async () => client;
try {
  let actor = { userId: 'a', userName: 'Ana', tenantId: 't1', perfil: 'ADMIN', source: 'USUARIO' };
  const pool = new AuditPool({}, async () => ({ ...actor }));
  assert.equal((await pool.query('SELECT actor')).rows[0].actor, 'a');
  assert.equal(released, 1);
  actor = { ...actor, userId: 'b', tenantId: 't2' };
  const transaction = await pool.connect();
  await transaction.query('BEGIN');
  assert.equal((await transaction.query('UPDATE entidade')).rows[0].actor, 'b');
  await transaction.query('ROLLBACK');
  transaction.release();
  actor = { ...actor, userId: '', tenantId: '', source: 'SISTEMA' };
  await new Promise((resolve, reject) => pool.query('SELECT actor', [], (error, result) => {
    if (error) return reject(error);
    assert.equal(result.rows[0].actor, '');
    resolve();
  }));
  failContext = true;
  const before = commands.length;
  await assert.rejects(pool.query('MUST NOT EXECUTE'), /context-failed/);
  assert.equal(commands.length, before + 1);
  assert.equal(released, 4);
  await pool.end();
  console.log('PASS Pool real: promise, callback, transação, troca de ator e falha fechada');
} finally { Pool.prototype.connect = originalConnect; }

// Executa initDB inteiro, incluindo migrações/seed reais, em um PostgreSQL isolado.
const database = new PGlite();
const requireNative = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
function loadApplication() {
  const loaded = new Map();
  class IsolatedPool {
    constructor(_options, resolveContext) { this.resolveContext = resolveContext; }
    async query(sql, params) {
      await database.query('SELECT set_config($1,$2,false)', ['app.audit_context', JSON.stringify(await this.resolveContext())]);
      if (!params) {
        const results = await database.exec(sql);
        const last = results.at(-1) || { rows: [] };
        return { ...last, rowCount: last.affectedRows ?? 0 };
      }
      const result = await database.query(sql, params);
      return { ...result, rowCount: result.affectedRows ?? 0 };
    }
  }
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (loaded.has(filename)) return loaded.get(filename).exports;
    const loadedModule = { exports: {} };
    loaded.set(filename, loadedModule);
    const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
      module: loadedModule, exports: loadedModule.exports, console, Buffer,
      process: { env: { DATABASE_URL: 'isolated-test' } },
      require(name) {
        if (name === './audit-pool') return { AuditPool: IsolatedPool };
        if (name === './auth') return { getSession: async () => null, hashPassword: async () => 'isolated' };
        if (name === 'next/headers') return { headers: async () => { throw new Error('No request'); } };
        if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
        return requireNative(name);
      },
    }, { filename });
    return loadedModule.exports;
  }
  return load('src/lib/db.ts');
}
try {
  const first = loadApplication();
  await Promise.all([first.initDB(), first.initDB()]);
  const coverage = (await database.query("SELECT * FROM audit_config WHERE id='capture-v1'")).rows[0];
  assert.ok(coverage.data.tables.length >= 50);
  assert.equal((await database.query('SELECT count(*)::int AS n FROM audit_log')).rows[0].n, 0);
  await loadApplication().initDB();
  const again = (await database.query("SELECT * FROM audit_config WHERE id='capture-v1'")).rows[0];
  assert.equal(new Date(again.created_at).toISOString(), new Date(coverage.created_at).toISOString());
  await database.query("INSERT INTO clientes (id,tenant_id,data) VALUES ('after-boot','t1','{\"nome\":\"Teste\"}')");
  assert.equal((await database.query("SELECT count(*)::int AS n FROM audit_log WHERE entidade_id='after-boot'")).rows[0].n, 1);
  console.log(`PASS initDB completo: ${coverage.data.tables.length} tabelas, inicialização concorrente, segundo boot e trigger único`);
} finally { await database.close(); }
