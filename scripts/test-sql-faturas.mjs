/**
 * Faturas ao cliente, Regras de faturamento e Nota de débito (E5, parte B)
 * contra um Postgres real (PGlite), rodando o código DE PRODUÇÃO: as rotas
 * com sessão de teste, a venda completa, a cobrança da E3 com provedor FALSO
 * (sem rede) e o portal do cliente.
 *
 * O que se prova:
 *   (a) esquema idempotente; histórico da fatura não aceita UPDATE;
 *   (b) regra pela rota, uma por pessoa × produto × fornecedor; prévia das
 *       próximas 3 com o feriado de 15/11;
 *   (c) a forma Faturar entra sozinha na fatura certa (quinzena + feriado),
 *       a conta do item sai dos totais e o dinheiro vive na conta da fatura
 *       (nunca duas vezes); pagante sem regra fica solto e a tela diz por quê;
 *   (d) a posição da venda lê o item pela fatura;
 *   (e) a venda muda com a fatura aberta: o item acompanha no lugar;
 *   (f) idempotência: montar de novo não muda nada; fechar duas vezes também;
 *       a mesma correção não duplica a nota; a mesma chave de cobrança devolve
 *       a mesma cobrança;
 *   (g) mover itens, faturar avulso, tirar e adicionar;
 *   (h) corrigir valor vira nota de crédito/débito escrita;
 *   (i) fechar/reabrir com direito e motivo; a venda que muda depois de
 *       faturada gera nota de crédito, e a que volta a subir, nota de débito —
 *       o total faturado sempre bate com a venda;
 *   (j) "Fechar e cobrar" com boleto+Pix da E3; recusa do provedor devolve a
 *       fatura aberta; a E3 recusa cobrar fatura aberta;
 *   (k) saldo de pagamento parcial vira nota de débito na próxima;
 *   (l) conferência por arquivo, exportação CSV/XLSX, retenções;
 *   (m) recalcular vencimentos (prévia e aplicar);
 *   (n) o cliente confere, contesta e aprova no portal;
 *   (o) isolamento entre agências;
 *   (p) a tarefa de hora em hora junta o que ficou solto;
 *   (q) nota de débito da venda.
 *
 * Uso: node --no-warnings scripts/test-sql-faturas.mjs
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

process.env.INTEGRACOES_MASTER_KEY = 'c'.repeat(64);
process.env.PUBLIC_APP_URL = 'https://fin.exemplo.com';
process.env.JWT_SECRET = 'segredo-de-teste-faturas';

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE crm_eventos_entrada (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RECEBIDO', processado BOOLEAN NOT NULL DEFAULT false, erro TEXT, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE membros (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE itens_venda (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', sequencia INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_contas_receber_venda_parcela ON contas_receber (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE UNIQUE INDEX idx_contas_pagar_venda_item ON contas_pagar (tenant_id, (data->>'origem_venda_id'), (data->>'origem_item_id'), (data->>'parcela_numero'))
    WHERE data->>'auto_gerado' = 'true' AND COALESCE(data->>'origem_venda_id', '') <> '' AND COALESCE(data->>'status', '') <> 'CANCELADO';
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE transferencias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_notificacoes_deduplicacao ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE TABLE plataformas_transacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_transacao TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plataformas_config (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', ativo BOOLEAN NOT NULL DEFAULT false, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (tenant_id, plataforma));
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
globalThis.__SESSAO_DE_TESTE__ = null;
register('./sessao-de-teste-hook.mjs', import.meta.url);

const { VENDA_SCHEMA_SQL } = await import('../src/lib/venda-schema.ts');
const { FATURA_SCHEMA_SQL } = await import('../src/lib/fatura-schema.ts');
const { BAIXAS_SCHEMA_SQL } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(VENDA_SCHEMA_SQL);
await pg.exec(FATURA_SCHEMA_SQL);
await pg.exec(FATURA_SCHEMA_SQL); // idempotente: roda a cada boot
await pg.exec(RAZAO_SCHEMA_SQL);

const srvCob = await import('../src/lib/cobranca/servidor.ts');
const { ErroProvedor } = await import('../src/lib/cobranca/tipos.ts');
const { criarLink, lerPortal, acharLink } = await import('../src/lib/cobranca/portal-servidor.ts');
const rotaVendas = await import('../src/app/api/vendas/completa/route.ts');
const rotaVenda = await import('../src/app/api/vendas/completa/[id]/route.ts');
const rotaNotaDebito = await import('../src/app/api/vendas/completa/[id]/nota-de-debito/route.ts');
const rotaRegras = await import('../src/app/api/regras-faturamento/route.ts');
const rotaRegra = await import('../src/app/api/regras-faturamento/[id]/route.ts');
const rotaPreviaRegra = await import('../src/app/api/regras-faturamento/previa/route.ts');
const rotaRecalcular = await import('../src/app/api/regras-faturamento/recalcular/route.ts');
const rotaFaturas = await import('../src/app/api/faturas/route.ts');
const rotaAlocar = await import('../src/app/api/faturas/alocar/route.ts');
const rotaAFaturar = await import('../src/app/api/faturas/a-faturar/route.ts');
const rotaFatura = await import('../src/app/api/faturas/[id]/route.ts');
const rotaFechar = await import('../src/app/api/faturas/[id]/fechar/route.ts');
const rotaReabrir = await import('../src/app/api/faturas/[id]/reabrir/route.ts');
const rotaCobrar = await import('../src/app/api/faturas/[id]/cobrar/route.ts');
const rotaItens = await import('../src/app/api/faturas/[id]/itens/route.ts');
const rotaNotas = await import('../src/app/api/faturas/[id]/notas/route.ts');
const rotaSaldo = await import('../src/app/api/faturas/[id]/saldo/route.ts');
const rotaConferencia = await import('../src/app/api/faturas/[id]/conferencia/route.ts');
const rotaExportar = await import('../src/app/api/faturas/[id]/exportar/route.ts');
const rotaPortalFaturas = await import('../src/app/api/portal/[token]/faturas/route.ts');
const rotaPortalFatura = await import('../src/app/api/portal/[token]/faturas/[id]/route.ts');

const T = 'ag-fat';
const T2 = 'ag-outra';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const sessao = (perfil, tenant = T) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const pedir = (metodo, url, corpo, cab = {}) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json', ...cab }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const params = id => ({ params: Promise.resolve({ id }) });
const como = perfil => { globalThis.__SESSAO_DE_TESTE__ = sessao(perfil); };

await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, tipo, data) VALUES
  ('cli-emp', $1, 'Empresa Alfa', '11222333000181', 'juridica', '{"email":"fin@alfa.com"}'),
  ('cli-sem', $1, 'Beta Viagens', '22333444000172', 'juridica', '{}'),
  ('cli-emp2', $2, 'Gama Ltda', '33444555000163', 'juridica', '{}')`, [T, T2]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('a1', $1, '{"nome":"Agência Teste","cnpj":"44555666000154","cobranca":{"provedor_padrao":"asaas","tipo_padrao":"boleto_pix"}}')`, [T]);

const vendaManual = ({ id, data, cliente = { id: 'cli-emp', nome: 'Empresa Alfa' }, valor, inicio = '', fim = '', loc = '' }) => ({
  id, data_venda: data, cliente, centro_custo: 'Diretoria',
  produtos: [{ id: `p-${id}`, tipo: 'HOSPEDAGEM', descricao: `Hotel ${id}`, fornecedor: { id: 'f-mar', nome: 'Hotel Mar' }, localizador: loc || `LOC${id}`, data_inicio: inicio, data_fim: fim,
    passageiros: [{ id: `x-${id}`, nome: `Passageiro ${id}`, tarifa_centavos: valor }] }],
  pagamentos: [{ id: `g-${id}`, forma: 'FATURAR', valor_centavos: valor }],
});
const lancar = async v => json(await rotaVendas.POST(pedir('POST', '/api/vendas/completa', { venda: v })));
const mudar = async v => json(await rotaVenda.PUT(pedir('PUT', `/api/vendas/completa/${v.id}`, { venda: v }), params(v.id)));
const faturas = async (tenant = T) => (await todos(`SELECT id, numero, situacao, chave, vencimento::text AS venc, total_centavos::int AS total, titulo_id, conferencia, avulsa FROM faturas WHERE tenant_id = $1 ORDER BY numero`, [tenant]));
const fatura = async numero => (await faturas()).find(f => f.numero === numero);
const itensDa = async id => (await todos(`SELECT conta_id, venda_id, valor_centavos::int AS v FROM fatura_itens WHERE tenant_id = $1 AND fatura_id = $2 ORDER BY venda_id, conta_id`, [T, id]));
const notasDa = async id => (await todos(`SELECT tipo, valor_centavos::int AS v, motivo, chave FROM fatura_ajustes WHERE tenant_id = $1 AND fatura_id = $2 ORDER BY criado_em, id`, [T, id]));
const contaFaturar = async vendaId => (await todos(`SELECT id, status, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'faturar' = 'true' ORDER BY data->>'origem_item_id'`, [T, vendaId]));
const vivasDoCliente = async cliente => Math.round(Number((await um(`SELECT COALESCE(SUM((data->>'valor_final')::numeric), 0) AS s FROM contas_receber WHERE tenant_id = $1 AND data->>'cliente_id' = $2 AND COALESCE(data->>'status', status) <> 'CANCELADO'`, [T, cliente])).s) * 100);
const ficha = async id => json(await rotaFatura.GET(pedir('GET', `/api/faturas/${id}`), params(id)));
const acao = async (id, corpo) => json(await rotaItens.POST(pedir('POST', `/api/faturas/${id}/itens`, corpo), params(id)));
/** Tudo que a venda tem faturado: itens nas faturas vivas + notas da venda. */
const faturadoDaVenda = async vendaId => {
  const it = await um(`SELECT COALESCE(SUM(fi.valor_centavos), 0)::int AS s FROM fatura_itens fi JOIN faturas f ON f.tenant_id = fi.tenant_id AND f.id = fi.fatura_id WHERE fi.tenant_id = $1 AND fi.venda_id = $2 AND f.situacao <> 'CANCELADA'`, [T, vendaId]);
  const nt = await um(`SELECT COALESCE(SUM(CASE WHEN tipo = 'DEBITO' THEN valor_centavos ELSE -valor_centavos END), 0)::int AS s FROM fatura_ajustes WHERE tenant_id = $1 AND venda_id = $2`, [T, vendaId]);
  return Number(it.s) + Number(nt.s);
};

