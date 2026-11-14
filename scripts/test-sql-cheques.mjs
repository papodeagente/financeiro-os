/**
 * Cheques emitidos (E7, frente C) contra um Postgres real (PGlite), chamando
 * as ROTAS de produção com sessão de teste:
 *  1. Esquema idempotente.
 *  2. Emitir o cheque de uma conta a pagar em aberto (valor = o que falta),
 *     número repetido, conta paga/cancelada, valor acima do saldo, conta de
 *     outra agência, conta bancária não liberada.
 *  3. Liquidar a conta com forma cheque e o mesmo número: a baixa liga ao
 *     cheque emitido; o número fica na conta (numero_cheque); o estorno solta.
 *  4. Liquidação em lote com um cheque novo: o cheque nasce da liquidação com
 *     a soma das contas; o estorno de uma tira o valor; o das duas cancela.
 *  5. Compensar (com a linha do extrato), devolver, cancelar; frases; cheque
 *     que pagou conta não se cancela.
 *  6. Ajuste de margens na conta bancária; impressão marcada.
 *  7. Isolamento: outra agência não vê nem mexe.
 *
 * Uso: node --no-warnings scripts/test-sql-cheques.mjs
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
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_origem_id TEXT NOT NULL DEFAULT '',
    conta_destino_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '',
    status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-cheques';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { FORMAS_PAGAMENTO_SCHEMA_SQL } = await import('../src/lib/formas-pagamento-servidor.ts');
const { CAMBIO_SCHEMA_SQL } = await import('../src/lib/cambio-servidor.ts');
const { CHEQUES_SCHEMA_SQL } = await import('../src/lib/cheques-servidor.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(FORMAS_PAGAMENTO_SCHEMA_SQL);
await pg.exec(CAMBIO_SCHEMA_SQL);
await pg.exec(CHEQUES_SCHEMA_SQL);
await pg.exec(CHEQUES_SCHEMA_SQL); // idempotente: roda a cada boot
await pg.exec(RAZAO_SCHEMA_SQL);

await import('../src/lib/aprovacoes-executores.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const { hojeISO } = await import('../src/lib/money.ts');
const RB = await import('../src/app/api/baixas/route.ts');
const RE = await import('../src/app/api/baixas/[id]/estorno/route.ts');
const RC = await import('../src/app/api/cheques/route.ts');
const RU = await import('../src/app/api/cheques/[id]/route.ts');
const RCFG = await import('../src/app/api/cheques/configuracao/route.ts');
const RPA = await import('../src/app/api/perfis-de-acesso/route.ts');

const T = 'ag-chq';
const OUTRA = 'ag-outra';
const sessao = (perfil, userId = `u-${perfil}`, tenant = T) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo, chave) => new Request(`http://localhost${url}`, {
  method: metodo,
  headers: { 'content-type': 'application/json', ...(chave ? { 'idempotency-key': chave } : {}) },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];
const titulo = async id => (await um(`SELECT data FROM contas_pagar WHERE id = $1`, [id])).data;
const ctx = id => ({ params: Promise.resolve({ id }) });
const HOJE = hojeISO();
let chaveN = 0;
const pagar = async itens => {
  const pv = await json(await RB.POST(req('/api/baixas', 'POST', { modo: 'previa', itens })));
  if (pv.status !== 200) return pv;
  return json(await RB.POST(req('/api/baixas', 'POST', { modo: 'gravar', itens, assinatura: pv.corpo.assinatura }, `chq-${++chaveN}`)));
};
const emitir = corpo => RC.POST(req('/api/cheques', 'POST', corpo)).then(json);
const listar = (q = '') => RC.GET(req(`/api/cheques${q}`)).then(json);
const ver = id => RU.GET(req(`/api/cheques/${id}`), ctx(id)).then(json);
const mudar = (id, corpo) => RU.PATCH(req(`/api/cheques/${id}`, 'PATCH', corpo), ctx(id)).then(json);
const cp = (id, data, tenant = T) => query(`INSERT INTO contas_pagar (id, tenant_id, status, fornecedor_id, data) VALUES ($1,$2,$3,'forn',$4)`,
  [id, tenant, data.status ?? 'PENDENTE', JSON.stringify({ id, fornecedor_nome: 'Operadora Sol', descricao: `Conta ${id}`, data_vencimento: HOJE, status: 'PENDENTE', valor_pago: 0, ...data })]);

await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES
  ('b1',$1,'{"nome":"Itaú","saldo_inicial":10000,"saldo_atual":10000}'),
  ('b2',$1,'{"nome":"Inter","saldo_inicial":0,"saldo_atual":0}'),
  ('bx',$2,'{"nome":"Alheia","saldo_inicial":0,"saldo_atual":0}')`, [T, OUTRA]);
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));

console.log('--- 1. Esquema ---');
const tabelas = (await query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('cheques_emitidos','cheque_baixas') ORDER BY 1`)).rows.map(r => r.table_name);
eq(tabelas, ['cheque_baixas', 'cheques_emitidos'], 'as duas tabelas existem (esquema roda duas vezes sem erro)');

console.log('--- 2. Emitir de uma conta a pagar em aberto ---');
como(sessao('ADMIN'));
await cp('p1', { valor_final: 1234.56 });
let r = await emitir({ titulo_id: 'p1', conta_bancaria_id: 'b1', numero: '000101', emissao: HOJE, cidade: 'Recife' });
const c1 = r.corpo;
eq([r.status, c1.situacao, c1.valor_centavos, c1.favorecido, c1.origem, c1.numero, c1.conta_nome], [201, 'EMITIDO', 123456, 'Operadora Sol', 'titulo', '000101', 'Itaú'],
  'emitido com o saldo da conta e o fornecedor como favorecido');
r = await emitir({ titulo_id: 'p1', conta_bancaria_id: 'b1', numero: '000101' });
eq([r.status, r.corpo.error], [409, 'O cheque nº 000101 desta conta já foi registrado (emitido). Use o próximo número do talão.'], 'número repetido recusado');
r = await emitir({ titulo_id: 'p1', conta_bancaria_id: 'b1', numero: '101' });
eq(r.status, 409, '101 e 000101 são o mesmo cheque');
r = await emitir({ titulo_id: 'p1', conta_bancaria_id: 'b2', numero: '000101', valor_centavos: 100 });
eq(r.status, 201, 'o mesmo número em outra conta (outro talão) passa');
await mudar(r.corpo.id, { acao: 'cancelar', motivo: 'só para o teste' });
r = await emitir({ titulo_id: 'p1', conta_bancaria_id: 'b1', numero: '000199', valor_centavos: 999999 });
eq([r.status, /não pode passar do que falta pagar/.test(r.corpo.error)], [400, true], 'valor acima do saldo recusado');
await cp('p-paga', { valor_final: 100, valor_pago: 100, status: 'PAGO' });
r = await emitir({ titulo_id: 'p-paga', conta_bancaria_id: 'b1', numero: '000200' });
eq([r.status, /já está paga/.test(r.corpo.error)], [409, true], 'conta já paga: recusada');
await cp('p-canc', { valor_final: 100, status: 'CANCELADO' });
r = await emitir({ titulo_id: 'p-canc', conta_bancaria_id: 'b1', numero: '000201' });
eq(r.status, 409, 'conta cancelada: recusada');
await cp('p-alheia', { valor_final: 100 }, OUTRA);
r = await emitir({ titulo_id: 'p-alheia', conta_bancaria_id: 'b1', numero: '000202' });
eq(r.status, 404, 'conta a pagar de outra agência: não existe aqui');
r = await emitir({ titulo_id: 'p1', conta_bancaria_id: 'bx', numero: '000203' });
eq(r.status, 404, 'conta bancária de outra agência: não existe aqui');
r = await emitir({ titulo_id: 'p1', conta_bancaria_id: 'b1', numero: '12A' });
eq([r.status, r.corpo.error], [400, 'O número do cheque tem só algarismos (até 12).'], 'número com letra recusado');

console.log('--- 3. Liquidar com o cheque emitido ---');
r = await pagar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p1', data: HOJE, conta_bancaria_id: 'b1', forma: 'CHEQUE', valor: 1234.56, cheque_numero: '101' }]);
eq(r.status, 200, 'liquidação com o cheque 101 (sem os zeros) gravada');
let d = await titulo('p1');
eq([d.status, d.numero_cheque], ['PAGO', '101'], 'o número do cheque fica na conta (o extrato e as movimentações já leem)');
r = await ver(c1.id);
eq([r.status, r.corpo.cheque.situacao, r.corpo.cheque.valor_centavos, r.corpo.cheque.liquidacoes.length, r.corpo.cheque.liquidacoes[0].titulo_id],
  [200, 'EMITIDO', 123456, 1, 'p1'], 'a baixa ligou ao cheque emitido (o valor do cheque não muda)');
eq(r.corpo.desenho.campos.find(c => c.campo === 'local_data').texto.startsWith('Recife, '), true, 'o desenho do cheque vem pronto para imprimir');
r = await mudar(c1.id, { acao: 'cancelar', motivo: 'rasgou' });
eq([r.status, r.corpo.error], [409, 'Este cheque pagou uma conta. Estorne a liquidação na conta a pagar antes de cancelar o cheque.'], 'cheque que pagou conta não se cancela');
const baixa1 = (await um(`SELECT id FROM baixas WHERE titulo_id = 'p1' AND tipo = 'baixa'`)).id;
r = await json(await RE.POST(req(`/api/baixas/${baixa1}/estorno`, 'POST', { motivo: 'cheque errado' }), ctx(baixa1)));
eq(r.status, 200, 'liquidação estornada');
r = await ver(c1.id);
eq([r.corpo.cheque.situacao, r.corpo.cheque.liquidacoes.length], ['EMITIDO', 0], 'estorno: o cheque emitido antes fica Emitido e sem conta');
r = await mudar(c1.id, { acao: 'cancelar', motivo: 'ok' });
eq([r.status, r.corpo.error], [400, 'Diga por que o cheque foi cancelado.'], 'cancelar sem motivo: recusado');
r = await mudar(c1.id, { acao: 'cancelar', motivo: 'preenchido errado' });
eq([r.status, r.corpo.cheque.situacao, r.corpo.cheque.motivo], [200, 'CANCELADO', 'preenchido errado'], 'cancelado com motivo');
r = await mudar(c1.id, { acao: 'compensar' });
eq([r.status, r.corpo.error], [409, 'Este cheque está cancelado. Nada mais muda nele.'], 'cancelado não muda mais');
r = await pagar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p1', data: HOJE, conta_bancaria_id: 'b1', forma: 'CHEQUE', valor: 10, cheque_numero: '000101' }]);
eq([r.status, r.corpo.error], [409, 'O cheque nº 000101 desta conta está cancelado. Use outro número.'], 'liquidar com número de cheque cancelado: recusado, nada gravado');
eq((await titulo('p1')).status, 'PENDENTE', 'a conta continua em aberto');

console.log('--- 4. Cheque nascido da liquidação em lote ---');
await cp('p2', { valor_final: 300 });
await cp('p3', { valor_final: 200 });
r = await pagar(['p2', 'p3'].map((id, i) => ({ titulo_tabela: 'contas_pagar', titulo_id: id, data: HOJE, conta_bancaria_id: 'b1', forma: 'CHEQUE', valor: i === 0 ? 300 : 200, cheque_numero: '000300' })));
eq(r.status, 200, 'lote de duas contas com o mesmo cheque');
r = await listar('?busca=000300');
const c3 = r.corpo.cheques[0];
eq([r.corpo.cheques.length, c3.origem, c3.valor_centavos, c3.liquidacoes.length, c3.favorecido], [1, 'liquidacao', 50000, 2, 'Operadora Sol'], 'o cheque nasceu da liquidação com a soma das duas contas');
const baixa2 = (await um(`SELECT id FROM baixas WHERE titulo_id = 'p2' AND tipo = 'baixa'`)).id;
await RE.POST(req(`/api/baixas/${baixa2}/estorno`, 'POST', { motivo: 'conta errada' }), ctx(baixa2));
r = await ver(c3.id);
eq([r.corpo.cheque.valor_centavos, r.corpo.cheque.situacao], [20000, 'EMITIDO'], 'estorno de uma: o cheque fica com o valor da outra');
const baixa3 = (await um(`SELECT id FROM baixas WHERE titulo_id = 'p3' AND tipo = 'baixa'`)).id;
await RE.POST(req(`/api/baixas/${baixa3}/estorno`, 'POST', { motivo: 'conta errada' }), ctx(baixa3));
r = await ver(c3.id);
eq([r.corpo.cheque.valor_centavos, r.corpo.cheque.situacao, r.corpo.cheque.motivo], [0, 'CANCELADO', 'Liquidação estornada'], 'estorno das duas: o cheque da liquidação fica cancelado');
await cp('p-rec', { valor_final: 50 });
r = await pagar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-rec', data: HOJE, conta_bancaria_id: 'b1', forma: 'PIX', valor: 50 }]);
eq([r.status, Number((await um(`SELECT count(*)::int AS n FROM cheques_emitidos WHERE tenant_id = $1`, [T])).n)], [200, 3], 'liquidação sem cheque não mexe nos cheques');

console.log('--- 5. Compensar, devolver ---');
await cp('p4', { valor_final: 80 });
r = await emitir({ titulo_id: 'p4', conta_bancaria_id: 'b1', numero: '000400', emissao: HOJE, bom_para: HOJE });
const c4 = r.corpo;
await query(`INSERT INTO extrato_bancario (id, tenant_id, conta_bancaria_id, data) VALUES
  ('e1',$1,'b1',$2), ('e2',$1,'b2',$3), ('e3',$1,'b1',$4)`,
  [T, JSON.stringify({ conta_bancaria_id: 'b1', data: HOJE, valor: -80, descricao: 'CHEQUE COMPENSADO 400' }),
    JSON.stringify({ conta_bancaria_id: 'b2', data: HOJE, valor: -80, descricao: 'outra conta' }),
    JSON.stringify({ conta_bancaria_id: 'b1', data: HOJE, valor: 80, descricao: 'entrada' })]);
r = await ver(c4.id);
eq(r.corpo.sugestoes_do_extrato.map(s => s.id), ['e1'], 'sugestão do extrato: só a saída do mesmo valor na mesma conta');
eq(r.corpo.acoes, ['compensar', 'devolver', 'cancelar'], 'ações do cheque emitido');
r = await mudar(c4.id, { acao: 'compensar', extrato_id: 'e2' });
eq([r.status, r.corpo.error], [400, 'A linha do extrato escolhida não é desta conta bancária.'], 'linha do extrato de outra conta: recusada');
r = await mudar(c4.id, { acao: 'compensar', data: HOJE, extrato_id: 'e1' });
eq([r.status, r.corpo.cheque.situacao, r.corpo.cheque.compensado_em, r.corpo.cheque.extrato_id], [200, 'COMPENSADO', HOJE, 'e1'], 'compensado e ligado à linha do extrato');
r = await mudar(c4.id, { acao: 'cancelar', motivo: 'xxx' });
eq(r.status, 409, 'compensado não se cancela');
r = await mudar(c4.id, { acao: 'devolver', motivo: 'sem fundos' });
eq([r.status, r.corpo.cheque.situacao, r.corpo.aviso], [200, 'DEVOLVIDO', null], 'devolvido (sem conta paga: sem aviso)');
await cp('p5', { valor_final: 40 });
r = await pagar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p5', data: HOJE, conta_bancaria_id: 'b1', forma: 'CHEQUE', valor: 40, cheque_numero: '000500' }]);
const c5 = (await listar('?busca=000500')).corpo.cheques[0];
r = await mudar(c5.id, { acao: 'devolver', motivo: 'divergência de assinatura' });
eq([r.status, /continua liquidada/.test(r.corpo.aviso ?? '')], [200, true], 'devolver cheque que pagou conta avisa para estornar a liquidação');

console.log('--- 6. Lista, filtros, ajuste e impressão ---');
r = await listar('?situacao=DEVOLVIDO');
eq(r.corpo.cheques.map(c => c.numero).sort(), ['000400', '000500'], 'filtro por situação');
eq([r.corpo.totais.DEVOLVIDO.quantidade, r.corpo.totais.DEVOLVIDO.valor_centavos], [2, 12000], 'totais por situação');
r = await listar('?conta=b2');
eq(r.corpo.cheques.map(c => [c.numero, c.situacao]), [['000101', 'CANCELADO']], 'filtro por conta');
r = await json(await RCFG.PUT(req('/api/cheques/configuracao', 'PUT', { conta_bancaria_id: 'b1', deslocar_x_mm: 2, deslocar_y_mm: -1.5, cidade_padrao: 'Olinda' })));
eq([r.status, r.corpo.config.deslocar_x_mm, r.corpo.config.cidade_padrao], [200, 2, 'Olinda'], 'ajuste da conta gravado');
const b1 = (await um(`SELECT data FROM contas_bancarias WHERE id = 'b1'`)).data;
eq([b1.nome, b1.saldo_inicial, b1.cheque.deslocar_y_mm], ['Itaú', 10000, -1.5], 'só o pedaço do cheque mudou na conta');
r = await json(await RCFG.GET(req('/api/cheques/configuracao?conta=b1')));
eq([r.status, r.corpo.proximo_numero], [200, '000501'], 'próximo número do talão sugerido');
r = await ver(c5.id);
const valor = r.corpo.desenho.campos.find(c => c.campo === 'valor');
eq([valor.x, valor.y, valor.texto], [130, 4.5, '#40,00#'], 'o desenho já sai com o ajuste da conta');
r = await mudar(c5.id, { acao: 'marcar_impresso' });
eq([r.status, r.corpo.cheque.impressoes, Boolean(r.corpo.cheque.impresso_em)], [200, 1, true], 'impressão marcada');

console.log('--- 7. Conta não liberada e outra agência ---');
await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ('u-op', $1, '{"id":"u-op","nome":"Op","perfil":"OPERADOR","ativo":true}')`, [T]);
r = await json(await RPA.POST(req('/api/perfis-de-acesso', 'POST', { restricao: { usuario_id: 'u-op', contas_liberadas: ['b2'], acoes_negadas: [] } })));
eq(r.status, 200, 'admin libera só a conta b2 para o operador');
como(sessao('OPERADOR', 'u-op'));
await cp('p6', { valor_final: 70 });
r = await emitir({ titulo_id: 'p6', conta_bancaria_id: 'b1', numero: '000600' });
eq([r.status, r.corpo.error], [403, 'Esta conta bancária não está liberada para você.'], 'operador não emite cheque da conta não liberada');
r = await listar();
eq(r.corpo.cheques.map(c => c.conta_bancaria_id), ['b2'], 'operador só vê os cheques da conta liberada');
r = await ver(c5.id);
eq(r.status, 404, 'nem abre o cheque');
r = await emitir({ titulo_id: 'p6', conta_bancaria_id: 'b2', numero: '7' });
eq([r.status, r.corpo.conta_nome], [201, 'Inter'], 'na conta liberada, emite');
como(sessao('ADMIN', 'u-x', OUTRA));
r = await listar();
eq(r.corpo.cheques.length, 0, 'outra agência não vê nenhum cheque');
r = await mudar(c5.id, { acao: 'compensar' });
eq(r.status, 404, 'outra agência não mexe');
como(sessao('VENDEDOR', 'u-vend'));
r = await emitir({ titulo_id: 'p6', conta_bancaria_id: 'b2', numero: '8' });
eq(r.status, 403, 'vendedor não emite cheque');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
