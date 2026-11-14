/**
 * Grava o retrato da venda do CRM na VERSÃO SIMPLES (commit a9fd7cf), para o
 * teste scripts/test-sql-venda-crm-simples-congelada.mjs.
 *
 * Roda dentro de uma cópia do código de a9fd7cf (não do código de hoje):
 *
 *   mkdir /tmp/a9 && git archive a9fd7cf src scripts package.json tsconfig.json | tar -x -C /tmp/a9
 *   ln -s "$PWD/node_modules" /tmp/a9/node_modules
 *   cp scripts/roteiro-venda-crm-simples.mjs scripts/gerar-retrato-venda-crm-simples.mjs /tmp/a9/scripts/
 *   node --experimental-strip-types --no-warnings /tmp/a9/scripts/gerar-retrato-venda-crm-simples.mjs \
 *     > scripts/fixtures/venda-crm-simples-a9fd7cf.json
 *
 * Não precisa rodar de novo: o retrato é da versão simples congelada.
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { TABELAS_SQL, rodar, retrato } from './roteiro-venda-crm-simples.mjs';

const pg = new PGlite();
await pg.exec(TABELAS_SQL);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
// Avisos ao CRM saem pela fila; o envio de verdade não acontece no teste.
globalThis.fetch = async () => new Response('{}', { status: 200 });

const { processarEventoCRM } = await import('../src/lib/crm-integration.ts');
const acoes = await rodar(processarEventoCRM, query);
process.stdout.write(JSON.stringify({ origem: 'a9fd7cf', acoes, retrato: await retrato(query) }, null, 1) + '\n');