console.log('--- (a) Esquema ---');
const tabelas = (await todos(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND (table_name LIKE 'fatura%' OR table_name = 'regras_faturamento') ORDER BY 1`)).map(r => r.table_name);
eq(tabelas, ['fatura_ajustes', 'fatura_eventos', 'fatura_itens', 'faturas', 'regras_faturamento'], 'tabelas da fatura');

console.log('--- (b) Regra de faturamento ---');
como('ADMIN');
const regraBase = { pessoa_tipo: 'CLIENTE', pessoa_id: 'cli-emp', periodo: 'QUINZENAL', prazo_dias: 0, dia_nao_util: 'PROXIMO', descricao: 'Viagens corporativas', solicitante: 'Carla', centro_custo: 'Diretoria' };
let r = await json(await rotaRegras.POST(pedir('POST', '/api/regras-faturamento', { regra: regraBase })));
eq([r.status, r.corpo.regra.pessoa_nome, r.corpo.regra.periodo], [201, 'Empresa Alfa', 'QUINZENAL'], 'regra criada; o nome vem do cadastro');
const regraId = r.corpo.regra.id;
r = await json(await rotaRegras.POST(pedir('POST', '/api/regras-faturamento', { regra: regraBase })));
eq([r.status, r.corpo.codigo, r.corpo.detalhes.regra_id], [409, 'REGRA_REPETIDA', regraId], 'a mesma pessoa, produto e fornecedor: uma regra só (leva à que existe)');
r = await json(await rotaRegras.POST(pedir('POST', '/api/regras-faturamento', { regra: { ...regraBase, periodo: 'CUSTOMIZADO', faixas: [{ de: 1, ate: 10, vence_dia: 20 }], produto_tipo: 'AEREO' } })));
eq([r.status, r.corpo.codigo], [400, 'DADOS'], 'faixas que não cobrem o mês: 400');
r = await json(await rotaPreviaRegra.POST(pedir('POST', '/api/regras-faturamento/previa', { regra: regraBase, a_partir_de: '2026-11-05' })));
eq(r.corpo.proximas.map(p => [p.inicio, p.fim, p.vencimento]), [['2026-11-01', '2026-11-15', '2026-11-16'], ['2026-11-16', '2026-11-30', '2026-11-30'], ['2026-12-01', '2026-12-15', '2026-12-15']], 'prévia: 15/11 é domingo e feriado → 16/11');
eq(/Proclamação/.test(r.corpo.proximas[0].ajuste), true, 'a prévia diz por que o vencimento andou');
r = await json(await rotaRegras.GET(pedir('GET', '/api/regras-faturamento?pessoa_tipo=CLIENTE')));
eq([r.corpo.regras.length, r.corpo.regras[0].descricao_curta], [1, 'Quinzenal pela data da venda; vence no dia em que termina o período; fim de semana e feriado adiam.'], 'lista com a regra em uma frase');

console.log('--- (c) A forma Faturar entra sozinha na fatura ---');
r = await lancar(vendaManual({ id: 'vA', data: '2026-10-03', valor: 100000, inicio: '2026-12-20', fim: '2026-12-24', loc: 'HM100' }));
eq(r.status, 201, 'venda A lançada à mão');
let fs = await faturas();
eq(fs.map(f => [f.numero, f.situacao, f.venc, f.total]), [[1, 'ABERTA', '2026-10-15', 100000]], 'fatura Nº 1: quinzena 1–15 de outubro, vence 15/10, com a venda A');
const f1 = fs[0];
let cA = (await contaFaturar('vA'))[0];
eq([cA.data.status, cA.data.na_fatura.numero, cA.data.na_fatura.status_anterior], ['CANCELADO', 1, 'PENDENTE'], 'a conta do item sai dos totais, com o carimbo da fatura');
let tit = await um(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND id = $2`, [T, f1.titulo_id]);
eq([tit.data.origem, tit.data.valor_final, tit.data.data_vencimento, tit.data.cliente_id, tit.data.descricao, tit.data.fatura_situacao], ['FATURA', 1000, '2026-10-15', 'cli-emp', 'Fatura Nº 1 - Viagens corporativas', 'ABERTA'], 'o dinheiro mora na conta a receber da fatura');
eq(await vivasDoCliente('cli-emp'), 100000, 'nada conta duas vezes: o cliente deve 1.000,00');
await lancar(vendaManual({ id: 'vB', data: '2026-10-10', valor: 50000 }));
await lancar(vendaManual({ id: 'vC', data: '2026-10-20', valor: 40000 }));
fs = await faturas();
eq(fs.map(f => [f.numero, f.venc, f.total]), [[1, '2026-10-15', 150000], [2, '2026-11-03', 40000]], 'B na mesma quinzena (Nº 1); C na segunda (Nº 2): 31/10 é sábado, 01/11 domingo e 02/11 Finados → vence 03/11');
eq(await vivasDoCliente('cli-emp'), 190000, 'o cliente deve 1.900,00 (as três vendas, uma vez só)');
await lancar(vendaManual({ id: 'vD', data: '2026-10-04', valor: 30000, cliente: { id: 'cli-sem', nome: 'Beta Viagens' } }));
r = await json(await rotaAFaturar.GET(pedir('GET', '/api/faturas/a-faturar')));
eq(r.corpo.itens.map(i => [i.pessoa_nome, i.valor_centavos, i.motivo]), [['Beta Viagens', 30000, 'SEM_REGRA']], 'pagante sem regra: o item fica solto e a tela diz por quê');
eq((await faturas()).length, 2, 'e nenhuma fatura nasce para ele');

console.log('--- (d) Posição da venda pela fatura ---');
r = await json(await rotaVenda.GET(pedir('GET', '/api/vendas/completa/vA'), params('vA')));
const contaNaFicha = r.corpo.contas_receber.find(c => c.faturar);
eq([contaNaFicha.status, contaNaFicha.fatura_numero, contaNaFicha.data_vencimento], ['PENDENTE', 1, '2026-10-15'], 'na ficha da venda, o item aparece em aberto, na fatura Nº 1, com o vencimento dela');
eq([r.corpo.posicao.cliente.a_receber, r.corpo.posicao.cliente.em_aberto], [100000, 100000], 'a posição do cliente não some');

console.log('--- (e) A venda muda com a fatura aberta ---');
const idAntes = cA.id;
r = await mudar(vendaManual({ id: 'vA', data: '2026-10-03', valor: 120000, inicio: '2026-12-20', fim: '2026-12-24', loc: 'HM100' }));
eq(r.status, 200, 'venda A sobe para 1.200,00');
cA = (await contaFaturar('vA'))[0];
eq([cA.id, cA.data.status, cA.data.valor_final], [idAntes, 'CANCELADO', 1200], 'a mesma conta, atualizada no lugar e ainda dentro da fatura');
eq((await itensDa(f1.id)).map(i => [i.venda_id, i.v]), [['vA', 120000], ['vB', 50000]], 'o item acompanha a venda, sem duplicar');
eq((await fatura(1)).total, 170000, 'e o total da fatura também');

console.log('--- (f) Idempotência ---');
r = await json(await rotaAlocar.POST(pedir('POST', '/api/faturas/alocar', {})));
const r2 = await json(await rotaAlocar.POST(pedir('POST', '/api/faturas/alocar', {})));
eq([r.corpo.alocados.length, r2.corpo.alocados.length, (await faturas()).length], [0, 0, 2], 'montar de novo não muda nada');

console.log('--- (g) Mover, faturar avulso, tirar e adicionar ---');
const contaB = (await contaFaturar('vB'))[0].id;
const contaC = (await contaFaturar('vC'))[0].id;
r = await acao(f1.id, { acao: 'mover', conta_ids: [contaB], vencimento: '2026-12-20' });
eq(r.status, 200, 'mover B para 20/12');
fs = await faturas();
eq(fs.map(f => [f.numero, f.situacao, f.venc, f.total]), [[1, 'ABERTA', '2026-10-15', 120000], [2, 'ABERTA', '2026-11-03', 40000], [3, 'ABERTA', '2026-12-20', 50000]], 'B foi para uma fatura nova com o vencimento pedido');
eq((await contaFaturar('vB'))[0].data.na_fatura.numero, 3, 'o carimbo da conta acompanha');
const f3 = fs[2];
r = await acao(f3.id, { acao: 'mover', conta_ids: [contaB], vencimento: '2026-11-03' });
fs = await faturas();
eq(fs.map(f => [f.numero, f.situacao, f.total]), [[1, 'ABERTA', 120000], [2, 'ABERTA', 90000], [3, 'CANCELADA', 0]], 'para um vencimento que já tem fatura: entra nela; a que ficou vazia é cancelada');
const titF3 = await um(`SELECT status FROM contas_receber WHERE tenant_id = $1 AND id = $2`, [T, f3.titulo_id]);
eq(titF3.status, 'CANCELADO', 'e a conta a receber dela também');
const f2 = fs[1];
r = await acao(f2.id, { acao: 'avulso', conta_ids: [contaB], vencimento: '2026-12-05' });
fs = await faturas();
const f4 = fs.find(f => f.numero === 4);
eq([f4.avulsa, f4.venc, f4.total, (await fatura(2)).total], [true, '2026-12-05', 50000, 40000], 'faturar avulso: B sozinho na Nº 4');
r = await acao(f4.id, { acao: 'tirar', conta_ids: [contaB] });
const contaBSolta = (await contaFaturar('vB'))[0];
eq([(await fatura(4)).situacao, contaBSolta.data.status, contaBSolta.data.fatura_manual, contaBSolta.data.na_fatura ?? null], ['CANCELADA', 'PENDENTE', true, null], 'tirar: a conta volta a ser conta a receber solta, marcada');
r = await json(await rotaAlocar.POST(pedir('POST', '/api/faturas/alocar', {})));
eq(r.corpo.alocados.length, 0, 'e não entra sozinha de novo');
r = await json(await rotaAFaturar.GET(pedir('GET', '/api/faturas/a-faturar?pessoa_id=cli-emp')));
eq(r.corpo.itens.map(i => i.motivo), ['TIRADO_DA_FATURA'], 'a tela diz que foi tirada à mão');
r = await acao(f2.id, { acao: 'adicionar', conta_ids: [contaB] });
eq([r.status, (await fatura(2)).total], [200, 90000], 'adicionar B à fatura Nº 2');
r = await acao(f2.id, { acao: 'adicionar', conta_ids: ['nao-existe'] });
eq([r.status, r.corpo.codigo], [409, 'ITEM_INDISPONIVEL'], 'item que não existe: 409');

console.log('--- (h) Corrigir valor vira nota escrita ---');
r = await acao(f2.id, { acao: 'corrigir', conta_id: contaC, valor_centavos: 38000, motivo: 'Tarifa revisada pela operadora' });
eq((await notasDa(f2.id)).map(n => [n.tipo, n.v]), [['CREDITO', 2000]], 'fatura aberta: nota de crédito nela mesma');
eq(/de R\$ 400,00 para R\$ 380,00/.test((await notasDa(f2.id))[0].motivo), true, 'a nota diz de quanto para quanto');
await acao(f2.id, { acao: 'corrigir', conta_id: contaC, valor_centavos: 38000, motivo: 'Tarifa revisada pela operadora' });
eq([(await notasDa(f2.id)).length, (await fatura(2)).total], [1, 88000], 'repetir a mesma correção não duplica');
eq((await itensDa(f2.id)).find(i => i.conta_id === contaC).v, 40000, 'o item não é reescrito');
r = await acao(f2.id, { acao: 'corrigir', conta_id: contaC, valor_centavos: 38000, motivo: 'x' });
eq(r.status, 400, 'sem motivo de verdade: 400');

console.log('--- (i) Fechar, reabrir e a venda que muda depois de faturada ---');
como('VENDEDOR');
eq((await rotaFechar.POST(pedir('POST', `/api/faturas/${f1.id}/fechar`), params(f1.id))).status, 403, 'sem o direito de fechar: 403');
como('ADMIN');
r = await json(await rotaFechar.POST(pedir('POST', `/api/faturas/${f1.id}/fechar`), params(f1.id)));
eq([r.status, r.corpo.fatura.situacao, r.corpo.fatura.conferencia, r.corpo.situacao_visivel, !!r.corpo.fatura.emissao], [200, 'FECHADA', 'AGUARDANDO', 'EM_ATRASO', true], 'fechada (e já vencida: em atraso), aguardando o cliente conferir');
r = await json(await rotaFechar.POST(pedir('POST', `/api/faturas/${f1.id}/fechar`), params(f1.id)));
eq([r.status, r.corpo.fatura.situacao], [200, 'FECHADA'], 'fechar de novo não muda nada');
r = await acao(f1.id, { acao: 'tirar', conta_ids: [cA.id] });
eq([r.status, r.corpo.codigo], [409, 'FATURA_FECHADA'], 'fatura fechada não muda item');
// A venda A cai para 1.100,00 depois de faturada.
r = await mudar(vendaManual({ id: 'vA', data: '2026-10-03', valor: 110000, inicio: '2026-12-20', fim: '2026-12-24', loc: 'HM100' }));
eq(r.status, 200, 'venda A cai para 1.100,00');
eq([(await itensDa(f1.id)).find(i => i.venda_id === 'vA').v, (await fatura(1)).total], [120000, 120000], 'a fatura fechada não muda');
let notas2 = await notasDa(f2.id);
eq(notas2.map(n => [n.tipo, n.v]), [['CREDITO', 2000], ['CREDITO', 10000]], 'a diferença vira nota de crédito na próxima fatura aberta');
eq(/diminuiu R\$ 100,00 depois de faturada na fatura Nº 1/.test(notas2[1].motivo), true, 'explicada: quanto e de qual fatura');
eq(await faturadoDaVenda('vA'), 110000, 'faturado da venda A = 1.100,00');
r = await mudar(vendaManual({ id: 'vA', data: '2026-10-03', valor: 110000, inicio: '2026-12-20', fim: '2026-12-24', loc: 'HM100' }));
eq((await notasDa(f2.id)).length, 2, 'salvar a venda de novo sem mudar nada: nenhuma nota a mais');
// E volta a subir, para 1.250,00.
r = await mudar(vendaManual({ id: 'vA', data: '2026-10-03', valor: 125000, inicio: '2026-12-20', fim: '2026-12-24', loc: 'HM100' }));
eq(await faturadoDaVenda('vA'), 125000, 'venda sobe para 1.250,00: o complemento entra numa fatura e o crédito é desfeito; o faturado bate com a venda');
fs = await faturas();
const comp = fs.find(f => f.numero === 5);
eq([comp.situacao, comp.venc, (await itensDa(comp.id)).map(i => i.v)], ['ABERTA', '2026-10-15', [5000]], 'o complemento vai para uma fatura complementar do mesmo período (a Nº 1 está fechada)');
const notasDaVendaA = await todos(`SELECT tipo, valor_centavos::int AS v FROM fatura_ajustes WHERE tenant_id = $1 AND venda_id = 'vA' ORDER BY criado_em, id`, [T]);
eq(notasDaVendaA.map(n => [n.tipo, n.v]), [['CREDITO', 10000], ['DEBITO', 10000]], 'o crédito é desfeito por um débito explicado');
// Reabrir.
r = await json(await rotaReabrir.POST(pedir('POST', `/api/faturas/${f1.id}/reabrir`, { motivo: 'erro' }), params(f1.id)));
eq([r.status, r.corpo.codigo], [400, 'MOTIVO'], 'reabrir sem motivo de verdade: 400');
await query(`INSERT INTO cobrancas (id, tenant_id, titulo_tabela, titulo_id, provedor, referencia, tipo, status, valor_centavos, vencimento) VALUES ('cob-x', $1, 'contas_receber', $2, 'asaas', 'f1;x', 'boleto_pix', 'aberta', 120000, '2026-11-16')`, [T, f1.titulo_id]);
r = await json(await rotaReabrir.POST(pedir('POST', `/api/faturas/${f1.id}/reabrir`, { motivo: 'Cliente pediu outro centro de custo' }), params(f1.id)));
eq([r.status, r.corpo.codigo], [409, 'COBRANCA_VALENDO'], 'com boleto valendo não reabre');
await query(`DELETE FROM cobrancas WHERE id = 'cob-x'`);
r = await json(await rotaReabrir.POST(pedir('POST', `/api/faturas/${f1.id}/reabrir`, { motivo: 'Cliente pediu outro centro de custo' }), params(f1.id)));
eq([r.status, r.corpo.fatura.situacao, r.corpo.fatura.conferencia], [200, 'ABERTA', 'NAO_ENVIADA'], 'reaberta com motivo');
eq([(await fatura(5)).situacao, (await itensDa(f1.id)).map(i => i.v).sort((a, b) => a - b)], ['CANCELADA', [5000, 120000]], 'a complementar do mesmo período volta para a reaberta');
eq(r.corpo.eventos.find(e => e.tipo === 'reaberta').motivo, 'Cliente pediu outro centro de custo', 'motivo no histórico');
eq(await faturadoDaVenda('vA'), 125000, 'e o faturado da venda continua batendo');
let recusou = false;
try { await query(`UPDATE fatura_eventos SET motivo = 'x' WHERE tenant_id = $1`, [T]); } catch { recusou = true; }
eq(recusou, true, 'histórico da fatura não aceita UPDATE');

console.log('--- (j) Fechar e cobrar (boleto + Pix da E3) ---');
let emitidas = 0;
let recusar = false;
const adapterFalso = {
  provedor: 'asaas', nome: 'Asaas', capacidades: { boletoComPix: true, carne: true, jurosMulta: true, desconto: true, link: true },
  async acharOuCriarCliente() { return 'cus_1'; },
  async emitir(_c, _cli, p) {
    if (recusar) throw new ErroProvedor('recusa', 'CPF/CNPJ do pagador inválido.', 400);
    emitidas++;
    return { id_externo: `pay_${emitidas}`, status: 'aberta', valor_centavos: p.valor_centavos, vencimento: p.vencimento, referencia: p.referencia, id_carne: '', numero_parcela: 0, url_boleto: `https://b/${emitidas}`, url_fatura: `https://f/${emitidas}`, bruto: {} };
  },
  async consultar() { return null; }, async consultarPorReferencia() { return null; },
  async dadosDePagamento(c) { return { linha_digitavel: '34191.79001 01043.510047 91020.150008 1 99990000120000', codigo_barras: '', pix_copia_cola: '000201PIX', pix_qrcode_url: '', url_boleto: c.url_boleto, url_fatura: c.url_fatura }; },
  async alterar() { throw new Error('não usado'); }, async cancelar() {},
};
srvCob.definirFabricaDeAdapter(async () => adapterFalso);
const titF1 = (await fatura(1)).titulo_id;
const previaAberta = await srvCob.previaDaEmissao(pool, T, { itens: [{ conta_id: titF1 }] }, '2026-11-05');
eq(previaAberta.itens[0].erros, ['A fatura ainda está aberta: feche a fatura antes de cobrar.'], 'a E3 não cobra fatura aberta (o valor ainda muda)');
r = await json(await rotaCobrar.POST(pedir('POST', `/api/faturas/${f1.id}/cobrar`, {}, { 'Idempotency-Key': 'cobrar-f1' }), params(f1.id)));
eq([r.status, r.corpo.ficha.fatura.situacao, r.corpo.cobranca?.status, r.corpo.cobranca?.valor, !!r.corpo.cobranca?.linha_digitavel, !!r.corpo.cobranca?.pix_copia_cola], [200, 'FECHADA', 'aberta', 1350, true, true], 'fechou e emitiu boleto+Pix de 1.350,00 (itens 1.250,00 + a nota de débito que desfez o crédito)');
const cob1 = r.corpo.cobranca.id;
r = await json(await rotaCobrar.POST(pedir('POST', `/api/faturas/${f1.id}/cobrar`, {}, { 'Idempotency-Key': 'cobrar-f1' }), params(f1.id)));
eq([r.status, r.corpo.cobranca?.id, emitidas], [200, cob1, 1], 'a mesma chave: a mesma cobrança, nada emitido em dobro');
r = await json(await rotaCobrar.POST(pedir('POST', `/api/faturas/${f1.id}/cobrar`, {}), params(f1.id)));
eq([r.status, emitidas, (await fatura(1)).situacao], [409, 1, 'FECHADA'], 'sem a chave: a conta com boleto valendo recusa a segunda');
eq(r.corpo.ficha ?? null, null, 'e a fatura continua fechada');
eq((await ficha(f1.id)).corpo.eventos.some(e => e.tipo === 'cobranca_emitida'), true, 'cobrança no histórico da fatura');
// Outro pagante, para provar a recusa do provedor.
await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, tipo, data) VALUES ('cli-r', $1, 'Delta SA', '55666777000145', 'juridica', '{}')`, [T]);
await json(await rotaRegras.POST(pedir('POST', '/api/regras-faturamento', { regra: { ...regraBase, pessoa_id: 'cli-r', periodo: 'MENSAL' } })));
await lancar(vendaManual({ id: 'vR', data: '2026-10-05', valor: 20000, cliente: { id: 'cli-r', nome: 'Delta SA' } }));
const fR = (await todos(`SELECT id FROM faturas WHERE tenant_id = $1 AND pessoa_id = 'cli-r'`, [T]))[0];
recusar = true;
r = await json(await rotaCobrar.POST(pedir('POST', `/api/faturas/${fR.id}/cobrar`, {}, { 'Idempotency-Key': 'cobrar-r' }), params(fR.id)));
const fRdepois = await ficha(fR.id);
eq([fRdepois.corpo.fatura.situacao, fRdepois.corpo.eventos[0].tipo, /CPF\/CNPJ do pagador inválido/.test(fRdepois.corpo.eventos[0].motivo)], ['ABERTA', 'fechamento_desfeito', true], 'o provedor recusou: a fatura volta a ficar aberta, com a frase dele no histórico');
recusar = false;
// Venda com data depois de hoje: a fatura não fecha (a emissão não vem antes da venda).
await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, tipo, data) VALUES ('cli-f', $1, 'Épsilon', '66777888000136', 'juridica', '{}')`, [T]);
await json(await rotaRegras.POST(pedir('POST', '/api/regras-faturamento', { regra: { ...regraBase, pessoa_id: 'cli-f', periodo: 'MENSAL' } })));
await lancar(vendaManual({ id: 'vF', data: '2099-01-10', valor: 10000, cliente: { id: 'cli-f', nome: 'Épsilon' } }));
const fF = (await todos(`SELECT id FROM faturas WHERE tenant_id = $1 AND pessoa_id = 'cli-f'`, [T]))[0];
r = await json(await rotaFechar.POST(pedir('POST', `/api/faturas/${fF.id}/fechar`), params(fF.id)));
eq([r.status, r.corpo.codigo], [409, 'VENDA_FUTURA'], 'item de venda com data futura: a fatura não fecha');

