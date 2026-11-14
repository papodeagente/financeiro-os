/**
 * Várias empresas dentro da agência (06/11/2026, E7 G2) contra um Postgres
 * real (PGlite), rodando o código DE PRODUÇÃO, inclusive as rotas.
 *
 * Prova:
 *  0. CONGELA — antes do esquema novo, as rotas de hoje devolvem um retrato;
 *     depois da migração (agência de UMA empresa) devolvem o MESMO retrato,
 *     número por número (só o campo empresa_id = 'principal' a mais no JSON).
 *     Nenhum seletor: GET /api/empresas diz multi = false.
 *  1. MIGRAÇÃO — idempotente; a principal nasce dos dados da agência; todo
 *     registro de antes fica nela; nada fica sem empresa.
 *  2. GATILHO — registro novo sem empresa ganha a da venda, do título, do
 *     cartão, da conta bancária, a que a pessoa marcou ou a principal;
 *     regravação sem empresa mantém a de antes; a venda que muda de empresa
 *     leva os títulos em aberto (os pagos ficam).
 *  3. DUAS EMPRESAS — o seletor (lembrado por pessoa) separa os números nas
 *     listas e relatórios; o rateio 60/40 soma 60% numa e 40% na outra.
 *  4. PERMISSÃO — perfil de acesso só da empresa B: as listas, o item pelo id
 *     e a gravação respeitam; administrador vê tudo.
 *  5. CONFIGURAÇÃO POR EMPRESA — a B grava a própria sem tocar a principal;
 *     "copiar de outra empresa" leva tudo menos o que é da empresa (token,
 *     certificado, número do emissor); a política de encargos da baixa é a
 *     da empresa do título.
 *
 * Uso: node --no-warnings scripts/test-sql-empresas.mjs
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
  CREATE TABLE extrato_bancario (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_bancaria_id TEXT NOT NULL DEFAULT '',
    status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}');
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
// A conexão carrega o ator, como o pool de produção (app.audit_context).
let ator = { userId: '', tenantId: '' };
const conectar = async () => {
  await pg.query(`SELECT set_config('app.audit_context', $1, false)`, [JSON.stringify(ator)]);
  return { query, release() {} };
};
const pool = { query: async (t, v) => { await pg.query(`SELECT set_config('app.audit_context', $1, false)`, [JSON.stringify(ator)]); return query(t, v); }, connect: conectar };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-empresas';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { EMPRESAS_SCHEMA_SQL } = await import('../src/lib/empresas-schema.ts');
const P = await import('../src/lib/permissoes-servidor.ts');
const E = await import('../src/lib/empresas-servidor.ts');
const NF = await import('../src/lib/nfse-servico.ts');

const T = 'ag-1';
const sessao = (perfil, userId = `u-${perfil}`) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; ator = { userId: s?.userId ?? '', tenantId: T }; };
const req = (url, metodo = 'GET', corpo) => new Request(`http://localhost${url}`, {
  method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo),
});
const ctx = obj => ({ params: Promise.resolve(obj) });
const um = async (sql, v) => (await query(sql, v)).rows[0];
const semEmpresa = v => JSON.parse(JSON.stringify(v, (k, x) => (k === 'empresa_id' ? undefined : x)));

await pg.exec(PERMISSOES_SCHEMA_SQL);
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
await pg.exec(COBRANCA_SCHEMA_SQL);

// ---------------------------------------------------------------------------
// Uma agência de hoje: dados da agência, contas, títulos, rateio, extrato.
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, $2)`, [T, JSON.stringify({ nome_fantasia: 'Viaje Bem', razao_social: 'VB Turismo LTDA', cnpj: '11.222.333/0001-81', venda_config: { receita: { componentes: { OVER: true } } }, politica_cobranca: { juros_am_pct: 1, multa_pct: 2 } })]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag2', 'ag-2', '{"nome_fantasia":"Outra"}')`);
for (const [id, perfil] of [['u-ADMIN', 'ADMIN'], ['u-OPERADOR', 'OPERADOR']]) {
  await query(`INSERT INTO usuarios (id, tenant_id, data) VALUES ($1, $2, $3)`, [id, T, JSON.stringify({ id, nome: id, perfil, ativo: true })]);
}
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, tipo, data) VALUES ('aluguel', $1, '2.1', 'DESPESA', '{"id":"aluguel","codigo":"2.1","nome":"Aluguel","tipo":"DESPESA"}'),
  ('venda', $1, '1.1', 'RECEITA', '{"id":"venda","codigo":"1.1","nome":"Vendas","tipo":"RECEITA"}')`, [T]);
await query(`INSERT INTO centros_custo (id, tenant_id, nome, data) VALUES ('sp', $1, 'SP', '{"id":"sp","nome":"SP"}'), ('rj', $1, 'RJ', '{"id":"rj","nome":"RJ"}')`, [T]);
for (const b of ['b1', 'b2']) await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ($1, $2, $3, $4)`, [b, T, `Conta ${b}`, JSON.stringify({ id: b, nome: `Conta ${b}`, saldo_atual: 0 })]);
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('bx', 'ag-2', '{"id":"bx","nome":"Outra agência"}')`);
const pagar = (id, data, tenant = T) => query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ($1, $2, $3, $4)`,
  [id, tenant, data.status ?? 'PENDENTE', JSON.stringify({ id, fornecedor_nome: 'Forn', valor_pago: data.valor_pago ?? null, ...data })]);
const receber = (id, data, tenant = T) => query(`INSERT INTO contas_receber (id, tenant_id, status, venda_id, data) VALUES ($1, $2, $3, $4, $5)`,
  [id, tenant, data.status ?? 'PENDENTE', data.venda_id ?? '', JSON.stringify({ id, cliente_nome: 'Cliente', ...data })]);
await pagar('cp1', { status: 'PAGO', conta_bancaria_id: 'b1', valor_final: 100, valor_pago: 100, data_pagamento: '2026-11-03', data_vencimento: '2026-11-03', categoria_id: 'aluguel', centro_custo_id: 'sp' });
await pagar('cp2', { valor_final: 1000, data_vencimento: '2026-11-10', categoria_id: 'aluguel', rateio: [{ centro_custo_id: 'sp', percentual: 50, valor: 500 }, { centro_custo_id: 'rj', percentual: 50, valor: 500 }] });
await receber('cr1', { valor_final: 700, data_vencimento: '2026-11-12', categoria_id: 'venda', conta_bancaria_id: 'b2' });
await receber('cr2', { status: 'RECEBIDO', valor_final: 300, valor_recebido: 300, data_recebimento: '2026-11-04', data_vencimento: '2026-11-04', categoria_id: 'venda', conta_bancaria_id: 'b2' });
await pagar('cpx', { valor_final: 9, data_vencimento: '2026-11-10' }, 'ag-2');
await query(`INSERT INTO extrato_bancario (id, tenant_id, conta_bancaria_id, data) VALUES ('e1', $1, 'b1', '{"id":"e1","conta_bancaria_id":"b1"}'), ('e2', $1, 'b2', '{"id":"e2","conta_bancaria_id":"b2"}')`, [T]);
await query(`INSERT INTO vendas_crm (id, tenant_id, data) VALUES ('v1', $1, '{"id":"v1","numero":"V-1","data_venda":"2026-11-02","valor_total":700}')`, [T]);
await query(`INSERT INTO faturas (tenant_id, id) VALUES ($1, 'f1')`, [T]);
await query(`INSERT INTO cobrancas (tenant_id, id, titulo_id, provedor, referencia, tipo, valor_centavos) VALUES ($1, 'c1', 'cr1', 'asaas', 'r1', 'boleto', 70000)`, [T]);

const RCB = await import('../src/app/api/contas-bancarias/route.ts');
const RCP = await import('../src/app/api/contas-pagar/route.ts');
const ICP = await import('../src/app/api/contas-pagar/[id]/route.ts');
const RCR = await import('../src/app/api/contas-receber/route.ts');
const REX = await import('../src/app/api/extrato-bancario/route.ts');
const RLI = await import('../src/app/api/contas-pagar-receber/route.ts');
const RRL = await import('../src/app/api/relatorios/lancamentos/route.ts');
const RVE = await import('../src/app/api/vendas-crm/route.ts');
const REM = await import('../src/app/api/empresas/route.ts');
const RSE = await import('../src/app/api/empresas/selecao/route.ts');
const RCO = await import('../src/app/api/empresas/copiar/route.ts');
const RCV = await import('../src/app/api/config/vendas/route.ts');
const RGU = await import('../src/app/api/perfis-de-acesso/route.ts');

const LISTA = '/api/contas-pagar-receber?de=2026-11-01&ate=2026-11-30&data=vencimento&situacao=todas&tipo=ambos&em=tudo&ordem=vencimento&direcao=asc&pagina=1&por_pagina=100';
const RELATORIO = '/api/relatorios/lancamentos?visao=categoria&data_de=VENCIMENTO&de=2026-11-01&ate=2026-11-30';
async function retrato() {
  const j = async r => r.json();
  return {
    contas_bancarias: (await j(await RCB.GET())).map(c => c.id).sort(),
    pagar: (await j(await RCP.GET())).map(c => [c.id, c.valor_final]).sort(),
    receber: (await j(await RCR.GET())).map(c => [c.id, c.valor_final]).sort(),
    extrato: (await j(await REX.GET())).map(c => c.id).sort(),
    lista: semEmpresa(await j(await RLI.GET(req(LISTA)))),
    relatorio: semEmpresa(await j(await RRL.GET(req(RELATORIO)))),
    vendas: (await j(await RVE.GET())).map(v => v.id),
  };
}

console.log('--- 0. Congela: o retrato de hoje, antes do esquema novo ---');
como(sessao('ADMIN'));
const antes = await retrato();
eq(antes.pagar, [['cp1', 100], ['cp2', 1000]], 'retrato de hoje: contas a pagar');
eq([antes.lista.totais.pagar.valor, antes.lista.totais.receber.valor], [1100, 1000], 'retrato de hoje: totais da lista');
eq(antes.relatorio.totais.valor, 2100, 'retrato de hoje: relatório por categoria');

console.log('--- 1. Migração ---');
await pg.exec(EMPRESAS_SCHEMA_SQL);
await pg.exec(EMPRESAS_SCHEMA_SQL); // idempotente: roda a cada boot
eq(await um(`SELECT id, nome, razao_social, cnpj, principal FROM empresas WHERE tenant_id = $1`, [T]),
  { id: 'principal', nome: 'Viaje Bem', razao_social: 'VB Turismo LTDA', cnpj: '11222333000181', principal: true }, 'a principal nasceu dos dados da agência');
eq((await um(`SELECT count(*)::int AS n FROM empresas`)).n, 2, 'uma principal por agência (duas agências, duas linhas), mesmo rodando duas vezes');
for (const tab of ['contas_pagar', 'contas_receber', 'contas_bancarias', 'vendas_crm']) {
  eq((await um(`SELECT count(*) FILTER (WHERE data->>'empresa_id' = 'principal')::int AS ok, count(*)::int AS n FROM ${tab}`)), { ok: (await um(`SELECT count(*)::int AS n FROM ${tab}`)).n, n: (await um(`SELECT count(*)::int AS n FROM ${tab}`)).n }, `${tab}: tudo na principal, nada vazio`);
}
eq((await query(`SELECT empresa_id FROM faturas UNION ALL SELECT empresa_id FROM cobrancas`)).rows.map(r => r.empresa_id), ['principal', 'principal'], 'faturas e cobranças: coluna preenchida');
eq(!!(await um(`SELECT 1 AS x FROM marcos_de_migracao WHERE chave = 'empresas_v1'`)), true, 'marco da migração gravado');

console.log('--- 0b. Uma empresa só: o mesmo retrato, número por número ---');
const depois = await retrato();
eq(depois, antes, 'mesmas listas, mesmos totais, mesmo relatório (só o campo empresa_id a mais)');
const ctxEmp = await (await REM.GET(req('/api/empresas'))).json();
eq([ctxEmp.multi, ctxEmp.visiveis, ctxEmp.empresas.length], [false, null, 1], 'GET /api/empresas: multi = false, sem recorte (a tela não mostra seletor)');

console.log('--- 2. Gatilho: a empresa de quem veio sem ---');
await query(`INSERT INTO empresas (tenant_id, id, nome, cnpj) VALUES ($1, 'emp_b', 'Loja B', '')`, [T]);
await query(`UPDATE vendas_crm SET data = data || '{"empresa_id":"emp_b"}' WHERE id = 'v1'`);
await receber('cr-venda', { valor_final: 10, venda_id: 'v1', data_vencimento: '2026-11-20' });
eq((await um(`SELECT data->>'empresa_id' AS e FROM contas_receber WHERE id = 'cr-venda'`)).e, 'emp_b', 'título da venda: empresa da venda');
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('bB', $1, '{"id":"bB","nome":"Conta da B","empresa_id":"emp_b"}')`, [T]);
await pagar('cp-conta', { valor_final: 20, conta_bancaria_id: 'bB', data_vencimento: '2026-11-20' });
eq((await um(`SELECT data->>'empresa_id' AS e FROM contas_pagar WHERE id = 'cp-conta'`)).e, 'emp_b', 'título pela conta bancária: empresa da conta');
await query(`INSERT INTO cartoes_corp (id, tenant_id, data) VALUES ('k1', $1, '{"id":"k1","apelido":"Visa","empresa_id":"emp_b"}')`, [T]);
await pagar('cp-cartao', { valor_final: 30, cartao_id: 'k1', data_vencimento: '2026-11-20' });
eq((await um(`SELECT data->>'empresa_id' AS e FROM contas_pagar WHERE id = 'cp-cartao'`)).e, 'emp_b', 'compra no cartão: fatura na empresa do cartão');
await pagar('cp-solta', { valor_final: 40, data_vencimento: '2026-11-20' });
eq((await um(`SELECT data->>'empresa_id' AS e FROM contas_pagar WHERE id = 'cp-solta'`)).e, 'principal', 'sem nada: a principal');
await query(`INSERT INTO cobrancas (tenant_id, id, titulo_id, provedor, referencia, tipo, valor_centavos) VALUES ($1, 'c2', 'cr-venda', 'asaas', 'r2', 'boleto', 1000)`, [T]);
eq((await um(`SELECT empresa_id FROM cobrancas WHERE id = 'c2'`)).empresa_id, 'emp_b', 'cobrança: empresa do título');
await query(`INSERT INTO notas_fiscais (id, tenant_id, conta_receber_id, data) VALUES ('n1', $1, 'cr-venda', '{"id":"n1"}')`, [T]);
eq((await um(`SELECT data->>'empresa_id' AS e FROM notas_fiscais WHERE id = 'n1'`)).e, 'emp_b', 'nota: empresa da conta a receber');
await query(`UPDATE contas_pagar SET data = data - 'empresa_id' WHERE id = 'cp-conta'`);
eq((await um(`SELECT data->>'empresa_id' AS e FROM contas_pagar WHERE id = 'cp-conta'`)).e, 'emp_b', 'regravação sem empresa mantém a de antes');
await query(`UPDATE contas_pagar SET data = data || '{"empresa_id":"nao-existe"}' WHERE id = 'cp-solta'`);
eq((await um(`SELECT data->>'empresa_id' AS e FROM contas_pagar WHERE id = 'cp-solta'`)).e, 'principal', 'empresa que não existe não entra: volta para a derivada');
await receber('cr-venda-paga', { valor_final: 5, venda_id: 'v1', status: 'RECEBIDO', valor_recebido: 5, data_recebimento: '2026-11-01', data_vencimento: '2026-11-01' });
await query(`UPDATE vendas_crm SET data = data || '{"empresa_id":"principal"}' WHERE id = 'v1'`);
eq((await query(`SELECT id, data->>'empresa_id' AS e FROM contas_receber WHERE id IN ('cr-venda', 'cr-venda-paga') ORDER BY id`)).rows.map(r => [r.id, r.e]),
  [['cr-venda', 'principal'], ['cr-venda-paga', 'emp_b']], 'venda trocou de empresa: o aberto vai junto, o recebido fica');
// A empresa marcada no seletor (uma só) é a de quem grava sem dizer.
como(sessao('OPERADOR', 'u-OPERADOR'));
await query(`INSERT INTO empresa_selecao (tenant_id, usuario_id, empresas) VALUES ($1, 'u-OPERADOR', '["emp_b"]')`, [T]);
await pool.query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('cp-op', $1, 'PENDENTE', '{"id":"cp-op","valor_final":1,"data_vencimento":"2026-12-01"}')`, [T]);
eq((await um(`SELECT data->>'empresa_id' AS e FROM contas_pagar WHERE id = 'cp-op'`)).e, 'emp_b', 'quem trabalha só na B lança na B');
await query(`DELETE FROM empresa_selecao`);
await query(`DELETE FROM contas_pagar WHERE id IN ('cp-op', 'cp-conta', 'cp-cartao', 'cp-solta')`);
await query(`DELETE FROM contas_receber WHERE id IN ('cr-venda', 'cr-venda-paga')`);
await query(`DELETE FROM cobrancas WHERE id = 'c2'`);
await query(`DELETE FROM empresas WHERE id = 'emp_b'`);
await query(`DELETE FROM contas_bancarias WHERE id = 'bB'`);
await query(`DELETE FROM cartoes_corp`);
await query(`UPDATE vendas_crm SET data = data || '{"empresa_id":"principal"}'`);

console.log('--- 3. Duas empresas: o seletor separa os números ---');
como(sessao('ADMIN', 'u-ADMIN'));
let r = await REM.POST(req('/api/empresas', 'POST', { nome: 'Loja B', cnpj: '11.222.333/0001-81' }));
eq([r.status, (await r.json()).error], [409, 'Este CNPJ já está na empresa "Viaje Bem".'], 'CNPJ repetido entre empresas é recusado');
r = await REM.POST(req('/api/empresas', 'POST', { nome: 'Loja B', razao_social: 'Loja B Viagens LTDA', cnpj: '' }));
const B = (await r.json()).id;
eq([r.status, typeof B === 'string' && B.startsWith('emp_')], [200, true], 'administrador cadastra a segunda empresa');
como(sessao('OPERADOR', 'u-OPERADOR'));
eq((await REM.POST(req('/api/empresas', 'POST', { nome: 'Loja C' }))).status, 403, 'só administrador cadastra empresa');
r = await REM.POST(req('/api/empresas', 'POST', { id: 'principal', nome: 'Viaje Bem', ativa: false }));
como(sessao('ADMIN', 'u-ADMIN'));
r = await REM.POST(req('/api/empresas', 'POST', { id: 'principal', nome: 'Viaje Bem', ativa: false }));
eq(r.status, 409, 'a principal não se desativa');

// A B ganha conta, títulos e uma despesa rateada 60/40 com a principal.
await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ('bB', $1, 'Conta da B', $2)`, [T, JSON.stringify({ id: 'bB', nome: 'Conta da B', empresa_id: B, saldo_atual: 0 })]);
await query(`UPDATE contas_bancarias SET data = data || $1::jsonb WHERE id = 'b2'`, [JSON.stringify({ empresas_disponiveis: [B] })]);
await pagar('cpB', { valor_final: 250, empresa_id: B, data_vencimento: '2026-11-15', categoria_id: 'aluguel' });
r = await RCP.POST(req('/api/contas-pagar', 'POST', {
  id: 'cpR', fornecedor_nome: 'Shopping', valor_final: 1000, status: 'PENDENTE', data_vencimento: '2026-11-20', categoria_id: 'aluguel',
  rateio: [{ empresa_id: 'principal', centro_custo_id: '', percentual: 60, valor: 0 }, { empresa_id: B, centro_custo_id: 'rj', percentual: 40, valor: 0 }],
}));
eq(r.status, 200, 'despesa rateada entre as duas empresas grava');
eq((await um(`SELECT data->'rateio' AS r FROM contas_pagar WHERE id = 'cpR'`)).r.map(l => l.valor), [600, 400], 'rateio 60/40 fecha os centavos');
r = await RCP.POST(req('/api/contas-pagar', 'POST', { id: 'cpX', valor_final: 10, status: 'PENDENTE', rateio: [{ empresa_id: 'emp_fantasma', percentual: 100, valor: 0 }] }));
eq([r.status, (await r.json()).error], [403, 'A empresa da linha 1 do rateio não existe ou está inativa.'], 'rateio para empresa que não existe é recusado');

const ctx2 = await (await REM.GET(req('/api/empresas'))).json();
eq([ctx2.multi, ctx2.visiveis, ctx2.empresas.map(e => e.nome)], [true, null, ['Viaje Bem', 'Loja B']], 'com duas empresas o seletor aparece (todas marcadas = sem recorte)');
const todas = await retrato();
eq(todas.pagar.map(p => p[0]), ['cp1', 'cp2', 'cpB', 'cpR'], 'todas as empresas: tudo');

eq((await (await RSE.PUT(req('/api/empresas/selecao', 'PUT', { empresas: [B] }))).json()).selecao, [B], 'marca só a B (lembrado para a pessoa)');
const soB = await retrato();
eq(soB.pagar, [['cpB', 250], ['cpR', 1000]], 'só a B: a conta da B e a rateada (que toca a B)');
eq(soB.contas_bancarias, ['b2', 'bB'], 'só a B: a conta dela e a da principal disponível na B');
eq(soB.extrato, ['e2'], 'só a B: extrato das contas disponíveis na B');
eq(soB.receber.map(c => c[0]), [], 'só a B: nenhum título a receber');
eq(soB.vendas, [], 'só a B: nenhuma venda');
eq(soB.lista.totais.pagar.valor, 1250, 'lista de contas: só a B');
eq(soB.relatorio.totais.valor, 650, 'relatório por categoria: 250 da B + 40% de 1000');
eq((await (await RSE.PUT(req('/api/empresas/selecao', 'PUT', { empresas: ['principal'] }))).json()).selecao, ['principal'], 'marca só a principal');
const soP = await retrato();
eq(soP.relatorio.totais.valor, 2100 + 600, 'só a principal: o de antes + 60% da rateada');
eq(soP.lista.totais.pagar.valor, 1100 + 1000, 'lista: as de antes + a rateada');
como(sessao('ADMIN', 'u-OUTRO'));
eq((await retrato()).pagar.length, 4, 'a escolha é por pessoa: outra pessoa continua vendo todas');
como(sessao('ADMIN', 'u-ADMIN'));
eq((await (await RSE.PUT(req('/api/empresas/selecao', 'PUT', { empresas: ['principal', B] }))).json()).selecao, [], 'marcar todas grava "todas"');

console.log('--- 4. Permissão por empresa ---');
r = await RGU.POST(req('/api/perfis-de-acesso', 'POST', { tipo: 'grupo', grupo: { id: 'g-lojaB', nome: 'Equipe da Loja B', acesso_total: true, acoes: [], contas: [], empresas: [B], membros: ['u-OPERADOR'] } }));
const corpoGrupo = await r.json();
eq([r.status, corpoGrupo.grupo?.empresas ?? corpoGrupo.empresas], [200, [B]], 'perfil "acesso completo só na Loja B" gravado');
P.invalidarPermissoes(T);
como(sessao('OPERADOR', 'u-OPERADOR'));
const op = await retrato();
eq(op.pagar.map(p => p[0]), ['cpB', 'cpR'], 'operador da B vê só a B, sem marcar nada');
eq(op.receber, [], 'operador da B: nada a receber da principal');
eq((await (await REM.GET(req('/api/empresas'))).json()).empresas.map(e => e.id), [B], 'o seletor dele só oferece a B');
eq((await ICP.GET(req('/api/contas-pagar/cp1'), ctx({ id: 'cp1' }))).status, 404, 'abrir pelo id uma conta da principal: não existe para ele');
eq((await RCP.POST(req('/api/contas-pagar', 'POST', { id: 'cpOp', valor_final: 5, status: 'PENDENTE', empresa_id: 'principal' }))).status, 403, 'lançar na principal: recusado');
eq((await RCP.POST(req('/api/contas-pagar', 'POST', { id: 'cp1', valor_final: 5, status: 'PENDENTE', empresa_id: B }))).status, 403, 'puxar para a B uma conta da principal: recusado');
eq((await RCP.POST(req('/api/contas-pagar', 'POST', { id: 'cpOp', valor_final: 5, status: 'PENDENTE', empresa_id: B, data_vencimento: '2026-11-21' }))).status, 200, 'lançar na B: pode');
eq((await RSE.PUT(req('/api/empresas/selecao', 'PUT', { empresas: ['principal'] }))).status, 403, 'marcar a principal no seletor: recusado');
como(sessao('ADMIN', 'u-ADMIN'));
eq((await retrato()).pagar.length, 5, 'administrador nunca é restringido');

console.log('--- 5. Configuração por empresa e "copiar de outra empresa" ---');
const agenciaAntes = (await um(`SELECT data FROM agencia WHERE tenant_id = $1`, [T])).data;
r = await RCV.PUT(req(`/api/config/vendas?empresa=${B}`, 'PUT', { receita: { componentes: { OVER: false } } }));
eq([r.status, (await r.json()).receita.componentes.OVER], [200, false], 'a B grava a própria configuração de vendas');
eq((await um(`SELECT data FROM agencia WHERE tenant_id = $1`, [T])).data, agenciaAntes, 'a agência (principal) não mudou');
eq((await (await RCV.GET(req('/api/config/vendas'))).json()).receita.componentes.OVER, true, 'a principal continua com a dela');
const { lerConfigVenda } = await import('../src/lib/venda-servidor.ts');
eq((await lerConfigVenda(pool, T, B)).receita.componentes.OVER, false, 'quem lê a configuração da venda da B recebe a da B');
r = await RCO.POST(req('/api/empresas/copiar', 'POST', { secao: 'vendas', de: 'principal', para: B }));
eq([r.status, (await r.json()).config.venda_config.receita.componentes.OVER], [200, true], 'copiar da principal para a B');
eq((await um(`SELECT copiada_de FROM empresa_configuracoes WHERE empresa_id = $1 AND secao = 'vendas'`, [B])).copiada_de, 'principal', 'fica anotado de onde veio');
eq((await RCO.POST(req('/api/empresas/copiar', 'POST', { secao: 'vendas', de: B, para: B }))).status, 400, 'copiar de si mesma: recusado');

// Fiscal: a B tem linha própria e nunca herda o emissor da principal.
await NF.salvarConfigFiscal(T, { ...(await NF.carregarConfigFiscal(T)), provedor: 'aceleraapi', token: 'ace_principal', empresa_id: 77, aliquota_iss: 2, item_lista_servico: '9.02' });
eq([(await NF.carregarConfigFiscal(T, B)).token ?? '', (await NF.carregarConfigFiscal(T, B)).empresa_id], ['', null], 'a B não herda o token nem o emissor da principal');
r = await RCO.POST(req('/api/empresas/copiar', 'POST', { secao: 'notas', de: 'principal', para: B }));
const notasB = await NF.carregarConfigFiscal(T, B);
eq([r.status, notasB.aliquota_iss, notasB.item_lista_servico, notasB.token ?? '', notasB.empresa_id], [200, 2, '9.02', '', null], 'copiar notas: leva o enquadramento, nunca o token nem o emissor');
eq((await NF.carregarConfigFiscal(T)).token, 'ace_principal', 'a principal segue com o token dela');
eq((await NF.carregarEmitente(T, B)).razao_social, 'Loja B Viagens LTDA', 'emitente da B: a razão social da B');
eq((await NF.carregarEmitente(T)).razao_social, 'VB Turismo LTDA', 'emitente da principal: o de sempre');

// Política de encargos da baixa: a da empresa do título.
await query(`INSERT INTO empresa_configuracoes (tenant_id, empresa_id, secao, data) VALUES ($1, $2, 'financeiro', '{"politica_cobranca":{"juros_am_pct":9}}')
  ON CONFLICT (tenant_id, empresa_id, secao) DO UPDATE SET data = EXCLUDED.data`, [T, B]);
const pol = await E.lerChavesDaEmpresa(pool, T, B, ['politica_cobranca']);
eq(pol.politica_cobranca.juros_am_pct, 9, 'a B tem a política própria');
eq((await E.lerChavesDaEmpresa(pool, T, 'principal', ['politica_cobranca'])).politica_cobranca.juros_am_pct, 1, 'a principal segue com a dela');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
