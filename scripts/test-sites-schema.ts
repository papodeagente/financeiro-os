import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { SITES_SCHEMA_SQL } from '../src/lib/sites-schema.ts';

const db = new PGlite();
await db.exec(SITES_SCHEMA_SQL);
await db.query(`INSERT INTO sites_config (tenant_id, company_id, segredo) VALUES ($1, $2, $3::jsonb)`, ['agencia-a', 42, JSON.stringify({ v: 1, iv: 'a', tag: 'b', ct: 'c' })]);
await db.query(`INSERT INTO sites_config (tenant_id, company_id, segredo) VALUES ($1, $2, $3::jsonb)`, ['agencia-b', 42, JSON.stringify({ v: 1, iv: 'd', tag: 'e', ct: 'f' })]);
const id = 'd0d9a84c-ccdf-48aa-9c1a-4a2cd933954c';
const insert = `INSERT INTO sites_eventos
  (tenant_id, id, company_id, tipo, pedido_codigo, agregado_tipo, agregado_id, agregado_versao, criado_em, corpo_sha256, dados)
  VALUES ($1, $2, 42, 'pagamento.recebido', 'ET-123', 'pedido', '123', 1, NOW(), 'hash', '{}')
  ON CONFLICT (tenant_id, id) DO NOTHING`;
assert.equal((await db.query(insert, ['agencia-a', id])).affectedRows, 1);
assert.equal((await db.query(insert, ['agencia-a', id])).affectedRows, 0);
assert.equal((await db.query(insert, ['agencia-b', id])).affectedRows, 1);
const r = await db.query(`SELECT count(*)::int AS n FROM sites_eventos WHERE tenant_id = $1`, ['agencia-a']);
assert.equal(r.rows[0]?.n, 1);
await db.close();
console.log('PASS EnturOS Sites: esquema, idempotência e isolamento por agência');