console.log('--- (k) Saldo de pagamento parcial vai para a próxima, explicado ---');
await query(`UPDATE cobrancas SET status = 'paga' WHERE tenant_id = $1 AND titulo_id = $2`, [T, titF1]);
await query(`UPDATE contas_receber SET status = 'PARCIAL', data = data || '{"status":"PARCIAL","valor_recebido":1000,"data_recebimento":"2026-11-16"}' WHERE id = $1`, [titF1]);
r = await json(await rotaReabrir.POST(pedir('POST', `/api/faturas/${f1.id}/reabrir`, { motivo: 'Tentativa de reabrir paga' }), params(f1.id)));
eq([r.status, r.corpo.codigo], [409, 'FATURA_RECEBIDA'], 'fatura com pagamento não reabre');
r = await json(await rotaSaldo.POST(pedir('POST', `/api/faturas/${f1.id}/saldo`), params(f1.id)));
eq([r.status, r.corpo.situacao_visivel, r.corpo.titulo.valor_final, r.corpo.titulo.status], [200, 'PAGA', 1000, 'RECEBIDO'], 'a fatura fica recebida pelo que entrou');
const notaSaldo = (await notasDa(f2.id)).find(n => n.chave === `saldo:${f1.id}`);
eq([notaSaldo?.tipo, notaSaldo?.v, /pagos R\$ 1\.000,00 de R\$ 1\.350,00 em 16\/11\/2026/.test(notaSaldo?.motivo ?? '')], ['DEBITO', 35000, true], 'o restante (350,00) é nota de débito explicada na próxima fatura');
r = await json(await rotaSaldo.POST(pedir('POST', `/api/faturas/${f1.id}/saldo`), params(f1.id)));
eq([r.status, (await todos(`SELECT 1 FROM fatura_ajustes WHERE tenant_id = $1 AND chave = $2`, [T, `saldo:${f1.id}`])).length], [409, 1], 'repetir não leva o saldo duas vezes');

