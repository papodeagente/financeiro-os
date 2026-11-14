/**
 * Roda o initDB DE PRODUÇÃO (src/lib/db.ts, com todas as migrações) contra um
 * PGlite isolado. Mesmo carregador de scripts/test-audit-infrastructure.mjs,
 * com `connect()` para o que abre transação própria no boot (a reabertura do
 * razão nos acertos da volta).
 *
 * Uso: const { initDB } = carregarAplicacao(pglite); await initDB();
 * Cada chamada devolve um módulo novo (initialized = false): é um boot novo.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const requireNative = createRequire(import.meta.url);
const raiz = path.resolve(import.meta.dirname, '..');

export function carregarAplicacao(database) {
  const carregados = new Map();
  async function executar(sql, params) {
    if (!params) {
      const resultados = await database.exec(sql);
      const ultimo = resultados.at(-1) || { rows: [] };
      return { ...ultimo, rowCount: ultimo.affectedRows ?? 0 };
    }
    const r = await database.query(sql, params);
    return { ...r, rowCount: r.affectedRows ?? 0 };
  }
  class PoolIsolado {
    constructor(_opcoes, resolverContexto) { this.resolverContexto = resolverContexto; }
    async query(sql, params) {
      await database.query('SELECT set_config($1,$2,false)', ['app.audit_context', JSON.stringify(await this.resolverContexto())]);
      return executar(sql, params);
    }
    async connect() {
      await database.query('SELECT set_config($1,$2,false)', ['app.audit_context', JSON.stringify(await this.resolverContexto())]);
      return { query: executar, release() {} };
    }
  }
  function carregar(relativo) {
    const arquivo = path.resolve(raiz, relativo);
    if (carregados.has(arquivo)) return carregados.get(arquivo).exports;
    const modulo = { exports: {} };
    carregados.set(arquivo, modulo);
    const fonte = ts.transpileModule(readFileSync(arquivo, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(fonte, {
      module: modulo, exports: modulo.exports, console, Buffer,
      process: { env: { DATABASE_URL: 'isolated-test' }, cwd: () => raiz },
      require(nome) {
        if (nome === './audit-pool') return { AuditPool: PoolIsolado };
        if (nome === './auth') return { getSession: async () => null, hashPassword: async () => 'isolated' };
        if (nome === 'next/headers') return { headers: async () => { throw new Error('No request'); } };
        if (nome.startsWith('.')) return carregar(path.resolve(path.dirname(arquivo), `${nome}.ts`));
        return requireNative(nome);
      },
    }, { filename: arquivo });
    return modulo.exports;
  }
  return carregar('src/lib/db.ts');
}
