/**
 * Aviso de vencimento no sino (05/11/2026), contra um Postgres real
 * (PGlite), rodando o código DE PRODUÇÃO pelo agendador de verdade:
 * por agência, uma vez por dia, sem repetir, e nada sai durante importação.
 *
 * Uso: node --no-warnings scripts/test-sql-avisos-vencimento.mjs
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
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', status TEXT DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
await pg.exec(RAZAO_SCHEMA_SQL);
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
const { rodarAgendador } = await import('../src/lib/agendador/nucleo.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { comNadaSai } = await import('../src/lib/nada-sai.ts');
const { tarefaAvisosVencimento, avisarVencimentos } = await import('../src/lib/avisos-vencimento-servidor.ts');

const conexao = async () => ({ exec: pool, liberar() {} });
const rodar = agora => rodarAgendador({ tarefas: [tarefaAvisosVencimento], conexao, emTransacao, agora });
// 05/11/2026 às 8h de Brasília = 11h UTC.
const OITO_DA_MANHA = new Date('2026-11-05T11:00:00Z');
const SEIS_DA_MANHA = new Date('2026-11-05T09:00:00Z');

const cp = (id, t, d) => query(`INSERT INTO contas_pagar (id, tenant_id, data) VALUES ($1,$2,$3)`, [id, t, JSON.stringify({ id, fornecedor_nome: 'Fornecedor', ...d })]);
const cr = (id, t, d) => query(`INSERT INTO contas_receber (id, tenant_id, data) VALUES ($1,$2,$3)`, [id, t, JSON.stringify({ id, cliente_nome: 'Cliente', ...d })]);
const avisos = async t => (await query(`SELECT tipo, titulo, link, vendedor_id FROM notificacoes WHERE tenant_id = $1 ORDER BY tipo, titulo`, [t])).rows;

// Agência A: padrão (sem preferência gravada). Agência B: tudo ligado. Agência C: tudo desligado.
await cp('a1', 'A', { descricao: 'Aluguel', valor_final: 2500, status: 'PENDENTE', data_vencimento: '2026-11-05' });
await cp('a2', 'A', { descricao: 'Luz', valor_final: 300, status: 'PARCIAL', valor_pago: 100, data_vencimento: '2026-11-05' });
await cp('a3', 'A', { descricao: 'Paga', valor_final: 80, status: 'PAGO', data_vencimento: '2026-11-05' });
await cp('a4', 'A', { descricao: 'Amanhã', valor_final: 80, status: 'PENDENTE', data_vencimento: '2026-11-06' });
await cr('a9', 'A', { descricao: 'Atrasada', valor_final: 500, status: 'PENDENTE', data_vencimento: '2026-10-01' });
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag-b','B','{"avisos_vencimento":{"pagar_hoje":true,"pagar_amanha":true,"receber_atrasadas":true}}'),
                                                           ('ag-c','C','{"avisos_vencimento":{"pagar_hoje":false,"pagar_amanha":false,"receber_atrasadas":false}}')`);
await cp('b1', 'B', { descricao: 'Hotel', valor_final: 1200, status: 'PENDENTE', data_vencimento: '2026-11-06' });
await cr('b2', 'B', { descricao: 'Pacote', valor_final: 900, status: 'PARCIAL', valor_recebido: 400, data_vencimento: '2026-11-01' });
await cr('b3', 'B', { descricao: 'Cancelada', valor_final: 900, status: 'CANCELADO', data_vencimento: '2026-11-01' });
await cp('c1', 'C', { descricao: 'Vence hoje', valor_final: 10, status: 'PENDENTE', data_vencimento: '2026-11-05' });

console.log('--- Antes das 7h, nada ---');
const cedo = await rodar(SEIS_DA_MANHA);
eq([cedo['avisos-vencimento'].janela, (await avisos('A')).length], [null, 0], 'fora da janela: não roda');

console.log('--- Nada sai (importação em andamento) ---');
const r0 = await comNadaSai('importação do sistema anterior', () => avisarVencimentos(pool, 'A', OITO_DA_MANHA));
eq([r0.avisos, (await avisos('A')).length], [0, 0], 'durante a importação nenhum aviso é criado');

console.log('--- De manhã, por agência ---');
const r1 = await rodar(OITO_DA_MANHA);
eq([r1['avisos-vencimento'].feitas, r1['avisos-vencimento'].falhas], [3, 0], 'atende as três agências com conta em aberto');
eq(await avisos('A'), [{ tipo: 'CONTAS_A_PAGAR_VENCENDO', titulo: '2 contas a pagar vencem hoje', link: '/financeiro-ag/pagar', vendedor_id: '' }],
  'padrão: só o aviso das contas a pagar de hoje (paga e de amanhã ficam de fora)');
const dadosA = (await query(`SELECT descricao, data FROM notificacoes WHERE tenant_id = 'A'`)).rows[0];
eq([dadosA.data.total, dadosA.descricao.startsWith('R$ 2.700,00 no total.')], [2700, true], 'parcial conta pelo que falta (2.500 + 200)');
eq((await avisos('B')).map(a => a.titulo), ['1 conta a pagar vence amanhã', '1 conta a receber em atraso'], 'tudo ligado: amanhã e atraso (cancelada fica fora)');
eq(await avisos('C'), [], 'tudo desligado: nada');

console.log('--- Sem repetir no mesmo dia ---');
const r2 = await rodar(new Date('2026-11-05T15:00:00Z'));
eq([r2['avisos-vencimento'].feitas, (await avisos('A')).length], [0, 1], 'a janela do dia já rodou');
await query(`DELETE FROM agendador_execucoes`);
await rodar(new Date('2026-11-05T16:00:00Z'));
eq([(await avisos('A')).length, (await avisos('B')).length], [1, 2], 'mesmo refazendo a janela, a chave do dia não deixa repetir');

console.log('--- No dia seguinte, avisa de novo ---');
await rodar(new Date('2026-11-06T11:00:00Z'));
eq((await avisos('A')).map(a => a.titulo).sort(), ['1 conta a pagar vence hoje', '2 contas a pagar vencem hoje'], 'novo dia, novo aviso (a de amanhã virou de hoje)');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
