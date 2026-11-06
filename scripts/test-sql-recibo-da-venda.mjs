/**
 * Recibo da venda, recibo consolidado da fatura, notas e retenção na ficha
 * e o texto do recibo em Configurações › Vendas (E7, 06/11/2026), contra um
 * Postgres real (PGlite) e o código DE PRODUÇÃO (rotas com sessão de teste).
 *
 * Prova: o PUT da configuração guarda só a parte enviada (a tela antiga não
 * apaga o texto do recibo; chave de outra parte fica); recibo recusado sem
 * pagamento; parcial com quanto falta; por pagante; estorno tira do recibo;
 * vendedor só vê o da venda dele; outra agência não vê; notas da venda pela
 * venda e pela conta; retenção; fatura aberta/sem recebimento recusadas,
 * paga em parte = parcial, quitada = total; a venda faturada lê a fatura.
 *
 * Uso: node --no-warnings scripts/test-sql-recibo-da-venda.mjs
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
process.env.JWT_SECRET = 'segredo-de-teste-recibo';

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
  CREATE TABLE notas_fiscais (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_receber_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RASCUNHO', referencia_gateway TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
// Fora do bundler, os subcaminhos do pacote next (next/link...) precisam do .js.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, n) {
    if (/^next\\/(link|navigation|image)$/.test(s)) return n(s + '.js', c);
    return n(s, c);
  }`));

const { VENDA_SCHEMA_SQL } = await import('../src/lib/venda-schema.ts');
const { FATURA_SCHEMA_SQL } = await import('../src/lib/fatura-schema.ts');
const { BAIXAS_SCHEMA_SQL, registrarBaixas, estornarBaixa } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
for (const sql of [BAIXAS_SCHEMA_SQL, PERIODO_SCHEMA_SQL, COBRANCA_SCHEMA_SQL, PERMISSOES_SCHEMA_SQL, VENDA_SCHEMA_SQL, FATURA_SCHEMA_SQL, RAZAO_SCHEMA_SQL]) await pg.exec(sql);
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');

const rotaVendas = await import('../src/app/api/vendas/completa/route.ts');
const rotaRecibo = await import('../src/app/api/vendas/completa/[id]/recibo/route.ts');
const rotaFiscal = await import('../src/app/api/vendas/completa/[id]/fiscal/route.ts');
const rotaConfig = await import('../src/app/api/config/vendas/route.ts');
const rotaRegras = await import('../src/app/api/regras-faturamento/route.ts');
const rotaFaturas = await import('../src/app/api/faturas/route.ts');
const rotaFechar = await import('../src/app/api/faturas/[id]/fechar/route.ts');
const rotaReciboFatura = await import('../src/app/api/faturas/[id]/recibo/route.ts');

const T = 'ag-recibo';
const T2 = 'ag-outra';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const sessao = (perfil, tenant = T) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const params = id => ({ params: Promise.resolve({ id }) });
const como = (perfil, tenant = T) => { globalThis.__SESSAO_DE_TESTE__ = sessao(perfil, tenant); };
const ctxBaixa = { tenantId: T, usuarioId: 'u1', usuarioNome: 'Ana', origem: 'tela', politica: null };
const baixar = (id, valor, data, extra = {}) => emTransacao(exec => registrarBaixas(exec, ctxBaixa, [{ titulo_tabela: 'contas_receber', titulo_id: id, conta_bancaria_id: 'b1', forma: 'Pix', valor, data, ...extra }], { gravar: true }));
const recibo = async (id, pagante) => json(await rotaRecibo.GET(pedir('GET', `/api/vendas/completa/${id}/recibo${pagante ? `?pagante=${encodeURIComponent(pagante)}` : ''}`), params(id)));
const contasDa = async vendaId => (await todos(`SELECT id, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 ORDER BY data->>'origem_item_id', (data->>'parcela_numero')::int`, [T, vendaId])).map(r => ({ ...r.data, id: r.id }));

await query(`INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, tipo, data) VALUES
  ('cli-ana', $1, 'Ana Lima', '12345678909', 'fisica', '{}'),
  ('cli-emp', $1, 'Empresa Alfa', '11222333000181', 'juridica', '{}')`, [T]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('a1', $1, '{"razao_social":"Viagens Teste Ltda","cnpj":"44555666000154","endereco":{"cidade":"Campinas"}}')`, [T]);
await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ('b1', $1, 'Banco Inter', '{"nome":"Banco Inter","saldo_inicial":0,"saldo_atual":0}')`, [T]);
como('ADMIN');

console.log('--- Configurações › Vendas: texto do recibo ---');
let r = await json(await rotaConfig.GET());
eq([r.corpo.recibo, r.corpo.receita.componentes.COMISSAO], [{ texto: '', complemento: '' }, true], 'sem nada gravado: texto padrão (vazio) e receita padrão');
r = await json(await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { recibo: { texto: 'Recebemos de {pagante} {valor} ({valor_extenso}).', complemento: 'Plantão: (19) 0000-0000' } })));
eq([r.status, r.corpo.recibo.texto, r.corpo.receita.componentes.COMISSAO], [200, 'Recebemos de {pagante} {valor} ({valor_extenso}).', true], 'grava só o recibo; a receita fica');
r = await json(await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { receita: { componentes: { COMISSAO: false } } })));
eq([r.corpo.recibo.complemento, r.corpo.receita.componentes.COMISSAO], ['Plantão: (19) 0000-0000', false], 'a tela antiga (só receita) não apaga o texto do recibo');
await query(`UPDATE agencia SET data = jsonb_set(data, '{venda_config,outra_chave}', '"fica"') WHERE tenant_id = $1`, [T]);
await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { receita: { componentes: { COMISSAO: true } } }));
eq((await um(`SELECT data->'venda_config'->>'outra_chave' AS c FROM agencia WHERE tenant_id = $1`, [T])).c, 'fica', 'chave de outra parte em venda_config não some');
como('VENDEDOR');
eq((await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { recibo: { texto: 'x' } }))).status, 403, 'só administrador muda o texto');
como('ADMIN');

console.log('--- Recibo da venda ---');
r = await json(await rotaVendas.POST(pedir('POST', '/api/vendas/completa', { venda: {
  id: 'v1', data_venda: '2026-11-01', cliente: { id: 'cli-ana', nome: 'Ana Lima' },
  produtos: [{ id: 'p1', tipo: 'PACOTE', descricao: 'Pacote Lisboa', fornecedor: { id: 'f1', nome: 'Operadora Sol' }, data_inicio: '2027-01-10', data_fim: '2027-01-17', localizador: 'SOL9',
    passageiros: [{ id: 'x', nome: 'Ana Lima', tarifa_centavos: 300000 }] }],
  pagamentos: [
    { id: 'g1', forma: 'BOLETO', valor_centavos: 200000, parcelas: 2, primeiro_vencimento: '2026-11-10' },
    { id: 'g2', forma: 'PIX', valor_centavos: 100000, pagante: { id: 'cli-emp', nome: 'Empresa Alfa' } },
  ],
} })));
eq(r.status, 201, 'venda com dois pagantes lançada');
let rc = await recibo('v1');
eq([rc.status, /Ainda não entrou nenhum pagamento de Ana Lima/.test(rc.corpo.error), rc.corpo.pagantes.length], [422, true, 2], 'sem pagamento recebido: 422 com o motivo e os pagantes');
const crs = await contasDa('v1');
const parcela1 = crs.find(c => c.venda_pagamento_id === 'g1' && Number(c.parcela_numero) === 1);
await baixar(parcela1.id, 1000, '2026-11-10', { forma: 'Boleto' });
rc = await recibo('v1');
eq([rc.status, rc.corpo.recibo.valor, rc.corpo.recibo.parcial, rc.corpo.recibo.em_aberto, rc.corpo.recibo.pagador.documento], [200, 1000, true, 1000, '123.456.789-09'], 'parcela 1 paga: recibo parcial de Ana, falta 1.000');
eq(rc.corpo.recibo.declaracao, 'Recebemos de Ana Lima (CPF/CNPJ 123.456.789-09) R$ 1.000,00 (mil reais).', 'o texto da agência, preenchido');
eq([rc.corpo.recibo.complemento, rc.corpo.recibo.emitente.nome, rc.corpo.recibo.cidade], ['Plantão: (19) 0000-0000', 'Viagens Teste Ltda', 'Campinas'], 'complemento e cabeçalho da agência');
eq(rc.corpo.recibo.recebimentos.map(l => [l.data, l.forma, l.referencia, l.valor]), [['2026-11-10', 'Boleto', 'Parcela 1/2', 1000]], 'o recebimento com a parcela');
const empresa = rc.corpo.pagantes.find(p => p.nome === 'Empresa Alfa');
rc = await recibo('v1', empresa.chave);
eq([rc.status, /Empresa Alfa/.test(rc.corpo.error)], [422, true], 'Empresa Alfa ainda não pagou: sem recibo dela');
const pixEmp = crs.find(c => c.venda_pagamento_id === 'g2');
const bEmp = await baixar(pixEmp.id, 1000, '2026-11-11');
rc = await recibo('v1', empresa.chave);
eq([rc.status, rc.corpo.recibo.numero, rc.corpo.recibo.valor, rc.corpo.recibo.parcial, rc.corpo.recibo.pagador.documento], [200, `RV-${(await um(`SELECT data->>'numero' AS n FROM vendas_crm WHERE id = 'v1'`)).n}-2`.toUpperCase(), 1000, false, '11.222.333/0001-81'], 'recibo da Empresa Alfa, quitado, com o número dela');
await emTransacao(exec => estornarBaixa(exec, { tenantId: T, usuarioNome: 'Ana' }, bEmp.itens[0].baixa_id, { motivo: 'Pix devolvido ao cliente', data: '2026-11-12' }));
rc = await recibo('v1', empresa.chave);
eq(rc.status, 422, 'estornado o Pix: o recibo dela some');

console.log('--- Quem pode ver ---');
await query(`UPDATE vendas_crm SET vendedor_id = 'u-outro', data = data || '{"vendedor_id":"u-outro"}' WHERE id = 'v1'`);
como('VENDEDOR');
eq((await recibo('v1')).status, 404, 'vendedor sem a venda: 404');
await query(`UPDATE vendas_crm SET vendedor_id = 'u-VENDEDOR', data = data || '{"vendedor_id":"u-VENDEDOR"}' WHERE id = 'v1'`);
eq((await recibo('v1')).status, 200, 'vendedor dono da venda vê o recibo');
como('ADMIN', T2);
eq((await recibo('v1')).status, 404, 'outra agência: 404');
como('ADMIN');

console.log('--- Notas e retenção na ficha ---');
await query(`INSERT INTO notas_fiscais (id, tenant_id, conta_receber_id, venda_id, status, data) VALUES
  ('n1', $1, '', 'v1', 'AUTORIZADA', '{"numero":"88","valor_servicos":120,"tomador":{"razao_social":"Ana Lima"},"autorizada_em":"2026-11-10T12:00:00Z"}'),
  ('n2', $1, $2, '', 'PROCESSANDO', '{"valor_servicos":30}'),
  ('n3', $3, '', 'v1', 'AUTORIZADA', '{"numero":"99","valor_servicos":999}')`, [T, parcela1.id, T2]);
await query(`UPDATE contas_receber SET data = data || '{"retencao_na_fonte":{"valor_bruto":1000,"total":61.5,"IR":15,"CSLL":10,"PIS":6.5,"COFINS":30}}' WHERE id = $1`, [pixEmp.id]);
r = await json(await rotaFiscal.GET(pedir('GET', '/api/vendas/completa/v1/fiscal'), params('v1')));
eq([r.status, r.corpo.notas.map(n => [n.id, n.rotulo]).sort(), r.corpo.totais.autorizado, r.corpo.totais.retido], [200, [['n1', 'Autorizada'], ['n2', 'Na prefeitura']], 120, 61.5], 'as notas da venda (pela venda e pela conta), sem a de outra agência; a retenção da conta');
como('VENDEDOR');
eq((await rotaFiscal.GET(pedir('GET', '/api/vendas/completa/v1/fiscal'), params('v1'))).status, 403, 'sem ver o financeiro da venda: 403');
como('ADMIN');

console.log('--- Recibo consolidado da fatura ---');
r = await json(await rotaRegras.POST(pedir('POST', '/api/regras-faturamento', { regra: { pessoa_tipo: 'CLIENTE', pessoa_id: 'cli-emp', periodo: 'MENSAL', prazo_dias: 10, dia_nao_util: 'PROXIMO' } })));
eq(r.status, 201, 'regra mensal da Empresa Alfa');
for (const [id, valor] of [['vf1', 100000], ['vf2', 50000]]) {
  await rotaVendas.POST(pedir('POST', '/api/vendas/completa', { venda: {
    id, data_venda: '2026-10-05', cliente: { id: 'cli-emp', nome: 'Empresa Alfa' },
    produtos: [{ id: `p-${id}`, tipo: 'HOSPEDAGEM', descricao: `Hotel ${id}`, fornecedor: { id: 'f1', nome: 'Hotel' }, passageiros: [{ id: `x-${id}`, nome: 'Bia', tarifa_centavos: valor }] }],
    pagamentos: [{ id: `g-${id}`, forma: 'FATURAR', valor_centavos: valor }],
  } }));
}
const fat = await um(`SELECT id, titulo_id, numero FROM faturas WHERE tenant_id = $1 ORDER BY numero LIMIT 1`, [T]);
const reciboFatura = async () => json(await rotaReciboFatura.GET(pedir('GET', `/api/faturas/${fat.id}/recibo`), params(fat.id)));
r = await reciboFatura();
eq([r.status, r.corpo.error], [422, 'A fatura ainda está aberta. Feche e receba a fatura para tirar o recibo.'], 'fatura aberta: sem recibo');
eq((await rotaFechar.POST(pedir('POST', `/api/faturas/${fat.id}/fechar`), params(fat.id))).status, 200, 'fatura fechada');
r = await reciboFatura();
eq([r.status, /ainda não tem recebimento/.test(r.corpo.error)], [422, true], 'fechada sem recebimento: sem recibo');
await baixar(fat.titulo_id, 1000, '2026-11-16', { forma: 'Boleto' });
r = await reciboFatura();
eq([r.status, r.corpo.numero, r.corpo.valor, r.corpo.parcial, r.corpo.em_aberto, r.corpo.recebimentos.map(l => [l.forma, l.conta, l.valor])], [200, `RF-${String(fat.numero).padStart(4, '0')}`, 1000, true, 500, [['Boleto', 'Banco Inter', 1000]]], 'pago em parte: recibo parcial com a conta do recebimento');
eq(/^Fatura Nº \d+, período de 01\/10\/2026 a 31\/10\/2026, vendas /.test(r.corpo.referente), true, 'referente: número, período e as vendas');
await baixar(fat.titulo_id, 500, '2026-11-20');
r = await reciboFatura();
eq([r.corpo.valor, r.corpo.parcial, r.corpo.recebimentos.length, r.corpo.valor_por_extenso], [1500, false, 2, 'Mil e quinhentos reais'], 'quitada: os dois recebimentos e o total por extenso');
// A venda faturada mostra o recebimento pela fatura no recibo dela.
rc = await recibo('vf1');
eq([rc.status, rc.corpo.recibo?.recebimentos.map(l => l.forma)], [200, [`Fatura Nº ${fat.numero}`]], 'o recibo da venda faturada lê o pagamento da fatura');
como('ADMIN', T2);
eq((await rotaReciboFatura.GET(pedir('GET', `/api/faturas/${fat.id}/recibo`), params(fat.id))).status, 404, 'outra agência: 404');

console.log('--- As folhas desenham ---');
const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { FolhaDoReciboDaVenda, FolhaDoReciboDaFatura } = await import('../src/components/financeiro/cobranca/FolhaDoReciboDaVenda.tsx');
como('ADMIN');
const rv = (await recibo('v1')).corpo.recibo;
const htmlVenda = renderToStaticMarkup(React.createElement(FolhaDoReciboDaVenda, { recibo: rv }));
eq(['RECIBO', 'Recibo parcial', 'Ainda falta pagar', 'Pacote Lisboa', '10/01/2027 a 17/01/2027', 'Localizador SOL9', 'Recebido pela agência', 'Total recebido', 'Plantão: (19) 0000-0000', 'Campinas'].filter(t => !htmlVenda.includes(t)), [], 'recibo da venda: faixa de parcial, serviços, pagamentos, complemento e assinatura');
const rfat = (await reciboFatura()).corpo;
const htmlFatura = renderToStaticMarkup(React.createElement(FolhaDoReciboDaFatura, { recibo: rfat }));
eq(['Recebemos de', 'Empresa Alfa', 'mil e quinhentos reais', 'Banco Inter', 'Recebimentos', 'Total recebido'].filter(t => !htmlFatura.includes(t)), [], 'recibo da fatura: declaração por extenso e cada recebimento');
eq(htmlFatura.includes('Recibo parcial'), false, 'quitada: sem a faixa de parcial');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
