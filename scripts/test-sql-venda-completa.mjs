/**
 * A venda completa (E5, parte A) contra um Postgres real (PGlite), rodando o
 * código DE PRODUÇÃO: o webhook do CRM (VENDA_FECHADA v2), as rotas da ficha
 * da venda com sessão de teste, o esquema e a regeração das contas.
 *
 * O que se prova:
 *   (a) esquema idempotente; histórico da venda não aceita UPDATE;
 *   (b) VENDA_FECHADA v2: as contas certas para cada forma de pagamento,
 *       fornecedores resolvidos, pendência do crédito do cliente;
 *       reenviar dá as MESMAS contas (mesmos ids, atualizadas no lugar);
 *   (c) venda lançada à mão pelo mesmo modelo e gerador (rota POST/PUT/GET);
 *   (d) receita aberta por componente bate com Configurações › Vendas;
 *   (e) posição com baixa parcial e cobrança emitida; conta com cobrança
 *       valendo não é mexida pela regeração;
 *   (f) fechar/reabrir com direito e motivo; venda fechada recusa mudança
 *       (tela e CRM); reabrir não apaga conta baixada e a diferença vai para
 *       as contas livres;
 *   (g) a rota antiga de venda não regera a venda completa.
 *
 * Uso: node --no-warnings scripts/test-sql-venda-completa.mjs
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
  CREATE UNIQUE INDEX idx_crm_eventos_entrada_idem_tenant ON crm_eventos_entrada(tenant_id, idempotency_key);
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_clientes_external_id ON clientes(tenant_id, external_id) WHERE external_id IS NOT NULL AND external_id <> '';
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
  CREATE UNIQUE INDEX uq_plataformas_transacoes ON plataformas_transacoes(tenant_id, plataforma, id_transacao);
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
await pg.exec(VENDA_SCHEMA_SQL); // idempotente: roda a cada boot
await pg.exec(RAZAO_SCHEMA_SQL);

const { processarEventoCRM } = await import('../src/lib/crm-integration.ts');
const srv = await import('../src/lib/venda-servidor.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const rotaNova = await import('../src/app/api/vendas/completa/route.ts');
const rotaPrevia = await import('../src/app/api/vendas/completa/previa/route.ts');
const rotaUma = await import('../src/app/api/vendas/completa/[id]/route.ts');
const rotaFechar = await import('../src/app/api/vendas/completa/[id]/fechar/route.ts');
const rotaReabrir = await import('../src/app/api/vendas/completa/[id]/reabrir/route.ts');
const rotaConfig = await import('../src/app/api/config/vendas/route.ts');
const rotaAntiga = await import('../src/app/api/vendas-crm/route.ts');

const T = 'agencia-e5';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const sessao = (perfil, userId = `u-${perfil}`) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const params = id => ({ params: Promise.resolve({ id }) });
const contas = async (tabela, vendaId) => (await todos(`SELECT id, status, data FROM ${tabela} WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 ORDER BY data->>'origem_item_id', (data->>'parcela_numero')::int`, [T, vendaId]))
  .map(r => ({ id: r.id, status: r.data.status, ...r.data }));

console.log('--- (a) Esquema ---');
const tabelas = (await todos(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'venda%' ORDER BY 1`)).map(r => r.table_name);
eq(tabelas, ['venda_componentes', 'venda_eventos', 'venda_pagamentos', 'venda_passageiros', 'venda_pendencias', 'venda_produtos', 'vendas_crm', 'vendas_modelo'], 'tabelas da venda completa');

console.log('--- (b) VENDA_FECHADA v2 ---');
const fornecedor = (id, nome) => ({ fornecedor_id: `sup_${id}`, crm_supplier_id: id, fornecedor_nome: nome });
const payloadV2 = (o = {}) => ({
  versao_contrato: 2, versao_venda: 2,
  crm_venda_id: 'deal_v2', cliente_id: 'contact_9', cliente_nome: 'Carla Dias', cliente_email: 'carla@x.com',
  data_venda: '2026-11-01', valor_total: 5760, custo_total: 5055,
  fornecedores: [{ ...fornecedor('11', 'Hotel Mar'), valor_custo: 1900, valor_venda: 2360 }, { ...fornecedor('44', 'Consolidadora'), valor_custo: 3155, valor_venda: 3400 }],
  venda: {
    intermediario: fornecedor('33', 'Agência Parceira'),
    produtos: [
      {
        ref: 'h1', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar 4 noites', quem_cobra: 'AGENCIA', moeda: 'BRL', cambio: 1,
        fornecedor: fornecedor('11', 'Hotel Mar'), localizador: 'HM123', data_inicio: '2026-12-20', data_fim: '2026-12-24',
        passageiros: [{ ref: 'a', nome: 'Carla Dias', tipo: 'ADT', tarifa: 1000, taxas: 50 }, { ref: 'b', nome: 'Davi Dias', tipo: 'ADT', tarifa: 1000, taxas: 50 }],
        componentes: [{ tipo: 'MARKUP', valor: 200 }, { tipo: 'RAV', valor: 30, passageiro_ref: 'a' }, { tipo: 'RAV', valor: 30, passageiro_ref: 'b' }, { tipo: 'COMISSAO', percentual: 10 }],
      },
      {
        ref: 'a1', tipo: 'AEREO', descricao: 'GRU-LIS', quem_cobra: 'FORNECEDOR', moeda: 'BRL',
        fornecedor: fornecedor('22', 'Cia Aérea'), representante: fornecedor('44', 'Consolidadora'),
        quantidade: 1, valor_unitario: 3000, taxas: 300,
        componentes: [{ tipo: 'TAXA_DU', valor: 100 }, { tipo: 'COMISSAO', valor: 150 }, { tipo: 'TAXA_CC', valor: 5 }, { tipo: 'REPASSE_INTERMEDIARIO', valor: 50 }],
      },
    ],
    pagamentos: [
      { ref: 'pix', forma: 'PIX', valor: 500 },
      { ref: 'bol', forma: 'BOLETO', valor: 1000, parcelas: 2, primeiro_vencimento: '2026-12-10' },
      { ref: 'car', forma: 'CARTAO', valor: 360, parcelas: 3, cartao_tipo: 'credito' },
      { ref: 'cre', forma: 'CREDITO_CLIENTE', valor: 200, venda_origem_credito: 'VND-0007' },
      { ref: 'fat', forma: 'FATURAR', valor: 300 },
    ],
  },
  ...o,
});
let r = await processarEventoCRM('VENDA_FECHADA', payloadV2(), 'v2-1', T);
eq([r.processado, /pelo contrato v2/.test(r.acao)], [true, true], 'v2 processada pelo contrato novo');
const vid = (await um(`SELECT id FROM vendas_crm WHERE tenant_id = $1 AND data->>'crm_venda_id' = 'deal_v2'`, [T])).id;
const nomeDe = async id => (await um(`SELECT nome_fantasia FROM fornecedores_crm WHERE id = $1`, [id]))?.nome_fantasia;
let cr = await contas('contas_receber', vid);
let cp = await contas('contas_pagar', vid);
eq(cr.map(c => [c.origem, c.valor_final, c.data_vencimento, c.forma_recebimento, c.parcela_numero]), [
  ['COMISSAO_FORNECEDOR', 245, '2026-12-01', '', 1],
  ['VENDA', 500, '2026-12-10', 'BOLETO', 1], ['VENDA', 500, '2027-01-10', 'BOLETO', 2],
  ['VENDA', 120, '2026-12-01', 'CARTAO_CREDITO', 1], ['VENDA', 120, '2027-01-01', 'CARTAO_CREDITO', 2], ['VENDA', 120, '2027-02-01', 'CARTAO_CREDITO', 3],
  ['VENDA', 300, '2026-12-01', 'FATURAR', 1],
  ['VENDA', 500, '2026-11-01', 'PIX', 1],
], 'a receber: cada forma vira as suas contas; comissão da consolidadora');
eq(await nomeDe(cr[0].cliente_id), 'Consolidadora', 'a comissão é cobrada da consolidadora (cadastro resolvido)');
eq(cr.find(c => c.forma_recebimento === 'FATURAR').faturar, true, 'Faturar: marcada para a fatura');
eq(cp.map(c => [c.fornecedor_nome, c.valor_final, c.origem_item_id.split(':')[1]]), [['Hotel Mar', 1900, 'forn'], ['Agência Parceira', 50, 'repasse']], 'a pagar: líquido do hotel e repasse ao intermediário');
const cliente = await um(`SELECT id, nome FROM clientes WHERE tenant_id = $1 AND external_id = 'contact_9'`, [T]);
eq(cr.filter(c => c.origem === 'VENDA').every(c => c.cliente_id === cliente.id), true, 'contas do cliente no cadastro dele');
const pend = await todos(`SELECT chave, tipo, valor_centavos, situacao, pessoa_id FROM venda_pendencias WHERE tenant_id = $1 AND venda_id = $2`, [T, vid]);
eq(pend.map(p => [p.chave, p.tipo, Number(p.valor_centavos), p.situacao, p.pessoa_id === cliente.id]), [['v2:credito:crm:pag:cre', 'CREDITO_CLIENTE', 20000, 'ABERTA', true]], 'Crédito do cliente: pendência aberta para a parte D');
const modelo = await um(`SELECT versao_modelo, origem, situacao, total_cliente_centavos, receita_centavos FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [T, vid]);
eq([modelo.versao_modelo, modelo.origem, modelo.situacao, Number(modelo.total_cliente_centavos), Number(modelo.receita_centavos)], [2, 'crm', 'ABERTA', 576000, 65500], 'modelo gravado com total e receita');
const cab = (await um(`SELECT data FROM vendas_crm WHERE id = $1`, [vid])).data;
eq([cab.valor_final, cab.valor_total_custo, cab.rentabilidade, cab.modelo_venda, cab.produtos.length, cab.passageiros.length], [5760, 5055, 655, 2, 2, 2], 'cabeçalho no formato que as telas antigas leem');
eq((await todos(`SELECT data->>'meio_pagamento' m FROM itens_venda WHERE tenant_id = $1 AND venda_id = $2 ORDER BY sequencia`, [T, vid])).map(x => x.m), ['proprio', 'fornecedor'], 'itens no formato antigo, com quem cobra');

// Reenvio do mesmo negócio: as mesmas contas, nos mesmos ids.
const idsAntes = [...cr, ...cp].map(c => c.id).sort();
r = await processarEventoCRM('VENDA_FECHADA', payloadV2(), 'v2-2', T);
const idsDepois = [...await contas('contas_receber', vid), ...await contas('contas_pagar', vid)].map(c => c.id).sort();
eq([r.processado, idsDepois], [true, idsAntes], 'reenvio: as mesmas contas, atualizadas no lugar');
r = await processarEventoCRM('VENDA_FECHADA', payloadV2(), 'v2-2', T);
eq(r.acao, 'duplicata ignorada', 'mesma chave: duplicata');

console.log('--- PAGAMENTO_CONFIRMADO de venda v2 ---');
r = await processarEventoCRM('PAGAMENTO_CONFIRMADO', { entur_venda_id: vid, parcela: 2, valor: 1, data_pagamento: '2026-11-04' }, 'pc-1', T);
eq([r.processado, /ambígua/.test(r.acao)], [true, true], 'sem pagamento_ref e com duas formas na parcela 2: não baixa nada');
r = await processarEventoCRM('PAGAMENTO_CONFIRMADO', { entur_venda_id: vid, parcela: 3, valor: 1, data_pagamento: '2026-11-04', pagamento_ref: 'car' }, 'pc-2', T);
const car3 = (await contas('contas_receber', vid)).find(c => c.forma_recebimento === 'CARTAO_CREDITO' && c.parcela_numero === 3);
eq([r.processado, car3.status, car3.valor_recebido], [true, 'PARCIAL', 1], 'com pagamento_ref: baixa só a parcela daquela forma');
await query(`UPDATE contas_receber SET status = 'PENDENTE', data = data || '{"status":"PENDENTE","valor_recebido":null}' WHERE id = $1`, [car3.id]);

console.log('--- (e) Posição: baixa parcial e cobrança ---');
cr = await contas('contas_receber', vid);
const pix = cr.find(c => c.forma_recebimento === 'PIX');
const bol1 = cr.find(c => c.forma_recebimento === 'BOLETO' && c.parcela_numero === 1);
const bol2 = cr.find(c => c.forma_recebimento === 'BOLETO' && c.parcela_numero === 2);
await query(`UPDATE contas_receber SET status = 'RECEBIDO', data = data || '{"status":"RECEBIDO","valor_recebido":500}' WHERE id = $1`, [pix.id]);
await query(`UPDATE contas_receber SET status = 'PARCIAL', data = data || '{"status":"PARCIAL","valor_recebido":200}' WHERE id = $1`, [bol1.id]);
await query(`INSERT INTO cobrancas (id, tenant_id, titulo_tabela, titulo_id, provedor, referencia, tipo, status, valor_centavos, vencimento) VALUES ('cob1', $1, 'contas_receber', $2, 'asaas', 'f1;cob1', 'boleto_pix', 'aberta', 50000, '2027-01-10')`, [T, bol2.id]);
cp = await contas('contas_pagar', vid);
const hotel = cp.find(c => c.fornecedor_nome === 'Hotel Mar');
await query(`UPDATE contas_pagar SET status = 'PAGO', data = data || '{"status":"PAGO","valor_pago":1900}' WHERE id = $1`, [hotel.id]);
const pos = await srv.posicaoDaVendaNoBanco(pool, T, vid, '2026-11-05');
eq([pos.posicao.cliente.a_receber, pos.posicao.cliente.recebido, pos.posicao.cliente.em_aberto, pos.posicao.cliente.situacao], [216000, 70000, 146000, 'PARCIAL'], 'cliente: recebido conta a baixa parcial');
eq(pos.posicao.cliente.cobrancas_abertas, { quantidade: 1, valor: 50000, vencidas: 0 }, 'a cobrança emitida aparece na posição');
eq(pos.posicao.alertas.map(a => a.tipo), ['FORNECEDOR_PAGO_ANTES', 'CREDITO_PENDENTE'], 'alerta: fornecedor pago antes de o cliente pagar');
eq(pos.posicao.fornecedores.find(f => f.nome === 'Hotel Mar').situacao, 'PAGO', 'fornecedor: hotel pago');

console.log('--- (f) Reenvio com mudança: baixado e cobrado ficam, a diferença vai para as livres ---');
// O CRM tira R$ 100 do boleto (900 em 2x) e põe R$ 100 a mais no Pix: o Pix
// já recebido (500) fica; a parcela com boleto emitido fica; a parcial fica.
const mudado = payloadV2();
mudado.venda.pagamentos[0].valor = 600;
mudado.venda.pagamentos[1].valor = 900;
r = await processarEventoCRM('VENDA_FECHADA', mudado, 'v2-3', T);
cr = await contas('contas_receber', vid);
eq(cr.find(c => c.id === pix.id).valor_final, 500, 'Pix recebido não muda');
eq(cr.find(c => c.id === bol2.id).valor_final, 500, 'parcela com boleto emitido não muda');
eq(cr.find(c => c.id === bol1.id).valor_final, 500, 'parcela parcial não muda');
const totalCliente = cr.filter(c => c.origem === 'VENDA').reduce((a, c) => a + Math.round(c.valor_final * 100), 0);
eq(totalCliente, 216000, 'o total do cliente continua batendo com a venda');
// O boleto travado ficou com 100 a mais e o Pix recebido com 100 a menos: no
// lado do cliente isso se compensa, sem conta nova.
eq(cr.filter(c => c.origem_item_id.includes(':complemento')).length, 0, 'diferença entre formas do mesmo lado se compensa, sem conta nova');
// Agora o total da venda sobe 100 (Fee no hotel): a diferença cai na conta livre.
const maior = payloadV2();
maior.venda.produtos[0].componentes.push({ tipo: 'FEE', valor: 100 });
maior.venda.pagamentos[4].valor = 400;
await processarEventoCRM('VENDA_FECHADA', maior, 'v2-3b', T);
cr = await contas('contas_receber', vid);
eq([cr.find(c => c.forma_recebimento === 'FATURAR').valor_final, cr.filter(c => c.origem === 'VENDA').reduce((a, c) => a + Math.round(c.valor_final * 100), 0)], [400, 226000], 'total maior: a conta livre (Faturar) recebe a diferença');

console.log('--- (c) Venda lançada à mão pelas rotas ---');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
const manual = {
  data_venda: '2026-11-03', cliente: { id: 'cli-m', nome: 'Eva Melo' },
  produtos: [
    { id: 'pm1', tipo: 'CRUZEIRO', descricao: 'Cruzeiro Caribe', fornecedor: { id: 'f-nav', nome: 'Navio Azul' }, moeda: 'USD', cambio: 5.5,
      passageiros: [{ id: 'x1', nome: 'Eva', tarifa_centavos: 100000 }], componentes: [{ id: 'c1', tipo: 'COMISSAO', valor_centavos: 12000 }, { id: 'c2', tipo: 'FEE', valor_centavos: 5000 }] },
  ],
  pagamentos: [{ id: 'g1', forma: 'BOLETO', valor_centavos: 577500, parcelas: 3 }],
};
const pv = await json(await rotaPrevia.POST(pedir('POST', '/api/vendas/completa/previa', { venda: manual })));
eq([pv.status, pv.corpo.totais.valor_cliente, pv.corpo.contas.contas_receber.length, pv.corpo.contas.contas_pagar.map(c => [c.moeda, c.valor_original, c.valor_final])], [200, 577500, 3, [['USD', 880, 4840]]], 'prévia: 1.050 USD a 5,50 = 5.775; a pagar 880 USD');
const nova = await json(await rotaNova.POST(pedir('POST', '/api/vendas/completa', { venda: manual })));
eq([nova.status, nova.corpo.versao_modelo, nova.corpo.venda.origem, nova.corpo.situacao, nova.corpo.contas_receber.length, nova.corpo.contas_pagar.length], [201, 2, 'manual', 'ABERTA', 3, 1], 'POST: venda à mão gravada com as contas sozinhas');
const mid = nova.corpo.venda.id;
eq(/^VND-\d{4}$/.test(nova.corpo.venda.numero), true, 'numerada como as outras');
const erro = await json(await rotaNova.POST(pedir('POST', '/api/vendas/completa', { venda: { ...manual, cliente: null, pagamentos: [{ forma: 'PIX', valor_centavos: -5 }] } })));
eq([erro.status, erro.corpo.codigo, erro.corpo.detalhes.erros.length], [400, 'DADOS', 2], 'dados inválidos: 400 com a lista');

console.log('--- (d) Receita configurável ---');
const cfg0 = await json(await rotaConfig.GET());
eq(Object.values(cfg0.corpo.receita.componentes).every(Boolean), true, 'padrão: todo componente conta');
await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { receita: { componentes: { FEE: false } } }));
const ficha = await json(await rotaUma.GET(pedir('GET', `/api/vendas/completa/${mid}`), params(mid)));
eq([ficha.corpo.receita.receita, ficha.corpo.receita.fora_da_receita, ficha.corpo.receita.linhas.map(l => [l.tipo, l.valor, l.entra])],
  [66000, 27500, [['COMISSAO', 66000, true], ['FEE', 27500, false]]], 'sem o Fee: 660 de receita (comissão) e 275 fora dela');
await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { receita: { componentes: {} } }));
const fichaDeOutro = await json(await rotaUma.GET(pedir('GET', `/api/vendas/completa/${vid}`), params(vid)));
eq([fichaDeOutro.corpo.receita.receita, fichaDeOutro.corpo.posicao.receita.receita], [75500, 75500], 'venda do CRM (com o Fee de 100): a mesma receita na ficha e na posição');

console.log('--- (f) Fechar e reabrir ---');
// Fecha a venda à mão e recebe a 1ª parcela.
const crM = await contas('contas_receber', mid);
await query(`UPDATE contas_receber SET status = 'RECEBIDO', data = data || '{"status":"RECEBIDO","valor_recebido":1925}' WHERE id = $1`, [crM[0].id]);
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
eq((await rotaFechar.POST(pedir('POST', `/api/vendas/completa/${mid}/fechar`, {}), params(mid))).status, 403, 'sem o direito de fechar: 403');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
const fechada = await json(await rotaFechar.POST(pedir('POST', `/api/vendas/completa/${mid}/fechar`, {}), params(mid)));
eq([fechada.status, fechada.corpo.situacao], [200, 'FECHADA'], 'fechar: venda fechada');
const mexer = await json(await rotaUma.PUT(pedir('PUT', `/api/vendas/completa/${mid}`, { venda: manual }), params(mid)));
eq([mexer.status, mexer.corpo.codigo], [409, 'VENDA_FECHADA'], 'venda fechada não muda pela tela');
const antiga = await json(await rotaAntiga.POST(pedir('POST', '/api/vendas-crm', { venda: { id: mid }, itens: [{ id: 'x', venda_id: mid, fornecedor_id: '', sequencia: 1, status: 'ativo', data: { tipo: 'OUTROS', meio_pagamento: 'proprio', valor_custo: 1, valor_venda: 2 } }], cliente_nome: 'x' })));
eq([antiga.status, antiga.corpo.codigo], [409, 'VENDA_FECHADA'], 'nem pela rota antiga');
const curto = await json(await rotaReabrir.POST(pedir('POST', `/api/vendas/completa/${mid}/reabrir`, { motivo: 'erro' }), params(mid)));
eq([curto.status, curto.corpo.codigo], [400, 'MOTIVO'], 'reabrir sem motivo de verdade: 400');
const reaberta = await json(await rotaReabrir.POST(pedir('POST', `/api/vendas/completa/${mid}/reabrir`, { motivo: 'Cliente trocou a cabine' }), params(mid)));
eq([reaberta.status, reaberta.corpo.situacao, reaberta.corpo.eventos.map(e => e.tipo).slice(0, 3)], [200, 'ABERTA', ['reaberta', 'fechada', 'criada']], 'reaberta, com o histórico');
eq(reaberta.corpo.eventos[0].motivo, 'Cliente trocou a cabine', 'motivo guardado');
// Muda o pagamento (Pix no lugar do boleto): a parcela recebida fica, e o Pix cobre o resto.
const trocado = { ...manual, pagamentos: [{ id: 'g2', forma: 'PIX', valor_centavos: 577500 }] };
const salvo = await json(await rotaUma.PUT(pedir('PUT', `/api/vendas/completa/${mid}`, { venda: trocado }), params(mid)));
eq(salvo.status, 200, 'PUT depois de reabrir');
const crM2 = await contas('contas_receber', mid);
eq(crM2.map(c => [c.forma_recebimento, c.valor_final, c.status]), [['BOLETO', 1925, 'RECEBIDO'], ['PIX', 3850, 'PENDENTE']], 'reabrir não apaga conta baixada; o Pix nasce com o que falta');
const antigaV2 = await json(await rotaAntiga.POST(pedir('POST', '/api/vendas-crm', { venda: { id: mid }, itens: [{ id: 'x', venda_id: mid, fornecedor_id: '', sequencia: 1, status: 'ativo', data: { tipo: 'OUTROS', meio_pagamento: 'proprio', valor_custo: 1, valor_venda: 2 } }], cliente_nome: 'x' })));
eq([antigaV2.status, antigaV2.corpo.codigo], [409, 'VENDA_COMPLETA'], 'a rota antiga não regera a venda completa');

// Venda fechada não muda pelo CRM: fica no histórico e avisa.
await emTransacao(e => srv.fecharVenda(e, T, vid, { usuario: { id: 'u', nome: 'U' }, confirmar: true }));
const crAntes = JSON.stringify(await contas('contas_receber', vid));
r = await processarEventoCRM('VENDA_FECHADA', payloadV2({ valor_total: 9999 }), 'v2-4', T);
eq([r.processado, /está fechada/.test(r.acao), JSON.stringify(await contas('contas_receber', vid)) === crAntes], [true, true, true], 'CRM em venda fechada: nada muda, evento processado');
eq((await todos(`SELECT tipo FROM notificacoes WHERE tenant_id = $1 AND tipo = 'VENDA_FECHADA_MUDANCA_CRM'`, [T])).length, 1, 'e avisa no sino');
eq((await todos(`SELECT tipo FROM venda_eventos WHERE tenant_id = $1 AND venda_id = $2 AND tipo = 'mudanca_do_crm_recusada'`, [T, vid])).length, 1, 'e registra no histórico da venda');

console.log('--- (a) Histórico imutável ---');
let recusou = false;
try { await query(`UPDATE venda_eventos SET motivo = 'x' WHERE tenant_id = $1`, [T]); } catch { recusou = true; }
eq(recusou, true, 'histórico da venda não aceita UPDATE');

console.log('--- Pendência de crédito acompanha o pagamento ---');
await emTransacao(e => srv.reabrirVenda(e, T, vid, { usuario: { id: 'u', nome: 'U' }, motivo: 'Teste do crédito do cliente' }));
const semCredito = payloadV2();
semCredito.venda.pagamentos = semCredito.venda.pagamentos.filter(p => p.forma !== 'CREDITO_CLIENTE');
semCredito.venda.pagamentos[0].valor = 700;
await processarEventoCRM('VENDA_FECHADA', semCredito, 'v2-5', T);
eq((await todos(`SELECT situacao FROM venda_pendencias WHERE tenant_id = $1 AND venda_id = $2`, [T, vid])).map(p => p.situacao), ['CANCELADA'], 'pagamento com crédito saiu: a pendência é cancelada');

console.log('--- v1 de uma venda completa volta à v1 ---');
const { VENDA_SCHEMA_SQL: _ } = await import('../src/lib/venda-schema.ts');
r = await processarEventoCRM('VENDA_FECHADA', { ...payloadV2(), versao_venda: undefined, venda: undefined }, 'v2-6', T);
eq([r.processado, (await um(`SELECT versao_modelo FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [T, vid])).versao_modelo], [true, 1], 'payload v1: a venda volta para a v1');
globalThis.__SESSAO_DE_TESTE__ = null;

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