console.log('--- (l) Conferência por arquivo, retenções e exportação ---');
const vendaB = await um(`SELECT data->>'numero' AS n FROM vendas_crm WHERE tenant_id = $1 AND id = 'vB'`, [T]);
r = await json(await rotaConferencia.POST(pedir('POST', `/api/faturas/${f2.id}/conferencia`, { arquivo: 'alfa.xlsx', linhas: [{ referencia: vendaB.n, valor_centavos: 50000 }, { referencia: 'LOCVC', valor_centavos: 39000 }, { referencia: 'ZZZ' }] }), params(f2.id)));
eq([r.status, r.corpo.relatorio.conferidos, r.corpo.relatorio.itens.map(i => i.resultado).sort(), r.corpo.relatorio.linhas_sem_item.map(l => l.referencia)], [200, 1, ['CONFERIDO', 'VALOR_DIFERENTE'], ['ZZZ']], 'B bate pelo número da venda; C pelo localizador com valor diferente; ZZZ sobra');
eq(r.corpo.ficha.itens.filter(i => i.conferido).length, 1, 'o item conferido fica marcado');
r = await json(await rotaFatura.PATCH(pedir('PATCH', `/api/faturas/${f2.id}`, { retencoes: { ir: 1.5, base: 'TOTAL' }, modelo: 'PERSONALIZADA', campos: ['venda', 'passageiros', 'valor', 'nada'] }), params(f2.id)));
// Itens 40.000 + 50.000; notas: crédito 2.000, crédito 10.000, débito 35.000 (saldo) → bruto 113.000; IR 1,5% = 1.695.
eq([r.status, r.corpo.totais.bruto, r.corpo.totais.total_retencoes, r.corpo.totais.liquido, r.corpo.fatura.campos], [200, 113000, 1695, 111305, ['venda', 'passageiros', 'valor']], 'retenção na fonte tira do total que o cliente paga');
eq((await um(`SELECT data->>'valor_final' AS v FROM contas_receber WHERE id = $1`, [f2.titulo_id])).v, '1113.05', 'e a conta a receber da fatura passa a ser o líquido');
let resp = await rotaExportar.GET(pedir('GET', `/api/faturas/${f2.id}/exportar?formato=csv`), params(f2.id));
const csv = await resp.text();
eq([resp.status, resp.headers.get('content-type'), csv.split('\r\n')[0].startsWith('Fatura;Vencimento;Cliente;Tipo;Venda'), /Total a pagar.*;1113,05/.test(csv)], [200, 'text/csv; charset=utf-8', true, true], 'CSV para o sistema do cliente, com o total a pagar');
resp = await rotaExportar.GET(pedir('GET', `/api/faturas/${f2.id}/exportar?formato=xlsx`), params(f2.id));
const bytes = new Uint8Array(await resp.arrayBuffer());
eq([resp.status, String.fromCharCode(bytes[0], bytes[1])], [200, 'PK'], 'XLSX de verdade');

