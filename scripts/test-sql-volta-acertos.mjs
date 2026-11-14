/**
 * Acertos da volta da versão completa (14/11/2026) contra um Postgres real
 * (PGlite), pelo initDB DE PRODUÇÃO.
 *
 * Monta o banco no estado de produção: a versão completa rodou (05/11 a
 * 12/11, razão aberto), depois a versão simples rodou em cima (gatilho de
 * auditoria em toda tabela com tenant_id, dinheiro mexido sem razão, conta
 * nova, proposta sem token). O boot da completa acerta; o boot seguinte não
 * muda nada.
 *
 * Uso: node --no-warnings scripts/test-sql-volta-acertos.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { carregarAplicacao } from './carregar-initdb-isolado.mjs';

let total = 0;
function ok(cond, label) { total++; assert.ok(cond, label); console.log(`PASS  ${label}`); }
function eq(a, b, label) { total++; assert.deepEqual(a, b, label); console.log(`PASS  ${label}`); }

const pg = new PGlite();
const um = async (sql, v) => (await pg.query(sql, v)).rows[0];
const todos = async (sql, v) => (await pg.query(sql, v)).rows;
const silenciar = async fn => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };

// A lista do acerto é a mesma do instalador da auditoria (sem deriva).
const fonteAudit = readFileSync(new URL('../src/lib/audit-schema.ts', import.meta.url), 'utf8');
const notIn = fonteAudit.match(/c\.table_name NOT IN \(([\s\S]*?)\)/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
const fonteAcertos = readFileSync(new URL('../src/lib/volta-acertos.ts', import.meta.url), 'utf8');
const lista = fonteAcertos.match(/TABELAS_FORA_DA_AUDITORIA = \[([\s\S]*?)\] as const/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
eq([...lista].sort(), notIn.filter(t => !['audit_log', 'api_cache', 'audit_config', 'grupo_eventos'].includes(t)).sort(),
  'lista do acerto = tabelas que a auditoria completa deixa de fora');

// ---- 1. A versão completa roda (05/11): esquema inteiro e razão aberto ----
await silenciar(() => carregarAplicacao(pg).initDB());
eq((await todos(`SELECT chave FROM marcos_de_migracao WHERE chave LIKE 'volta_completa%' ORDER BY 1`)).length, 3, 'banco novo: os três marcos já nascem marcados');
// Em produção a completa de 05/11 não tinha os acertos: sem marco.
await pg.query(`DELETE FROM marcos_de_migracao WHERE chave LIKE 'volta_completa%'`);

const conta = (id, t, inicial, atual, nome = id) => pg.query(
  `INSERT INTO contas_bancarias (id, tenant_id, nome, banco, data) VALUES ($1,$2,$3,'',$4)`,
  [id, t, nome, JSON.stringify({ id, nome, saldo_inicial: inicial, saldo_atual: atual })]);
const lancar = (t, lanc) => pg.query(`SELECT razao_lancar($1, $2::jsonb, true)`, [t, JSON.stringify(lanc)]);
const mov = (chave, conta_id, centavos, tipo = 'baixa_receber', contra = 'CLIENTES') => ({
  chave_natural: chave, tipo_evento: tipo, partidas: [
    { conta: 'BANCO', conta_bancaria_id: conta_id, valor_centavos: centavos },
    { conta: contra, conta_bancaria_id: conta_id, valor_centavos: -centavos }],
});

await conta('c1', 'tA', 1000, 1200);
await conta('d1', 'tB', 500, 500);
await conta('e1', 'tC', 50, 50);
await pg.query(`INSERT INTO razao_estado (tenant_id) VALUES ('tA'), ('tB')`);
await lancar('tA', mov('abertura:contas_bancarias:c1', 'c1', 100000, 'abertura', 'ABERTURA'));
await lancar('tA', mov('baixa:1', 'c1', 20000));
await lancar('tB', mov('abertura:contas_bancarias:d1', 'd1', 50000, 'abertura', 'ABERTURA'));

// ---- 2. A versão simples roda por cima (12/11 até a publicação) ----
// O instalador dela pôs o gatilho de auditoria em toda tabela com tenant_id.
for (const t of lista) {
  const existe = (await um(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`])).ok;
  if (existe) await pg.exec(`DROP TRIGGER IF EXISTS audit_capture_row_v1 ON ${t}; CREATE TRIGGER audit_capture_row_v1 AFTER INSERT OR UPDATE OR DELETE ON ${t} FOR EACH ROW EXECUTE FUNCTION audit_capture_row()`);
}
const comGatilho = async () => Number((await um(
  `SELECT COUNT(*)::int AS n FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
    WHERE g.tgname = 'audit_capture_row_v1' AND c.relname = ANY($1::text[])`, [lista])).n);
ok(await comGatilho() > 30, 'estado da simples: gatilho de auditoria nas tabelas de controle');
// Dinheiro mexido sem razão, conta nova com movimento, propostas.
await pg.query(`UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_atual}', '1500') WHERE id = 'c1'`);
await conta('c2', 'tA', 100, 160);
await pg.query(`INSERT INTO propostas (id, tenant_id, data) VALUES ('p-antiga', 'tA', '{}'), ('p-token', 'tA', '{}')`);
await pg.query(`UPDATE propostas SET token_publico_hash = 'h1' WHERE id = 'p-token'`);
// A conferência das 3h acusaria: razão de c1 = 1200, saldo = 1500.
const diferencas = async () => todos(
  `SELECT c.id, ROUND((c.data->>'saldo_atual')::numeric*100)::bigint - COALESCE(r.saldo_centavos,0) AS dif
     FROM contas_bancarias c LEFT JOIN razao_saldo_bancario r ON r.tenant_id = c.tenant_id AND r.conta_bancaria_id = c.id
    WHERE c.tenant_id IN ('tA','tB') ORDER BY c.id`);
eq((await diferencas()).map(r => [r.id, Number(r.dif)]), [['c1', 30000], ['c2', 16000], ['d1', 0]], 'antes: razão não bate (intervalo da simples)');

// ---- 3. A completa volta: boot com os acertos ----
await silenciar(() => carregarAplicacao(pg).initDB());

eq(await comGatilho(), 0, 'gatilho de auditoria saiu de todas as tabelas de controle');
ok(Number((await um(`SELECT COUNT(*)::int AS n FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE g.tgname = 'audit_capture_row_v1' AND c.relname = 'contas_bancarias'`)).n) === 1,
  'tabela de cadastro continua auditada');
const antiga = await um(`SELECT link_por_id_ate > NOW() + INTERVAL '179 days' AS ok FROM propostas WHERE id = 'p-antiga'`);
ok(antiga.ok === true, 'proposta sem token da simples abre pelo link antigo por 180 dias');
eq((await um(`SELECT link_por_id_ate FROM propostas WHERE id = 'p-token'`)).link_por_id_ate, null, 'proposta com token não ganha link pelo id');

eq((await diferencas()).map(r => [r.id, Number(r.dif)]), [['c1', 0], ['c2', 0], ['d1', 0]], 'depois: razão bate com o saldo em todas as contas');
const revisao = await todos(`SELECT tenant_id, conta_bancaria_id, diferenca_centavos::int AS d, (dados->>'intervalo_de') AS de
  FROM razao_conferencias WHERE tipo = 'reabertura' ORDER BY conta_bancaria_id`);
eq(revisao.map(r => [r.tenant_id, r.conta_bancaria_id, r.d, r.de]),
  [['tA', 'c1', 30000, '2026-11-12'], ['tA', 'c2', 6000, '2026-11-12'], ['tB', 'd1', 0, '2026-11-12']],
  'diferença do intervalo listada para revisão (conta nova: só o que mexeu depois do saldo inicial)');
eq(Number((await um(`SELECT valor_centavos FROM razao_partidas p JOIN razao_lancamentos l ON l.tenant_id=p.tenant_id AND l.id=p.lancamento_id
  WHERE l.chave_natural = 'abertura:contas_bancarias:c2' AND p.conta='BANCO'`)).valor_centavos), 10000, 'conta nova abre pelo saldo inicial');
eq(Number((await um(`SELECT COALESCE(SUM(valor_centavos),0)::int AS s FROM razao_partidas WHERE tenant_id='tA' AND conta='AJUSTE_A_REVISAR'`)).s), -36000,
  'contrapartida "a revisar" guarda o total do intervalo');
ok((await um(`SELECT dados ? 'reabertura' AS ok FROM razao_estado WHERE tenant_id = 'tA'`)).ok, 'razao_estado marca a reabertura');
eq((await um(`SELECT COUNT(*)::int AS n FROM razao_lancamentos WHERE tenant_id='tB' AND tipo_evento='reabertura'`)).n, 0, 'agência sem diferença não ganha lançamento');
eq((await um(`SELECT COUNT(*)::int AS n FROM razao_estado WHERE tenant_id='tC'`)).n, 0, 'agência sem razão continua esperando a abertura do agendador');
eq(Number((await um(`SELECT (data->>'saldo_atual')::numeric AS s FROM contas_bancarias WHERE id='c1'`)).s), 1500, 'saldo da conta não foi tocado');
eq((await todos(`SELECT chave FROM marcos_de_migracao WHERE chave LIKE 'volta_completa%' ORDER BY 1`)).map(r => r.chave),
  ['volta_completa_gatilhos_de_auditoria', 'volta_completa_propostas_link_por_id', 'volta_completa_razao_reaberto'], 'três marcos gravados');

// ---- 4. Rodar de novo não muda nada ----
const retrato = async () => JSON.stringify([
  await todos(`SELECT tenant_id, chave_natural FROM razao_lancamentos ORDER BY 1,2`),
  await todos(`SELECT tenant_id, conta_bancaria_id, tipo, diferenca_centavos FROM razao_conferencias ORDER BY 1,2,3`),
  await todos(`SELECT id, link_por_id_ate FROM propostas ORDER BY 1`),
  await todos(`SELECT tenant_id, dados FROM razao_estado ORDER BY 1`),
  await comGatilho(),
]);
const antes = await retrato();
// Proposta nova da completa (sem token ainda) não pode ganhar link pelo id.
await pg.query(`INSERT INTO propostas (id, tenant_id, data) VALUES ('p-nova', 'tA', '{}')`);
await silenciar(() => carregarAplicacao(pg).initDB());
eq((await um(`SELECT link_por_id_ate FROM propostas WHERE id = 'p-nova'`)).link_por_id_ate, null, 'proposta nova da completa nunca ganha link pelo id');
await pg.query(`DELETE FROM propostas WHERE id = 'p-nova'`);
eq(await retrato(), antes, 'segundo boot: nada muda');

// A função de acerto chamada de novo, direto, também não muda nada.
const app = carregarAplicacao(pg);
await silenciar(() => app.initDB());
eq(await retrato(), antes, 'terceiro boot: nada muda');

await pg.close();
console.log(`\n${total} verificações, todas passaram.`);
