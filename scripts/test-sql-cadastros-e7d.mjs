/**
 * Cadastros e configuração (E7, frente D, 06/11/2026) contra um Postgres real
 * (PGlite), chamando as ROTAS de produção:
 *  1. MOEDAS DA AGÊNCIA — catálogo com as oito do sistema; a agência
 *     acrescenta ARS (ISO 4217), edita e desativa; outra agência não vê;
 *     conta bancária e conta a pagar aceitam a moeda cadastrada e recusam a
 *     desconhecida (antes virava real calada); a consulta de 15 min busca a
 *     PTAX só das que o Banco Central publica (DKK sim, ARS não).
 *  2. CONFIGURAÇÃO POR EMPRESA (as três da G1) — a empresa B grava conta
 *     previsão, categorias das contas geradas e campos personalizados sem
 *     tocar a principal; "copiar de outra empresa" leva categorias e campos e
 *     nunca a conta previsão; o reembolso de uma venda da B nasce com a
 *     categoria da B; sem empresa, tudo como antes.
 *  3. CAMPO OBRIGATÓRIO — trava o lançar e o editar pelo formulário, com a
 *     lista da empresa do título; conta gerada pelo sistema não trava.
 *  4. ASSISTENTE INICIAL — agência nova fica pronta sozinha (plano padrão com
 *     as mães ligadas, as seis categorias das contas geradas e os encargos);
 *     rodar de novo não duplica; agência com dados recebe a oferta e o clique
 *     só cria o que falta, sem mudar escolha, categoria ou conta gravada.
 *
 * Uso: node --no-warnings scripts/test-sql-cadastros-e7d.mjs
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
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_origem_id TEXT DEFAULT '', conta_destino_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT DEFAULT '', vendedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE cartoes_corp (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', apelido TEXT DEFAULT '', bandeira TEXT DEFAULT '',
    ativo BOOLEAN DEFAULT TRUE, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notas_fiscais (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_receber_id TEXT NOT NULL DEFAULT '',
    venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RASCUNHO',
    referencia_gateway TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE config_fiscal (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE faturas (tenant_id TEXT NOT NULL, id TEXT NOT NULL, numero INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (tenant_id, id));
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
let ator = { userId: '', tenantId: '' };
const marcar = () => pg.query(`SELECT set_config('app.audit_context', $1, false)`, [JSON.stringify(ator)]);
const pool = { query: async (t, v) => { await marcar(); return query(t, v); }, connect: async () => { await marcar(); return { query, release() {} }; } };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-e7d';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { EMPRESAS_SCHEMA_SQL } = await import('../src/lib/empresas-schema.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { CAMBIO_SCHEMA_SQL, atualizarCotacoes } = await import('../src/lib/cambio-servidor.ts');
const { MOEDAS_SCHEMA_SQL } = await import('../src/lib/moedas-servidor.ts');
const { REEMBOLSOS_SCHEMA_SQL, criarReembolso, aprovarReembolso } = await import('../src/lib/reembolsos-servidor.ts');
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(CAMBIO_SCHEMA_SQL);
await pg.exec(REEMBOLSOS_SCHEMA_SQL);

const T = 'ag-1', T2 = 'ag-2', NOVA = 'ag-nova';
const sessao = (perfil, tenant = T) => ({ userId: `u-${perfil}-${tenant}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const P = await import('../src/lib/permissoes-servidor.ts');
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; ator = { userId: s?.userId ?? '', tenantId: s?.tenantId ?? '' }; P.invalidarPermissoes?.(); };
const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const ctx = obj => ({ params: Promise.resolve(obj) });
const json = async r => ({ status: r.status, corpo: await r.json() });
const um = async (sql, v) => (await query(sql, v)).rows[0];

for (const t of [T, T2, NOVA]) {
  await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ($1, $2, $3)`, [`ag-${t}`, t, JSON.stringify({ nome_fantasia: `Agência ${t}` })]);
  for (const perfil of ['ADMIN', 'OPERADOR']) {
    const id = `u-${perfil}-${t}`;
    await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, t, JSON.stringify({ id, nome: id, perfil, ativo: true })]);
  }
}
for (const [id, tipo, codigo] of [['cat-rec', 'RECEITA', '1.1'], ['cat-dev', 'DESPESA', '2.1'], ['cat-dev-b', 'DESPESA', '2.2'], ['cat-rec-b', 'RECEITA', '1.2']]) {
  await query(`INSERT INTO plano_contas (id, tenant_id, codigo, tipo, data) VALUES ($1, $2, $3, $4, $5)`, [id, T, codigo, tipo, JSON.stringify({ id, codigo, nome: `Nome ${id}`, tipo, ativo: true })]);
}
await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ('b1', $1, 'Conta 1', '{"id":"b1","nome":"Conta 1","saldo_atual":0}'),
  ('b2', $1, 'Conta 2', '{"id":"b2","nome":"Conta 2","saldo_atual":0}')`, [T]);
await pg.exec(EMPRESAS_SCHEMA_SQL);
await pg.exec(MOEDAS_SCHEMA_SQL);

const RMO = await import('../src/app/api/moedas/route.ts');
const IMO = await import('../src/app/api/moedas/[codigo]/route.ts');
const RCB = await import('../src/app/api/contas-bancarias/route.ts');
const ICB = await import('../src/app/api/contas-bancarias/[id]/route.ts');
const RCP = await import('../src/app/api/contas-pagar/route.ts');
const ICP = await import('../src/app/api/contas-pagar/[id]/route.ts');
const RCR = await import('../src/app/api/contas-receber/route.ts');
const REM = await import('../src/app/api/empresas/route.ts');
const RCO = await import('../src/app/api/empresas/copiar/route.ts');
const RPV = await import('../src/app/api/config/financeiro/conta-previsao/route.ts');
const RCT = await import('../src/app/api/config/financeiro/categorias-dos-titulos/route.ts');
const RCA = await import('../src/app/api/config/financeiro/campos-personalizados/route.ts');
const RAS = await import('../src/app/api/config/financeiro/assistente/route.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');

// ---------------------------------------------------------------------------
console.log('--- 1. Moedas da agência ---');
como(sessao('OPERADOR'));
let r = await json(await RMO.GET());
eq([r.status, r.corpo.moedas.map(m => m.codigo)], [200, ['BRL', 'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY']], 'sem cadastro: as oito do sistema');
r = await json(await RMO.POST(req('/api/moedas', 'POST', { codigo: 'ars' })));
eq([r.status, r.corpo.moeda?.codigo, r.corpo.moeda?.casas, /peso/i.test(r.corpo.moeda?.nome ?? '')], [201, 'ARS', 2, true], 'acrescenta ARS com nome e casas sugeridos');
eq((await json(await RMO.POST(req('/api/moedas', 'POST', { codigo: 'USD' })))).status, 400, 'moeda do sistema: recusada');
eq((await json(await RMO.POST(req('/api/moedas', 'POST', { codigo: 'XYZ' })))).status, 400, 'código fora do ISO 4217: recusado');
eq((await json(await RMO.POST(req('/api/moedas', 'POST', { codigo: 'DKK', nome: 'Coroa dinamarquesa' })))).status, 201, 'acrescenta DKK');
r = await json(await IMO.PUT(req('/api/moedas/ARS', 'PUT', { simbolo: 'AR$' }), ctx({ codigo: 'ars' })));
eq([r.status, r.corpo.moeda.simbolo, r.corpo.moeda.ativo], [200, 'AR$', true], 'edita o símbolo');
eq((await json(await IMO.PUT(req('/api/moedas/USD', 'PUT', { nome: 'x' }), ctx({ codigo: 'USD' })))).status, 404, 'as do sistema não se editam');
r = await json(await RMO.GET());
eq(r.corpo.moedas.filter(m => m.da_agencia).map(m => [m.codigo, m.ptax]), [['ARS', false], ['DKK', true]], 'catálogo com as da agência; PTAX só na DKK');
como(sessao('OPERADOR', T2));
eq((await json(await RMO.GET())).corpo.moedas.length, 8, 'outra agência não vê as moedas desta');

como(sessao('ADMIN'));
r = await RCB.POST(req('/api/contas-bancarias', 'POST', { id: 'bars', nome: 'Conta em pesos', moeda: 'ars', saldo_inicial: 0 }));
eq([r.status, (await um(`SELECT data->>'moeda' AS m FROM contas_bancarias WHERE id = 'bars'`)).m], [200, 'ARS'], 'conta bancária em ARS cadastrada');
r = await json(await RCB.POST(req('/api/contas-bancarias', 'POST', { id: 'bmxn', nome: 'Conta MXN', moeda: 'MXN' })));
eq([r.status, /não está cadastrada/.test(r.corpo.error ?? '')], [400, true], 'moeda não cadastrada: recusada (antes virava real calada)');
eq((await RCB.POST(req('/api/contas-bancarias', 'POST', { id: 'bbrl', nome: 'Conta sem moeda' }))).status, 200, 'sem moeda: real, como sempre');
eq((await um(`SELECT data->>'moeda' AS m FROM contas_bancarias WHERE id = 'bbrl'`)).m, 'BRL', '...gravada como BRL');
eq((await ICB.PUT(req('/api/contas-bancarias/bbrl', 'PUT', { id: 'bbrl', nome: 'Conta sem moeda', moeda: 'MXN' }), ctx({ id: 'bbrl' }))).status, 400, 'editar para moeda não cadastrada: recusado');

r = await RCP.POST(req('/api/contas-pagar', 'POST', { id: 'cpars', descricao: 'Hotel em Bariloche', fornecedor_nome: 'Hotel', moeda: 'ars', cambio: 0.006, valor_original: 100000, valor_final: 600, status: 'PENDENTE', data_vencimento: '2026-12-01' }));
eq([r.status, (await um(`SELECT data->>'moeda' AS m FROM contas_pagar WHERE id = 'cpars'`)).m], [200, 'ARS'], 'conta a pagar em ARS lançada');
eq((await RCP.POST(req('/api/contas-pagar', 'POST', { id: 'cpmxn', descricao: 'x', moeda: 'MXN', valor_final: 1, status: 'PENDENTE' }))).status, 400, 'conta a pagar em moeda não cadastrada: recusada');
// Venda grava a moeda do produto; regravar a conta sem cadastrar a moeda não trava.
await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('cpclp', $1, 'PENDENTE', '{"id":"cpclp","moeda":"CLP","valor_final":10,"descricao":"Da venda"}')`, [T]);
eq((await ICP.PUT(req('/api/contas-pagar/cpclp', 'PUT', { id: 'cpclp', moeda: 'CLP', valor_final: 10, descricao: 'Da venda (editada)', status: 'PENDENTE' }), ctx({ id: 'cpclp' }))).status, 200,
  'título que já estava numa moeda não cadastrada continua editável');

// Consulta global: a PTAX das que o Banco Central publica (DKK), nunca da ARS.
const chamadas = [];
const http = async url => {
  chamadas.push(url);
  const m = /@moeda='([A-Z]{3})'/.exec(url)?.[1];
  return { status: 200, json: async () => ({ value: [{ cotacaoCompra: 1.1, cotacaoVenda: 1.2, dataHoraCotacao: '2026-11-05 13:10:00.000', tipoBoletim: 'Fechamento' }].map(v => ({ ...v, m })) }) };
};
await atualizarCotacoes(pool, { http, agora: new Date('2026-11-06T18:00:00Z'), chaveAwesome: null });
const ptax = chamadas.filter(u => u.includes('olinda')).map(u => /@moeda='([A-Z]{3})'/.exec(u)?.[1]);
eq([ptax.length, ptax.includes('DKK'), ptax.includes('ARS')], [8, true, false], 'PTAX: as sete de sempre mais a DKK; ARS fica no câmbio digitado');

// ---------------------------------------------------------------------------
console.log('--- 2. Configuração por empresa (as três da G1) ---');
como(sessao('ADMIN'));
const antesDaB = {
  previsao: (await json(await RPV.GET(req('/x')))).corpo,
  categorias: (await json(await RCT.GET(req('/x')))).corpo,
  campos: (await json(await RCA.GET(req('/x')))).corpo,
};
eq(antesDaB, { previsao: { conta_previsao_padrao: null }, categorias: { categorias: {} }, campos: { campos: [] } }, 'agência de uma empresa: as três respondem como antes');
await RPV.PUT(req('/x', 'PUT', { conta_previsao_padrao: 'b1' }));
await RCT.PUT(req('/x', 'PUT', { categorias: { reembolso_pagar: 'cat-dev', receita_venda: 'cat-rec' } }));
await RCA.PUT(req('/x', 'PUT', { campos: [{ nome: 'Pedido', tipo: 'texto', aplica_a: 'ambos' }] }));
r = await REM.POST(req('/api/empresas', 'POST', { nome: 'Loja B' }));
const B = (await r.json()).id;
const agenciaAntes = (await um(`SELECT data FROM agencia WHERE tenant_id = $1`, [T])).data;
eq((await json(await RPV.GET(req(`/x?empresa=${B}`)))).corpo.conta_previsao_padrao, 'b1', 'a B sem escolha própria segue a da agência');
eq((await json(await RPV.PUT(req(`/x?empresa=${B}`, 'PUT', { conta_previsao_padrao: 'b2' })))).status, 200, 'a B grava a conta previsão dela');
eq((await json(await RCT.PUT(req(`/x?empresa=${B}`, 'PUT', { categorias: { reembolso_pagar: 'cat-dev-b' } })))).status, 200, 'a B grava as categorias dela');
eq((await json(await RCA.PUT(req(`/x?empresa=${B}`, 'PUT', { campos: [{ nome: 'Centro da loja', tipo: 'texto', aplica_a: 'pagar', obrigatorio: true }] })))).status, 200, 'a B grava os campos dela');
eq((await um(`SELECT data FROM agencia WHERE tenant_id = $1`, [T])).data, agenciaAntes, 'a agência (principal) não mudou');
eq([(await json(await RPV.GET(req(`/x?empresa=${B}`)))).corpo.conta_previsao_padrao, (await json(await RPV.GET(req('/x')))).corpo.conta_previsao_padrao],
  ['b2', 'b1'], 'cada empresa com a sua conta previsão');
eq((await json(await RPV.GET(req('/x')))).corpo.por_empresa, { [B]: 'b2' }, 'o fluxo de caixa recebe a conta previsão de cada empresa');
eq((await json(await RCT.GET(req(`/x?empresa=${B}`)))).corpo.categorias, { reembolso_pagar: 'cat-dev-b' }, 'a B lê as categorias dela');
eq((await json(await RCA.GET(req(`/x?empresa=${B}`)))).corpo.campos.map(c => [c.id, c.ativo]), [['centro_da_loja', true], ['pedido', false]],
  'a B lê os campos dela (o da agência que ela herdava fica guardado como desativado: valores nunca perdem o nome)');
eq((await json(await RCA.GET(req('/x')))).corpo.campos.map(c => c.id), ['pedido'], 'a principal segue com os dela');
como(sessao('OPERADOR'));
eq((await json(await RCT.PUT(req(`/x?empresa=${B}`, 'PUT', { categorias: {} })))).status, 403, 'só administrador grava a da empresa');
como(sessao('ADMIN'));

// Reembolso de uma venda da B: categoria da B. Sem venda: a da agência.
await query(`INSERT INTO vendas_crm (id, tenant_id, data) VALUES ('vB', $1, $2)`, [T, JSON.stringify({ id: 'vB', numero: 'V-9', empresa_id: B })]);
let rb = await emTransacao(e => criarReembolso(e, T, { tipo: 'CLIENTE', pessoa_id: 'c1', pessoa_nome: 'Ana', valor_centavos: 5000, descricao: 'Devolução', venda_id: 'vB' }, 'u'));
rb = await emTransacao(e => aprovarReembolso(e, T, rb.id, 'u'));
let ra = await emTransacao(e => criarReembolso(e, T, { tipo: 'CLIENTE', pessoa_id: 'c1', pessoa_nome: 'Ana', valor_centavos: 5000, descricao: 'Devolução sem venda' }, 'u'));
ra = await emTransacao(e => aprovarReembolso(e, T, ra.id, 'u'));
eq([(await um(`SELECT data->>'categoria_id' AS c FROM contas_pagar WHERE id = $1`, [rb.conta_id])).c, (await um(`SELECT data->>'categoria_id' AS c FROM contas_pagar WHERE id = $1`, [ra.conta_id])).c],
  ['cat-dev-b', 'cat-dev'], 'reembolso da venda da B nasce com a categoria da B; sem venda, a da agência');

// Copiar da B para a principal: leva categorias e campos, nunca a conta previsão.
r = await RCO.POST(req('/api/empresas/copiar', 'POST', { secao: 'financeiro', de: B, para: 'principal' }));
eq(r.status, 200, 'copiar o financeiro da B para a principal');
const depois = (await um(`SELECT data FROM agencia WHERE tenant_id = $1`, [T])).data;
eq([depois.categorias_dos_titulos, depois.campos_personalizados_titulos.map(c => c.id).sort(), depois.conta_previsao_padrao],
  [{ reembolso_pagar: 'cat-dev-b' }, ['centro_da_loja', 'pedido'], 'b1'], 'a cópia leva categorias e campos; a conta previsão (da empresa) fica');

// ---------------------------------------------------------------------------
console.log('--- 3. Campo personalizado obrigatório ---');
// A principal agora tem "Centro da loja" obrigatório no pagar (veio na cópia).
const novaConta = (id, extra = {}) => ({ id, descricao: 'Aluguel', fornecedor_nome: 'Imobiliária', valor_final: 100, status: 'PENDENTE', data_vencimento: '2026-12-10', ...extra });
r = await json(await RCP.POST(req('/api/contas-pagar', 'POST', novaConta('cpo1', { campos_personalizados: {} }))));
eq([r.status, r.corpo.error], [400, 'Preencha o campo "Centro da loja".'], 'lançar sem o obrigatório: recusado');
eq((await RCP.POST(req('/api/contas-pagar', 'POST', novaConta('cpo1', { campos_personalizados: { centro_da_loja: 'Centro' } })))).status, 200, 'com o obrigatório: lança');
r = await json(await ICP.PUT(req('/api/contas-pagar/cpo1', 'PUT', novaConta('cpo1', { campos_personalizados: {} })), ctx({ id: 'cpo1' })));
eq([r.status, r.corpo.campo_obrigatorio], [400, true], 'editar apagando o obrigatório: recusado');
eq((await ICP.PUT(req('/api/contas-pagar/cpo1', 'PUT', { id: 'cpo1', status: 'PENDENTE', descricao: 'Aluguel de dezembro' }), ctx({ id: 'cpo1' }))).status, 200,
  'mudança sem os campos (não é o formulário): segue como sempre');
eq((await RCP.POST(req('/api/contas-pagar', 'POST', novaConta('cpo2', { origem_venda_id: 'vB', auto_gerado: true })))).status, 200, 'conta gerada pelo sistema não trava');
eq((await RCR.POST(req('/api/contas-receber', 'POST', { id: 'cro1', descricao: 'x', cliente_nome: 'Ana', valor_final: 10, status: 'PENDENTE' }))).status, 200,
  'campo só do pagar não trava o receber');
// Lista da empresa: a B tem o obrigatório; uma conta da B sem ele é recusada.
await RCA.PUT(req('/x', 'PUT', { campos: [] }));
eq((await RCP.POST(req('/api/contas-pagar', 'POST', novaConta('cpo3')))).status, 200, 'principal sem obrigatório: lança');
eq((await RCP.POST(req('/api/contas-pagar', 'POST', novaConta('cpo4', { empresa_id: B })))).status, 400, 'conta da B sem o obrigatório da B: recusada');

// ---------------------------------------------------------------------------
console.log('--- 4. Assistente inicial ---');
como(sessao('ADMIN', NOVA));
r = await json(await RAS.GET());
eq([r.corpo.modo, r.corpo.faltam.length, r.corpo.encargos_faltam.length], ['automatico', 6, 4], 'agência nova: o assistente roda sozinho');
como(sessao('OPERADOR', NOVA));
eq((await RAS.POST(req('/x', 'POST', { automatico: true }))).status, 403, 'só administrador aplica');
como(sessao('ADMIN', NOVA));
r = await json(await RAS.POST(req('/x', 'POST', { automatico: true })));
eq([r.status, r.corpo.aplicado, r.corpo.resultado.plano_criado, r.corpo.situacao.modo], [200, true, true, 'pronto'], 'aplicado: plano padrão criado e tudo ligado');
const planoNova = (await query(`SELECT id, data FROM plano_contas WHERE tenant_id = $1`, [NOVA])).rows;
const idsNova = new Set(planoNova.map(p => p.id));
eq(planoNova.every(p => !p.data.categoria_pai_id || idsNova.has(p.data.categoria_pai_id)), true, 'cada categoria-mãe existe (plano ligado de verdade)');
const ligadas = (await um(`SELECT data->'categorias_dos_titulos' AS c FROM agencia WHERE tenant_id = $1`, [NOVA])).c;
eq(Object.keys(ligadas).sort(), ['fatura_fornecedor', 'pagamento_fornecedor', 'receita_venda', 'reembolso_pagar', 'reembolso_receber', 'restituicao'], 'as seis contas geradas ligadas');
const qtd = planoNova.length;
r = await json(await RAS.POST(req('/x', 'POST', { automatico: true })));
eq([r.corpo.aplicado, (await query(`SELECT 1 FROM plano_contas WHERE tenant_id = $1`, [NOVA])).rows.length], [false, qtd], 'rodar de novo não duplica nada');
let rn = await emTransacao(e => criarReembolso(e, NOVA, { tipo: 'CLIENTE', pessoa_id: 'c1', pessoa_nome: 'Ana', valor_centavos: 100, descricao: 'x' }, 'u'));
rn = await emTransacao(e => aprovarReembolso(e, NOVA, rn.id, 'u'));
eq((await um(`SELECT data->>'categoria_id' AS c FROM contas_pagar WHERE id = $1`, [rn.conta_id])).c, ligadas.reembolso_pagar, 'a conta gerada já nasce com categoria');

// Agência com dados (T): oferta; o clique só cria o que falta.
como(sessao('ADMIN'));
const contasAntes = (await query(`SELECT id, data FROM contas_pagar WHERE tenant_id = $1 ORDER BY id`, [T])).rows;
const escolhaAntes = (await um(`SELECT data->'categorias_dos_titulos' AS c FROM agencia WHERE tenant_id = $1`, [T])).c;
r = await json(await RAS.GET());
eq([r.corpo.modo, r.corpo.faltam.includes('reembolso_pagar')], ['oferecer', false], 'agência com dados: oferece (a escolha que existe não falta)');
r = await json(await RAS.POST(req('/x', 'POST', { automatico: true })));
eq(r.corpo.aplicado, false, '"automático" não roda em agência com dados');
r = await json(await RAS.POST(req('/x', 'POST', {})));
eq([r.status, r.corpo.resultado.plano_criado, r.corpo.situacao.modo], [200, false, 'pronto'], 'o clique liga o que falta, sem criar plano padrão');
const escolhaDepois = (await um(`SELECT data->'categorias_dos_titulos' AS c FROM agencia WHERE tenant_id = $1`, [T])).c;
eq(escolhaDepois.reembolso_pagar, escolhaAntes.reembolso_pagar, 'a escolha que já existia não mudou');
eq((await query(`SELECT id, data FROM contas_pagar WHERE tenant_id = $1 ORDER BY id`, [T])).rows, contasAntes, 'nenhuma conta gravada mudou');
eq((await query(`SELECT 1 FROM plano_contas WHERE tenant_id = $1 AND data->>'padrao_titulo' IS NOT NULL`, [T])).rows.length, 5, 'criou só as cinco que faltavam');

console.log(`\n${total - falhas}/${total} passaram`);
process.exit(falhas ? 1 : 0);
