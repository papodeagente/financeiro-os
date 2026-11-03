import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { SITES_SCHEMA_SQL } from '../src/lib/sites-schema.ts';

const db = new PGlite();
await db.exec(SITES_SCHEMA_SQL);
await db.query(`INSERT INTO sites_config (tenant_id, company_id, segredo) VALUES ($1, $2, $3::jsonb)`, ['agencia-a', 42, JSON.stringify({ v: 1, iv: 'a', tag: 'b', ct: 'c' })]);
await db.query(`INSERT INTO sites_config (tenant_id, company_id, segredo) VALUES ($1, $2, $3::jsonb)`, ['agencia-b', 43, JSON.stringify({ v: 1, iv: 'd', tag: 'e', ct: 'f' })]);
await assert.rejects(
  db.query(`INSERT INTO sites_config (tenant_id, company_id, segredo) VALUES ($1, $2, $3::jsonb)`, ['agencia-c', 42, '{}']),
  /unique|duplicate/i,
  'uma empresa do Sites não pode alimentar dois tenants do Financeiro',
);
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

// O retrato só avança e o livro tem chave natural por tenant.
await db.query(`INSERT INTO sites_reservas
  (tenant_id,reserva_id,versao,situacao,total_centavos,ocorrido_em,evento_id,dados)
  VALUES ('agencia-a','7',2,'confirmada',50000,NOW(),$1,'{}')`, [id]);
const idAntigo = 'd0d9a84c-ccdf-48aa-9c1a-4a2cd933954d';
await db.query(`INSERT INTO sites_reservas
  (tenant_id,reserva_id,versao,situacao,total_centavos,ocorrido_em,evento_id,dados)
  VALUES ('agencia-a','7',1,'criada',10000,NOW(),$1,'{}')
  ON CONFLICT (tenant_id,reserva_id) DO UPDATE SET versao=EXCLUDED.versao,situacao=EXCLUDED.situacao
  WHERE EXCLUDED.versao > sites_reservas.versao`, [idAntigo]);
const estado = await db.query(`SELECT versao,situacao FROM sites_reservas WHERE tenant_id='agencia-a' AND reserva_id='7'`);
assert.deepEqual(estado.rows[0], { versao: 2, situacao: 'confirmada' });

await db.query(`INSERT INTO sites_movimentos
  (tenant_id,chave_natural,evento_id,company_id,tipo,categoria,referencia,valor_centavos,estado,efetivo,ocorrido_em,dados)
  VALUES ('agencia-a','pagamento:88',$1,42,'pagamento.recebido','recebimento','88',30000,'recebido',true,NOW(),'{}')`, [id]);
await db.query(`INSERT INTO sites_movimentos
  (tenant_id,chave_natural,evento_id,company_id,tipo,categoria,referencia,valor_centavos,estado,efetivo,ocorrido_em,dados)
  VALUES ('agencia-a','pagamento:88',$1,42,'pagamento.recebido','recebimento','88',30000,'recebido',true,NOW(),'{}')
  ON CONFLICT (tenant_id,chave_natural) DO UPDATE SET evento_id=EXCLUDED.evento_id`, [idAntigo]);
const movs = await db.query(`SELECT count(*)::int AS n FROM sites_movimentos WHERE tenant_id='agencia-a'`);
assert.equal(movs.rows[0]?.n, 1);
await db.close();
console.log('PASS EnturOS Sites: esquema, idempotência e isolamento por agência');