console.log('--- (m) Recalcular vencimentos ---');
r = await json(await rotaRegra.PUT(pedir('PUT', `/api/regras-faturamento/${regraId}`, { regra: { ...regraBase, periodo: 'MENSAL', prazo_dias: 10 } }), params(regraId)));
eq([r.status, r.corpo.regra.periodo], [200, 'MENSAL'], 'regra passa a mensal, vence 10 dias depois');
eq((await faturas()).find(f => f.numero === 2).venc, '2026-11-03', 'mudar a regra não mexe nas faturas sozinho');
r = await json(await rotaRecalcular.POST(pedir('POST', '/api/regras-faturamento/recalcular', { pessoa_id: 'cli-emp' })));
eq([r.corpo.aplicado, r.corpo.mudancas.map(m => [m.de.numero, m.para.vencimento]).sort()], [false, [[2, '2026-11-10'], [2, '2026-11-10']]], 'prévia: os 2 itens da Nº 2 (outubro) iriam para 10/11');
r = await json(await rotaRecalcular.POST(pedir('POST', '/api/regras-faturamento/recalcular', { pessoa_id: 'cli-emp', aplicar: true })));
fs = await faturas();
const nova = fs.find(f => f.venc === '2026-11-10' && f.situacao === 'ABERTA');
eq([r.corpo.aplicado, (await fatura(2)).situacao, (await itensDa(nova.id)).length, (await notasDa(nova.id)).length], [true, 'CANCELADA', 2, 3], 'aplicado: itens e notas vão para a fatura mensal; a quinzenal vazia é cancelada');
r = await json(await rotaRecalcular.POST(pedir('POST', '/api/regras-faturamento/recalcular', { pessoa_id: 'cli-emp', aplicar: true })));
eq(r.corpo.mudancas.length, 0, 'recalcular de novo: nada muda');

