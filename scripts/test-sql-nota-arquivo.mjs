/**
 * Isolamento entre agências ao baixar o arquivo da nota, contra um Postgres
 * real (PGlite).
 *
 * A rota /api/fiscal/notas/[id]/arquivo recebe um id pela URL. Sem o
 * tenant_id na cláusula, bastaria o id da nota de outra agência para baixar
 * um documento fiscal que não é seu — e documento fiscal carrega CNPJ,
 * endereço e valores do cliente. Este teste prova que a consulta da rota só
 * encontra nota da própria agência.
 *
 * O SQL é extraído da própria rota, então código e teste não divergem.
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

const db = new PGlite();
const fonte = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
const i = fonte.indexOf('CREATE TABLE IF NOT EXISTS notas_fiscais (');
if (i < 0) throw new Error('notas_fiscais não encontrada em db.ts');
const resto = fonte.slice(i);
const fim = resto.indexOf('CREATE TABLE IF NOT EXISTS', 1);
await db.exec(fim > 0 ? resto.slice(0, fim) : resto);

// A consulta vem do arquivo da rota: se alguém tirar o tenant_id de lá, este
// teste passa a rodar o SQL furado e quebra.
const rota = readFileSync(
  new URL('../src/app/api/fiscal/notas/[id]/arquivo/route.ts', import.meta.url), 'utf8');
const m = rota.match(/`(SELECT data FROM notas_fiscais[^`]*)`/);
if (!m) throw new Error('consulta da rota não encontrada');
const SQL = m[1];
eq(/tenant_id\s*=\s*\$2/.test(SQL), true, 'a consulta da rota filtra por tenant_id');

const A = 'agencia-a', B = 'agencia-b';
async function nota(id, tenant) {
  await db.query(
    `INSERT INTO notas_fiscais (id, tenant_id, status, data) VALUES ($1, $2, $3, $4::jsonb)`,
    [id, tenant, 'AUTORIZADA', JSON.stringify({
      numero: id.toUpperCase(), status: 'AUTORIZADA',
      link_pdf: `https://emissor/pdf/${id}`, link_xml: `https://emissor/xml/${id}`,
    })]);
}
await nota('nota-da-a', A);
await nota('nota-da-b', B);

const buscar = (id, tenant) => db.query(SQL, [id, tenant]).then(r => r.rows.length);

console.log('--- cada agência só acha a sua ---');
eq(await buscar('nota-da-a', A), 1, 'a agência A acha a nota dela');
eq(await buscar('nota-da-b', B), 1, 'a agência B acha a nota dela');
eq(await buscar('nota-da-b', A), 0, 'a agência A NÃO acha a nota da B, mesmo sabendo o id');
eq(await buscar('nota-da-a', B), 0, 'e a B não acha a da A');
eq(await buscar('nota-inexistente', A), 0, 'id que não existe não vira nota de ninguém');

// Prova de que o teste enxerga a falha: sem o tenant_id, o id basta.
const FURADO = SQL.replace(/\s*AND\s+tenant_id\s*=\s*\$2/, '');
const furado = await db.query(FURADO, ['nota-da-b']);
eq(furado.rows.length, 1, 'controle: sem tenant_id na cláusula, o id da outra agência serve');

console.log(`\n${total - falhas}/${total} testes de isolamento do arquivo da nota passaram`);
if (falhas > 0) process.exit(1);
