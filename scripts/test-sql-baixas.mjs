/**
 * Liquidação no servidor e "Fechar Caixa" (05/11/2026), contra um Postgres
 * real (PGlite), rodando o código DE PRODUÇÃO.
 *
 * Uso: node --no-warnings scripts/test-sql-baixas.mjs
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
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
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
const { BAIXAS_SCHEMA_SQL, registrarBaixas, estornarBaixa, historicoDaConta } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL, fecharPeriodo, reabrirPeriodo, periodoFechadoDoErro, dataForaDoFechamento } = await import('../src/lib/periodo-fechado.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL); // idempotente
const { emTransacao, aplicarMovimentoCaixaAtomico } = await import('../src/lib/caixa-atomico.ts');
const { editarContaNoExecutor } = await import('../src/lib/baixa-de-conta.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');

const T = 't1';
const um = async (sql, v) => (await query(sql, v)).rows[0];
const saldo = async id => Number((await um(`SELECT (data->>'saldo_atual')::numeric AS s FROM contas_bancarias WHERE id = $1`, [id]))?.s ?? NaN);
const razao = async id => Number((await um(`SELECT COALESCE(saldo_centavos,0) AS s FROM razao_saldo_bancario WHERE tenant_id=$1 AND conta_bancaria_id=$2`, [T, id]))?.s ?? 0) / 100;
const titulo = async (tab, id) => (await um(`SELECT data FROM ${tab} WHERE id = $1`, [id])).data;
const cr = (id, data) => query(`INSERT INTO contas_receber (id, tenant_id, status, cliente_id, data) VALUES ($1,$2,$3,$4,$5)`,
  [id, T, data.status ?? 'PENDENTE', 'cli', JSON.stringify({ id, cliente_id: 'cli', cliente_nome: 'Cliente', descricao: `Conta ${id}`, data_vencimento: '2026-10-01', ...data })]);
const cp = (id, data) => query(`INSERT INTO contas_pagar (id, tenant_id, status, fornecedor_id, data) VALUES ($1,$2,$3,$4,$5)`,
  [id, T, data.status ?? 'PENDENTE', 'forn', JSON.stringify({ id, fornecedor_id: 'forn', descricao: `Conta ${id}`, data_vencimento: '2026-10-01', ...data })]);
const ctx = { tenantId: T, usuarioId: 'u1', usuarioNome: 'Ana', origem: 'tela', politica: null };
const gravar = (itens, extra = {}) => emTransacao(exec => registrarBaixas(exec, { ...ctx, ...extra }, itens, { gravar: true }));
const previa = itens => registrarBaixas(pool, ctx, itens, { gravar: false });
const estornar = (id, motivo = 'lançado errado') => emTransacao(exec => estornarBaixa(exec, ctx, id, { motivo }));

await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1',$1,'{"nome":"Inter","saldo_inicial":0,"saldo_atual":0}'),('b2',$1,'{"nome":"Itaú","saldo_inicial":0,"saldo_atual":0}')`, [T]);
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));

console.log('--- Liquidação de uma conta a receber ---');
await cr('r1', { valor_final: 1000 });
const pv = await previa([{ titulo_tabela: 'contas_receber', titulo_id: 'r1', data: '2026-10-05', conta_bancaria_id: 'b1', valor: 300 }]);
eq([pv.itens[0].plano.status_depois, pv.itens[0].plano.saldo_depois, typeof pv.assinatura], ['PARCIAL', 700, 'string'], 'prévia mostra o efeito sem gravar');
eq(await saldo('b1'), 0, 'prévia não move dinheiro');
const g1 = await gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r1', data: '2026-10-05', conta_bancaria_id: 'b1', valor: 300 }]);
let d = await titulo('contas_receber', 'r1');
eq([d.status, d.valor_recebido, d.data_recebimento, d.conta_bancaria_id, await saldo('b1'), await razao('b1')], ['PARCIAL', 300, '2026-10-05', 'b1', 300, 300], 'parcial: título, data escolhida, caixa e razão');
await gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r1', data: '2026-10-08', valor: 750, juros: 50 }]);
d = await titulo('contas_receber', 'r1');
eq([d.status, d.valor_recebido, d.juros, d.valor_final, await saldo('b1')], ['RECEBIDO', 1050, 50, 1050, 1050], 'segunda baixa com juros: quita, juros no valor final, caixa recebe o pago');
const h = await historicoDaConta(pool, T, 'contas_receber', 'r1');
eq(h.map(x => [x.tipo, x.valor, x.usuario]), [['baixa', 300, 'Ana'], ['baixa', 750, 'Ana']], 'histórico com as duas baixas e quem fez');

console.log('--- Regras de proteção ---');
let e = await falha(gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r1', valor: 10 }]));
eq(e?.msg?.includes('já está liquidada'), true, 'conta liquidada não aceita nova baixa');
await cr('r2', { valor_final: 500 });
await gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r2', data: '2026-10-05', conta_bancaria_id: 'b1', valor: 100 }]);
e = await falha(gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r2', data: '2026-10-06', conta_bancaria_id: 'b2', valor: 100 }]));
eq(e?.status, 409, 'parcela seguinte em outra conta bancária é recusada com explicação');
e = await falha(gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r2', valor: 100, esperado: { status_depois: 'RECEBIDO' } }]));
eq(e?.status, 409, 'tela desatualizada (esperado diferente) é recusada');
const idem = await emTransacao(exec => registrarBaixas(exec, { ...ctx, idempotencia: 'k1' }, [{ titulo_tabela: 'contas_receber', titulo_id: 'r2', valor: 50 }], { gravar: true }));
const idem2 = await emTransacao(exec => registrarBaixas(exec, { ...ctx, idempotencia: 'k1' }, [{ titulo_tabela: 'contas_receber', titulo_id: 'r2', valor: 50 }], { gravar: true }));
eq([idem2.itens[0].ja_existia, idem2.itens[0].baixa_id === idem.itens[0].baixa_id, (await titulo('contas_receber', 'r2')).valor_recebido], [true, true, 150], 'repetir a mesma gravação (duplo clique) não grava duas vezes');
{
  await cr('r-ass', { valor_final: 100 });
  const it = [{ titulo_tabela: 'contas_receber', titulo_id: 'r-ass', valor: 20 }];
  const pv = await previa(it);
  const g1 = await emTransacao(exec => registrarBaixas(exec, { ...ctx, idempotencia: 'k-ass' }, it, { gravar: true, assinatura: pv.assinatura }));
  const e2 = await falha(emTransacao(exec => registrarBaixas(exec, { ...ctx, idempotencia: 'k-ass' }, it, { gravar: true, assinatura: pv.assinatura })));
  eq([e2, (await titulo('contas_receber', 'r-ass')).valor_recebido, !!g1.itens[0].baixa_id], [null, 20, true], 'repetir com a assinatura da prévia devolve o que foi feito, sem 409');
}
e = await falha(gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r2', valor: 10, tratamento_diferenca: 'credito' }]));
eq(e?.msg?.includes('carteira de crédito'), true, 'crédito do cliente ainda não liberado');

console.log('--- Lote: pagar e receber juntos ---');
await cr('r3', { valor_final: 200 });
await cp('p1', { valor_final: 80 });
const lote = await gravar([
  { titulo_tabela: 'contas_pagar', titulo_id: 'p1', data: '2026-10-10', conta_bancaria_id: 'b2', valor: 80 },
  { titulo_tabela: 'contas_receber', titulo_id: 'r3', data: '2026-10-10', conta_bancaria_id: 'b2', valor: 190, tratamento_diferenca: 'desconto' },
]);
eq([typeof lote.lote_id, (await titulo('contas_pagar', 'p1')).status, (await titulo('contas_receber', 'r3')).status, (await titulo('contas_receber', 'r3')).desconto, await saldo('b2')],
  ['string', 'PAGO', 'RECEBIDO', 10, 110], 'lote grava os dois, desconto quita o receber, caixa = 190 − 80');
const antes = await saldo('b2');
e = await falha(gravar([
  { titulo_tabela: 'contas_receber', titulo_id: 'r2', valor: 10 },
  { titulo_tabela: 'contas_receber', titulo_id: 'nao-existe', valor: 10 },
]));
eq([e?.status, await saldo('b2'), (await titulo('contas_receber', 'r2')).valor_recebido], [404, antes, 150], 'lote é tudo ou nada: um erro não grava nenhum');

console.log('--- Estorno no meio do histórico ---');
const baixasR1 = await historicoDaConta(pool, T, 'contas_receber', 'r1');
const r = await estornar(baixasR1[0].id);
d = await titulo('contas_receber', 'r1');
eq([r.status_depois, d.valor_recebido, d.juros, d.valor_final, await saldo('b1'), await razao('b1')], ['PARCIAL', 750, 50, 1050, 900, 900], 'estornar a primeira baixa (300) deixa a segunda valendo');
e = await falha(estornar(baixasR1[0].id));
eq(e?.status, 409, 'a mesma baixa não é estornada duas vezes');
eq((await historicoDaConta(pool, T, 'contas_receber', 'r1')).map(x => [x.tipo, x.estornada]), [['baixa', true], ['baixa', false], ['estorno', false]], 'histórico mostra a baixa estornada e o estorno');

console.log('--- Caminhos antigos também deixam histórico ---');
await cr('r4', { valor_final: 400, status: 'PARCIAL', valor_recebido: 100, data_recebimento: '2026-09-01', conta_bancaria_id: 'b1' });
await aplicarMovimentoCaixaAtomico(T, 'b1', 100, undefined, { tipo: 'baixa_receber', tabela: 'contas_receber', id: 'r4' });
const r4 = await titulo('contas_receber', 'r4');
await emTransacao(exec => editarContaNoExecutor(exec, {
  tabela: 'contas_receber', colunasIndice: ['venda_id', 'cliente_id', 'status'], campo: 'valor_recebido', sinal: 1, id: 'r4', tenantId: T,
  item: { ...r4, status: 'RECEBIDO', valor_recebido: 400, data_recebimento: '2026-10-02' },
}));
eq((await historicoDaConta(pool, T, 'contas_receber', 'r4')).map(x => [x.tipo, x.valor]), [['anterior', 100], ['legada', 300]], 'tela antiga: linha do que já existia + linha do novo recebimento');

console.log('--- Fechar Caixa ---');
await emTransacao(exec => fecharPeriodo(exec, { tenantId: T, ate: '2026-10-06', usuarioNome: 'Ana' }));
e = await falha(gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r2', data: '2026-10-06', valor: 10 }]));
eq(e?.status, 423, 'baixa com data no período fechado é recusada (423)');
await gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r2', data: '2026-10-07', valor: 10 }]);
eq((await titulo('contas_receber', 'r2')).valor_recebido, 160, 'conta com parcela em período fechado aceita nova parcela em data aberta');
const hR2 = await historicoDaConta(pool, T, 'contas_receber', 'r2');
const ultima = hR2.filter(x => x.tipo === 'baixa').at(-1);
await estornar(ultima.id);
eq((await titulo('contas_receber', 'r2')).valor_recebido, 150, 'estorno de baixa em data aberta passa');
const primeira = hR2.find(x => x.tipo === 'baixa');
e = await falha(estornar(primeira.id));
eq(periodoFechadoDoErro(new Error(e?.msg ?? '')) !== null || e?.status === 423, true, 'estorno de baixa em data fechada é recusado');
e = await falha(query(`UPDATE contas_receber SET data = jsonb_set(data, '{valor_recebido}', '0') WHERE id = 'r2'`));
eq(periodoFechadoDoErro(new Error(e?.msg ?? '')), '2026-10-06', 'mexer no valor de baixa fechada direto no banco é recusado');
e = await falha(query(`UPDATE contas_receber SET data = jsonb_set(data, '{descricao}', '"novo nome"') WHERE id = 'r2'`));
eq(e, null, 'mudar só a descrição de conta antiga continua livre');
e = await falha(query(`DELETE FROM contas_receber WHERE id = 'r2'`));
eq(periodoFechadoDoErro(new Error(e?.msg ?? '')), '2026-10-06', 'apagar conta com baixa fechada é recusado');
eq(await dataForaDoFechamento(pool, T, 'b1', '2026-10-03'), '2026-10-07', 'integração com data fechada entra no dia seguinte ao fechamento');
eq(await dataForaDoFechamento(pool, T, 'b1', '2026-10-20'), '2026-10-20', 'integração com data aberta fica com a data dela');
e = await falha(emTransacao(exec => fecharPeriodo(exec, { tenantId: T, ate: '2026-10-01' })));
eq(e?.msg?.includes('Já está fechado'), true, 'fechar não volta para trás');
e = await falha(emTransacao(exec => reabrirPeriodo(exec, { tenantId: T, ate: null, motivo: '' })));
eq(e?.msg?.includes('motivo'), true, 'reabrir exige motivo');
await emTransacao(exec => reabrirPeriodo(exec, { tenantId: T, ate: null, motivo: 'corrigir lançamento do dia 5', usuarioNome: 'Ana' }));
e = await falha(query(`UPDATE contas_receber SET data = jsonb_set(data, '{descricao}', '"x"') || '{"valor_recebido": 150}' WHERE id = 'r2'`));
eq(e, null, 'reaberto, volta a aceitar');
const ev = (await query(`SELECT acao, motivo FROM periodos_eventos WHERE tenant_id = $1 ORDER BY id`, [T])).rows;
eq(ev.map(x => x.acao), ['FECHAR', 'REABRIR'], 'fechar e reabrir ficam registrados');

console.log('--- Política da agência chega na prévia do servidor ---');
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, '{"politica_cobranca":{"juros_am_pct":3,"multa_pct":2,"tolerancia_dias":0}}')`, [T]);
await cr('r9', { valor_final: 1000, data_vencimento: '2026-10-01' });
const pol = await registrarBaixas(pool, { tenantId: T, origem: 'tela' }, [{ titulo_tabela: 'contas_receber', titulo_id: 'r9', data: '2026-10-31', valor: 1050 }], { gravar: false });
eq([pol.itens[0].encargos_sugeridos.juros, pol.itens[0].encargos_sugeridos.multa, pol.itens[0].encargos_sugeridos.dias_atraso], [30, 20, 30], 'servidor sugere juros e multa pela política da agência');

console.log('--- Conferência final ---');
eq([await saldo('b1'), await razao('b1')].every((x, _, a) => x === a[0]), true, 'b1: razão = saldo depois de tudo');
eq([await saldo('b2'), await razao('b2')].every((x, _, a) => x === a[0]), true, 'b2: razão = saldo depois de tudo');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
