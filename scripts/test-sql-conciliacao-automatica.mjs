/**
 * Conciliação com regras aprendidas (E6, 05/11/2026) contra um Postgres
 * real (PGlite), rodando o código e a ROTA de produção com sessões de teste.
 *
 * Prova:
 *  1. APRENDER — cada conciliação feita por uma pessoa com uma conta ensina a
 *     regra da descrição; três vezes do mesmo jeito = certeza alta.
 *  2. SÓ COM CERTEZA E LIGADA — sem a agência ligar, nada vai sozinho; regra
 *     sem certeza não liga; ligada, só concilia sozinha a conta da MESMA
 *     pessoa com o MESMO valor, uma só, perto da data.
 *  3. PELA LIQUIDAÇÃO — a baixa automática é uma linha do histórico de baixas
 *     (origem conciliação), move o saldo e passa pelo porteiro; o porteiro
 *     recusando, a linha fica na fila com o motivo.
 *  4. DESFAZER — estorna a baixa, devolve o saldo e a conta, apaga a conta que
 *     a regra criou, e a regra para de conciliar sozinha.
 *  5. TARIFA RECORRENTE — vira conta a pagar sugerida; aceitar duas vezes não
 *     cria duas.
 *  6. ISOLAMENTO — a regra de uma agência não vale na outra.
 *
 * Uso: node --no-warnings scripts/test-sql-conciliacao-automatica.mjs
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
async function recusa(fn) {
  try { await fn(); return null; } catch (e) { return { status: e.status ?? 0, msg: e.message }; }
}

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '',
    status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', usuario_id TEXT NOT NULL DEFAULT '',
    acao TEXT NOT NULL DEFAULT '', modulo TEXT NOT NULL DEFAULT '', entidade TEXT NOT NULL DEFAULT '',
    entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES
    ('b1','t1','Itaú','{"nome":"Itaú","saldo_atual":0}'), ('b9','t1','Inter','{"nome":"Inter","saldo_atual":0}'),
    ('b2','t2','Inter','{"nome":"Inter","saldo_atual":0}');
  INSERT INTO plano_contas (id, tenant_id, codigo, data) VALUES ('tar','t1','2.9','{"codigo":"2.9","nome":"Tarifas bancárias","natureza_custo":"FIXO"}');
  INSERT INTO usuarios (id, tenant_id, nome, email, data) VALUES ('u-op','t1','Op','op@x.com','{"perfil":"OPERADOR"}');
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-automatica';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { CONCILIACAO_REGRAS_SCHEMA_SQL } = await import('../src/lib/conciliacao-regras-schema.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);
await pg.exec(CONCILIACAO_REGRAS_SCHEMA_SQL);
await pg.exec(CONCILIACAO_REGRAS_SCHEMA_SQL); // roda a cada boot

const { conciliarComContas, conciliarCriandoConta } = await import('../src/lib/conciliacao-servidor.ts');
const A = await import('../src/lib/conciliacao-automatica.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const { conferirBaixa } = await import('../src/lib/baixas-porteiro.ts');
const ROTA = await import('../src/app/api/conciliacao/automatica/route.ts');
const ROTA_CONCILIAR = await import('../src/app/api/conciliacao/conciliar/route.ts');

const exec = { query };
async function emTransacao(fn) {
  await pg.exec('BEGIN');
  try { const r = await fn(exec); await pg.exec('COMMIT'); return r; } catch (e) { await pg.exec('ROLLBACK'); throw e; }
}
const sessao = (perfil, tenantId = 't1', userId = `u-${perfil}`) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId, tenantSlug: tenantId });
const ADMIN = sessao('ADMIN');
const quem = (s = ADMIN, contas = null) => ({
  tenantId: s.tenantId, usuarioId: s.userId, usuarioNome: s.nome, contas,
  conferir: (x, itens, previa) => conferirBaixa(x, s, s.tenantId, itens, previa),
});
const executar = (s = ADMIN, contas = null) => A.executarConciliacaoAutomatica(exec, emTransacao, quem(s, contas));

const saldo = async id => Number((await pg.query(`SELECT (data->>'saldo_atual')::numeric s FROM contas_bancarias WHERE id=$1`, [id])).rows[0].s);
const linha = async id => (await pg.query(`SELECT status_conciliacao, data FROM extrato_bancario WHERE id=$1`, [id])).rows[0];
const conta = async (tabela, id) => (await pg.query(`SELECT status, data FROM ${tabela} WHERE id=$1`, [id])).rows[0];
async function novaLinha(id, valor, data, desc, tenant = 't1', contaB = 'b1') {
  const d = { id, conta_bancaria_id: contaB, data, descricao: desc, valor, tipo: valor >= 0 ? 'CREDITO' : 'DEBITO', status_conciliacao: 'PENDENTE' };
  await pg.query(`INSERT INTO extrato_bancario (id, tenant_id, conta_bancaria_id, status_conciliacao, data) VALUES ($1,$2,$3,'PENDENTE',$4::jsonb)`, [id, tenant, contaB, JSON.stringify(d)]);
}
async function cr(id, valor, venc, cliente = 'c-maria', nome = 'Maria Souza', tenant = 't1') {
  await pg.query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ($1,$2,$3,'PENDENTE',$4::jsonb)`,
    [id, tenant, cliente, JSON.stringify({ id, status: 'PENDENTE', valor_final: valor, data_vencimento: venc, valor_recebido: null, cliente_id: cliente, cliente_nome: nome, descricao: `Parcela ${id}` })]);
}
const regras = async (t = 't1') => A.listarRegras(exec, t);

console.log('--- 1. aprender com quem concilia ---');
const PIX = n => `PIX RECEBIDO - MARIA SOUZA ${n}/10 ID E${n}9988`;
for (const [i, dia] of [['1', '05'], ['2', '06'], ['3', '07']]) {
  await novaLinha(`m${i}`, 500, `2026-10-${dia}`, PIX(i));
  await cr(`rm${i}`, 500, `2026-10-${dia}`);
  await emTransacao(x => conciliarComContas(x, 't1', `m${i}`, [{ tipo: 'CONTA_RECEBER', id: `rm${i}` }]));
  await emTransacao(x => A.aprenderComConciliacao(x, 't1', `m${i}`));
}
{
  const rs = await regras();
  eq(rs.length, 1, 'três linhas com a mesma descrição (datas e ids diferentes) = uma regra só');
  eq([rs[0].padrao, rs[0].pessoa_id, rs[0].confirmacoes, rs[0].auto_ligada, rs[0].valores_centavos], ['maria souza', 'c-maria', 3, false, [50000, 50000, 50000]], 'a regra aprendeu a pessoa, o valor e três confirmações, sem ligar sozinha');
  eq((await linha('m3')).data.regra_id, rs[0].id, 'a linha guarda a regra que ensinou');
}
{
  // Conciliação 1-para-N não ensina.
  await novaLinha('mn', 1000, '2026-10-08', 'PIX RECEBIDO - CARLOS LIMA');
  await cr('rc1', 500, '2026-10-08', 'c-carlos', 'Carlos Lima');
  await cr('rc2', 500, '2026-11-08', 'c-carlos', 'Carlos Lima');
  await emTransacao(x => conciliarComContas(x, 't1', 'mn', [{ tipo: 'CONTA_RECEBER', id: 'rc1' }, { tipo: 'CONTA_RECEBER', id: 'rc2' }]));
  eq(await emTransacao(x => A.aprenderComConciliacao(x, 't1', 'mn')), null, 'linha que quitou duas contas não vira regra');
}

console.log('--- 2. só com a regra ligada e certeza alta ---');
await novaLinha('m4', 500, '2026-11-05', PIX('4'));
await cr('rm4', 500, '2026-11-06');
{
  const sug = await A.sugestoesDasRegras(exec, 't1', { contas: null });
  const s = sug.find(x => x.extrato_id === 'm4');
  eq([s?.decisao.tipo, s?.decisao.titulo?.id, /não está ligada/.test(s?.decisao.por_que_nao_sozinha ?? '')], ['sugerir', 'rm4', true], 'sem ligar: a regra só SUGERE a conta certa, dizendo por quê');
  const r = await executar();
  eq([r.conciliadas.length, (await linha('m4')).status_conciliacao], [0, 'PENDENTE'], 'executar sem regra ligada não concilia nada');
}
{
  // Regra com uma confirmação só não liga.
  await novaLinha('j1', 300, '2026-10-05', 'TED RECEBIDA JOANA PRADO');
  await cr('rj1', 300, '2026-10-05', 'c-joana', 'Joana Prado');
  await emTransacao(x => conciliarComContas(x, 't1', 'j1', [{ tipo: 'CONTA_RECEBER', id: 'rj1' }]));
  const rj = await emTransacao(x => A.aprenderComConciliacao(x, 't1', 'j1'));
  const r = await recusa(() => emTransacao(x => A.ligarRegra(x, 't1', rj.id, true, {})));
  eq([r?.status, /3 confirmações/.test(r?.msg ?? '')], [409, true], 'regra com uma confirmação não pode ser ligada');
}
const regraMaria = (await regras()).find(r => r.pessoa_id === 'c-maria');
await emTransacao(x => A.ligarRegra(x, 't1', regraMaria.id, true, { usuarioNome: 'Admin' }));

console.log('--- 3. ligada: concilia sozinha pela liquidação ---');
{
  const antes = await saldo('b1');
  const r = await executar();
  eq(r.conciliadas.map(c => c.extrato_id), ['m4'], 'a linha de valor e pessoa iguais foi conciliada sozinha');
  const c = await conta('contas_receber', 'rm4');
  eq([c.status, c.data.valor_recebido, c.data.data_recebimento, c.data.conta_bancaria_id, c.data.extrato_conciliado_id], ['RECEBIDO', 500, '2026-11-05', 'b1', 'm4'], 'a conta ficou recebida com a data e o banco do extrato');
  eq(await saldo('b1'), antes + 500, 'o saldo subiu 500');
  const b = (await pg.query(`SELECT tipo, origem, valor_centavos FROM baixas WHERE tenant_id='t1' AND titulo_id='rm4'`)).rows;
  eq(b.map(x => [x.tipo, x.origem, Number(x.valor_centavos)]), [['baixa', 'conciliacao', 50000]], 'a baixa está no histórico, com origem conciliação');
  const l = await linha('m4');
  eq([l.status_conciliacao, l.data.conciliado_por, l.data.vinculos[0].acao, !!l.data.vinculos[0].baixa_id], ['CONCILIADO', 'regra', 'BAIXA', true], 'a linha diz que foi a regra, e qual baixa');
  const lista = await A.listarAutomaticas(exec, 't1', { contas: null });
  eq([lista.length, lista[0].extrato_id, lista[0].pessoa_nome, lista[0].desfeita_em], [1, 'm4', 'Maria Souza', null], 'aparece na lista "conciliado sozinho"');
  const r2 = await executar();
  eq(r2.conciliadas.length, 0, 'executar de novo não concilia duas vezes');
}
{
  // Valor diferente: nunca vai sozinho.
  await novaLinha('m5', 480, '2026-12-05', PIX('5'));
  await cr('rm5', 500, '2026-12-05');
  const r = await executar();
  const s = (await A.sugestoesDasRegras(exec, 't1', { contas: null })).find(x => x.extrato_id === 'm5');
  eq([r.conciliadas.length, (await linha('m5')).status_conciliacao, (await conta('contas_receber', 'rm5')).status], [0, 'PENDENTE', 'PENDENTE'], 'banco 480 e conta 500: nada é conciliado');
  eq([s?.decisao.tipo, /valor diferente/.test(s?.decisao.por_que_nao_sozinha ?? '')], ['sugerir', true], 'vira sugestão dizendo que o valor é diferente');
}
{
  // Pessoa diferente: conta de outro cliente com o mesmo valor não serve.
  await pg.query(`DELETE FROM contas_receber WHERE id='rm5'`);
  await novaLinha('m6', 700, '2027-01-05', PIX('6'));
  await cr('rjo', 700, '2027-01-05', 'c-joao', 'João Alves');
  const r = await executar();
  const s = (await A.sugestoesDasRegras(exec, 't1', { contas: null })).find(x => x.extrato_id === 'm6');
  eq([r.conciliadas.length, (await conta('contas_receber', 'rjo')).status, s?.decisao.tipo], [0, 'PENDENTE', 'nada'], 'conta de outra pessoa com o mesmo valor nunca é conciliada pela regra');
}
{
  // Ambíguo: duas contas da Maria com o mesmo valor perto da data.
  await novaLinha('m7', 250, '2027-02-05', PIX('7'));
  await cr('rm7a', 250, '2027-02-04');
  await cr('rm7b', 250, '2027-02-06');
  const r = await executar();
  const s = (await A.sugestoesDasRegras(exec, 't1', { contas: null })).find(x => x.extrato_id === 'm7');
  eq([r.conciliadas.length, s?.decisao.tipo, /2 contas/.test(s?.decisao.por_que_nao_sozinha ?? '')], [0, 'sugerir', true], 'duas contas iguais: pede para escolher');
  await pg.query(`DELETE FROM contas_receber WHERE id IN ('rm7a','rm7b')`);
}

console.log('--- 4. o porteiro manda ---');
{
  await novaLinha('m8', 600, '2027-03-05', PIX('8'));
  await cr('rm8', 600, '2027-03-05');
  await P.salvarRestricaoDeUsuario(exec, 't1', { usuario_id: 'u-op', acoes_negadas: ['liquidar_receber'] });
  const op = sessao('OPERADOR', 't1', 'u-op');
  const r = await executar(op);
  eq([r.conciliadas.length, r.puladas.map(p => p.extrato_id), /baixa em contas a receber/.test(r.puladas[0]?.motivo ?? '')], [0, ['m8'], true], 'sem o direito de dar baixa, a linha fica na fila com o motivo');
  eq([(await linha('m8')).status_conciliacao, (await conta('contas_receber', 'rm8')).status], ['PENDENTE', 'PENDENTE'], 'e nada foi gravado');
  const rc = await executar(ADMIN, ['b9']);
  eq(rc.conciliadas.length, 0, 'quem só tem outra conta bancária liberada não concilia esta');
  const ra = await executar();
  eq(ra.conciliadas.map(c => c.extrato_id), ['m8'], 'quem pode, concilia');
}

console.log('--- 5. desfazer ---');
{
  const antes = await saldo('b1');
  await emTransacao(x => A.desfazerComRegras(x, 't1', 'm4', { usuarioId: 'u-ADMIN', usuarioNome: 'Admin' }, 'Era de outra venda'));
  const c = await conta('contas_receber', 'rm4');
  eq([c.status, c.data.valor_recebido ?? null, c.data.extrato_conciliado_id ?? null], ['PENDENTE', 0, null], 'a conta voltou a aberta, sem o vínculo');
  eq(await saldo('b1'), antes - 500, 'o saldo voltou');
  const b = (await pg.query(`SELECT tipo, motivo FROM baixas WHERE tenant_id='t1' AND titulo_id='rm4' ORDER BY criado_em`)).rows;
  eq(b.map(x => x.tipo), ['baixa', 'estorno'], 'a baixa foi estornada pelo estorno da liquidação (nada apagado)');
  eq((await linha('m4')).status_conciliacao, 'PENDENTE', 'a linha voltou para a fila');
  const lista = await A.listarAutomaticas(exec, 't1', { contas: null });
  eq([!!lista.find(x => x.extrato_id === 'm4')?.desfeita_em], [true], 'a lista mostra que foi desfeita');
  const rg = (await regras()).find(r => r.id === regraMaria.id);
  eq([rg.auto_ligada, rg.desfeitas, /desfeita/.test(rg.auto_suspensa_motivo)], [false, 1, true], 'a regra parou de conciliar sozinha e diz por quê');
  const r = await executar();
  eq(r.conciliadas.length, 0, 'e não concilia sozinha de novo até ser ligada');
}

console.log('--- 6. regra que lança a conta (tarifa) ---');
for (const [i, mes] of [['1', '07'], ['2', '08'], ['3', '09']]) {
  await novaLinha(`t${i}`, -39.9, `2026-${mes}-02`, `TARIFA PACOTE SERVICOS ${mes}/2026`);
  await emTransacao(x => conciliarCriandoConta(x, 't1', `t${i}`, { nome: 'Banco Itaú', descricao: 'Tarifa do pacote', categoria_id: 'tar' }));
  await emTransacao(x => A.aprenderComConciliacao(x, 't1', `t${i}`));
}
{
  const rt = (await regras()).find(r => r.destino === 'CRIAR');
  eq([rt.pessoa_nome, rt.categoria_id, rt.confirmacoes, rt.titulo_tabela], ['Banco Itaú', 'tar', 3, 'contas_pagar'], 'a regra da tarifa aprendeu quem cobra e a categoria');
  await emTransacao(x => A.ligarRegra(x, 't1', rt.id, true, {}));
  await novaLinha('t4', -39.9, '2026-10-02', 'TARIFA PACOTE SERVICOS 10/2026');
  await novaLinha('t5', -45, '2026-11-02', 'TARIFA PACOTE SERVICOS 11/2026');
  const antes = await saldo('b1');
  const r = await executar();
  eq(r.conciliadas.map(c => c.extrato_id), ['t4'], 'só a tarifa de valor igual vai sozinha; a de 45,00 não');
  const l = await linha('t4');
  const c = await conta('contas_pagar', l.data.vinculos[0].id);
  eq([c.status, c.data.valor_pago, c.data.categoria_id, c.data.fornecedor_nome, l.data.vinculos[0].criada], ['PAGO', 39.9, 'tar', 'Banco Itaú', true], 'a conta nasceu e foi paga pela liquidação');
  eq(await saldo('b1'), Math.round((antes - 39.9) * 100) / 100, 'o saldo saiu 39,90');
  await emTransacao(x => A.desfazerComRegras(x, 't1', 't4', {}, ''));
  eq([await conta('contas_pagar', l.data.vinculos[0].id), await saldo('b1')], [undefined, antes], 'desfazer apaga a conta criada pela regra e devolve o saldo');
}

console.log('--- 7. tarifa recorrente vira conta a pagar sugerida ---');
{
  const tarifas = await A.tarifasSugeridas(exec, 't1', null);
  const t = tarifas.find(x => x.conta_bancaria_id === 'b1');
  eq([!!t, t?.meses.length >= 2, t?.valor_tipico_centavos, t?.conta_criada_id], [true, true, 3990, null], 'a tarifa de todo mês aparece como sugestão, pelo valor típico');
  const r1 = await emTransacao(x => A.criarContaDaTarifa(x, 't1', t.chave, { fornecedor_nome: 'Banco Itaú', categoria_id: 'tar', contas: null }));
  const r2 = await emTransacao(x => A.criarContaDaTarifa(x, 't1', t.chave, { fornecedor_nome: 'Banco Itaú', categoria_id: 'tar', contas: null }));
  const c = await conta('contas_pagar', r1.id);
  eq([c.status, c.data.valor_final, c.data.data_vencimento, c.data.tarifa_chave === t.chave], ['PENDENTE', 39.9, t.proximo_vencimento, true], 'aceitar lança a conta a pagar do próximo mês, em aberto');
  eq([r2.ja_existia, r2.id], [true, r1.id], 'aceitar de novo não cria outra');
  eq((await A.tarifasSugeridas(exec, 't1', ['b9'])).length, 0, 'a sugestão respeita as contas bancárias liberadas');
}

console.log('--- 8. isolamento e rota ---');
{
  await novaLinha('x1', 500, '2026-11-05', PIX('4'), 't2', 'b2');
  await pg.query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ('rx1','t2','c-maria','PENDENTE',$1::jsonb)`,
    [JSON.stringify({ id: 'rx1', status: 'PENDENTE', valor_final: 500, data_vencimento: '2026-11-05', cliente_id: 'c-maria', cliente_nome: 'Maria Souza' })]);
  eq((await regras('t2')).length, 0, 'a outra agência não vê as regras da primeira');
  eq((await A.sugestoesDasRegras(exec, 't2', { contas: null })).length, 0, 'nem recebe sugestão delas');
  const r = await A.executarConciliacaoAutomatica(exec, emTransacao, quem(sessao('ADMIN', 't2')));
  eq([r.conciliadas.length, (await linha('x1')).status_conciliacao], [0, 'PENDENTE'], 'e nada dela é conciliado');
  eq((await A.listarAutomaticas(exec, 't2', { contas: null })).length, 0, 'a lista "conciliado sozinho" é por agência');
}
{
  globalThis.__SESSAO_DE_TESTE__ = ADMIN;
  const g = await ROTA.GET(new Request('http://x/api/conciliacao/automatica'));
  const corpo = await g.json();
  eq([g.status, corpo.regras.length >= 2, Array.isArray(corpo.sugestoes), corpo.automaticas.length >= 2, corpo.regras[0].certeza.nivel !== undefined], [200, true, true, true, true], 'GET devolve regras com certeza, sugestões, a lista e as tarifas');
  globalThis.__SESSAO_DE_TESTE__ = sessao('OPERADOR', 't1', 'u-op2');
  const lig = await ROTA.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ acao: 'ligar', regra_id: regraMaria.id, ligar: true }) }));
  eq(lig.status, 403, 'operador não liga a conciliação sozinha (é política da agência)');
  globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', 't2');
  const g2 = await (await ROTA.GET(new Request('http://x/api/conciliacao/automatica'))).json();
  eq([g2.regras.length, g2.automaticas.length], [0, 0], 'pela rota, a outra agência não vê nada da primeira');
  globalThis.__SESSAO_DE_TESTE__ = ADMIN;
  // Desfazer pela rota de sempre, com o motivo.
  await novaLinha('m9', 900, '2027-04-05', PIX('9'));
  await cr('rm9', 900, '2027-04-05');
  await emTransacao(x => A.ligarRegra(x, 't1', regraMaria.id, false, {}));
  // Ensina de novo até a certeza voltar (desfeita 1 exige 6 confirmações).
  const rg = (await regras()).find(r => r.id === regraMaria.id);
  await query(`UPDATE conciliacao_regras SET confirmacoes = 6 WHERE id = $1`, [rg.id]);
  await emTransacao(x => A.ligarRegra(x, 't1', regraMaria.id, true, {}));
  const ex = await (await ROTA.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ acao: 'executar' }) }))).json();
  eq(ex.conciliadas.map(c => c.extrato_id).includes('m9'), true, 'POST executar concilia pela rota');
  const d = await ROTA_CONCILIAR.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ acao: 'desfazer', extrato_id: 'm9', motivo: 'Teste' }) }));
  eq([d.status, (await linha('m9')).status_conciliacao, (await conta('contas_receber', 'rm9')).status], [200, 'PENDENTE', 'PENDENTE'], 'o desfazer da conciliação também desfaz a automática');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
