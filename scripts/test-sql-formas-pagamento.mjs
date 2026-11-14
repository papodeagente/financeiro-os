/**
 * Formas de pagamento no banco (05/11/2026), contra um Postgres real
 * (PGlite), rodando o código DE PRODUÇÃO (src/lib/formas-pagamento-servidor.ts).
 *
 * Uso: node --no-warnings scripts/test-sql-formas-pagamento.mjs
 */
import { register } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}
async function falha(p) { try { await p; return null; } catch (e) { return { status: e?.status ?? null, msg: e?.message ?? String(e) }; } }

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL);
`);
const query = async (text, values) => {
  const r = await pg.query(text, values);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { FORMAS_PAGAMENTO_SCHEMA_SQL, listarFormas, salvarForma, excluirForma } = await import('../src/lib/formas-pagamento-servidor.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');

const T = 't1', OUTRA = 't2';
console.log('--- Sem a tabela: as formas de sempre continuam ---');
eq((await listarFormas(pool, T)).length, 10, 'antes de criar a tabela, lista as 10 formas de sempre');

await pg.exec(FORMAS_PAGAMENTO_SCHEMA_SQL);
await pg.exec(FORMAS_PAGAMENTO_SCHEMA_SQL); // idempotente
await pg.exec(BAIXAS_SCHEMA_SQL);
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1',$1,'{"nome":"Stone"}'),('b9',$2,'{"nome":"Outra"}')`, [T, OUTRA]);

console.log('--- Ajustar uma forma de sempre ---');
const cc = await salvarForma(pool, T, { conta_bancaria_id: 'b1', dias_para_cair: 30, taxa_pct: 3.49, taxa_fixa: 0.5, nome: 'Tentou renomear' }, 'CARTAO_CREDITO');
eq([cc.nome, cc.conta_bancaria_id, cc.dias_para_cair, cc.taxa_pct, cc.taxa_fixa], ['Cartão de crédito', 'b1', 30, 3.49, 0.5], 'conta, dias e taxa gravados; o nome de sempre fica');
const linha = (await query(`SELECT taxa_fixa_centavos::int AS c, sistema FROM formas_pagamento WHERE tenant_id=$1 AND id='CARTAO_CREDITO'`, [T])).rows[0];
eq([linha.c, linha.sistema], [50, true], 'taxa fixa em centavos no banco');
eq(await falha(salvarForma(pool, T, { conta_bancaria_id: 'b9' }, 'PIX')), { status: 409, msg: 'A conta bancária escolhida não existe nesta agência.' }, 'conta de outra agência recusada');
eq(await falha(salvarForma(pool, T, { taxa_pct: 120 }, 'PIX')), { status: 400, msg: 'A taxa em porcentagem precisa ficar entre 0 e 99,99%.' }, 'taxa fora da faixa recusada');
await salvarForma(pool, T, { ativo: false }, 'CHEQUE');
eq((await listarFormas(pool, T)).find(f => f.codigo === 'CHEQUE').ativo, false, 'desligar uma forma de sempre');
eq((await listarFormas(pool, OUTRA)).find(f => f.codigo === 'CARTAO_CREDITO').conta_bancaria_id, null, 'o ajuste é só desta agência');

console.log('--- Formas próprias ---');
const vale = await salvarForma(pool, T, { nome: 'Vale-viagem', uso: 'receber' });
eq([vale.codigo, vale.nome, vale.uso, vale.sistema, vale.ativo], ['VALE_VIAGEM', 'Vale-viagem', 'receber', false, true], 'cria com código vindo do nome');
eq(await falha(salvarForma(pool, T, { nome: 'vale-viagem' })), { status: 409, msg: 'Já existe a forma "Vale-viagem".' }, 'nome repetido (sem diferença de maiúsculas) recusado');
eq(await falha(salvarForma(pool, T, { nome: 'Pix' })), { status: 409, msg: 'Já existe a forma "Pix".' }, 'nome de forma de sempre recusado');
const renomeada = await salvarForma(pool, T, { nome: 'Vale viagem', uso: 'receber' }, 'VALE_VIAGEM');
eq([renomeada.codigo, renomeada.nome], ['VALE_VIAGEM', 'Vale viagem'], 'renomear mantém o código (o que já foi lançado continua ligado)');
eq(await falha(salvarForma(pool, T, {}, 'NAO_EXISTE')), { status: 404, msg: 'Forma de pagamento não encontrada.' }, 'ajustar forma que não existe');

console.log('--- Apagar ---');
eq((await falha(excluirForma(pool, T, 'PIX'))).status, 409, 'forma de sempre não se apaga');
await query(`INSERT INTO contas_receber (id, tenant_id, data) VALUES ('r1',$1,'{"forma_recebimento":"VALE_VIAGEM"}')`, [T]);
const usada = await falha(excluirForma(pool, T, 'VALE_VIAGEM'));
eq([usada.status, /1 lançamento/.test(usada.msg)], [409, true], 'forma usada não se apaga (desligar preserva a história)');
await query(`DELETE FROM contas_receber WHERE id = 'r1'`);
await query(`INSERT INTO baixas (id, tenant_id, titulo_tabela, titulo_id, data_baixa, forma, origem) VALUES ('x1',$1,'contas_receber','r9','2026-11-05','VALE_VIAGEM','tela')`, [T]);
eq((await falha(excluirForma(pool, T, 'VALE_VIAGEM'))).status, 409, 'usada numa baixa também conta');
await query(`DELETE FROM baixas`);
await excluirForma(pool, T, 'VALE_VIAGEM');
eq((await listarFormas(pool, T)).some(f => f.codigo === 'VALE_VIAGEM'), false, 'sem uso: apaga');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
