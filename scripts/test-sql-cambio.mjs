/**
 * Câmbio, contas em moeda, transferência entre moedas e variação cambial
 * (05/11/2026, E6, parte A), contra um Postgres real (PGlite), rodando o
 * código DE PRODUÇÃO. Nenhuma API real é chamada: o cliente HTTP é simulado
 * com as respostas da documentação oficial, e o fetch global explode se
 * alguém tentar sair para a internet.
 *
 * Uso: node --no-warnings scripts/test-sql-cambio.mjs
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

// Nada sai para a internet neste teste.
let fetchReal = 0;
globalThis.fetch = async () => { fetchReal++; throw new Error('o teste não pode chamar a internet'); };

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_origem_id TEXT NOT NULL DEFAULT '',
    conta_destino_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.INTEGRACOES_MASTER_KEY = 'd'.repeat(64);

const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
const { BAIXAS_SCHEMA_SQL, registrarBaixas, estornarBaixa } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const C = await import('../src/lib/cambio-servidor.ts');
const { sugestoesPara, idadeEmMinutos, variacaoPorTitulo } = await import('../src/lib/cambio.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(C.CAMBIO_SCHEMA_SQL);
await pg.exec(C.CAMBIO_SCHEMA_SQL); // idempotente (o gatilho não duplica)
await pg.exec(RAZAO_SCHEMA_SQL);
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { abrirRazaoNoExecutor } = await import('../src/lib/razao-servidor.ts');
const { rodarAgendador } = await import('../src/lib/agendador/nucleo.ts');

const um = async (sql, v) => (await query(sql, v)).rows[0];
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname = 'fin_moeda_da_conta_fixa'`)).n), 1, 'esquema idempotente: um gatilho só');

// ── Cliente HTTP simulado (respostas da documentação oficial) ─────────────
const chamadas = [];
let awesomeQuebrada = false;
let awesomeTs = Math.floor(Date.parse('2026-11-05T16:50:00Z') / 1000); // 13h50 de Brasília
const respSgs = {
  432: [{ data: '04/11/2026', valor: '15.00' }, { data: '08/12/2026', valor: '13.75' }],
  4390: [{ data: '01/11/2026', valor: '0.15' }, { data: '01/10/2026', valor: '1.07' }],
  433: Array.from({ length: 14 }, (_, i) => { const m = new Date(Date.UTC(2025, 8 + i, 1)); return { data: `01/${String(m.getUTCMonth() + 1).padStart(2, '0')}/${m.getUTCFullYear()}`, valor: '0.40' }; }),
  189: [{ data: '01/09/2026', valor: '1.57' }, { data: '01/10/2026', valor: '1.47' }],
};
const http = async (url, init) => {
  chamadas.push({ url, headers: init.headers });
  if (url.includes('awesomeapi')) {
    if (awesomeQuebrada) return { status: 500, json: async () => ({}) };
    if (init.headers['x-api-key'] !== 'chave-do-financeiro-123') return { status: 401, json: async () => ({}) };
    return { status: 200, json: async () => ({
      USDBRLT: { code: 'USD', codein: 'BRLT', name: 'Dólar Americano/Real Brasileiro Turismo', bid: '5.46195', ask: '5.88929', timestamp: String(awesomeTs), create_date: '2026-11-05 16:48:50' },
      EURBRLT: { code: 'EUR', codein: 'BRLT', name: 'Euro/Real Brasileiro Turismo', bid: '6.13501', ask: '6.61667', timestamp: String(awesomeTs), create_date: '2026-11-05 16:48:50' },
    }) };
  }
  if (url.includes('olinda')) {
    const moeda = /@moeda='([A-Z]{3})'/.exec(url)?.[1];
    const venda = { USD: 5.4778, EUR: 6.1549, GBP: 7.01, CAD: 3.9, CHF: 6.5, AUD: 3.5, JPY: 0.036 }[moeda];
    return { status: 200, json: async () => ({ value: [
      { cotacaoCompra: venda - 0.0006, cotacaoVenda: venda, dataHoraCotacao: '2026-11-04 13:05:19.232051', tipoBoletim: 'Fechamento PTAX' },
      { cotacaoCompra: venda - 0.0006, cotacaoVenda: venda + 0.01, dataHoraCotacao: '2026-11-05 13:06:00.1', tipoBoletim: 'Fechamento PTAX' },
    ] }) };
  }
  if (url.includes('bcdata.sgs.')) {
    const cod = Number(/sgs\.(\d+)\//.exec(url)?.[1]);
    return { status: 200, json: async () => respSgs[cod] ?? [] };
  }
  return { status: 404, json: async () => ({}) };
};
const contar = filtro => chamadas.filter(c => c.url.includes(filtro)).length;

console.log('--- Cofre do Super Admin ---');
let sit = await C.situacaoDosSegredos(pool);
eq([sit[0].nome, sit[0].definida, sit[0].cofre_disponivel], ['awesomeapi', false, true], 'sem chave cadastrada ainda');
let e = await falha(C.salvarSegredoPlataforma(pool, 'awesomeapi', 'ab', 'admin@x'));
eq(e?.status, 400, 'chave curta demais é recusada');
const guardada = process.env.INTEGRACOES_MASTER_KEY;
delete process.env.INTEGRACOES_MASTER_KEY;
e = await falha(C.salvarSegredoPlataforma(pool, 'awesomeapi', 'chave-do-financeiro-123', 'admin@x'));
eq(e?.status, 503, 'sem a chave mestra, nada é gravado (segredo da plataforma nunca em texto puro)');
process.env.INTEGRACOES_MASTER_KEY = guardada;

console.log('--- Sem chave: turismo não é consultado; PTAX e índices seguem ---');
const AGORA = new Date('2026-11-05T17:00:00Z'); // 14h de Brasília
let r = await C.atualizarCotacoes(pool, { http, agora: AGORA });
eq([r.awesomeapi, r.bcb_ptax, r.bcb_sgs, contar('awesomeapi')], ['sem_chave', 'ok', 'ok', 0], 'sem chave: nenhuma chamada à AwesomeAPI, PTAX e índices gravados');
eq(contar('olinda'), 7, 'PTAX: uma chamada por moeda estrangeira');
eq(contar('bcdata.sgs.'), 4, 'índices: uma chamada por série (Selic meta, Selic do mês, IPCA, IGP-M)');

await C.salvarSegredoPlataforma(pool, 'awesomeapi', 'chave-do-financeiro-123', 'admin@x');
const env = (await um(`SELECT envelope::text AS t FROM segredos_plataforma WHERE nome = 'awesomeapi'`)).t;
eq(env.includes('chave-do-financeiro-123'), false, 'no banco a chave está cifrada');
eq(await C.lerSegredoPlataforma(pool, 'awesomeapi'), 'chave-do-financeiro-123', 'o servidor decifra para usar');
sit = await C.situacaoDosSegredos(pool);
eq([sit[0].definida, sit[0].mascara, sit[0].atualizado_por], [true, 'chav••••••••••••-123', 'admin@x'], 'a tela vê só a máscara e quem gravou');

console.log('--- Uma consulta global a cada 15 min (cache único para todas as agências) ---');
chamadas.length = 0;
const tarefa = C.criarTarefaCotacoes(http);
const conexao = async () => ({ exec: pool, liberar() {} });
await rodarAgendador({ tarefas: [tarefa], conexao, emTransacao, agora: AGORA });
await rodarAgendador({ tarefas: [tarefa], conexao, emTransacao, agora: new Date(AGORA.getTime() + 5 * 60_000) });
eq(contar('awesomeapi'), 1, 'duas rodadas na mesma janela de 15 min: uma chamada à AwesomeAPI');
eq(chamadas.find(c => c.url.includes('awesomeapi'))?.headers['x-api-key'], 'chave-do-financeiro-123', 'a chave vai no cabeçalho x-api-key');
eq(chamadas.some(c => c.url.includes('chave-do-financeiro')), false, 'a chave nunca aparece em URL');
eq(contar('olinda') + contar('bcdata'), 0, 'PTAX de hoje já guardada e índices frescos: nada a consultar');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM agendador_execucoes WHERE tarefa = 'cambio-cotacoes'`)).n), 1, 'tarefa global: uma execução na janela, sem agência');
await rodarAgendador({ tarefas: [tarefa], conexao, emTransacao, agora: new Date(AGORA.getTime() + 15 * 60_000) });
eq(contar('awesomeapi'), 2, 'a janela seguinte consulta de novo');

chamadas.length = 0;
const R = await import('../src/app/api/cambio/route.ts');
const ler = async tenant => {
  globalThis.__SESSAO_DE_TESTE__ = { userId: `u-${tenant}`, nome: 'T', email: 't@x', perfil: 'VENDEDOR', tenantId: tenant, tenantSlug: tenant };
  const resp = await R.GET({ nextUrl: new URL('http://x/api/cambio') });
  return resp.json();
};
const pA = await ler('ag-A');
const pB = await ler('ag-B');
eq(JSON.stringify(pA.cotacoes), JSON.stringify(pB.cotacoes), 'duas agências leem exatamente as mesmas cotações');
eq([chamadas.length, fetchReal], [0, 0], 'ler as cotações nunca chama fonte nenhuma (só o cache)');
eq(pA.cotacoes.map(c => `${c.tipo}:${c.moeda}`).sort().slice(0, 3), ['ptax:AUD', 'ptax:CAD', 'ptax:CHF'], 'PTAX de todas as moedas no cache');
eq(sugestoesPara('USD', pA.cotacoes).turismo?.venda, 5.88929, 'turismo do dólar: venda = ask');
eq(sugestoesPara('USD', pA.cotacoes).ptax?.referencia, '2026-11-05', 'PTAX do dólar: o fechamento mais recente');
eq(pA.indices.filter(i => i.indice === 'selic_meta').map(i => i.referencia), ['2026-11-04'], 'meta Selic sem a data futura');
globalThis.__SESSAO_DE_TESTE__ = null;
eq((await R.GET({ nextUrl: new URL('http://x/api/cambio') })).status, 401, 'sem login, nada');
const hist = await C.lerPainelDeCambio(pool, { historico: { moeda: 'EUR', por_moeda: 5 } });
eq(hist.historico.filter(h => h.tipo === 'ptax').map(h => h.referencia), ['2026-11-05', '2026-11-04'], 'histórico curto por moeda, mais recente primeiro');

console.log('--- Disjuntor: fonte fora mostra a última cotação com a idade ---');
awesomeQuebrada = true;
chamadas.length = 0;
let quando = new Date(AGORA.getTime() + 30 * 60_000);
for (let i = 0; i < 3; i++) {
  r = await C.atualizarCotacoes(pool, { http, agora: quando });
  quando = new Date(quando.getTime() + 15 * 60_000);
}
eq([r.awesomeapi, contar('awesomeapi')], ['falhou', 3], 'três falhas seguidas');
r = await C.atualizarCotacoes(pool, { http, agora: quando });
eq([r.awesomeapi, contar('awesomeapi')], ['em_pausa', 3], 'com o disjuntor aberto, a fonte não é chamada');
const painel = await C.lerPainelDeCambio(pool, { agora: quando });
const est = painel.fontes.find(f => f.fonte === 'awesomeapi');
eq([est.falhas_seguidas, !!est.aberto_ate, est.ultimo_erro.includes('500')], [3, true, true], 'a tela sabe que a fonte está fora e por quê');
const usdT = sugestoesPara('USD', painel.cotacoes).turismo;
eq([usdT.venda, usdT.fonte], [5.88929, 'awesomeapi'], 'o turismo continua sendo a última cotação de turismo (não virou PTAX)');
eq(idadeEmMinutos(usdT.cotado_em, quando) > 60, true, 'com a idade crescendo, para a tela mostrar');
awesomeQuebrada = false;
await C.salvarSegredoPlataforma(pool, 'awesomeapi', 'chave-do-financeiro-123', 'admin@x');
eq((await C.lerEstadosDasFontes(pool)).find(f => f.fonte === 'awesomeapi').aberto_ate, null, 'gravar a chave de novo tira a fonte da pausa');

// ── Agência, contas e razão ────────────────────────────────────────────────
const T = 'ag-A';
globalThis.__SESSAO_DE_TESTE__ = { userId: 'u1', nome: 'Ana', email: 'a@x', perfil: 'ADMIN', tenantId: T, tenantSlug: T };
const CB = await import('../src/app/api/contas-bancarias/route.ts');
const CBI = await import('../src/app/api/contas-bancarias/[id]/route.ts');
const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const saldo = async id => Number((await um(`SELECT (data->>'saldo_atual')::numeric AS s FROM contas_bancarias WHERE id = $1`, [id]))?.s ?? NaN);
const razao = async id => Number((await um(`SELECT COALESCE(saldo_centavos,0) AS s FROM razao_saldo_bancario WHERE tenant_id=$1 AND conta_bancaria_id=$2`, [T, id]))?.s ?? 0) / 100;

console.log('--- Contas em moeda estrangeira ---');
await CB.POST(req('/api/contas-bancarias', 'POST', { id: 'brl', nome: 'Itaú', saldo_inicial: 10000 }));
await CB.POST(req('/api/contas-bancarias', 'POST', { id: 'usd', nome: 'Conta em dólar', moeda: 'USD', saldo_inicial: 0 }));
await CB.POST(req('/api/contas-bancarias', 'POST', { id: 'eur', nome: 'Conta em euro', moeda: 'eur', saldo_inicial: 0 }));
eq((await um(`SELECT data->>'moeda' AS m FROM contas_bancarias WHERE id = 'brl'`)).m, 'BRL', 'conta sem moeda nasce em real');
eq((await um(`SELECT data->>'moeda' AS m FROM contas_bancarias WHERE id = 'eur'`)).m, 'EUR', 'moeda normalizada');
let resp = await CBI.PUT(req('/api/contas-bancarias/eur', 'PUT', { id: 'eur', nome: 'Conta em libra', moeda: 'GBP', saldo_inicial: 0 }), { params: Promise.resolve({ id: 'eur' }) });
eq([resp.status, (await um(`SELECT data->>'moeda' AS m FROM contas_bancarias WHERE id = 'eur'`)).m], [200, 'GBP'], 'conta sem movimento pode trocar de moeda');
await emTransacao(exec => abrirRazaoNoExecutor(exec, T));

console.log('--- Transferência entre moedas, com câmbio e tarifa ---');
const TR = await import('../src/app/api/transferencias/route.ts');
const TRI = await import('../src/app/api/transferencias/[id]/route.ts');
const ctxId = id => ({ params: Promise.resolve({ id }) });
await TR.POST(req('/api/transferencias', 'POST', { id: 'tr1', conta_origem_id: 'brl', conta_destino_id: 'usd', valor: 5889.29, status: 'PENDENTE' }));
resp = await TRI.PUT(req('/api/transferencias/tr1', 'PUT', { id: 'tr1', conta_origem_id: 'brl', conta_destino_id: 'usd', valor: 5889.29, status: 'EFETIVADA' }), ctxId('tr1'));
eq([resp.status, (await resp.json()).error?.includes('câmbio')], [400, true], 'moedas diferentes sem câmbio: recusada, nada se move');
eq([await saldo('brl'), await saldo('usd')], [10000, 0], 'saldos intactos');
const carimbo = { valor: 5.8893, origem: 'turismo', fonte: 'awesomeapi', cotado_em: usdT.cotado_em, lado: 'venda' };
resp = await TRI.PUT(req('/api/transferencias/tr1', 'PUT', {
  id: 'tr1', conta_origem_id: 'brl', conta_destino_id: 'usd', valor: 5889.3, cambio: 5.8893, cambio_carimbo: carimbo, tarifa: 35, status: 'EFETIVADA',
}), ctxId('tr1'));
const tr1 = await resp.json();
eq(resp.status, 200, 'transferência efetivada');
eq([await saldo('brl'), await saldo('usd')], [4075.7, 1000], 'sai R$ 5.889,30 + R$ 35 de tarifa; chegam US$ 1.000');
eq([await razao('brl'), await razao('usd')], [4075.7, 1000], 'o razão acompanha cada conta na moeda dela');
eq([tr1.moeda_origem, tr1.moeda_destino, tr1.valor_destino, tr1.tarifa, tr1.cambio_carimbo.origem, tr1.cambio_carimbo.fonte], ['BRL', 'USD', 1000, 35, 'turismo', 'awesomeapi'], 'a transferência guarda moedas, valor que chegou, tarifa e de onde veio o câmbio');
e = await falha((async () => { const x = await CBI.PUT(req('/api/contas-bancarias/usd', 'PUT', { id: 'usd', nome: 'x', moeda: 'EUR', saldo_inicial: 0 }), ctxId('usd')); if (x.status !== 200) throw Object.assign(new Error((await x.json()).error), { status: x.status }); })());
eq([e?.status >= 400, String(e?.msg).includes('moeda desta conta não pode mudar'), (await um(`SELECT data->>'moeda' AS m FROM contas_bancarias WHERE id = 'usd'`)).m], [true, true, 'USD'], 'conta com movimento não troca de moeda');
resp = await TRI.PUT(req('/api/transferencias/tr1', 'PUT', { ...tr1, status: 'PENDENTE' }), ctxId('tr1'));
eq([resp.status, await saldo('brl'), await saldo('usd'), await razao('usd')], [200, 10000, 0, 0], 'desfazer a efetivação devolve os dois lados e a tarifa');
resp = await TRI.PUT(req('/api/transferencias/tr1', 'PUT', { ...tr1, status: 'EFETIVADA' }), ctxId('tr1'));
eq([await saldo('brl'), await saldo('usd')], [4075.7, 1000], 'efetivada de novo');

await TR.POST(req('/api/transferencias', 'POST', { id: 'tr2', conta_origem_id: 'brl', conta_destino_id: 'brl2', valor: 100, status: 'PENDENTE' }));
await CB.POST(req('/api/contas-bancarias', 'POST', { id: 'brl2', nome: 'Inter', saldo_inicial: 0 }));
await emTransacao(exec => abrirRazaoNoExecutor(exec, T)).catch(() => null);
resp = await TRI.PUT(req('/api/transferencias/tr2', 'PUT', { id: 'tr2', conta_origem_id: 'brl', conta_destino_id: 'brl2', valor: 100, status: 'EFETIVADA' }), ctxId('tr2'));
const tr2 = await resp.json();
eq([await saldo('brl'), await saldo('brl2'), tr2.valor_destino, tr2.cambio, tr2.tarifa], [3975.7, 100, undefined, undefined, 0], 'real → real: o mesmo valor nas duas pontas, sem câmbio (como sempre)');

console.log('--- Recalcular saldos não mistura moedas ---');
const { recalcularSaldosCaixa } = await import('../src/lib/caixa-helpers.ts');
const rec = await recalcularSaldosCaixa(T);
eq([rec.erros, rec.contas_em_moeda_mantidas.sort(), await saldo('usd'), await saldo('brl'), await saldo('brl2')], [[], ['eur', 'usd'], 1000, 3975.7, 100],
  'contas em moeda ficam como estão; as em real são reconstruídas com a tarifa e o valor de destino');

console.log('--- Variação cambial na liquidação ---');
const cp = (id, data) => query(`INSERT INTO contas_pagar (id, tenant_id, status, fornecedor_id, data) VALUES ($1,$2,$3,'forn',$4)`,
  [id, T, data.status ?? 'PENDENTE', JSON.stringify({ id, fornecedor_id: 'forn', fornecedor_nome: 'Hotel em Miami', descricao: `Conta ${id}`, data_vencimento: '2026-11-10', ...data })]);
const titulo = async id => (await um(`SELECT data FROM contas_pagar WHERE id = $1`, [id])).data;
const ctxB = { tenantId: T, usuarioId: 'u1', usuarioNome: 'Ana', origem: 'tela', politica: null };
const gravar = itens => emTransacao(exec => registrarBaixas(exec, ctxB, itens, { gravar: true }));
const previa = itens => registrarBaixas(pool, ctxB, itens, { gravar: false });

await cp('p-brl', { valor_original: 800, valor_final: 800, moeda: 'BRL', cambio: 1 });
const antesBRL = await saldo('brl');
await gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-brl', data: '2026-11-05', conta_bancaria_id: 'brl', valor: 800 }]);
let d = await titulo('p-brl');
const bBRL = await um(`SELECT dados, caixa_centavos FROM baixas WHERE titulo_id = 'p-brl'`);
eq([d.status, d.valor_pago, d.valor_final, 'variacao_cambial' in d, await saldo('brl'), bBRL.dados, Number(bBRL.caixa_centavos)],
  ['PAGO', 800, 800, false, round2(antesBRL - 800), {}, -80000], 'conta em real paga em real: exatamente como antes, sem nenhum campo novo');

await cp('p-usd', { valor_original: 1000, cambio: 5, valor_final: 5000, valor_brl: 5000, moeda: 'USD' });
const pv = await previa([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-usd', data: '2026-11-05', conta_bancaria_id: 'brl', valor: 5200, cambio: 5.2 }]);
eq([pv.itens[0].plano.status_depois, pv.itens[0].plano.juros, pv.itens[0].cambio.variacao.variacao, pv.itens[0].cambio.variacao.resultado, pv.itens[0].cambio.saldo_moeda],
  ['PAGO', 0, 200, -200, 1000], 'prévia: US$ 1.000 lançados a 5,00 e pagos a 5,20 — perda de R$ 200, nada vira juros');
eq(Number((await um(`SELECT COUNT(*)::int AS n FROM variacoes_cambiais`)).n), 0, 'prévia não grava variação');
const g = await gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-usd', data: '2026-11-05', conta_bancaria_id: 'brl', valor: 5200, cambio: 5.2,
  cambio_carimbo: { valor: 5.2, origem: 'ptax', fonte: 'bcb_ptax', cotado_em: '2026-11-05T16:06:00.000Z' } }]);
d = await titulo('p-usd');
eq([d.status, d.valor_pago, d.valor_final, d.variacao_cambial, d.valor_base_encargos, d.valor_original, d.cambio, d.juros],
  ['PAGO', 5200, 5200, 200, 5000, 1000, 5, 0], 'o lançado fica (US$ 1.000 a 5,00); a variação é uma parcela própria no título');
const v1 = await um(`SELECT moeda, valor_moeda_centavos, cambio_lancado::text AS cl, cambio_pago::text AS cpg, variacao_centavos, resultado_centavos, cambio_origem, cambio_fonte FROM variacoes_cambiais WHERE baixa_id = $1`, [g.itens[0].baixa_id]);
eq([v1.moeda, Number(v1.valor_moeda_centavos), Number(v1.cl), Number(v1.cpg), Number(v1.variacao_centavos), Number(v1.resultado_centavos), v1.cambio_origem, v1.cambio_fonte],
  ['USD', 100000, 5, 5.2, 20000, -20000, 'ptax', 'bcb_ptax'], 'linha de variação: moeda, câmbios, efeito no resultado e a fonte do câmbio usado');
const { variacoesDaAgencia } = C;
let linhas = await variacoesDaAgencia(pool, T);
eq([...variacaoPorTitulo(linhas)], [['contas_pagar:p-usd', 200]], 'o DRE recebe a variação por título');
eq(await variacoesDaAgencia(pool, 'ag-B'), [], 'outra agência não vê a variação');
await emTransacao(exec => estornarBaixa(exec, ctxB, g.itens[0].baixa_id, { motivo: 'câmbio errado' }));
d = await titulo('p-usd');
eq([d.status, d.valor_final, d.variacao_cambial, d.valor_moeda_liquidado], ['PENDENTE', 5000, 0, 0], 'estorno: o título volta ao lançado');
linhas = await variacoesDaAgencia(pool, T);
eq([linhas.length, linhas[1].estorno, [...variacaoPorTitulo(linhas)]], [2, true, []], 'o estorno entra como linha própria (a original continua registrada)');

console.log('--- Parcial com câmbio ---');
await gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-usd', data: '2026-11-05', conta_bancaria_id: 'brl', valor: 2600, cambio: 5.2 }]);
d = await titulo('p-usd');
eq([d.status, d.valor_pago, d.valor_moeda_liquidado, d.variacao_cambial, d.valor_final], ['PARCIAL', 2600, 500, 100, 5100], 'paga US$ 500 a 5,20: variação de R$ 100 sobre a metade');
await gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-usd', data: '2026-11-06', conta_bancaria_id: 'brl', valor: 2450, cambio: 4.9 }]);
d = await titulo('p-usd');
eq([d.status, d.valor_pago, d.valor_moeda_liquidado, d.variacao_cambial, d.valor_final], ['PAGO', 5050, 1000, 50, 5050], 'o resto a 4,90: ganho de R$ 50 nessa metade, quitada');

console.log('--- Conta bancária em moeda ---');
await cp('p-usd2', { valor_original: 300, cambio: 5.5, valor_final: 1650, moeda: 'USD' });
e = await falha(gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-usd2', data: '2026-11-05', conta_bancaria_id: 'usd', valor: 1650 }]));
eq(e?.msg.includes('câmbio do pagamento'), true, 'pela conta em dólar, o câmbio é obrigatório');
e = await falha(gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-brl2', data: '2026-11-05', conta_bancaria_id: 'usd', valor: 10 }]));
await cp('p-brl2', { valor_original: 10, valor_final: 10, moeda: 'BRL', cambio: 1 });
e = await falha(gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-brl2', data: '2026-11-05', conta_bancaria_id: 'usd', valor: 10 }]));
eq([e?.status, e?.msg.includes('é em USD')], [409, true], 'conta em real não se paga pela conta em dólar');
const gU = await gravar([{ titulo_tabela: 'contas_pagar', titulo_id: 'p-usd2', data: '2026-11-05', conta_bancaria_id: 'usd', valor: 1680, cambio: 5.6 }]);
d = await titulo('p-usd2');
eq([d.status, d.variacao_cambial, await saldo('usd'), await razao('usd')], ['PAGO', 30, 700, 700], 'paga US$ 300 pela conta em dólar: sai US$ 300 dela, e a conta em reais registra a perda de R$ 30');
const bU = await um(`SELECT caixa_centavos, valor_centavos FROM baixas WHERE id = $1`, [gU.itens[0].baixa_id]);
eq([Number(bU.caixa_centavos), Number(bU.valor_centavos)], [-30000, 168000], 'a baixa guarda o caixa na moeda da conta e o valor em reais');
await emTransacao(exec => estornarBaixa(exec, ctxB, gU.itens[0].baixa_id, { motivo: 'teste' }));
eq([await saldo('usd'), (await titulo('p-usd2')).status], [1000, 'PENDENTE'], 'estorno devolve US$ 300 à conta em dólar');

function round2(n) { return Math.round(n * 100) / 100; }
console.log('--- Caminho antigo não põe reais em conta em moeda ---');
{
  const { aplicarMovimentoCaixaAtomico: mover } = await import('../src/lib/caixa-atomico.ts');
  const antes = await saldo('usd');
  let erro = null;
  try { await emTransacao(tx => mover(T, 'usd', 100, tx, { tipo: 'conciliacao', descricao: 'teste' })); } catch (e) { erro = e; }
  eq([erro?.name, /em USD/.test(erro?.message ?? ''), await saldo('usd')], ['ErroMovimentoCaixa', true, antes], 'movimento em reais (conciliação, tela antiga, CRM) é recusado com a moeda no motivo e o saldo não muda');
  const ok = await emTransacao(tx => mover(T, 'usd', 10, tx, { tipo: 'ajuste', descricao: 'teste na moeda', naMoedaDaConta: true }));
  eq([ok, await saldo('usd')], [true, Math.round((antes + 10) * 100) / 100], 'quem já converteu (liquidação nova, transferência) move na moeda da conta');
  await emTransacao(tx => mover(T, 'usd', -10, tx, { tipo: 'ajuste', descricao: 'volta', naMoedaDaConta: true }));
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
