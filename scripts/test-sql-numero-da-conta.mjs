/**
 * O número da conta, contra um Postgres real (PGlite).
 *
 * O que só um banco de verdade pega: a guarda pelo DEFAULT da coluna, o
 * terceiro argumento do setval (sem ele a primeira conta de um banco novo
 * seria a número 2), e o índice único.
 *
 * O SQL é extraído do próprio db.ts, então código e teste não divergem.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}

const fonte = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');

function trecho(de, ate) {
  const i = fonte.indexOf(de);
  if (i < 0) throw new Error(`não achei: ${de}`);
  const j = fonte.indexOf(ate, i);
  if (j < 0) throw new Error(`não achei o fim: ${ate}`);
  return fonte.slice(i, j + ate.length);
}

const CRIA_TABELA = trecho('CREATE TABLE IF NOT EXISTS tenants (', 'idx_tenants_status ON tenants(status);');
// A migração inteira, como ela roda no initDB.
const MIGRACAO = trecho('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS numero INTEGER;', 'uq_tenants_numero ON tenants(numero);');

eq(/setval\(/.test(MIGRACAO) && /> 0\s*\n?\s*\);/.test(MIGRACAO), true, 'a migração usa setval com o terceiro argumento');

async function novoBanco() {
  const db = new PGlite();
  await db.exec(CRIA_TABELA);
  return db;
}
const inserir = (db, id, slug, quando) => db.query(
  `INSERT INTO tenants (id, slug, nome, data, created_at) VALUES ($1, $2, $3, '{}'::jsonb, $4)`,
  [id, slug, slug, quando]);
const numeros = async (db) => (await db.query(`SELECT slug, numero FROM tenants ORDER BY numero`)).rows;

console.log('--- banco com contas antigas: numera pela ordem de criação ---');
{
  const db = await novoBanco();
  await inserir(db, 'b', 'segunda', '2026-02-01T00:00:00Z');
  await inserir(db, 'a', 'primeira', '2026-01-01T00:00:00Z');
  await inserir(db, 'c', 'terceira', '2026-03-01T00:00:00Z');
  await db.exec(MIGRACAO);
  eq(await numeros(db), [
    { slug: 'primeira', numero: 1 }, { slug: 'segunda', numero: 2 }, { slug: 'terceira', numero: 3 },
  ], 'a conta mais antiga é a número 1');

  console.log('--- initDB roda a cada requisição: rodar de novo não renumera ---');
  await db.exec(MIGRACAO);
  await db.exec(MIGRACAO);
  eq(await numeros(db), [
    { slug: 'primeira', numero: 1 }, { slug: 'segunda', numero: 2 }, { slug: 'terceira', numero: 3 },
  ], 'três execuções, os mesmos números');

  console.log('--- conta nova continua a sequência ---');
  await inserir(db, 'd', 'quarta', '2026-04-01T00:00:00Z');
  eq((await db.query(`SELECT numero FROM tenants WHERE slug = 'quarta'`)).rows[0].numero, 4, 'a quarta conta é a número 4');
  await db.exec(MIGRACAO);
  eq((await db.query(`SELECT numero FROM tenants WHERE slug = 'quarta'`)).rows[0].numero, 4, 'e a migração rodando de novo não a mexe');
}

console.log('--- banco vazio: a PRIMEIRA conta é a 1, não a 2 ---');
{
  // É para isto que serve o terceiro argumento do setval. Sem ele a conta
  // de uma instalação nova nasceria com o número 2.
  const db = await novoBanco();
  await db.exec(MIGRACAO);
  await inserir(db, 'x', 'unica', '2026-01-01T00:00:00Z');
  eq((await db.query(`SELECT numero FROM tenants WHERE slug = 'unica'`)).rows[0].numero, 1, 'a primeira conta de um banco novo é a número 1');
}

console.log('--- dois números iguais não entram ---');
{
  const db = await novoBanco();
  await inserir(db, 'a', 'uma', '2026-01-01T00:00:00Z');
  await db.exec(MIGRACAO);
  let barrou = false;
  try {
    await db.query(`INSERT INTO tenants (id, slug, nome, numero, data) VALUES ('z', 'outra', 'outra', 1, '{}'::jsonb)`);
  } catch { barrou = true; }
  eq(barrou, true, 'o índice único barra número repetido');
}

console.log('--- o número sobrevive a uma conta apagada ---');
{
  // Apagar a conta 2 não pode renumerar a 3: o número é a identidade que o
  // cliente já decorou e que o suporte já anotou.
  const db = await novoBanco();
  await inserir(db, 'a', 'uma', '2026-01-01T00:00:00Z');
  await inserir(db, 'b', 'duas', '2026-02-01T00:00:00Z');
  await inserir(db, 'c', 'tres', '2026-03-01T00:00:00Z');
  await db.exec(MIGRACAO);
  await db.query(`DELETE FROM tenants WHERE slug = 'duas'`);
  await db.exec(MIGRACAO);
  eq(await numeros(db), [{ slug: 'uma', numero: 1 }, { slug: 'tres', numero: 3 }], 'a terceira continua sendo a 3');
  await inserir(db, 'd', 'quatro', '2026-04-01T00:00:00Z');
  eq((await db.query(`SELECT numero FROM tenants WHERE slug = 'quatro'`)).rows[0].numero, 4, 'e o número 2 não é reaproveitado');
}

console.log(`\n${total - falhas}/${total} testes do número da conta passaram`);
if (falhas > 0) process.exit(1);
