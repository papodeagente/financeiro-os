/**
 * Entrega B da auditoria de segurança de 04/11/2026 (Financeiro), contra um
 * Postgres real (PGlite), rodando o código DE PRODUÇÃO — inclusive as rotas,
 * com a sessão trocada por uma de teste (sessao-de-teste-hook.mjs).
 *
 * Cada bloco reproduz o ataque ou a falha descrita na auditoria e prova que
 * não passa mais. O PGlite tem uma conexão só: corridas de verdade não dá
 * para provocar aqui; o que se prova é que a guarda está DENTRO do SQL (o
 * estado do banco decide), e não numa leitura feita antes.
 *
 * Uso: node --no-warnings scripts/test-sql-seguranca-entrega-b.mjs
 */
import { register } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

let falhas = 0, total = 0;
function eq(a, b, label) {
  total++;
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(b)}\n        obtido:   ${JSON.stringify(a)}`); }
  else console.log(`PASS  ${label}`);
}
async function erro(p) { try { await p; return null; } catch (e) { return e?.status ?? e?.constructor?.name ?? String(e); } }

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT DEFAULT '', cliente_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '',
    status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE propostas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', numero TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '',
    vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RASCUNHO', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE crm_eventos_entrada (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'RECEBIDO', processado BOOLEAN NOT NULL DEFAULT false, erro TEXT, data JSONB NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE convites (id TEXT PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, nome TEXT NOT NULL DEFAULT '', plano_slug TEXT NOT NULL DEFAULT '',
    duracao_dias INTEGER NOT NULL DEFAULT 365, max_usos INTEGER, usos_atuais INTEGER NOT NULL DEFAULT 0, expira_em TIMESTAMPTZ,
    ativo BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE gestao_grupos (id TEXT PRIMARY KEY, grupo_id TEXT NOT NULL DEFAULT '', tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL);
  CREATE TABLE grupo_periodos_vagas (id TEXT PRIMARY KEY, grupo_id TEXT NOT NULL DEFAULT '', tenant_id TEXT NOT NULL DEFAULT '',
    periodo_index INTEGER NOT NULL DEFAULT 0, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE grupo_reservas (id TEXT PRIMARY KEY, grupo_id TEXT NOT NULL DEFAULT '', periodo_id TEXT NOT NULL DEFAULT '',
    cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'reservado', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE arquivos_privados (nome TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, nome_original TEXT NOT NULL DEFAULT '',
    mime TEXT NOT NULL DEFAULT '', tamanho BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE config_apis (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, entidade TEXT, entidade_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
`);

let quebrarTrava = false;
const query = async (text, values) => {
  if (quebrarTrava && /pg_try_advisory_lock/.test(text)) throw new Error('banco caiu');
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);

process.env.INTEGRACOES_MASTER_KEY = 'c'.repeat(64);
process.env.JWT_SECRET = 'segredo-de-teste-da-entrega-b';

