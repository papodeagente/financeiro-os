/**
 * Agendador, fila justa e "nada sai" (05/11/2026), contra um Postgres real
 * (PGlite), rodando o código DE PRODUÇÃO.
 *
 * Uso: node --no-warnings scripts/test-sql-agendador.mjs
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

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
`);
const query = async (text, values) => {
  const r = await pg.query(text, values);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
await pg.exec(RAZAO_SCHEMA_SQL);
const { rodarAgendador, janelaDiaria, janelaDeMinutos, horaDeBrasilia, FALHAS_PARA_ABRIR } = await import('../src/lib/agendador/nucleo.ts');
const fila = await import('../src/lib/agendador/fila.ts');
const { tarefaRazaoAbertura, tarefaRazaoConferencia } = await import('../src/lib/agendador/tarefas.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { comNadaSai, nadaSai } = await import('../src/lib/nada-sai.ts');

const conexao = async () => ({ exec: pool, liberar() {} });
const rodar = (tarefas, agora = new Date('2026-11-05T12:00:00Z'), extra = {}) =>
  rodarAgendador({ tarefas, conexao, emTransacao, agora, ...extra });

console.log('--- Horário de Brasília e janelas ---');
eq(horaDeBrasilia(new Date('2026-11-05T05:59:00Z')), { data: '2026-11-05', hora: 2, minuto: 59 }, '05:59 UTC = 02:59 em Brasília');
eq(janelaDiaria(3)(new Date('2026-11-05T05:59:00Z')), null, 'antes das 3h de Brasília a diária não roda');
eq(janelaDiaria(3)(new Date('2026-11-05T06:00:00Z')), '2026-11-05', 'às 3h de Brasília a diária roda');
eq(janelaDiaria(3)(new Date('2026-11-06T02:30:00Z')), '2026-11-05', '23h30 de Brasília ainda é o mesmo dia');
eq(janelaDeMinutos(5)(new Date('2026-11-05T12:04:59Z')) === janelaDeMinutos(5)(new Date('2026-11-05T12:00:00Z')), true, 'mesma janela de 5 minutos');
eq(janelaDeMinutos(5)(new Date('2026-11-05T12:05:00Z')) === janelaDeMinutos(5)(new Date('2026-11-05T12:04:59Z')), false, 'janela muda a cada 5 minutos');

console.log('--- Execução única por janela ---');
let chamadas = 0;
const global = { nome: 'teste-global', janela: () => 'j1', executar: async () => { chamadas++; return { ok: 1 }; } };
await rodar([global]);
await rodar([global]);
eq(chamadas, 1, 'a mesma janela roda uma vez só');
const segurada = await query(`SELECT pg_try_advisory_lock(hashtext('agendador'), hashtext('teste-ocupada')) AS ok`);
eq(segurada.rows[0].ok, true, 'outra chamada segura a trava da tarefa');
// PGlite tem uma conexão só, e trava de sessão é reentrante na mesma conexão;
// aqui se prova o caminho do código, não a corrida.
await query(`SELECT pg_advisory_unlock(hashtext('agendador'), hashtext('teste-ocupada'))`);

console.log('--- Falha libera a janela e abre o disjuntor depois de 5 seguidas ---');
let tentativas = 0;
const quebrada = { nome: 'teste-quebrada', janela: () => 'j1', agencias: async () => ['tA', 'tB'],
  executar: async (_c, t) => { if (t === 'tA') { tentativas++; throw new Error('boom'); } return { ok: t }; } };
for (let i = 0; i < FALHAS_PARA_ABRIR + 2; i++) await rodar([quebrada]);
eq(tentativas, FALHAS_PARA_ABRIR, `a agência com erro tentou ${FALHAS_PARA_ABRIR} vezes e o disjuntor parou as próximas`);
const est = (await query(`SELECT falhas_seguidas, aberto_ate IS NOT NULL AS aberto FROM agendador_estado WHERE tarefa='teste-quebrada' AND tenant_id='tA'`)).rows[0];
eq([est.falhas_seguidas, est.aberto], [FALHAS_PARA_ABRIR, true], 'disjuntor aberto só para a agência com erro');
const tB = (await query(`SELECT COUNT(*)::int AS n FROM agendador_execucoes WHERE tarefa='teste-quebrada' AND tenant_id='tB' AND terminado_em IS NOT NULL`)).rows[0].n;
eq(tB, 1, 'a outra agência rodou normalmente, uma vez');

console.log('--- Orçamento de tempo ---');
let t = 0;
const lenta = { nome: 'teste-lenta', janela: () => 'j1', agencias: async () => ['a', 'b', 'c'], executar: async () => { t += 20_000; } };
const r = await rodar([lenta], undefined, { orcamentoMs: 30_000, relogio: () => t });
eq([r['teste-lenta'].feitas, r['teste-lenta'].puladas], [2, 1], 'o que não coube no orçamento fica para a próxima chamada');
t = 0;
const r2 = await rodar([lenta], undefined, { orcamentoMs: 30_000, relogio: () => t });
eq(r2['teste-lenta'].feitas, 1, 'a próxima chamada termina o que faltou, sem repetir as já feitas');

console.log('--- Abertura e conferência do razão pelo agendador ---');
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('c1','agA','{"nome":"Inter","saldo_atual":150.25}'), ('c2','agB','{"nome":"Itaú","saldo_atual":10}')`);
const ra = await rodar([tarefaRazaoAbertura]);
eq(ra['razao-abertura'].feitas, 2, 'as duas agências com conta bancária foram abertas');
eq((await query(`SELECT COUNT(*)::int AS n FROM razao_estado`)).rows[0].n, 2, 'razao_estado marcado nas duas');
const rc = await rodar([tarefaRazaoConferencia], new Date('2026-11-05T07:00:00Z'));
eq(rc['razao-conferencia'].feitas, 2, 'conferência diária rodou nas duas agências');
const dif = (await query(`SELECT COUNT(*)::int AS n FROM razao_conferencias WHERE tipo='diaria' AND diferenca_centavos <> 0`)).rows[0].n;
eq(dif, 0, 'conferência zerada logo depois da abertura');
const rc2 = await rodar([tarefaRazaoConferencia], new Date('2026-11-05T08:00:00Z'));
eq(rc2['razao-conferencia'].feitas, 0, 'conferência do dia não roda de novo');

console.log('--- Fila justa entre agências ---');
for (let i = 0; i < 30; i++) await fila.enfileirarTarefa(pool, { tenantId: 'grande', tipo: 'cobranca', chaveIdem: `g${i}` });
await fila.enfileirarTarefa(pool, { tenantId: 'pequena', tipo: 'cobranca', chaveIdem: 'p1' });
eq(await fila.enfileirarTarefa(pool, { tenantId: 'pequena', tipo: 'cobranca', chaveIdem: 'p1' }), false, 'a mesma tarefa não entra duas vezes');
const lote = await fila.reivindicarTarefas(pool, { porAgencia: 5, total: 50 });
const porAg = lote.reduce((m, x) => ({ ...m, [x.tenant_id]: (m[x.tenant_id] ?? 0) + 1 }), {});
eq([porAg.grande, porAg.pequena], [5, 1], 'cada rodada pega no máximo 5 da agência grande e não esquece a pequena');
eq(lote.every(x => x.tentativas === 1), true, 'tentativa contada ao reivindicar');

const t1 = lote.find(x => x.tenant_id === 'pequena');
eq(await fila.falharTarefa(pool, t1, 'erro de teste'), 'repetir', 'primeira falha volta para a fila');
const espera = (await query(`SELECT status, (proxima_em - NOW()) > INTERVAL '50 seconds' AS longe FROM tarefas WHERE id=$1`, [t1.id])).rows[0];
eq([espera.status, espera.longe], ['pendente', true], 'com espera de 1 minuto antes de tentar de novo');
eq(await fila.falharTarefa(pool, { id: t1.id, tentativas: fila.TENTATIVAS_MAXIMAS }, 'erro final'), 'falhou', 'depois do limite ela fica como falhou');

await query(`UPDATE tarefas SET status = 'pendente', proxima_em = NOW() - INTERVAL '1 second' WHERE tenant_id = 'grande'`);
const vistos = [];
fila.registrarProcessador('cobranca', async tk => { vistos.push(tk.tenant_id); if (tk.chave_idem === 'g3') throw new Error('falha no g3'); return { feito: tk.chave_idem }; });
const pf = await fila.processarFila(pool, { orcamentoMs: 60_000 });
eq([pf.processadas, pf.falhas], [29, 1], 'processarFila roda todas, e a que falha volta para a fila');
eq((await query(`SELECT COUNT(*)::int AS n FROM tarefas WHERE status='concluida'`)).rows[0].n, 29, '29 concluídas');

console.log('--- Nada sai ---');
eq(nadaSai(), null, 'fora do contexto, as saídas estão ligadas');
const dentro = await comNadaSai('importação', async () => { await new Promise(r => setTimeout(r, 1)); return nadaSai(); });
eq(dentro, 'importação', 'dentro do contexto (inclusive depois de await), nada sai');
eq(nadaSai(), null, 'ao sair do contexto, volta ao normal');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
