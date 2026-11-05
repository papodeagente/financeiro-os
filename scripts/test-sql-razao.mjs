/**
 * Razão financeiro (05/11/2026) contra um Postgres real (PGlite), rodando o
 * código DE PRODUÇÃO.
 *
 * Prova três coisas:
 *  1. PORTEIRO — o saldo que a agência vê é exatamente o de antes: baixa
 *     parcial → parcial → quitada, troca de conta, exclusão de conta baixada,
 *     transferência e estorno, Caixa Geral, saldo legado em texto e o
 *     "Recalcular saldos" dão os mesmos números de sempre.
 *  2. RAZÃO — antes da abertura nada é gravado; a abertura parte do saldo de
 *     hoje; depois dela, a cada operação, saldo do razão = saldo_atual; o razão
 *     é imutável, só o "resetar dados" limpa; lançamento que não fecha em zero
 *     vira falha registrada; a mesma chave não grava duas vezes.
 *  3. NUNCA DERRUBA — dentro de uma transação, um razão quebrado não impede a
 *     baixa de acontecer.
 *
 * Uso: node --no-warnings scripts/test-sql-razao.mjs
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
async function erro(p) { try { await p; return null; } catch (e) { return e?.message ?? String(e); } }

const TABELAS = `
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
`;

const pg = new PGlite();
await pg.exec(TABELAS);
const query = async (text, values) => {
  const r = await pg.query(text, values);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { RAZAO_SCHEMA_SQL, RAZAO_LIMPEZA_DA_AGENCIA_SQL } = await import('../src/lib/razao-schema.ts');
const { aplicarMovimentoCaixaAtomico, estornarBaixaDaConta, emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { editarContaNoExecutor } = await import('../src/lib/baixa-de-conta.ts');
const { abrirRazaoNoExecutor, conferirRazaoNoExecutor, registrarMovimento, garantirAberturaDaConta } = await import('../src/lib/razao-servidor.ts');
const { recalcularSaldosCaixa } = await import('../src/lib/caixa-helpers.ts');
const { lancamentoDeMovimento, fechaEmZero } = await import('../src/lib/razao.ts');

const um = async (sql, v) => (await query(sql, v)).rows[0];
const saldo = async id => Number((await um(`SELECT (data->>'saldo_atual')::numeric AS s FROM contas_bancarias WHERE id = $1`, [id]))?.s ?? NaN);
const saldoRazao = async (t, id) => Number((await um(`SELECT COALESCE(saldo_centavos,0) AS s FROM razao_saldo_bancario WHERE tenant_id = $1 AND conta_bancaria_id = $2`, [t, id]))?.s ?? 0) / 100;
const qtdLanc = async t => Number((await um(`SELECT COUNT(*)::int AS n FROM razao_lancamentos WHERE tenant_id = $1`, [t])).n);
const conta = (id, t, data) => query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1,$2,$3)`, [id, t, JSON.stringify(data)]);
const receber = (id, t, data) => query(`INSERT INTO contas_receber (id, tenant_id, status, cliente_id, data) VALUES ($1,$2,$3,$4,$5)`,
  [id, t, data.status ?? 'PENDENTE', data.cliente_id ?? '', JSON.stringify({ id, ...data })]);
const pagar = (id, t, data) => query(`INSERT INTO contas_pagar (id, tenant_id, status, fornecedor_id, data) VALUES ($1,$2,$3,$4,$5)`,
  [id, t, data.status ?? 'PENDENTE', data.fornecedor_id ?? '', JSON.stringify({ id, ...data })]);
const editarCR = (t, id, item) => emTransacao(exec => editarContaNoExecutor(exec, {
  tabela: 'contas_receber', colunasIndice: ['venda_id', 'cliente_id', 'status'], campo: 'valor_recebido', sinal: 1, id, tenantId: t, item,
}));
const editarCP = (t, id, item) => emTransacao(exec => editarContaNoExecutor(exec, {
  tabela: 'contas_pagar', colunasIndice: ['fornecedor_id', 'status'], campo: 'valor_pago', sinal: -1, id, tenantId: t, item,
}));
const transferir = (t, origem, destino, valor, id, sinal = 1) => emTransacao(async exec => {
  const mov = { tipo: 'transferencia', tabela: 'transferencias', id };
  await aplicarMovimentoCaixaAtomico(t, origem, -valor * sinal, exec, mov);
  await aplicarMovimentoCaixaAtomico(t, destino, +valor * sinal, exec, mov);
});

// ---------------------------------------------------------------------------
console.log('--- 0. O mesmo movimento sem o esquema do razão nunca derruba a baixa ---');
{
  // Ainda SEM o esquema novo (banco antigo, antes do initDB rodar): a baixa
  // dentro de uma transação precisa acontecer mesmo assim.
  await conta('b0', 't0', { nome: 'Sem razão', saldo_inicial: 0, saldo_atual: 0 });
  await receber('cr0', 't0', { valor_final: 100, status: 'PENDENTE' });
  await editarCR('t0', 'cr0', { valor_final: 100, status: 'RECEBIDO', valor_recebido: 100, conta_bancaria_id: 'b0' });
  eq(await saldo('b0'), 100, 'banco sem razão: a baixa entrou no saldo (transação não foi envenenada)');
}

await pg.exec(RAZAO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL); // idempotente: roda a cada boot

console.log('--- 1. Antes da abertura: saldo de sempre, razão vazio ---');
await conta('b1', 't1', { nome: 'Inter', saldo_inicial: 1000, saldo_atual: 1000 });
await conta('b2', 't1', { nome: 'Itaú', saldo_inicial: 500, saldo_atual: 500 });
await receber('cr1', 't1', { valor_final: 300, status: 'PENDENTE', cliente_id: 'cli1' });
await editarCR('t1', 'cr1', { valor_final: 300, status: 'PARCIAL', valor_recebido: 100, conta_bancaria_id: 'b1', cliente_id: 'cli1' });
eq(await saldo('b1'), 1100, 'porteiro: parcial de 100 soma 100');
eq(await qtdLanc('t1'), 0, 'sem abertura, nada vai para o razão');

console.log('--- 2. Abertura parte do saldo de hoje ---');
const ab = await emTransacao(exec => abrirRazaoNoExecutor(exec, 't1'));
eq([ab.aberto, ab.jaEstava, ab.contas], [true, false, 2], 'abertura feita para as 2 contas');
eq(await saldoRazao('t1', 'b1'), 1100, 'razão da b1 = saldo de hoje');
eq(await saldoRazao('t1', 'b2'), 500, 'razão da b2 = saldo de hoje');
eq(ab.diferencas.length, 0, 'histórico reconstruído bate com o saldo: nenhuma diferença para revisar');
const ab2 = await emTransacao(exec => abrirRazaoNoExecutor(exec, 't1'));
eq([ab2.jaEstava, await qtdLanc('t1')], [true, 2], 'abrir de novo não grava nada (idempotente)');

console.log('--- 3. Depois da abertura: razão = saldo depois de cada operação ---');
async function confere(label) {
  for (const id of ['b1', 'b2']) eq(await saldoRazao('t1', id), await saldo(id), `${label}: razão = saldo (${id})`);
}
await editarCR('t1', 'cr1', { valor_final: 300, status: 'PARCIAL', valor_recebido: 250, conta_bancaria_id: 'b1', cliente_id: 'cli1' });
eq(await saldo('b1'), 1250, 'porteiro: parcial → parcial soma só a diferença (150)');
await confere('parcial → parcial');
await editarCR('t1', 'cr1', { valor_final: 300, status: 'RECEBIDO', valor_recebido: 300, conta_bancaria_id: 'b1', cliente_id: 'cli1' });
eq(await saldo('b1'), 1300, 'porteiro: quitação soma o restante (50)');
await confere('quitação');
await editarCR('t1', 'cr1', { valor_final: 300, status: 'RECEBIDO', valor_recebido: 300, conta_bancaria_id: 'b2', cliente_id: 'cli1' });
eq([await saldo('b1'), await saldo('b2')], [1000, 800], 'porteiro: trocar a conta da baixa tira de uma e põe na outra');
await confere('troca de conta');

await pagar('cp1', 't1', { valor_final: 120.35, status: 'PENDENTE', fornecedor_id: 'f1' });
await editarCP('t1', 'cp1', { valor_final: 120.35, status: 'PAGO', valor_pago: 120.35, conta_bancaria_id: 'b1', fornecedor_id: 'f1' });
eq(await saldo('b1'), 879.65, 'porteiro: pagamento sai do saldo');
await confere('pagamento');

await transferir('t1', 'b2', 'b1', 200, 'tr1');
eq([await saldo('b1'), await saldo('b2')], [1079.65, 600], 'porteiro: transferência sai da origem e entra no destino');
await confere('transferência');
await transferir('t1', 'b2', 'b1', 200, 'tr1', -1);
eq([await saldo('b1'), await saldo('b2')], [879.65, 800], 'porteiro: estorno da transferência devolve');
await confere('estorno da transferência');

const cp1 = (await um(`SELECT data FROM contas_pagar WHERE id = 'cp1'`)).data;
await emTransacao(exec => estornarBaixaDaConta('t1', 'contas_pagar', cp1, exec));
await query(`DELETE FROM contas_pagar WHERE id = 'cp1'`); // a rota apaga a linha depois do estorno
eq(await saldo('b1'), 1000, 'porteiro: excluir conta paga devolve o pagamento');
await confere('exclusão de conta baixada');

for (let i = 0; i < 300; i++) await aplicarMovimentoCaixaAtomico('t1', 'b1', 0.01, undefined, { tipo: 'ajuste', tabela: 'teste', id: `c${i}` });
eq(await saldo('b1'), 1003, 'porteiro: 300 × R$ 0,01 = R$ 3,00 exato');
await confere('300 movimentos de um centavo (cada um na sua transação)');

const p1 = await um(`SELECT COUNT(*)::int AS n FROM razao_lancamentos l WHERE tenant_id='t1' AND NOT EXISTS (
  SELECT 1 FROM razao_partidas p WHERE p.tenant_id=l.tenant_id AND p.lancamento_id=l.id GROUP BY p.lancamento_id HAVING SUM(valor_centavos)=0)`);
eq(p1.n, 0, 'todo lançamento do razão fecha em zero');
const pes = await um(`SELECT pessoa_id FROM razao_partidas WHERE tenant_id='t1' AND titulo_id='cp1' LIMIT 1`);
eq(pes.pessoa_id, 'f1', 'o razão guarda o fornecedor do pagamento');

console.log('--- 4. Caixa Geral e saldo legado em texto ---');
await conta('b3', 't1', { nome: 'Texto', saldo_atual: 'abc' });
await aplicarMovimentoCaixaAtomico('t1', 'b3', 50, undefined, { tipo: 'ajuste', tabela: 'teste', id: 'x' });
eq(await saldo('b3'), 50, 'porteiro: saldo textual inválido continua virando 0 + movimento');
await aplicarMovimentoCaixaAtomico('t1', null, 70, undefined, { tipo: 'ajuste', tabela: 'teste', id: 'y' });
const cg = await um(`SELECT id FROM contas_bancarias WHERE tenant_id='t1' AND data->>'nome' = 'Caixa Geral'`);
eq([!!cg, await saldo(cg.id)], [true, 70], 'porteiro: movimento sem conta cria e usa a Caixa Geral');
eq(await saldoRazao('t1', cg.id), 70, 'o razão acompanha a Caixa Geral');

console.log('--- 5. Conferência ---');
let conf = await emTransacao(exec => conferirRazaoNoExecutor(exec, 't1'));
// b3 nasceu depois da abertura com saldo textual e não passou pelo cadastro:
// a conferência mostra exatamente essa conta e mais nenhuma.
const comDiferenca = conf.linhas.filter(l => l.diferenca !== 0).map(l => l.conta_bancaria_id);
eq(comDiferenca, [], 'conferência zerada em todas as contas');
await query(`UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_atual}', '999') WHERE id = 'b2'`);
conf = await emTransacao(exec => conferirRazaoNoExecutor(exec, 't1'));
eq(conf.linhas.find(l => l.conta_bancaria_id === 'b2').diferenca, 199, 'saldo mexido por fora do caixa aparece na conferência');
await query(`UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_atual}', '800') WHERE id = 'b2'`);

console.log('--- 6. Recalcular saldos: mesmo resultado de sempre, diferença registrada ---');
await query(`UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_atual}', '1') WHERE id = 'b1'`);
const rc = await recalcularSaldosCaixa('t1');
// b1: inicial 1000 + recebido 0 (cr1 está na b2) + nada pago (cp1 foi excluída) = 1000 (os
// movimentos de ajuste do teste não são histórico de títulos, então o recálculo não os vê)
eq(rc.erros, [], 'recalcular sem erro');
eq(await saldo('b1'), 1000, 'porteiro: recalcular reconstrói pela regra de sempre');
eq(rc.ajustes.find(a => a.conta_bancaria_id === 'b1')?.diferenca, 999, 'a diferença aplicada à b1 vem na resposta');
// o razão tinha 1003; o ajuste do recálculo soma os 999 aplicados
eq(await saldoRazao('t1', 'b1'), 2002, 'o ajuste do recálculo entra no razão (nada muda em silêncio)');

console.log('--- 7. Conta criada depois da abertura ---');
await conta('b4', 't1', { nome: 'Nova', saldo_inicial: 321.5, saldo_atual: 321.5 });
eq(await garantirAberturaDaConta(pool, 't1', 'b4'), 'ok', 'saldo inicial da conta nova entra no razão');
eq(await garantirAberturaDaConta(pool, 't1', 'b4'), 'duplicado', 'e só uma vez');
eq(await saldoRazao('t1', 'b4'), 321.5, 'razão da conta nova = saldo inicial');

console.log('--- 8. Razão imutável; só o reset limpa ---');
eq(!!(await erro(query(`UPDATE razao_partidas SET valor_centavos = 0 WHERE tenant_id = 't1'`))), true, 'UPDATE no razão é recusado');
eq(!!(await erro(query(`DELETE FROM razao_lancamentos WHERE tenant_id = 't1'`))), true, 'DELETE no razão é recusado');
await emTransacao(async exec => { for (const sql of RAZAO_LIMPEZA_DA_AGENCIA_SQL) await exec.query(sql, sql.includes('$1') ? ['t1'] : []); });
eq([await qtdLanc('t1'), !!(await um(`SELECT 1 AS x FROM razao_estado WHERE tenant_id='t1'`))], [0, false], 'reset limpa o razão e a abertura da agência');

console.log('--- 9. Lançamento inválido e chave repetida ---');
await emTransacao(exec => abrirRazaoNoExecutor(exec, 't2'));
const torto = { chave_natural: 'torto', tipo_evento: 'ajuste', partidas: [
  { conta: 'BANCO', conta_bancaria_id: 'z', valor_centavos: 100 }, { conta: 'CLIENTES', conta_bancaria_id: 'z', valor_centavos: -99 }] };
eq((await um(`SELECT razao_lancar('t2', $1::jsonb, false) AS r`, [JSON.stringify(torto)])).r, 'falha', 'lançamento que não fecha em zero vira falha');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM razao_falhas WHERE tenant_id='t2'`)).n), 1, 'e fica registrado em razao_falhas');
const certo = lancamentoDeMovimento('z', 10, { tipo: 'ajuste', tabela: 'x', id: '1' }, 'fixo');
eq(fechaEmZero(certo), true, 'lancamentoDeMovimento monta partidas que fecham em zero');
eq((await um(`SELECT razao_lancar('t2', $1::jsonb, false) AS r`, [JSON.stringify(certo)])).r, 'ok', 'primeira gravação ok');
eq((await um(`SELECT razao_lancar('t2', $1::jsonb, false) AS r`, [JSON.stringify(certo)])).r, 'duplicado', 'mesma chave não grava duas vezes');
eq(await registrarMovimento(pool, 'sem-abertura', 'z', 5, { tipo: 'ajuste' }), 'sem_abertura', 'agência sem abertura não grava');
eq(!!(await erro(query(`DELETE FROM razao_lancamentos WHERE tenant_id = 't2'`))), true, 'depois do reset, fora dele, o bloqueio continua valendo');

console.log('--- 10. Isolamento por agência ---');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM razao_partidas WHERE tenant_id='t2' AND conta_bancaria_id IN ('b1','b2')`)).n), 0, 'razão de uma agência não enxerga contas de outra');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