const sessao = (tenantId, perfil = 'ADMIN') => ({ userId: `u-${tenantId}`, nome: 'Teste', email: 't@x.com', perfil, permissoes: {}, tenantId, tenantSlug: tenantId });
const comoAgencia = (t, perfil) => { globalThis.__SESSAO_DE_TESTE__ = sessao(t, perfil); };
const semLogin = () => { globalThis.__SESSAO_DE_TESTE__ = null; };
const req = (url, metodo = 'GET', corpo, cab = {}) => new Request(`http://localhost${url}`, {
  method: metodo,
  headers: { 'content-type': 'application/json', ...cab },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const ctx = obj => ({ params: Promise.resolve(obj) });
const um = async (sql, v) => (await query(sql, v)).rows[0];
const saldo = async id => Number((await um(`SELECT (data->>'saldo_atual')::numeric AS s FROM contas_bancarias WHERE id = $1`, [id]))?.s ?? NaN);

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-01: o POST de conta bancária não escreve o saldo calculado ---');
{
  const R = await import('../src/app/api/contas-bancarias/route.ts');
  comoAgencia('ag-1');
  let r = await R.POST(req('/api/contas-bancarias', 'POST', { id: 'banco-1', nome: 'Inter', saldo_inicial: 100, saldo_atual: 999999 }));
  eq(r.status, 200, 'cadastro novo aceito');
  eq(await saldo('banco-1'), 100, 'conta nova nasce com saldo atual = saldo inicial (não o enviado)');
  await query(`UPDATE contas_bancarias SET data = jsonb_set(data, '{saldo_atual}', '350') WHERE id = 'banco-1'`);
  r = await R.POST(req('/api/contas-bancarias', 'POST', { id: 'banco-1', nome: 'Inter PJ', saldo_inicial: 100, saldo_atual: 999999 }));
  eq(r.status, 200, 'regravação pelo POST aceita');
  eq(await saldo('banco-1'), 350, 'regravação pelo POST mantém o saldo do banco');
  eq((await um(`SELECT data->>'nome' AS n FROM contas_bancarias WHERE id = 'banco-1'`)).n, 'Inter PJ', 'e o resto do cadastro muda');
  comoAgencia('ag-2');
  r = await R.POST(req('/api/contas-bancarias', 'POST', { id: 'banco-1', nome: 'Roubada', saldo_inicial: 0, saldo_atual: 0 }));
  eq(r.status, 404, 'id de outra agência: nada gravado (404)');
  eq((await um(`SELECT tenant_id, data->>'nome' AS n FROM contas_bancarias WHERE id = 'banco-1'`)), { tenant_id: 'ag-1', n: 'Inter PJ' }, 'conta da ag-1 intacta');

  const I = await import('../src/app/api/contas-bancarias/[id]/route.ts').catch(() => null);
  if (I?.PUT) {
    comoAgencia('ag-1');
    r = await I.PUT(req('/api/contas-bancarias/banco-1', 'PUT', { id: 'banco-1', nome: 'Inter', saldo_inicial: 100, saldo_atual: 5 }), ctx({ id: 'banco-1' }));
    eq(await saldo('banco-1'), 350, 'PUT com saldo velho da tela também não apaga baixas');
  }
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-02 e FIN2-03: baixa travada, sem sucesso sem dinheiro ---');
{
  const R = await import('../src/app/api/contas-receber/route.ts');
  const I = await import('../src/app/api/contas-receber/[id]/route.ts');
  comoAgencia('ag-1');
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('banco-2', 'ag-1', '{"nome":"Itaú","saldo_inicial":0,"saldo_atual":0}')`);
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('banco-alheio', 'ag-2', '{"nome":"Alheio","saldo_inicial":0,"saldo_atual":0}')`);
  let r = await R.POST(req('/api/contas-receber', 'POST', { id: 'cr-1', status: 'PENDENTE', valor_final: 100 }));
  eq(r.status, 200, 'conta a receber criada');

  // Baixa num banco que não existe nesta agência: antes, 200 + RECEBIDO sem dinheiro.
  r = await I.PUT(req('/api/contas-receber/cr-1', 'PUT', { id: 'cr-1', status: 'RECEBIDO', valor_final: 100, valor_recebido: 100, conta_bancaria_id: 'banco-alheio' }), ctx({ id: 'cr-1' }));
  eq(r.status, 409, 'baixa em banco de outra agência é recusada');
  eq((await um(`SELECT data->>'status' AS s FROM contas_receber WHERE id = 'cr-1'`)).s, 'PENDENTE', 'e a conta continua PENDENTE (tudo desfeito)');
  eq(await saldo('banco-alheio'), 0, 'banco alheio intocado');
  r = await I.PUT(req('/api/contas-receber/cr-1', 'PUT', { id: 'cr-1', status: 'RECEBIDO', valor_final: 100, valor_recebido: 100, conta_bancaria_id: 'nao-existe' }), ctx({ id: 'cr-1' }));
  eq(r.status, 409, 'baixa em banco inexistente é recusada');

  r = await I.PUT(req('/api/contas-receber/cr-1', 'PUT', { id: 'cr-1', status: 'RECEBIDO', valor_final: 100, valor_recebido: 100, conta_bancaria_id: 'banco-2' }), ctx({ id: 'cr-1' }));
  eq([r.status, await saldo('banco-2')], [200, 100], 'baixa válida credita 100');
  r = await I.PUT(req('/api/contas-receber/cr-1', 'PUT', { id: 'cr-1', status: 'RECEBIDO', valor_final: 100, valor_recebido: 100, conta_bancaria_id: 'banco-2' }), ctx({ id: 'cr-1' }));
  eq(await saldo('banco-2'), 100, 'duplo clique não credita de novo');

  // Tela velha: o POST (upsert) com PENDENTE por cima da conta já recebida.
  r = await R.POST(req('/api/contas-receber', 'POST', { id: 'cr-1', status: 'PENDENTE', valor_final: 100 }));
  eq(r.status, 409, 'POST não rebaixa conta recebida (checagem dentro do upsert)');
  eq([(await um(`SELECT data->>'status' AS s FROM contas_receber WHERE id = 'cr-1'`)).s, await saldo('banco-2')], ['RECEBIDO', 100], 'conta e saldo intactos');
  r = await R.POST(req('/api/contas-receber', 'POST', { id: 'cr-novo', status: 'RECEBIDO', valor_final: 5 }));
  eq(r.status, 400, 'POST não cria conta já baixada');

  // Tela velha pelo PUT: quem abriu com PENDENTE salva só a descrição.
  r = await I.PUT(req('/api/contas-receber/cr-1', 'PUT', { id: 'cr-1', status: 'PENDENTE', valor_final: 100, descricao: 'nova' }), ctx({ id: 'cr-1' }));
  const depois = await um(`SELECT data->>'status' AS s FROM contas_receber WHERE id = 'cr-1'`);
  eq([depois.s, await saldo('banco-2')], ['PENDENTE', 0], 'edição sobre estado novo: conta e caixa andam juntos (estorno feito)');

  r = await I.PUT(req('/api/contas-receber/nao-existe', 'PUT', { id: 'x', status: 'PENDENTE' }), ctx({ id: 'nao-existe' }));
  eq(r.status, 404, 'PUT em conta inexistente é 404, não 200');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-02: conciliação não marca nada se o caixa não se move ---');
{
  const C = await import('../src/lib/conciliacao-servidor.ts');
  await query(`INSERT INTO contas_receber (id, tenant_id, status, data) VALUES ('cr-c', 'ag-1', 'PENDENTE', '{"id":"cr-c","status":"PENDENTE","valor_final":50,"data_vencimento":"2026-11-01"}')`);
  await query(`INSERT INTO extrato_bancario (id, tenant_id, conta_bancaria_id, data) VALUES ('ex-1', 'ag-1', 'banco-alheio', '{"valor":50,"data":"2026-11-01","descricao":"PIX","conta_bancaria_id":"banco-alheio"}')`);
  const e = await erro(C.conciliarComContas(pool, 'ag-1', 'ex-1', [{ tipo: 'CONTA_RECEBER', id: 'cr-c' }]));
  eq(e, 409, 'extrato de conta bancária alheia não concilia');
  eq(await saldo('banco-alheio'), 0, 'e não move o banco alheio');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-03: comissão paga não volta a pendente ---');
{
  const K = await import('../src/lib/comissao-conta.ts');
  const id = K.idDaContaDaComissao('com-1');
  await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1, 'ag-1', 'PAGO', $2)`, [id, JSON.stringify({ id, status: 'PAGO', valor_pago: 10 })]);
  const r = await K.sincronizarContaDaComissao('ag-1', { id: 'com-1', vendedor_nome: 'V', valor_comissao: 10, status: 'PENDENTE' }, pool);
  eq(r.acao, 'preservada', 'conta paga é preservada');
  eq((await um(`SELECT data->>'status' AS s FROM contas_pagar WHERE id = $1`, [id])).s, 'PAGO', 'continua PAGA');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-03: recálculo de saldo grava só o saldo ---');
{
  const H = await import('../src/lib/caixa-helpers.ts');
  await query(`UPDATE contas_receber SET status = 'RECEBIDO', data = data || '{"status":"RECEBIDO","valor_recebido":100,"conta_bancaria_id":"banco-2"}' WHERE id = 'cr-1'`);
  const r = await H.recalcularSaldosCaixa('ag-1');
  eq(r.erros, [], 'recálculo sem erro');
  eq(await saldo('banco-2'), 100, 'saldo reconstruído pelas baixas');
  eq((await um(`SELECT data->>'nome' AS n FROM contas_bancarias WHERE id = 'banco-1'`)).n, 'Inter', 'nome da conta não é regravado');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-20: a mesma transação bancária entra uma vez ---');
{
  const X = await import('../src/lib/extrato-importacao.ts');
  await pg.exec(X.EXTRATO_FITID_UNICO_SQL);
  const linhas = [{ data: '2026-11-02', valor: 10, descricao: 'TED', fitid: 'F-1' }];
  let r = await X.importarExtrato(pool, 'ag-1', 'banco-2', 'a.ofx', linhas);
  eq([r.inseridas, r.duplicadas], [1, 0], 'primeira importação grava');
  // Simula a corrida: a segunda importação "não viu" a linha da primeira.
  const cego = { query: (t, v) => (/SELECT data FROM extrato_bancario WHERE tenant_id/.test(t) ? Promise.resolve({ rows: [] }) : query(t, v)) };
  r = await X.importarExtrato(cego, 'ag-1', 'banco-2', 'a.ofx', linhas);
  eq([r.inseridas, r.duplicadas], [0, 1], 'mesmo sem ver a anterior, o índice único segura a duplicata');
  eq((await um(`SELECT count(*)::int AS n FROM extrato_bancario WHERE data->>'fitid' = 'F-1'`)).n, 1, 'uma linha no banco');
  eq(await erro(X.importarExtrato(pool, 'ag-1', 'banco-alheio', 'b.ofx', linhas)), 'Error', 'extrato em conta de outra agência é recusado');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN-13 / FIN2-06 / FIN2-07: proposta pública ---');
{
  const P = await import('../src/lib/proposta-publica.ts');
  await query(`INSERT INTO propostas (id, tenant_id, status, data) VALUES ('prop-antiga-01', 'ag-1', 'ENVIADO', $1)`, [JSON.stringify({
    id: 'prop-antiga-01', status: 'ENVIADO', cabecalho: { titulo: 'Paris' }, secoes: [{ tipo: 'VALORES', conteudo: { valor: 10, custo: 7, margem_pct: 30 } }],
    leads: [{ nome: 'Outro', email: 'outro@x.com', telefone: '119' }], aceite: null, observacoes_internas: 'segredo',
  })]);
  await pg.exec(P.PROPOSTA_LINK_SCHEMA_SQL);
  let achou = await P.resolverPropostaPublica(pool, 'prop-antiga-01');
  eq(achou?.id, 'prop-antiga-01', 'proposta que já existia abre pelo id (link já mandado ao cliente)');

  await query(`INSERT INTO propostas (id, tenant_id, status, data) VALUES ('prop-nova-0001', 'ag-1', 'RASCUNHO', '{"id":"prop-nova-0001","status":"RASCUNHO","cabecalho":{"titulo":"Roma"}}')`);
  await pg.exec(P.PROPOSTA_LINK_SCHEMA_SQL); // segundo boot: não marca a nova como antiga
  eq(await P.resolverPropostaPublica(pool, 'prop-nova-0001'), null, 'proposta nova NÃO abre pelo id');
  const link = await P.garantirLinkPublico(pool, 'ag-1', 'prop-nova-0001', 'https://fin.exemplo.com');
  const token = link.split('/p/')[1];
  eq(token.length >= 43, true, 'token com 256 bits');
  eq(await P.garantirLinkPublico(pool, 'ag-1', 'prop-nova-0001', 'https://fin.exemplo.com'), link, 'garantir é idempotente');
  eq(await P.garantirLinkPublico(pool, 'ag-2', 'prop-nova-0001'), null, 'outra agência não gera link da proposta');
  eq((await P.resolverPropostaPublica(pool, token))?.id, 'prop-nova-0001', 'abre pelo token');
  const guardado = await um(`SELECT token_publico_hash AS h FROM propostas WHERE id = 'prop-nova-0001'`);
  eq(guardado.h === token, false, 'o banco guarda o hash, não o token');
  const novo = await P.renovarLinkPublico(pool, 'ag-1', 'prop-nova-0001', 'https://fin.exemplo.com');
  eq(await P.resolverPropostaPublica(pool, token), null, 'trocar o link mata o anterior na hora');
  eq((await P.resolverPropostaPublica(pool, novo.split('/p/')[1]))?.id, 'prop-nova-0001', 'e o novo abre');
  await query(`UPDATE propostas SET token_expira_em = NOW() - INTERVAL '1 day' WHERE id = 'prop-nova-0001'`);
  eq(await P.resolverPropostaPublica(pool, novo.split('/p/')[1]), null, 'link vencido não abre');
  await P.renovarLinkPublico(pool, 'ag-1', 'prop-nova-0001');

  const pub = P.paraPublico((await P.resolverPropostaPublica(pool, 'prop-antiga-01')).data, 'prop-antiga-01');
  const txt = JSON.stringify(pub);
  eq(['outro@x.com', 'segredo', '"custo"', 'margem_pct', 'leads'].filter(x => txt.includes(x)), [], 'resposta pública sem leads, observação interna, custo, margem');
  eq(pub.cabecalho.titulo, 'Paris', 'o que a página desenha continua lá');

  // Rota pública: devolve o recorte, nunca o registro.
  const G = await import('../src/app/api/propostas/public/[slug]/route.ts');
  const resp = await G.GET(req('/api/propostas/public/prop-antiga-01'), ctx({ slug: 'prop-antiga-01' }));
  eq([resp.status, (await resp.text()).includes('outro@x.com')], [200, false], 'GET público não vaza o contato de outro interessado');
  const resp404 = await G.GET(req('/api/propostas/public/prop-nova-0001'), ctx({ slug: 'prop-nova-0001' }));
  eq(resp404.status, 404, 'GET pelo id de proposta nova: 404');

  // Aceite: vale o primeiro; a visualização não o apaga.
  eq(await P.registrarAceite(pool, 'prop-antiga-01', { nome_aceite: 'Ana', ip_aceite: '1.1.1.1', request_id: 'r1' }), true, 'primeiro aceite vale');
  eq(await P.registrarAceite(pool, 'prop-antiga-01', { nome_aceite: 'Intruso', ip_aceite: '6.6.6.6', request_id: 'r2' }), false, 'segundo aceite não regrava');
  await P.marcarVisualizada(pool, 'prop-antiga-01');
  await P.acrescentarEventoPublico(pool, 'prop-antiga-01', 'visualizacoes', { data: 'x', tempo_segundos: 3 });
  const final = await um(`SELECT status, data FROM propostas WHERE id = 'prop-antiga-01'`);
  eq([final.status, final.data.status, final.data.aceite.nome_aceite, final.data.visualizacoes.length], ['ACEITO', 'ACEITO', 'Ana', 1], 'visualização depois do aceite não rebaixa nem apaga o aceite');
  const A = await import('../src/app/api/propostas/public/[slug]/aceitar/route.ts');
  const dup = await A.PUT(req('/api/propostas/public/prop-antiga-01/aceitar', 'PUT', { nome: 'Intruso', telefone: '11999998888', email: 'i@x.com', request_id: 'r9' }), ctx({ slug: 'prop-antiga-01' }));
  eq(dup.status, 409, 'aceite com outro pedido sobre proposta aceita: 409');
  eq((await um(`SELECT data->'aceite'->>'nome_aceite' AS n FROM propostas WHERE id = 'prop-antiga-01'`)).n, 'Ana', 'prova do aceite intacta');

  // Editor da agência com tela velha não apaga o que o cliente escreveu.
  comoAgencia('ag-1');
  const E = await import('../src/app/api/propostas/[id]/route.ts');
  const resE = await E.PUT(req('/api/propostas/prop-antiga-01', 'PUT', { id: 'prop-antiga-01', status: 'ENVIADO', aceite: null, leads: [], cabecalho: { titulo: 'Paris 2' }, secoes: [] }), ctx({ id: 'prop-antiga-01' }));
  const salvo = await resE.json();
  eq([salvo.status, salvo.aceite?.nome_aceite, salvo.leads.length, salvo.cabecalho.titulo], ['ACEITO', 'Ana', 1, 'Paris 2'], 'PUT do editor preserva status, aceite e interessados');
  eq(typeof salvo.link_publico === 'string' && salvo.link_publico.includes('/p/') && !salvo.link_publico.endsWith('/p/prop-antiga-01'), true, 'e devolve o link por token');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN-07: texto rico limpo ---');
{
  const H = await import('../src/lib/html-seguro.ts');
  const casos = [
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt&#58;alert(1)">x</a>',
    '<svg><script>alert(1)</script></svg>',
    '<p onclick="alert(1)">oi</p>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<scr<script>ipt>alert(1)</script>',
    '<iframe src="https://evil"></iframe>',
    '<span style="background:url(javascript:alert(1))">x</span>',
    '<p>ok</p><!-- <img src=x onerror=alert(1)> -->',
  ];
  for (const c of casos) {
    const limpo = H.limparHtml(c);
    eq(/on\w+=|javascript:|<script|<img|<svg|<iframe|<math|url\(/i.test(limpo), false, `neutraliza: ${c.slice(0, 40)}`);
  }
  eq(H.limparHtml('<p style="text-align: center"><strong>Olá</strong> <a href="https://x.com" target="_blank">site</a></p>'),
    '<p style="text-align: center"><strong>Olá</strong> <a href="https://x.com" target="_blank" rel="noopener noreferrer nofollow">site</a></p>',
    'formatação do editor continua igual');
  eq(H.urlHttp('javascript:alert(1)'), '', 'link de hotel só http(s)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN-09: chat público com orçamento antes da IA ---');
{
  const L = await import('../src/lib/limite-publico.ts');
  L.limparLimitePublicoParaTeste();
  let chamadasIA = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { chamadasIA++; return new Response('{}', { status: 500 }); };
  const CH = await import('../src/app/api/propostas/public/[slug]/chat/route.ts');
  let r = await CH.POST(req('/x', 'POST', { mensagem: 'oi' }, { 'x-forwarded-for': '9.9.9.9' }), ctx({ slug: 'nao-existe-0000' }));
  eq([r.status, chamadasIA], [404, 0], 'proposta inexistente não chama a IA');
  r = await CH.POST(req('/x', 'POST', { mensagem: 'x'.repeat(5000) }, { 'x-forwarded-for': '9.9.9.9' }), ctx({ slug: 'prop-antiga-01' }));
  eq([r.status, chamadasIA], [413, 0], 'mensagem gigante recusada antes da IA');
  for (let i = 0; i < 25; i++) r = await CH.POST(req('/x', 'POST', { mensagem: 'oi' }, { 'x-forwarded-for': '8.8.8.8' }), ctx({ slug: 'nao-existe-0000' }));
  eq([r.status, chamadasIA], [429, 0], 'repetição do mesmo visitante é cortada');
  r = await CH.POST(req('/x', 'POST', { mensagem: 'oi' }, { 'x-forwarded-for': '7.7.7.7' }), ctx({ slug: 'prop-antiga-01' }));
  eq([r.status, chamadasIA], [503, 0], 'agência sem chave de IA: nada é chamado (nunca a chave de outra)');
  globalThis.fetch = fetchOriginal;
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN-08: documentos privados ---');
{
  const A = await import('../src/lib/arquivos.ts');
  const tipo = (bytes, ext) => A.detectarTipo(Uint8Array.from(bytes), ext)?.ext ?? null;
  eq(tipo([0xff, 0xd8, 0xff, 0xe0], 'png'), 'jpg', 'JPEG com nome .png vira .jpg (vale o conteúdo)');
  eq(tipo([...Buffer.from('%PDF-1.7')], 'pdf'), 'pdf', 'PDF reconhecido');
  eq(tipo([...Buffer.from('<html><script>')], 'pdf'), null, 'HTML com nome .pdf é recusado');
  eq(tipo([...Buffer.from('<svg onload=1>')], 'svg'), null, 'SVG não é aceito');
  eq(tipo([0x50, 0x4b, 0x03, 0x04], 'xlsx'), 'xlsx', 'planilha (zip) reconhecida');
  eq(tipo([0x61, 0x00, 0x62], 'csv'), null, 'binário com nome .csv recusado');

  const caminho = '/api/arquivos/abcdefgh.pdf';
  const assinada = new URL(A.assinarUrl(caminho, 60), 'http://x');
  eq(A.assinaturaValida(caminho, assinada.searchParams.get('exp'), assinada.searchParams.get('sig')), true, 'URL assinada vale');
  eq(A.assinaturaValida('/api/arquivos/outro123.pdf', assinada.searchParams.get('exp'), assinada.searchParams.get('sig')), false, 'assinatura não serve para outro arquivo');
  eq(A.assinaturaValida(caminho, assinada.searchParams.get('exp'), assinada.searchParams.get('sig'), Date.now() + 120_000), false, 'URL assinada vence');

  mkdirSync(A.PASTA_PRIVADA, { recursive: true });
  const nome = 'TesteEntregaB01.pdf';
  writeFileSync(path.join(A.PASTA_PRIVADA, nome), '%PDF-1.7 teste');
  await query(`INSERT INTO arquivos_privados (nome, tenant_id) VALUES ($1, 'ag-1')`, [nome]);
  const R = await import('../src/app/api/arquivos/[filename]/route.ts');
  const abrir = async (url) => (await R.GET(new Request(`http://localhost${url}`), ctx({ filename: nome }))).status;
  semLogin();
  eq(await abrir(`/api/arquivos/${nome}`), 404, 'anônimo não abre documento');
  comoAgencia('ag-2');
  eq(await abrir(`/api/arquivos/${nome}`), 404, 'outra agência não abre');
  comoAgencia('ag-1');
  eq(await abrir(`/api/arquivos/${nome}`), 200, 'agência dona abre');
  semLogin();
  eq(await abrir(A.assinarUrl(`/api/arquivos/${nome}`, 60)), 200, 'URL assinada abre sem login');
  rmSync(path.join(A.PASTA_PRIVADA, nome), { force: true });

  const AC = await import('../src/lib/arquivos-acesso.ts');
  eq(AC.podeAbrir(sessao('ag-2'), 'ag-1', true), false, 'documento antigo com dono registrado: só o dono');
  eq(AC.podeAbrir(null, null, true), false, 'documento antigo: anônimo nunca');
  eq(AC.podeAbrir({ ...sessao('ag-2'), isSuperAdmin: true }, 'ag-1', false), true, 'plataforma abre (suporte)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN-06: saída para a internet ---');
{
  const S = await import('../src/lib/saida-segura.ts');
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    eq(S.ipInterno(ip), true, `interno: ${ip}`);
  }
  eq(S.ipInterno('8.8.8.8'), false, 'público passa');
  eq(await erro(S.baixarImagemSegura('http://exemplo.com/a.jpg')), 'DestinoRecusado', 'http puro recusado');
  eq(await erro(S.baixarImagemSegura('https://user:pw@exemplo.com/a.jpg')), 'DestinoRecusado', 'credencial na URL recusada');
  eq(await erro(S.baixarImagemSegura('https://127.0.0.1/a.jpg')), 'DestinoRecusado', 'IP literal recusado');
  const dnsInterno = (_n, _o, pronto) => pronto(Object.assign(new Error('interno'), { code: 'EDESTINOINTERNO' }), '', 4);
  eq(await erro(S.baixarImagemSegura('https://interno.exemplo.com/a.jpg', { lookup: dnsInterno })), 'DestinoRecusado', 'nome que resolve para dentro é recusado no próprio socket');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-09: resposta perdida não libera segunda nota ---');
{
  const N = await import('../src/lib/nfse-servico.ts');
  const { ErroFiscal } = await import('../src/lib/nfse-emissor.ts');
  const nota = { id: 'n1', status: 'PROCESSANDO', erro: '' };
  eq(N.notaAposFalhaDeTransmissao(nota, new ErroFiscal('tempo', '', true)).status, 'PROCESSANDO', 'tempo esgotado: segue viva (PROCESSANDO)');
  eq(N.notaAposFalhaDeTransmissao(nota, new ErroFiscal('tempo', '', true)).resultado_desconhecido, true, 'marcada como resultado desconhecido');
  eq(N.notaAposFalhaDeTransmissao(nota, new TypeError('fetch failed')).status, 'PROCESSANDO', 'erro de rede qualquer: também');
  eq(N.notaAposFalhaDeTransmissao(nota, new ErroFiscal('recusada')).status, 'REJEITADA', 'recusa de verdade libera nova tentativa');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-11: evento do CRM nunca é dado por processado sem estar ---');
{
  const CRM = await import('../src/lib/crm-integration.ts');
  quebrarTrava = true;
  let r = await CRM.processarEventoCRM('TIPO_DESCONHECIDO', {}, 'ev-1', 'ag-1');
  quebrarTrava = false;
  eq(r.processado, false, 'falha na trava: pede nova tentativa (não 200)');
  eq((await um(`SELECT count(*)::int AS n FROM crm_eventos_entrada`)).n, 0, 'e nada foi marcado');
  await query(`INSERT INTO crm_eventos_entrada (id, idempotency_key, tipo, status, data, tenant_id, created_at)
               VALUES ('e-orfao', 'ev-orfao', 'TIPO_DESCONHECIDO', 'RECEBIDO', $1, 'ag-1', NOW() - INTERVAL '1 hour')`,
    [JSON.stringify({ received_at: new Date(Date.now() - 3600_000).toISOString() })]);
  r = await CRM.processarEventoCRM('TIPO_DESCONHECIDO', {}, 'ev-orfao', 'ag-1');
  eq(r.acao.includes('duplicata'), false, 'evento órfão (processo caiu) é retomado, não ignorado');
  await query(`INSERT INTO crm_eventos_entrada (id, idempotency_key, tipo, status, data, tenant_id)
               VALUES ('e-agora', 'ev-agora', 'TIPO_DESCONHECIDO', 'RECEBIDO', $1, 'ag-1')`, [JSON.stringify({ received_at: new Date().toISOString() })]);
  r = await CRM.processarEventoCRM('TIPO_DESCONHECIDO', {}, 'ev-agora', 'ag-1');
  eq(r.processado, false, 'evento em processamento agora: pede nova tentativa depois');

  console.log('--- HMAC do CRM: tempo constante e carimbo de tempo ---');
  const { createHmac } = await import('node:crypto');
  const corpo = '{"id":"1"}';
  const sig = createHmac('sha256', 'k').update(corpo).digest('hex');
  eq(CRM.assinaturaCRMConfere(corpo, sig, 'k', null), true, 'formato antigo ainda aceito (transição)');
  eq(CRM.assinaturaCRMConfere(corpo, sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0'), 'k', null), false, 'assinatura errada recusada');
  eq(CRM.assinaturaCRMConfere(corpo, 'curta', 'k', null), false, 'tamanho diferente recusado sem erro');
  const agora = Math.floor(Date.now() / 1000);
  const sigTs = createHmac('sha256', 'k').update(`${agora}.${corpo}`).digest('hex');
  eq(CRM.assinaturaCRMConfere(corpo, sigTs, 'k', String(agora)), true, 'formato novo com carimbo aceito');
  const velho = agora - 3600;
  const sigVelha = createHmac('sha256', 'k').update(`${velho}.${corpo}`).digest('hex');
  eq(CRM.assinaturaCRMConfere(corpo, sigVelha, 'k', String(velho)), false, 'chamada repetida 1 h depois recusada');
  process.env.CRM_HMAC_EXIGE_TIMESTAMP = '1';
  eq(CRM.assinaturaCRMConfere(corpo, sig, 'k', null), false, 'com a exigência ligada, sem carimbo é recusado');
  delete process.env.CRM_HMAC_EXIGE_TIMESTAMP;
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN-11: segredo do CRM cifrado ---');
{
  const K = await import('../src/lib/crm-config-cofre.ts');
  await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', 'ag-9', $1)`, [JSON.stringify({ ativo: true, api_key_entur: 'hmac-SEGREDO-9', api_key_crm: 'hmac-SEGREDO-9' })]);
  const aberta = await K.lerCrmConfig(pool, 'ag-9');
  eq(aberta.api_key_entur, 'hmac-SEGREDO-9', 'servidor lê o segredo antigo');
  const noBanco = (await um(`SELECT data FROM crm_config WHERE tenant_id = 'ag-9'`)).data;
  eq(JSON.stringify(noBanco).includes('SEGREDO'), false, 'primeira leitura regrava cifrado');
  eq((await K.lerCrmConfig(pool, 'ag-9')).api_key_crm, 'hmac-SEGREDO-9', 'e continua legível');
  const selado = K.selarCrmConfig({ ativo: false }, noBanco);
  eq(typeof selado.api_key_entur_cofre?.ct, 'string', 'gravar sem segredo novo mantém o envelope');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-13 / FIN2-14 / FIN2-15: reservas de grupo ---');
{
  const G = await import('../src/lib/gestao-grupos.ts');
  eq([G.parcelasValidas(1), G.parcelasValidas(24), G.parcelasValidas(25), G.parcelasValidas(1e6), G.parcelasValidas('abc')], [1, 24, null, null, null], 'parcelas de 1 a 24');

  comoAgencia('ag-1');
  await query(`INSERT INTO clientes (id, tenant_id) VALUES ('cli-1', 'ag-1')`);
  await query(`INSERT INTO gestao_grupos (id, grupo_id, tenant_id, data) VALUES ('gg', 'g1', 'ag-1', '{"config_vagas":{"permitir_lista_espera":false}}')`);
  // Cadastro do período com contagem velha (5 livres), mas só 1 vaga de verdade.
  await query(`INSERT INTO grupo_periodos_vagas (id, grupo_id, tenant_id, data) VALUES ('per-1', 'g1', 'ag-1', '{"vagas_total":1,"vagas_disponiveis":5}')`);
  const RES = await import('../src/app/api/gestao-grupos/[grupo_id]/reservas/route.ts');
  const reservar = (p) => RES.POST(req('/x', 'POST', { periodo_id: 'per-1', cliente_id: 'cli-1', parcelas: p }), ctx({ grupo_id: 'g1' }));
  eq((await reservar(1000000)).status, 400, 'um milhão de parcelas recusado na criação');
  eq((await reservar(3)).status, 200, 'primeira reserva fica com a vaga');
  eq((await reservar(3)).status, 409, 'segunda reserva não passa da capacidade (contagem na hora, período travado)');
  eq((await um(`SELECT count(*)::int AS n FROM grupo_reservas WHERE periodo_id = 'per-1'`)).n, 1, 'uma reserva só');

  const fonte = readFileSync(new URL('../src/app/api/gestao-grupos/[grupo_id]/reservas/[reserva_id]/confirmar/route.ts', import.meta.url), 'utf8');
  const sql = /`(SELECT r\.id, r\.periodo_id[\s\S]*?FOR UPDATE[^`]*)`/.exec(fonte)?.[1];
  eq(typeof sql, 'string', 'achou a consulta da confirmação');
  eq(await erro(pg.query(sql, ['x', 'g1', 'ag-1'])), null, 'consulta da confirmação é aceita pelo PostgreSQL (FOR UPDATE OF r)');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-16: origem das escritas ---');
{
  const O = await import('../src/lib/origem-da-mutacao.ts');
  const cab = h => ({ get: n => h[n.toLowerCase()] ?? null });
  eq(O.origemPermitida('POST', 'https://fin.x.com/api/usuarios', cab({ origin: 'https://evil.com' })), false, 'POST de outro site recusado');
  eq(O.origemPermitida('POST', 'https://fin.x.com/api/usuarios', cab({ 'sec-fetch-site': 'same-site' })), false, 'subdomínio irmão recusado');
  eq(O.origemPermitida('POST', 'https://fin.x.com/api/usuarios', cab({ origin: 'https://fin.x.com', 'sec-fetch-site': 'same-origin' })), true, 'mesma origem passa');
  eq(O.origemPermitida('GET', 'https://fin.x.com/api/usuarios', cab({ origin: 'https://evil.com' })), true, 'leitura não é barrada aqui');
  const canonico = h => h === 'fin.x.com' || h === 'app.x.com';
  eq(O.origemPermitida('POST', 'http://0.0.0.0:3000/api/usuarios', cab({ origin: 'https://app.x.com' }), [], canonico), true, 'atrás do proxy: domínio canônico passa');
  eq(O.origemPermitida('POST', 'http://0.0.0.0:3000/api/usuarios', cab({ origin: 'https://evil.com' }), [], canonico), false, 'atrás do proxy: domínio estranho continua recusado');
  eq(O.corpoSimplesEmRotaJson('POST', '/api/usuarios', 'text/plain;charset=UTF-8'), true, 'text/plain em rota administrativa recusado');
  eq(O.corpoSimplesEmRotaJson('POST', '/api/usuarios', 'application/json'), false, 'JSON passa');
  eq(O.corpoSimplesEmRotaJson('POST', '/api/fiscal/certificado', 'multipart/form-data; boundary=x'), false, 'envio do certificado (multipart) continua');
  eq(O.corpoSimplesEmRotaJson('POST', '/api/upload', 'multipart/form-data; boundary=x'), false, 'upload geral não é rota JSON');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-17: convite de uso único ---');
{
  const fonte = readFileSync(new URL('../src/app/api/auth/signup/route.ts', import.meta.url), 'utf8');
  const sql = /`(UPDATE convites SET usos_atuais = usos_atuais \+ 1[\s\S]*?RETURNING id)`/.exec(fonte)?.[1];
  eq(typeof sql, 'string', 'achou a reserva do convite');
  await query(`INSERT INTO convites (id, codigo, max_usos) VALUES ('cv1', 'UNICO', 1)`);
  const a = (await query(sql, ['cv1'])).rows.length;
  const b = (await query(sql, ['cv1'])).rows.length;
  eq([a, b], [1, 0], 'só a primeira inscrição leva o convite de uso único');
  eq(fonte.indexOf('UPDATE convites SET usos_atuais') < fonte.indexOf('INSERT INTO tenants'), true, 'o convite é reservado antes de criar a agência');
}

// ─────────────────────────────────────────────────────────────────────────
console.log('--- FIN2-18 / FIN2-19: chaves de API de terceiros ---');
{
  for (const f of ['searchapi-flights.ts', 'searchapi-hotels.ts']) {
    const fonte = readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8');
    eq(/const SEARCHAPI_KEY\s*=\s*['"`]/.test(fonte), false, `${f}: sem chave literal`);
  }
  const AM = await import('../src/lib/amadeus-api.ts');
  const ka = AM.chaveDoTokenAmadeus({ api_key: 'A', api_secret: 'segredoA', ambiente: 'production' });
  const kb = AM.chaveDoTokenAmadeus({ api_key: 'B', api_secret: 'segredoB', ambiente: 'production' });
  eq(ka !== kb, true, 'credenciais diferentes não dividem o token em cache');
  eq(ka.includes('segredoA'), false, 'a chave do cache não leva o segredo');
}

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
