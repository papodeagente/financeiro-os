/**
 * Conferência do extrato de operadora (E6) × venda completa (E5, modelo 2),
 * contra um Postgres real (PGlite), pelas ROTAS de produção, com a IA trocada
 * por um falso (nada sai para a rede).
 *
 * Prova:
 *  1. A venda lançada no modelo completo casa pelo localizador, com o custo
 *     e a comissão das contas dela (`v2:forn:…`, `v2:comissao:…`), não do
 *     item derivado; o representante é a operadora do produto.
 *  2. A comissão recebida (conta `v2:comissao:…` baixada) aparece no item.
 *  3. O que a operadora diz que pagou de comissão vai para o lado do
 *     fornecedor (fornecedor_extrato_comissoes), com a venda casada, sem
 *     repetir ao casar de novo; ligar à mão leva a venda junto; o
 *     cancelamento entra devolvendo.
 *
 * Uso: node --no-warnings scripts/test-sql-conferencia-venda-completa.mjs
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
  CREATE TABLE crm_eventos_entrada (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RECEBIDO', processado BOOLEAN NOT NULL DEFAULT false, erro TEXT, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE itens_venda (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', sequencia INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_contas_receber_venda_parcela ON contas_receber (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE UNIQUE INDEX idx_contas_pagar_venda_item ON contas_pagar (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE membros (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_notificacoes_deduplicacao ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
await pg.exec(`
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE config_apis (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', usuario_id TEXT NOT NULL DEFAULT '',
    acao TEXT NOT NULL DEFAULT '', modulo TEXT NOT NULL DEFAULT '', entidade TEXT NOT NULL DEFAULT '',
    entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
globalThis.__SESSAO_DE_TESTE__ = null;
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-conferencia-v2';

for (const [mod, nome] of [
  ['../src/lib/baixas-servidor.ts', 'BAIXAS_SCHEMA_SQL'], ['../src/lib/periodo-fechado.ts', 'PERIODO_SCHEMA_SQL'],
  ['../src/lib/cobranca/schema.ts', 'COBRANCA_SCHEMA_SQL'], ['../src/lib/permissoes-schema.ts', 'PERMISSOES_SCHEMA_SQL'],
  ['../src/lib/venda-schema.ts', 'VENDA_SCHEMA_SQL'], ['../src/lib/fornecedor-schema.ts', 'FORNECEDOR_SCHEMA_SQL'],
  ['../src/lib/razao-schema.ts', 'RAZAO_SCHEMA_SQL'], ['../src/lib/leitura-documento-servidor.ts', 'LEITURA_DOCUMENTO_SCHEMA_SQL'],
  ['../src/lib/conferencia-operadora-schema.ts', 'CONFERENCIA_OPERADORA_SCHEMA_SQL'],
]) await pg.exec((await import(mod))[nome]);

const forn = await import('../src/lib/fornecedor-servidor.ts');
const conf = await import('../src/lib/conferencia-operadora-servidor.ts');
const rotaVenda = await import('../src/app/api/vendas/completa/route.ts');
const LER = await import('../src/app/api/conferencia-operadora/ler/route.ts');
const LISTA = await import('../src/app/api/conferencia-operadora/route.ts');
const UMA = await import('../src/app/api/conferencia-operadora/[id]/route.ts');

let resposta = null;
globalThis.fetch = async (url) => {
  if (!String(url).startsWith('https://api.anthropic.com/')) throw new Error(`rede bloqueada no teste: ${url}`);
  return new Response(JSON.stringify({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(resposta) }] }),
    { status: 200, headers: { 'content-type': 'application/json' } });
};

const T = 'agencia-conf';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const sessao = (perfil, tenant = T) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const ctx = id => ({ params: Promise.resolve({ id }) });
const cadastro = (id, nome, cnpj = '') => query(
  `INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, cnpj, data) VALUES ($1, $2, $3, $4, $5::jsonb)`,
  [id, T, nome, cnpj, JSON.stringify({ id, nome_fantasia: nome, cnpj, tipo: 'OPERADORA', status: 'ATIVO', regras_faturamento: { prazo_pagamento_dias: 30 } })],
);
await cadastro('f-hotel', 'Hotel Mar');
await cadastro('f-cons', 'Consolidadora Azul', '11.222.333/0001-81');
await query(`INSERT INTO config_apis (id, tenant_id, data) VALUES ('apis-config-singleton', $1, $2)`, [T, JSON.stringify({ anthropic: { ativo: true, api_key: 'sk-conf' } })]);

async function lerEConferir(extrato, nome) {
  resposta = extrato;
  const form = new FormData();
  form.append('file', new File([new TextEncoder().encode(`%PDF-1.4\n${nome}\n%%EOF`)], `${nome}.pdf`, { type: 'application/pdf' }));
  const lido = await json(await LER.POST(new Request('http://x/api/conferencia-operadora/ler', { method: 'POST', body: form })));
  const criado = await json(await LISTA.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ hash: lido.corpo.hash, fornecedor_id: 'f-cons', fornecedor_nome: 'Consolidadora Azul' }) })));
  return { lido, id: criado.corpo.id, status: criado.status };
}
const detalhe = async id => (await json(await UMA.GET(new Request('http://x'), ctx(id)))).corpo;
const acao = async (id, corpo) => json(await UMA.POST(new Request('http://x', { method: 'POST', body: JSON.stringify(corpo) }), ctx(id)));
const extratoDaConf = async id => (await todos(
  `SELECT venda_id, localizador, valor_centavos, parte_id, data::text AS data FROM fornecedor_extrato_comissoes WHERE tenant_id = $1 AND referencia LIKE $2 ORDER BY referencia`,
  [T, `conferencia:${id}:%`],
)).map(r => [r.venda_id, r.localizador, Number(r.valor_centavos), r.parte_id, r.data]);

try {
  console.log('--- venda completa: hotel comprado pela consolidadora, aéreo cobrado pela consolidadora ---');
  const v = await json(await rotaVenda.POST(pedir('POST', '/api/vendas/completa', { venda: {
    data_venda: '2026-10-02', cliente: { id: 'cli-1', nome: 'Carla Dias' },
    produtos: [
      { tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar 4 noites', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' }, representante: { id: 'f-cons', nome: 'Consolidadora Azul' },
        quem_cobra: 'AGENCIA', localizador: 'HM1234', data_inicio: '2026-12-20',
        passageiros: [{ nome: 'Carla Dias', tarifa_centavos: 100000 }], componentes: [{ tipo: 'COMISSAO', valor_centavos: 10000 }] },
      { tipo: 'AEREO', descricao: 'GRU-SSA', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' }, representante: null, quem_cobra: 'FORNECEDOR', localizador: 'AZ9876', data_inicio: '2026-12-20',
        passageiros: [{ nome: 'Carla Dias', tarifa_centavos: 200000 }], componentes: [{ tipo: 'COMISSAO', valor_centavos: 15000 }] },
    ],
    pagamentos: [{ forma: 'PIX', valor_centavos: 100000 }],
  } })));
  eq(v.status, 201, 'venda completa lançada');
  const VID = v.corpo.venda.id;
  const [PH, PA] = v.corpo.venda.produtos.map(p => p.id);
  const pagar = (await todos(`SELECT data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, VID])).map(r => r.data);
  const receber = await todos(`SELECT id, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'origem' = 'COMISSAO_FORNECEDOR'`, [T, VID]);
  eq([pagar.map(c => [c.fornecedor_id, c.valor_final]), receber.map(c => [c.data.fornecedor_id, c.data.valor_final])],
    [[['f-cons', 900]], [['f-hotel', 150]]], 'contas da venda: 900 a pagar à consolidadora (hotel) e 150 de comissão a receber do hotel (aéreo cobrado direto)');
  await query(`UPDATE contas_receber SET status = 'RECEBIDO', data = data || jsonb_build_object('status', 'RECEBIDO', 'valor_recebido', (data->>'valor_final')::numeric) WHERE id = $1`, [receber[0].id]);

  console.log('--- 1. casar pelo localizador com as contas da venda completa ---');
  const EXTRATO = {
    operadora_nome: 'Consolidadora Azul', operadora_cnpj: '11.222.333/0001-81', periodo_de: '2026-10-01', periodo_ate: '2026-10-31',
    total_bruto: null, total_comissao: null, total_liquido: null,
    linhas: [
      { data: '2026-10-05', localizador: 'HM1234', passageiro: 'DIAS/CARLA', tipo: 'venda', valor_bruto: 1000, taxas: 0, comissao: 100, valor_liquido: 900 },
      { data: '2026-10-06', localizador: 'XX0000', passageiro: 'NINGUEM/X', tipo: 'venda', valor_bruto: 500, taxas: 0, comissao: 40, valor_liquido: 460 },
      { data: '2026-10-07', localizador: 'HM1234', passageiro: 'DIAS/CARLA', tipo: 'cancelamento', valor_bruto: 100, taxas: 0, comissao: 10, valor_liquido: 90 },
    ],
  };
  const { id, status } = await lerEConferir(EXTRATO, 'extrato-azul-outubro');
  eq(status, 201, 'conferência gravada');
  let d = await detalhe(id);
  const L = i => d.linhas[i];
  eq([L(0).situacao, L(0).como_casou, L(0).venda_id, L(0).item_id], ['CONFERIDO', 'localizador', VID, `${VID}:${PH}`],
    'hotel: casa pelo localizador com o item da venda completa e confere (900 líquido = conta a pagar)');
  eq([L(1).situacao, L(1).venda_id], ['NAO_ENCONTRADO', ''], 'linha sem venda: não encontrada');

  console.log('--- 2. contas e comissão recebida da venda completa ---');
  const itens = await conf.carregarItensParaCasar(pool, T, { ...EXTRATO, linhas: [{ data: '2026-10-05', localizador: 'AZ9876', passageiro: '', descricao: '', tipo: 'venda', bruto_centavos: 200000, taxas_centavos: 0, comissao_centavos: 15000, liquido_centavos: 185000 }] });
  const hotel = itens.find(i => i.item_id === `${VID}:${PH}`);
  const aereo = itens.find(i => i.item_id === `${VID}:${PA}`);
  eq([hotel?.fornecedor_id, hotel?.custo_centavos, hotel?.conta_pagar?.valor_centavos], ['f-cons', 90000, 90000],
    'hotel: a operadora do item é a consolidadora (representante) e o custo vem da conta v2:forn');
  eq([aereo?.fornecedor_id, aereo?.meio, aereo?.comissao_centavos, aereo?.conta_comissao?.recebido_centavos],
    ['f-hotel', 'fornecedor', 15000, 15000], 'aéreo cobrado direto: comissão da conta v2:comissao, já recebida');

  console.log('--- 3. comissão do extrato vai para o lado do fornecedor ---');
  eq(await extratoDaConf(id), [
    [VID, 'HM1234', 10000, 'f-cons', '2026-10-05'],
    [null, 'XX0000', 4000, 'f-cons', '2026-10-06'],
    [VID, 'HM1234', -1000, 'f-cons', '2026-10-07'],
  ], 'uma linha por linha com comissão, ligada à venda casada; cancelamento devolve');
  let r = await acao(id, { acao: 'recasar' });
  eq([r.status, (await extratoDaConf(id)).length], [200, 3], 'casar de novo não repete o registro');
  r = await acao(id, { acao: 'ligar', linha_id: L(1).id, item_id: `${VID}:${PA}` });
  eq(r.status, 200, 'ligar a linha sem venda à mão');
  eq((await extratoDaConf(id))[1][0], VID, 'a venda ligada à mão acompanha o registro da comissão');
  d = await detalhe(id);
  eq([L(1).venda_id, L(1).tem_conta_de_comissao, L(1).comissao_recebida_centavos], [VID, true, 15000], 'a linha ligada ao aéreo mostra a comissão recebida da venda completa');
  const com = await forn.comissoesNoPeriodo(pool, T, { de: '2026-10-01', ate: '2026-10-31' }, '2026-11-10');
  eq(com.extrato_disponivel, true, 'a tela "Comissão de fornecedores" passa a ter o extrato');
} finally {
  console.log(`\n${total - falhas}/${total} passaram`);
  if (falhas > 0) process.exit(1);
}