console.log('--- (n) O cliente confere no portal ---');
const link = await criarLink(pool, T, 'cli-emp', 'u-ADMIN');
const token = link.caminho.split('/c/')[1];
const portalFat = async () => json(await rotaPortalFaturas.GET(pedir('GET', `/api/portal/${token}/faturas`), { params: Promise.resolve({ token }) }));
r = await portalFat();
eq([r.status, r.corpo.faturas.map(f => [f.numero, f.situacao])], [200, [[1, 'PAGA']]], 'no portal só aparece a fatura fechada (a aberta ainda muda)');
const ln = await acharLink(pool, token);
const portal = await lerPortal(pool, ln, '2026-11-05');
const titulosNoPortal = [...portal.em_aberto, ...portal.pagas].map(i => i.ref);
eq([titulosNoPortal.includes(nova.titulo_id), titulosNoPortal.includes(titF1)], [false, true], 'a conta da fatura aberta não aparece para pagar; a fechada sim');
const responder = async (id, corpo, cab) => json(await rotaPortalFatura.POST(pedir('POST', `/api/portal/${token}/faturas/${id}`, corpo, cab), { params: Promise.resolve({ token, id }) }));
r = await json(await rotaPortalFatura.POST(new Request(`http://localhost/api/portal/${token}/faturas/${f1.id}`, { method: 'POST', body: 'acao=aprovar', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), { params: Promise.resolve({ token, id: f1.id }) }));
eq(r.status, 415, 'formulário de outro site não passa (só JSON)');
r = await responder(f1.id, { acao: 'contestar', itens: [{ conta_id: cA.id, motivo: 'ok' }] });
eq(r.status, 400, 'contestar sem dizer o que está errado: 400');
r = await responder(f1.id, { acao: 'contestar', nome: 'Dora (financeiro)', itens: [{ conta_id: cA.id, motivo: 'Este hotel foi cancelado pela empresa' }] });
eq([r.status, r.corpo.fatura.conferencia, r.corpo.fatura.itens.find(i => i.conta_id === cA.id).contestacao], [200, 'CONTESTADA', 'Este hotel foi cancelado pela empresa'], 'o cliente contesta o item');
const sino = await todos(`SELECT tipo, titulo, link FROM notificacoes WHERE tenant_id = $1 AND tipo = 'FATURA_CONTESTADA'`, [T]);
eq([sino.length, sino[0]?.link], [1, `/financeiro-ag/faturas/${f1.id}`], 'a agência é avisada no sino, com o link da fatura');
r = await acao(f1.id, { acao: 'responder', conta_id: cA.id, resposta: 'Cancelamento entra como nota de crédito na próxima fatura.' });
eq([r.status, r.corpo.fatura.conferencia], [200, 'AGUARDANDO'], 'respondida a contestação, a fatura volta para o cliente conferir');
r = await responder(f1.id, { acao: 'aprovar', nome: 'Dora' });
eq([r.status, r.corpo.fatura.conferencia], [200, 'APROVADA'], 'o cliente aprova');
eq((await todos(`SELECT 1 FROM notificacoes WHERE tenant_id = $1 AND tipo = 'FATURA_APROVADA'`, [T])).length, 1, 'e a agência fica sabendo');
r = await responder(nova.id, { acao: 'aprovar' });
eq(r.status, 404, 'fatura aberta não se aprova pelo portal');

console.log('--- (o) Isolamento entre agências ---');
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('a2', $1, '{}')`, [T2]);
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', T2);
r = await ficha(f1.id);
eq(r.status, 404, 'a outra agência não abre a fatura');
r = await json(await rotaFaturas.GET(pedir('GET', '/api/faturas?situacao=')));
eq(r.corpo.faturas.length, 0, 'nem vê na lista');
r = await acao(nova.id, { acao: 'tirar', conta_ids: [contaC] });
eq(r.status, 404, 'nem mexe nos itens');
r = await json(await rotaRegras.GET(pedir('GET', '/api/regras-faturamento')));
eq(r.corpo.regras.length, 0, 'nem nas regras');
r = await json(await rotaAlocar.POST(pedir('POST', '/api/faturas/alocar', {})));
eq([r.corpo.alocados.length, (await faturas(T2)).length], [0, 0], 'montar faturas lá não toca nas daqui');
const link2 = await criarLink(pool, T2, 'cli-emp2', 'u');
const token2 = link2.caminho.split('/c/')[1];
r = await json(await rotaPortalFatura.POST(pedir('POST', `/api/portal/${token2}/faturas/${f1.id}`, { acao: 'aprovar' }), { params: Promise.resolve({ token: token2, id: f1.id }) }));
eq(r.status, 404, 'o link de outro cliente não alcança a fatura');
como('ADMIN');
r = await json(await rotaFaturas.GET(pedir('GET', '/api/faturas?situacao=em_aberto&pessoa_id=cli-emp')));
eq(r.corpo.faturas.map(f => f.numero), [nova.numero], 'lista do cliente: em aberto só a mensal nova');

console.log('--- (p) Tarefa de hora em hora: o pagante que ganhou regra depois ---');
const { tarefaMontarFaturas } = await import('../src/lib/fatura-tarefa.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const ctx = { exec: pool, emTransacao, agora: new Date('2026-11-05T15:00:00Z'), restanteMs: () => 60_000 };
eq(await tarefaMontarFaturas.agencias(ctx), [], 'sem regra para a Beta: nada a fazer');
await json(await rotaRegras.POST(pedir('POST', '/api/regras-faturamento', { regra: { ...regraBase, pessoa_id: 'cli-sem', periodo: 'MENSAL', prazo_dias: 5 } })));
eq(await tarefaMontarFaturas.agencias(ctx), [T], 'com a regra nova, a agência entra na tarefa');
eq(await tarefaMontarFaturas.executar(ctx, T), { alocados: 1, sem_regra: 0, faturas: 1 }, 'o item solto da Beta entra na fatura de outubro');
eq(await tarefaMontarFaturas.executar(ctx, T), { alocados: 0, sem_regra: 0, faturas: 0 }, 'rodar de novo não muda nada');
eq((await todos(`SELECT vencimento::text AS v FROM faturas WHERE tenant_id = $1 AND pessoa_id = 'cli-sem'`, [T])).map(x => x.v), ['2026-11-05'], 'outubro + 5 dias = 05/11');

console.log('--- (q) Nota de débito da venda ---');
r = await json(await rotaNotaDebito.GET(pedir('GET', '/api/vendas/completa/vB/nota-de-debito'), params('vB')));
eq([r.status, r.corpo.nota.totais.a_faturar_centavos, r.corpo.nota.pagamentos[0].forma, r.corpo.nota.produtos[0].localizador, r.corpo.sacado.nome, r.corpo.emitente.nome],
  [200, 50000, 'Faturar', 'LOCvB', 'Empresa Alfa', 'Agência Teste'], 'nota de débito com o valor a faturar, a forma, o localizador, o pagante e a agência');
eq(/antes de a fatura ser emitida/.test(r.corpo.nota.aviso), true, 'com o aviso para conferir antes do faturamento');

console.log('--- Venda inteira cancelada com o item numa fatura aberta ---');
{
  como('ADMIN');
  const { cancelarContasDaVenda } = await import('../src/lib/venda-cancelamento.ts');
  await lancar(vendaManual({ id: 'vCanc', data: '2026-11-03', valor: 30000 }));
  const antes = await todos(`SELECT fi.fatura_id, f.situacao FROM fatura_itens fi JOIN faturas f ON f.tenant_id = fi.tenant_id AND f.id = fi.fatura_id WHERE fi.tenant_id = $1 AND fi.venda_id = $2`, [T, 'vCanc']);
  const r1 = await cancelarContasDaVenda(pool, 'vCanc', T);
  const depois = await todos(`SELECT 1 FROM fatura_itens WHERE tenant_id = $1 AND venda_id = $2`, [T, 'vCanc']);
  const conta = (await contaFaturar('vCanc'))[0];
  eq([antes.length > 0 && antes.every(a => a.situacao === 'ABERTA'), depois.length, conta.status, r1.em_fatura_fechada], [true, 0, 'CANCELADO', []],
    'o item sai da fatura aberta e a conta é cancelada (a fatura deixa de cobrar)');
}

globalThis.__SESSAO_DE_TESTE__ = null;
console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
