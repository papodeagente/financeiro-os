/**
 * Liquidação em lote completa (06/11/2026, E7) contra um Postgres real
 * (PGlite), chamando a ROTA de produção POST /api/baixas com sessão de teste.
 *
 * Prova:
 *  1. REGRA PURA: cheque só com números; cartão só com os 4 últimos dígitos
 *     (número completo recusado, com ou sem espaços); autorização que parece
 *     número de cartão recusada; cada dado só com a forma certa; formas do
 *     lote = ligadas e do sentido de todas as contas.
 *  2. CHEQUE no lote: o número fica em cada baixa e volta no histórico.
 *  3. CARTÃO: final e autorização gravados e devolvidos; número completo
 *     recusado na prévia e na gravação, sem gravar nada.
 *  4. FORMAS DA AGÊNCIA: forma própria aceita; forma desligada e forma do
 *     outro sentido recusadas; a forma que a conta já tinha continua valendo;
 *     texto livre (nome da plataforma) grava como sempre.
 *  5. CÂMBIO POR TÍTULO no mesmo lote, moedas diferentes: cada conta quita
 *     pelo saldo na moeda × câmbio dela, com a variação de cada uma.
 *  6. CONTA BANCÁRIA EM MOEDA no lote: a prévia põe a conta que não serve
 *     fora (com o motivo) em vez de derrubar tudo; gravar continua recusando.
 *
 * Uso: node --no-warnings scripts/test-sql-liquidacao-em-lote.mjs
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
process.env.JWT_SECRET = 'segredo-de-teste-lote';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { NOTIFICACOES_SCHEMA_SQL } = await import('../src/lib/notificacoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { FORMAS_PAGAMENTO_SCHEMA_SQL, salvarForma, listarFormas } = await import('../src/lib/formas-pagamento-servidor.ts');
const { CAMBIO_SCHEMA_SQL } = await import('../src/lib/cambio-servidor.ts');
await pg.exec(NOTIFICACOES_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(FORMAS_PAGAMENTO_SCHEMA_SQL);
await pg.exec(CAMBIO_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);

await import('../src/lib/aprovacoes-executores.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const { hojeISO } = await import('../src/lib/money.ts');
const M = await import('../src/lib/baixa-meio.ts');
const { FORMAS_DO_SISTEMA } = await import('../src/lib/formas-pagamento.ts');
const RB = await import('../src/app/api/baixas/route.ts');

const T = 'ag-1';
const sessao = (perfil, userId = `u-${perfil}`) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo, chave) => new Request(`http://localhost${url}`, {
  method: metodo,
  headers: { 'content-type': 'application/json', ...(chave ? { 'idempotency-key': chave } : {}) },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];
const titulo = async (tab, id) => (await um(`SELECT data FROM ${tab} WHERE id = $1`, [id])).data;
const saldo = async id => Number((await titulo('contas_bancarias', id)).saldo_atual);
const nBaixas = async () => Number((await um(`SELECT COUNT(*)::int AS n FROM baixas WHERE tenant_id = $1`, [T])).n);
const previa = itens => RB.POST(req('/api/baixas', 'POST', { modo: 'previa', itens })).then(json);
let chaveN = 0;
const gravar = (itens, previaFeita) => RB.POST(req('/api/baixas', 'POST', {
  modo: 'gravar',
  itens: itens.map((it, i) => (previaFeita ? { ...it, esperado: { status_depois: previaFeita.itens[i].plano.status_depois, valor_baixado_depois: previaFeita.itens[i].plano.valor_baixado_depois } } : it)),
}, `lote-${++chaveN}`)).then(json);
const historico = (tab, id) => RB.GET(req(`/api/baixas?titulo_tabela=${tab}&titulo_id=${id}`)).then(json);
const HOJE = hojeISO();

console.log('--- 1. Regra pura ---');
const erroDe = fn => { try { fn(); return null; } catch (e) { return e instanceof M.ErroDoMeio ? e.message : `outro: ${e}`; } };
eq(M.lerMeioDoPagamento('CHEQUE', { cheque_numero: ' 000.123 ' }), { cheque_numero: '000123' }, 'cheque: só os algarismos ficam');
eq(erroDe(() => M.lerMeioDoPagamento('CHEQUE', { cheque_numero: '12A4' })), 'O número do cheque tem só algarismos (até 12).', 'cheque com letra recusado');
eq(erroDe(() => M.lerMeioDoPagamento('PIX', { cheque_numero: '123' })), 'O número do cheque só vale quando a forma é cheque.', 'cheque com Pix recusado');
eq(M.lerMeioDoPagamento('CARTAO_CREDITO', { cartao_ultimos4: '4242', cartao_autorizacao: 'a1b2c3' }), { cartao_ultimos4: '4242', cartao_autorizacao: 'A1B2C3' }, 'cartão: final e autorização');
for (const pan of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', '42424']) {
  eq(erroDe(() => M.lerMeioDoPagamento('CARTAO_CREDITO', { cartao_ultimos4: pan })), 'Informe só os 4 últimos dígitos do cartão. O número completo nunca é guardado.', `mais de 4 dígitos recusado (${pan})`);
}
eq(erroDe(() => M.lerMeioDoPagamento('CARTAO_DEBITO', { cartao_autorizacao: '4111111111111111' })), 'Isto parece o número do cartão. No campo de autorização vai só o código do comprovante.', 'número de cartão na autorização recusado');
eq(erroDe(() => M.lerMeioDoPagamento('DINHEIRO', { cartao_ultimos4: '4242' })), 'Os dígitos do cartão só valem quando a forma é cartão.', 'dígitos do cartão com dinheiro recusados');
eq(M.lerMeioDoPagamento('CARTAO', { cartao_ultimos4: '1234' }), { cartao_ultimos4: '1234' }, 'o "Cartão" antigo também aceita o final');
eq(M.lerMeioDoPagamento('PIX', {}), {}, 'sem dados de cheque/cartão: nada a guardar');
eq(M.descreverMeio({ cartao_ultimos4: '4242', cartao_autorizacao: 'X9' }), 'cartão final 4242 · autorização X9', 'descrição do meio');
const formasTeste = [
  { ...FORMAS_DO_SISTEMA[0] },
  { ...FORMAS_DO_SISTEMA.find(f => f.codigo === 'BOLETO'), ativo: false },
  { ...FORMAS_DO_SISTEMA.find(f => f.codigo === 'CARTAO_CORP') },
  { codigo: 'VALE', nome: 'Vale-viagem', sistema: false, uso: 'receber', ativo: true, conta_bancaria_id: null, dias_para_cair: 0, taxa_pct: 0, taxa_fixa: 0, informacoes: '', ordem: 1000 },
];
eq(M.formasDoLote(formasTeste, new Set(['receber'])).map(f => f.codigo), ['PIX', 'VALE'], 'lote só a receber: ligadas de receber ou ambos');
eq(M.formasDoLote(formasTeste, new Set(['pagar', 'receber'])).map(f => f.codigo), ['PIX'], 'lote misturado: só as que valem para os dois');
eq(M.recusaDaForma('BOLETO', 'receber', formasTeste, ''), 'A forma "Boleto" está desligada em Formas de pagamento. Escolha outra.', 'forma desligada recusada');
eq(M.recusaDaForma('BOLETO', 'receber', formasTeste, 'BOLETO'), null, 'a forma que a conta já tinha continua valendo');
eq(M.recusaDaForma('CARTAO_CORP', 'receber', formasTeste, ''), 'A forma "Cartão corporativo" vale só para contas a pagar.', 'forma do outro sentido recusada');
eq([M.recusaDaForma('DEPOSITO', 'pagar', formasTeste), M.recusaDaForma('Hotmart', 'receber', formasTeste)], [null, null], 'valor antigo e texto livre: como sempre');

// ---------------------------------------------------------------------------
// Cadastro
await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ('u-ADMIN', $1, $2)`, [T, JSON.stringify({ id: 'u-ADMIN', nome: 'Admin', perfil: 'ADMIN', ativo: true })]);
for (const [b, nome, moeda, s] of [['b1', 'Itaú', 'BRL', 100000], ['usd', 'Conta em dólar', 'USD', 5000]]) {
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ($1, $2, $3)`, [b, T, JSON.stringify({ id: b, nome, moeda, saldo_inicial: s, saldo_atual: s })]);
}
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));
const cp = (id, data) => query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1,$2,'PENDENTE',$3)`,
  [id, T, JSON.stringify({ id, fornecedor_nome: 'Operadora X', descricao: `Conta ${id}`, status: 'PENDENTE', data_vencimento: HOJE, moeda: 'BRL', ...data })]);
const cr = (id, data) => query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ($1,$2,'PENDENTE',$3)`,
  [id, T, JSON.stringify({ id, cliente_nome: 'Ana', descricao: `Conta ${id}`, status: 'PENDENTE', data_vencimento: HOJE, ...data })]);
// A agência: desliga o Boleto e cria "Vale-viagem" só para receber.
await salvarForma(pool, T, { ativo: false }, 'BOLETO');
const vale = await salvarForma(pool, T, { nome: 'Vale-viagem', uso: 'receber' });
eq([(await listarFormas(pool, T)).find(f => f.codigo === 'BOLETO').ativo, vale.uso], [false, 'receber'], 'cadastro de formas da agência pronto');
como(sessao('ADMIN'));

console.log('--- 2. Cheque no lote ---');
await cr('r-ch1', { valor_final: 300 });
await cr('r-ch2', { valor_final: 200 });
const itensCheque = ['r-ch1', 'r-ch2'].map((id, i) => ({
  titulo_tabela: 'contas_receber', titulo_id: id, data: HOJE, conta_bancaria_id: 'b1', forma: 'CHEQUE', valor: i === 0 ? 300 : 200, cheque_numero: '000123',
}));
let pv = await previa(itensCheque);
eq([pv.status, pv.corpo.itens.map(i => i.meio)], [200, [{ cheque_numero: '000123' }, { cheque_numero: '000123' }]], 'prévia devolve o cheque de cada conta');
let g = await gravar(itensCheque, pv.corpo);
eq([g.status, Boolean(g.corpo.lote_id)], [200, true], 'lote gravado com cheque');
let h = await historico('contas_receber', 'r-ch2');
eq(h.corpo.map(l => [l.tipo, l.forma, l.meio]), [['baixa', 'CHEQUE', { cheque_numero: '000123' }]], 'o histórico mostra o número do cheque');
eq((await um(`SELECT dados FROM baixas WHERE titulo_id = 'r-ch1'`)).dados, { meio: { cheque_numero: '000123' } }, 'gravado em baixas.dados.meio');

console.log('--- 3. Cartão ---');
await cp('p-cartao', { valor_final: 450 });
const itemCartao = { titulo_tabela: 'contas_pagar', titulo_id: 'p-cartao', data: HOJE, conta_bancaria_id: 'b1', forma: 'CARTAO_CREDITO', valor: 450 };
const antes = await nBaixas();
let r = await previa([{ ...itemCartao, cartao_ultimos4: '4111111111111111' }]);
eq([r.status, r.corpo.error], [400, 'Informe só os 4 últimos dígitos do cartão. O número completo nunca é guardado.'], 'prévia recusa o número completo');
r = await gravar([{ ...itemCartao, cartao_ultimos4: '4111 1111 1111 1111' }]);
eq([r.status, await nBaixas(), (await titulo('contas_pagar', 'p-cartao')).status], [400, antes, 'PENDENTE'], 'gravar com o número completo: recusado e nada gravado');
r = await gravar([{ ...itemCartao, cartao_ultimos4: '4242', cartao_autorizacao: '4111111111111111' }]);
eq(r.status, 400, 'número do cartão escondido na autorização: recusado');
pv = await previa([{ ...itemCartao, cartao_ultimos4: '4242', cartao_autorizacao: 'ab12cd' }]);
g = await gravar([{ ...itemCartao, cartao_ultimos4: '4242', cartao_autorizacao: 'ab12cd' }], pv.corpo);
eq([g.status, (await titulo('contas_pagar', 'p-cartao')).status], [200, 'PAGO'], 'pago com cartão');
h = await historico('contas_pagar', 'p-cartao');
eq(h.corpo[0].meio, { cartao_ultimos4: '4242', cartao_autorizacao: 'AB12CD' }, 'histórico com o final e a autorização (nunca o número completo)');
const guardado = JSON.stringify((await um(`SELECT dados FROM baixas WHERE titulo_id = 'p-cartao'`)).dados);
eq(/\d{5,}/.test(guardado), false, 'nenhuma sequência de mais de 4 dígitos ficou guardada');
await cp('p-pix', { valor_final: 10 });
r = await gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-pix', data: HOJE, conta_bancaria_id: 'b1', forma: 'PIX', valor: 10, cheque_numero: '55' }]);
eq([r.status, r.corpo.error], [400, 'O número do cheque só vale quando a forma é cheque.'], 'cheque com Pix: recusado');

console.log('--- 4. Formas da agência ---');
await cr('r-vale', { valor_final: 80 });
pv = await previa([{ titulo_tabela: 'contas_receber', titulo_id: 'r-vale', data: HOJE, conta_bancaria_id: 'b1', forma: vale.codigo, valor: 80 }]);
g = await gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r-vale', data: HOJE, conta_bancaria_id: 'b1', forma: vale.codigo, valor: 80 }], pv.corpo);
eq([g.status, (await titulo('contas_receber', 'r-vale')).forma_recebimento], [200, vale.codigo], 'forma própria da agência aceita (e fica na conta)');
await cr('r-boleto', { valor_final: 90 });
r = await previa([{ titulo_tabela: 'contas_receber', titulo_id: 'r-boleto', data: HOJE, conta_bancaria_id: 'b1', forma: 'BOLETO', valor: 90 }]);
eq([r.status, r.corpo.error], [400, 'A forma "Boleto" está desligada em Formas de pagamento. Escolha outra.'], 'forma desligada recusada na prévia');
r = await gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r-boleto', data: HOJE, conta_bancaria_id: 'b1', forma: 'BOLETO', valor: 90 }]);
eq([r.status, (await titulo('contas_receber', 'r-boleto')).status], [400, 'PENDENTE'], 'forma desligada recusada na gravação');
await cr('r-boleto-antigo', { valor_final: 70, forma_recebimento: 'BOLETO' });
g = await gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r-boleto-antigo', data: HOJE, conta_bancaria_id: 'b1', forma: 'BOLETO', valor: 70 }]);
eq(g.status, 200, 'conta que já era de boleto: liquida com a forma dela, mesmo desligada');
await cp('p-vale', { valor_final: 15 });
r = await gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-vale', data: HOJE, conta_bancaria_id: 'b1', forma: vale.codigo, valor: 15 }]);
eq([r.status, r.corpo.error], [400, 'A forma "Vale-viagem" vale só para contas a receber.'], 'forma só de receber recusada numa conta a pagar');
await cr('r-plataforma', { valor_final: 40 });
g = await gravar([{ titulo_tabela: 'contas_receber', titulo_id: 'r-plataforma', data: HOJE, conta_bancaria_id: 'b1', forma: 'Hotmart', valor: 40 }]);
eq(g.status, 200, 'texto livre (nome da plataforma) grava como sempre');

console.log('--- 5. Câmbio por título, moedas diferentes no mesmo lote ---');
await cp('p-usd', { valor_original: 1000, cambio: 5, valor_final: 5000, valor_brl: 5000, moeda: 'USD' });
await cp('p-eur', { valor_original: 200, cambio: 6, valor_final: 1200, valor_brl: 1200, moeda: 'EUR' });
const saldoB1 = await saldo('b1');
// Como a tela faz: 1ª prévia pelo saldo em reais, com o câmbio de cada uma...
const base = [
  { titulo_tabela: 'contas_pagar', titulo_id: 'p-usd', data: HOJE, conta_bancaria_id: 'b1', forma: 'TED', valor: 5000, cambio: 5.2 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'p-eur', data: HOJE, conta_bancaria_id: 'b1', forma: 'TED', valor: 1200, cambio: 6.1 },
];
const p1 = await previa(base);
eq(p1.corpo.itens.map(i => [i.cambio.moeda_titulo, i.cambio.saldo_moeda]), [['USD', 1000], ['EUR', 200]], '1ª prévia: o que falta na moeda de cada conta');
// ...e o valor pago = saldo na moeda × câmbio dela.
const itensCambio = base.map((it, i) => ({ ...it, valor: Math.round(p1.corpo.itens[i].cambio.saldo_moeda * it.cambio * 100) / 100 }));
const p2 = await previa(itensCambio);
eq(p2.corpo.itens.map(i => [i.plano.status_depois, i.cambio.variacao.variacao, i.cambio.variacao.resultado]), [['PAGO', 200, -200], ['PAGO', 20, -20]],
  'prévia final: as duas quitam, cada uma com a sua variação');
g = await gravar(itensCambio, p2.corpo);
eq([g.status, (await titulo('contas_pagar', 'p-usd')).status, (await titulo('contas_pagar', 'p-eur')).status], [200, 'PAGO', 'PAGO'], 'lote em duas moedas gravado');
const vars = (await query(`SELECT moeda, cambio_pago::text AS c, variacao_centavos FROM variacoes_cambiais WHERE tenant_id = $1 ORDER BY moeda`, [T])).rows;
eq(vars.map(v => [v.moeda, Number(v.c), Number(v.variacao_centavos)]), [['EUR', 6.1, 2000], ['USD', 5.2, 20000]], 'uma linha de variação por conta, com o câmbio dela');
eq(await saldo('b1'), Math.round((saldoB1 - 5200 - 1220) * 100) / 100, 'o caixa sai pelo valor pago de cada uma');

console.log('--- 6. Conta bancária em moeda no lote ---');
await cp('p-usd2', { valor_original: 100, cambio: 5, valor_final: 500, valor_brl: 500, moeda: 'USD' });
await cp('p-brl', { valor_final: 50 });
const misto = [
  { titulo_tabela: 'contas_pagar', titulo_id: 'p-usd2', data: HOJE, conta_bancaria_id: 'usd', valor: 510, cambio: 5.1 },
  { titulo_tabela: 'contas_pagar', titulo_id: 'p-brl', data: HOJE, conta_bancaria_id: 'usd', valor: 50 },
];
pv = await previa(misto);
eq([pv.status, pv.corpo.itens[0].plano.erros, pv.corpo.itens[1].plano.erros[0]?.includes('é em USD')], [200, [], true],
  'prévia: a conta em reais fica fora com o motivo, a em dólar segue');
const antesUsd = await nBaixas();
r = await gravar(misto);
eq([r.status, await nBaixas()], [409, antesUsd], 'gravar com a conta que não serve: recusa tudo, como sempre');
g = await gravar([misto[0]]);
eq([g.status, await saldo('usd')], [200, 4900], 'só a conta em dólar: sai US$ 100 da conta em dólar');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
