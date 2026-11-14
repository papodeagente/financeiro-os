/**
 * Agendador e fila por módulo (14/11/2026), contra um Postgres real (PGlite),
 * rodando o código DE PRODUÇÃO.
 *
 * O que se prova:
 *   (a) toda tarefa do agendador declara o módulo (ou 'motor') e o catálogo
 *       não cita tarefa que não existe;
 *   (b) a tarefa de módulo só atende as agências com o módulo (exceção da
 *       agência, liberação geral e versão completa); a do motor, todas; a
 *       global continua global; a sem módulo declarado não atende ninguém;
 *   (c) a fila só pega a tarefa de um módulo nas agências com ele; a de
 *       agência sem o módulo espera pendente, sem gastar tentativa, e anda
 *       quando o módulo é ligado; tipo do motor anda para todas.
 *
 * Uso: node --no-warnings scripts/test-sql-agendador-modulos.mjs
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
  CREATE TABLE tenants (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE saas_config (key TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  INSERT INTO tenants (id, data) VALUES
    ('agS', '{"nome":"Simples"}'),
    ('agC', '{"nome":"Com cobrança","modulos":{"nucleo":true,"cobranca":true}}'),
    ('agX', '{"nome":"Completa","fin_versao":"completa"}'),
    ('agD', '{"nome":"Cobrança sem núcleo","modulos":{"cobranca":true}}');
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
await pg.exec(RAZAO_SCHEMA_SQL);
const { rodarAgendador } = await import('../src/lib/agendador/nucleo.ts');
const fila = await import('../src/lib/agendador/fila.ts');
const { TAREFAS } = await import('../src/lib/agendador/tarefas.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { agenciasComModulo, esquecerModulos } = await import('../src/lib/modulos-servidor.ts');
const { MODULO_DA_TAREFA, MODULO_DO_TIPO_NA_FILA, MODULOS } = await import('../src/lib/modulos.ts');

const conexao = async () => ({ exec: pool, liberar() {} });
let relogio = Date.parse('2026-11-14T12:00:00Z');
const rodar = (tarefas, extra = {}) =>
  rodarAgendador({ tarefas, conexao, emTransacao, agora: new Date(relogio), agenciasComModulo, ...extra });
const TODAS = ['agS', 'agC', 'agX', 'agD'];

console.log('--- (a) cada tarefa declara o módulo ---');
eq(TAREFAS.filter(t => t.modulo === undefined).map(t => t.nome), [], 'nenhuma tarefa do agendador sem módulo declarado');
eq(TAREFAS.every(t => t.modulo === MODULO_DA_TAREFA[t.nome]), true, 'o módulo de cada tarefa é o do catálogo (modulos.ts)');
eq(Object.keys(MODULO_DA_TAREFA).filter(n => !TAREFAS.some(t => t.nome === n)), [], 'o catálogo não cita tarefa que não existe');
const ids = new Set(MODULOS.map(m => m.id));
eq(Object.values(MODULO_DA_TAREFA).every(m => m === 'motor' || ids.has(m)), true, 'todo módulo citado existe');
eq(TAREFAS.filter(t => t.modulo === 'motor').map(t => t.nome).sort(), ['fila', 'razao-abertura', 'razao-conferencia'],
  'do motor (todas as agências): abertura e conferência do razão e a fila');
eq(TAREFAS.find(t => t.nome === 'cambio-cotacoes')?.agencias, undefined, 'as cotações continuam globais (sem agência)');

console.log('--- (b) o agendador só atende quem tem o módulo ---');
const feitas = [];
const tarefa = (nome, modulo, global = false) => ({
  nome, modulo, janela: () => `j-${relogio}`,
  ...(global ? {} : { agencias: async () => TODAS }),
  executar: async (_c, t) => { feitas.push(`${nome}:${t || 'global'}`); },
});
await rodar([tarefa('t-cobranca', 'cobranca'), tarefa('t-motor', 'motor'), tarefa('t-sem', undefined), tarefa('t-global', 'cambio', true)]);
eq(feitas.filter(f => f.startsWith('t-cobranca')).sort(), ['t-cobranca:agC', 't-cobranca:agX'],
  'tarefa da cobrança: só a agência com o módulo e a da versão completa (a simples e a sem núcleo ficam de fora)');
eq(feitas.filter(f => f.startsWith('t-motor')).length, 4, 'tarefa do motor: todas as agências');
eq(feitas.filter(f => f.startsWith('t-sem')), [], 'tarefa por agência sem módulo declarado: ninguém');
eq(feitas.filter(f => f.startsWith('t-global')), ['t-global:global'], 'tarefa global com módulo continua global');

relogio += 60_000; feitas.length = 0;
await rodarAgendador({ tarefas: [tarefa('t-cobranca', 'cobranca')], conexao, emTransacao, agora: new Date(relogio) });
eq(feitas.length, 4, 'sem o filtro ligado (agenciasComModulo), o núcleo do agendador se comporta como antes');

relogio += 60_000; feitas.length = 0;
await query(`INSERT INTO saas_config (key, data) VALUES ('modulos_liberados', '{"modulos":["nucleo","cobranca"]}')`);
await query(`UPDATE tenants SET data = data || '{"modulos":{"cobranca":false}}' WHERE id = 'agD'`);
esquecerModulos();
await rodar([tarefa('t-cobranca', 'cobranca')]);
eq(feitas.sort(), ['t-cobranca:agC', 't-cobranca:agS', 't-cobranca:agX'],
  'liberada para todas: a simples passa a ter; a agência que desligou a cobrança (exceção) fica de fora');
await query(`DELETE FROM saas_config`);
await query(`UPDATE tenants SET data = '{"nome":"Cobrança sem núcleo","modulos":{"cobranca":true}}' WHERE id = 'agD'`);
esquecerModulos();

console.log('--- (c) a fila por módulo ---');
await fila.enfileirarTarefa(pool, { tenantId: 'agS', tipo: 'cobranca_emitir', chaveIdem: 's1' });
await fila.enfileirarTarefa(pool, { tenantId: 'agC', tipo: 'cobranca_emitir', chaveIdem: 'c1' });
await fila.enfileirarTarefa(pool, { tenantId: 'agS', tipo: 'migracao-aplicar', chaveIdem: 's2' });
await fila.enfileirarTarefa(pool, { tenantId: 'agS', tipo: 'motor_teste', chaveIdem: 's3' });
eq(MODULO_DO_TIPO_NA_FILA.cobranca_emitir, 'cobranca', 'emitir cobrança é da cobrança');
const vistos = [];
const fake = t => { vistos.push(`${t.tipo}:${t.tenant_id}`); return { ok: true }; };
for (const tipo of Object.keys(fila.PROCESSADORES)) fila.registrarProcessador(tipo, async t => fake(t));
fila.registrarProcessador('motor_teste', async t => fake(t));
const porTipo = await fila.agenciasDosTipos(pool, ['cobranca_emitir', 'migracao-aplicar', 'motor_teste'], agenciasComModulo);
eq(porTipo, { cobranca_emitir: ['agC', 'agX'], 'migracao-aplicar': ['agX'] }, 'cada tipo de módulo com as agências que têm o módulo; o do motor fica fora do mapa');
// A tarefa da fila do agendador de verdade (tarefas.ts) liga o filtro.
const tarefaFila = TAREFAS.find(t => t.nome === 'fila');
relogio += 60_000;
await rodar([tarefaFila]);
eq(vistos.sort(), ['cobranca_emitir:agC', 'motor_teste:agS'], 'a fila do agendador: a cobrança da agência com o módulo e o tipo do motor; nada de módulo na simples');
const presas = (await query(`SELECT tipo, status, tentativas FROM tarefas WHERE tenant_id = 'agS' AND tipo <> 'motor_teste' ORDER BY tipo`)).rows;
eq(presas.map(r => [r.tipo, r.status, r.tentativas]), [['cobranca_emitir', 'pendente', 0], ['migracao-aplicar', 'pendente', 0]],
  'as tarefas de módulo da agência simples esperam pendentes, sem gastar tentativa');

vistos.length = 0;
await query(`UPDATE tenants SET data = data || '{"modulos":{"nucleo":true,"cobranca":true}}' WHERE id = 'agS'`);
esquecerModulos('agS');
relogio += 60_000;
await rodar([tarefaFila]);
eq(vistos, ['cobranca_emitir:agS'], 'ligada a cobrança na agência, a tarefa dela anda (a de mudança segue esperando)');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
