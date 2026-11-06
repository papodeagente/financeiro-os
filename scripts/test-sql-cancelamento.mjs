/**
 * Cancelamento por passageiro, reembolsos e carteira de crédito do cliente
 * (E5, parte D) contra um Postgres real (PGlite), rodando o código DE
 * PRODUÇÃO: as rotas com sessão de teste, a liquidação (E2) e a tarefa.
 *
 * O que se prova:
 *   (a) esquema idempotente; extrato do crédito não aceita UPDATE;
 *   (b) cancelar UM passageiro com multa, zerando os dois lados: prévia
 *       mostra as contas que mudam e não grava nada; assinatura velha 409;
 *       gravar refaz as contas, a receita e a comissão do vendedor;
 *   (c) cancelar o resto depois de pagar: a sobra vira crédito do cliente, o
 *       que a agência pagou a mais ao fornecedor vira reembolso do
 *       fornecedor, a comissão já paga ganha o estorno, a venda é cancelada;
 *   (d) reembolso em cada situação: solicitado → aprovado (gera a conta) →
 *       pago (pela baixa de sempre); cancelado; convertido em crédito;
 *   (e) crédito usado em parte numa venda futura (forma Crédito do cliente),
 *       devolvido quando a venda diminui, faltando quando não cobre;
 *   (f) crédito vencido e o aviso antes de vencer (uma vez por crédito);
 *   (g) sobra de pagamento vira crédito na liquidação; liquidar com crédito
 *       não mexe no caixa; o estorno desfaz os dois;
 *   (h) sem zerar e "manter na meta": contas e comissão iguais; a venda que
 *       chega de novo do CRM continua cancelada; venda fechada também cancela;
 *   (i) isolamento entre agências e permissões.
 *
 * Uso: node --no-warnings scripts/test-sql-cancelamento.mjs
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

const pg = new PGlite();
await pg.exec(`
  CREATE TABLE crm_eventos_entrada (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RECEBIDO', processado BOOLEAN NOT NULL DEFAULT false, erro TEXT, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_notificacoes_deduplicacao ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE TABLE agencia (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE comissoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'CALCULADA', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb);
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
const { PARTE_D_SCHEMA_SQL } = await import('../src/lib/cancelamento-schema.ts');
const { BAIXAS_SCHEMA_SQL, registrarBaixas, estornarBaixa } = await import('../src/lib/baixas-servidor.ts');
const { PERIODO_SCHEMA_SQL } = await import('../src/lib/periodo-fechado.ts');
const { COBRANCA_SCHEMA_SQL } = await import('../src/lib/cobranca/schema.ts');
const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { RAZAO_SCHEMA_SQL } = await import('../src/lib/razao-schema.ts');
await pg.exec(BAIXAS_SCHEMA_SQL);
await pg.exec(PERIODO_SCHEMA_SQL);
await pg.exec(COBRANCA_SCHEMA_SQL);
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(VENDA_SCHEMA_SQL);
await pg.exec(PARTE_D_SCHEMA_SQL);
await pg.exec(VENDA_SCHEMA_SQL); // idempotentes: rodam a cada boot
await pg.exec(PARTE_D_SCHEMA_SQL);
await pg.exec(RAZAO_SCHEMA_SQL);

const srv = await import('../src/lib/venda-servidor.ts');
const carteira = await import('../src/lib/credito-cliente-servidor.ts');
const { tarefaCreditosEReembolsos } = await import('../src/lib/creditos-e-reembolsos-tarefa.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { normalizarVenda } = await import('../src/lib/venda-modelo.ts');
const rotaNova = await import('../src/app/api/vendas/completa/route.ts');
const rotaUma = await import('../src/app/api/vendas/completa/[id]/route.ts');
const rotaCancel = await import('../src/app/api/vendas/completa/[id]/cancelamento/route.ts');
const rotaReemb = await import('../src/app/api/reembolsos/route.ts');
const rotaReembId = await import('../src/app/api/reembolsos/[id]/route.ts');
const rotaCred = await import('../src/app/api/creditos-cliente/route.ts');
const rotaCredUsar = await import('../src/app/api/creditos-cliente/usar/route.ts');

const T = 'agencia-d';
const T2 = 'agencia-outra';
const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const somaDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const sessao = (perfil, tenant = T, userId = `u-${perfil}`) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const params = id => ({ params: Promise.resolve({ id }) });
const contas = async (tabela, vendaId) => (await todos(`SELECT id, data FROM ${tabela} WHERE tenant_id = $1 AND (data->>'origem_venda_id' = $2 OR data->>'venda_id' = $2) ORDER BY data->>'descricao', id`, [T, vendaId]))
  .map(r => ({ ...r.data, id: r.id }));
const saldoCaixa = async id => Number((await um(`SELECT (data->>'saldo_atual')::numeric AS s FROM contas_bancarias WHERE id = $1`, [id]))?.s ?? NaN);
const ctxBaixa = { tenantId: T, usuarioId: 'u1', usuarioNome: 'Ana', origem: 'tela', politica: null };
const baixar = (tabela, id, valor, extra = {}) => emTransacao(exec => registrarBaixas(exec, ctxBaixa, [{ titulo_tabela: tabela, titulo_id: id, conta_bancaria_id: 'b1', valor, data: HOJE, ...extra }], { gravar: true }));
const cancelar = (id, modo, pedido, assinatura) => rotaCancel.POST(pedir('POST', `/api/vendas/completa/${id}/cancelamento`, { modo, pedido, assinatura }), params(id)).then(json);
const saldoCredito = cli => carteira.saldoDisponivel(pool, T, cli, HOJE);

await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1',$1,'{"nome":"Inter","saldo_inicial":0,"saldo_atual":0}')`, [T]);
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, '{"datas_pagamento_comissao":[5]}')`, [T]);
await query(`INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, data) VALUES ('f-hotel', $1, 'Hotel Mar', '{"nome_fantasia":"Hotel Mar","politica_cancelamento":{"faixas":[{"dias_antes":30,"percentual":10}]}}')`, [T]);

console.log('--- (a) Esquema ---');
const tabelas = (await todos(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('creditos_cliente','creditos_cliente_movimentos','reembolsos','venda_cancelamentos') ORDER BY 1`)).map(r => r.table_name);
eq(tabelas, ['creditos_cliente', 'creditos_cliente_movimentos', 'reembolsos', 'venda_cancelamentos'], 'tabelas da parte D');

console.log('--- (b) Um passageiro, com multa, zerando os dois lados ---');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');
const hotel = (pax) => ({
  id: 'h1', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' }, data_inicio: somaDias(HOJE, 60),
  passageiros: pax.map(([id, nome]) => ({ id, nome, tarifa_centavos: 100000 })),
  componentes: pax.flatMap(([id]) => [{ id: `c-${id}`, tipo: 'COMISSAO', valor_centavos: 10000, passageiro_id: id }, { id: `r-${id}`, tipo: 'RAV', valor_centavos: 3000, passageiro_id: id }]),
});
const venda1 = {
  data_venda: HOJE, cliente: { id: 'cli', nome: 'Carla Dias' }, vendedor: { id: 'vend', nome: 'Vera' },
  produtos: [hotel([['a', 'Ana'], ['b', 'Bia']])],
  pagamentos: [{ id: 'pix', forma: 'PIX', valor_centavos: 106000 }, { id: 'bol', forma: 'BOLETO', valor_centavos: 100000, parcelas: 2 }],
};
const v1 = (await json(await rotaNova.POST(pedir('POST', '/api/vendas/completa', { venda: venda1 })))).corpo.venda.id;
const pix1 = (await contas('contas_receber', v1)).find(c => c.forma_recebimento === 'PIX');
await baixar('contas_receber', pix1.id, 1060);
await query(`INSERT INTO comissoes (id, tenant_id, venda_id, vendedor_id, status, data) VALUES ('k1', $1, $2, 'vend', 'CALCULADA', $3::jsonb)`,
  [T, v1, JSON.stringify({ id: 'k1', venda_id: v1, venda_numero: 'VND', vendedor_id: 'vend', vendedor_nome: 'Vera', data_venda: HOJE, valor_base: 260, percentual_aplicado: 10, valor_comissao: 26, status: 'CALCULADA', observacoes: '' })]);

const ctxC = await json(await rotaCancel.GET(pedir('GET', `/api/vendas/completa/${v1}/cancelamento`), params(v1)));
eq([ctxC.status, ctxC.corpo.versao_modelo, ctxC.corpo.politicas.h1], [200, 2, { faixas: [{ dias_antes: 30, percentual: 10 }] }], 'contexto: a política do fornecedor chega para a multa sugerida');

const pedidoAna = { data: HOJE, motivo: 'Ana adoeceu', itens: [{ produto_id: 'h1', passageiro_ids: ['a'] }], multas: [{ produto_id: 'h1', fornecedor_centavos: 10000, cliente_centavos: 15000 }], zerar_fornecedor: true, zerar_cliente: true, sobra: 'credito' };
const antesCR = JSON.stringify(await contas('contas_receber', v1));
const antesCP = JSON.stringify(await contas('contas_pagar', v1));
const pv = await cancelar(v1, 'previa', pedidoAna);
eq(pv.status, 200, 'prévia responde');
eq(pv.corpo.mudancas.map(m => [m.tabela, m.tipo, m.antes, m.depois]), [
  ['contas_pagar', 'alterada', 1800, 1000],
  ['contas_pagar', 'criada', null, 18],
  ['contas_receber', 'alterada', 500, 60], ['contas_receber', 'alterada', 500, 60],
], 'prévia: o hotel cai para 1.000 (900 da Bia + 100 de multa), o boleto para 60+60 e a comissão do vendedor vira 18');
eq([pv.corpo.receita_antes_centavos, pv.corpo.receita_depois_centavos, pv.corpo.comissoes.map(c => [c.acao, c.valor_depois, c.estorno])], [26000, 18000, [['reduzir', 18, 8]]], 'prévia: receita 260 → 180; comissão 26 → 18');
eq([JSON.stringify(await contas('contas_receber', v1)) === antesCR, JSON.stringify(await contas('contas_pagar', v1)) === antesCP, (await todos(`SELECT 1 FROM venda_cancelamentos`)).length, (await um(`SELECT data FROM comissoes WHERE id = 'k1'`)).data.valor_comissao], [true, true, 0, 26], 'prévia não grava nada');
const velho = await cancelar(v1, 'gravar', pedidoAna, 'assinatura-velha');
eq([velho.status, velho.corpo.codigo, JSON.stringify(await contas('contas_receber', v1)) === antesCR], [409, 'MUDOU', true], 'assinatura que não é da prévia: 409 e nada muda');
const g1 = await cancelar(v1, 'gravar', pedidoAna, pv.corpo.assinatura);
eq([g1.status, g1.corpo.ficha.venda.produtos[0].passageiros.map(x => !!x.cancelado_em)], [200, [true, false]], 'gravado: Ana cancelada');
let cr = await contas('contas_receber', v1);
let cp = await contas('contas_pagar', v1);
eq([cr.filter(c => c.forma_recebimento === 'BOLETO').map(c => c.valor_final), cp.find(c => c.fornecedor_nome === 'Hotel Mar').valor_final], [[60, 60], 1000], 'contas como a prévia mostrou');
eq([g1.corpo.ficha.receita.receita, (await um(`SELECT data FROM comissoes WHERE id = 'k1'`)).data.valor_comissao, (await contas('contas_pagar', v1)).find(c => c.origem_comissao_id === 'k1')?.valor_final], [18000, 18, 18], 'receita 180 na ficha; comissão estornada para 18, com a conta a pagar dela');
eq((await todos(`SELECT tipo FROM venda_eventos WHERE tenant_id = $1 AND venda_id = $2 AND tipo = 'cancelamento'`, [T, v1])).length, 1, 'cancelamento no histórico da venda');

console.log('--- (c) O resto, depois de pagar: sobra vira crédito, reembolso do fornecedor, estorno da comissão paga ---');
await query(`UPDATE comissoes SET status = 'PAGA', data = data || '{"status":"PAGA"}' WHERE id = 'k1'`);
await baixar('contas_pagar', cp.find(c => c.fornecedor_nome === 'Hotel Mar').id, 1000);
await baixar('contas_receber', cr.find(c => c.forma_recebimento === 'BOLETO' && c.parcela_numero === 1).id, 60);
const caixaAntes = await saldoCaixa('b1');
const pedidoBia = { data: HOJE, motivo: 'Viagem cancelada', itens: [{ produto_id: 'h1', passageiro_ids: null }], zerar_fornecedor: true, zerar_cliente: true, sobra: 'credito' };
const pv2 = await cancelar(v1, 'previa', pedidoBia);
eq([pv2.corpo.credito?.valor_centavos, pv2.corpo.reembolsos.map(r => [r.tipo, r.valor_centavos]), pv2.corpo.comissoes.map(c => [c.acao, c.estorno])], [97000, [['FORNECEDOR', 90000]], [['estornar_paga', 13]]], 'prévia: 970 de crédito, 900 a pedir ao hotel, 13 de estorno da comissão paga');
const g2 = await cancelar(v1, 'gravar', pedidoBia, pv2.corpo.assinatura);
eq(g2.status, 200, 'gravado');
eq(await saldoCredito('cli'), 97000, 'carteira da cliente: 970 (1.120 pagos − 150 de multa)');
const reembF = await um(`SELECT * FROM reembolsos WHERE tenant_id = $1 AND tipo = 'FORNECEDOR'`, [T]);
eq([reembF.situacao, Number(reembF.valor_centavos), reembF.pessoa_id], ['SOLICITADO', 90000, 'f-hotel'], 'reembolso do fornecedor solicitado: 900');
const estorno = (await contas('contas_receber', v1)).find(c => c.estorno_de_comissao);
eq([estorno?.valor_final, (await um(`SELECT data FROM comissoes WHERE id = 'k1'`)).data.status], [13, 'PAGA'], 'comissão paga fica; o estorno é a receber do vendedor');
eq([(await um(`SELECT status FROM vendas_crm WHERE id = $1`, [v1])).status, await saldoCaixa('b1')], ['CANCELADO', caixaAntes], 'tudo cancelado: a venda sai das vendas; o caixa não se mexe');
cr = await contas('contas_receber', v1);
eq(cr.filter(c => c.origem === 'VENDA' && c.status !== 'CANCELADO').map(c => [c.forma_recebimento, c.valor_final, c.status]), [['BOLETO', 60, 'RECEBIDO'], ['PIX', 1060, 'RECEBIDO']], 'o que entrou fica como entrou; a parcela em aberto saiu');
const extrato = await json(await rotaCred.GET(pedir('GET', '/api/creditos-cliente?cliente_id=cli')));
eq([extrato.corpo.saldo.disponivel, extrato.corpo.creditos[0].origem, extrato.corpo.extrato.map(l => l.tipo)], [97000, 'CANCELAMENTO', ['ENTRADA']], 'extrato do crédito por cliente');

console.log('--- (d) Reembolso em cada situação ---');
let lista = await json(await rotaReemb.GET(pedir('GET', '/api/reembolsos?situacao=em_andamento')));
eq([lista.corpo.reembolsos.length, lista.corpo.totais.a_receber_do_fornecedor], [1, 90000], 'lista: em andamento');
const aprov = await json(await rotaReembId.PATCH(pedir('PATCH', `/api/reembolsos/${reembF.id}`, { acao: 'aprovar' }), params(reembF.id)));
eq([aprov.status, aprov.corpo.situacao, aprov.corpo.conta_tabela], [200, 'APROVADO', 'contas_receber'], 'aprovado: vira conta a receber do fornecedor');
const contaF = await um(`SELECT data FROM contas_receber WHERE id = $1`, [aprov.corpo.conta_id]);
eq([contaF.data.valor_final, contaF.data.cliente_nome, contaF.data.auto_gerado], [900, 'Hotel Mar', false], 'conta certa, fora da regeração da venda');
await baixar('contas_receber', aprov.corpo.conta_id, 900);
lista = await json(await rotaReemb.GET(pedir('GET', '/api/reembolsos?tipo=FORNECEDOR')));
eq([lista.corpo.reembolsos[0].situacao, lista.corpo.reembolsos[0].pago_em], ['PAGO', HOJE], 'liquidada a conta, o reembolso fica pago sozinho');

const venda2 = { data_venda: HOJE, cliente: { id: 'cli2', nome: 'Davi Reis' }, produtos: [{ id: 's1', tipo: 'SEGURO', descricao: 'Seguro', fornecedor: { id: 'f-seg', nome: 'Seguradora' }, quantidade: 1, valor_unitario_centavos: 30000, componentes: [{ id: 'cs', tipo: 'COMISSAO', valor_centavos: 3000 }] }], pagamentos: [{ id: 'p', forma: 'PIX', valor_centavos: 30000 }] };
const v2 = (await json(await rotaNova.POST(pedir('POST', '/api/vendas/completa', { venda: venda2 })))).corpo.venda.id;
await baixar('contas_receber', (await contas('contas_receber', v2))[0].id, 300);
const g3 = await cancelar(v2, 'gravar', { data: HOJE, motivo: 'Desistiu do seguro', itens: [{ produto_id: 's1' }], zerar_fornecedor: true, zerar_cliente: true, sobra: 'reembolso', prazo_reembolso: somaDias(HOJE, 10) });
eq([g3.status, g3.corpo.reembolsos.map(r => [r.tipo, r.valor_centavos, r.prazo])], [200, [['CLIENTE', 30000, somaDias(HOJE, 10)]]], 'sobra escolhida como reembolso: solicitado ao cliente com o prazo pedido');
const rc = g3.corpo.reembolsos[0].id;
const aprovC = await json(await rotaReembId.PATCH(pedir('PATCH', `/api/reembolsos/${rc}`, { acao: 'aprovar' }), params(rc)));
const contaC = await um(`SELECT data FROM contas_pagar WHERE id = $1`, [aprovC.corpo.conta_id]);
eq([aprovC.corpo.situacao, contaC.data.valor_final, contaC.data.data_vencimento, contaC.data.fornecedor_nome], ['APROVADO', 300, somaDias(HOJE, 10), 'Davi Reis'], 'aprovado: conta a pagar ao cliente no prazo');
const semMotivo = await json(await rotaReembId.PATCH(pedir('PATCH', `/api/reembolsos/${rc}`, { acao: 'cancelar', motivo: 'x' }), params(rc)));
eq(semMotivo.status, 400, 'cancelar pede motivo');
const canc = await json(await rotaReembId.PATCH(pedir('PATCH', `/api/reembolsos/${rc}`, { acao: 'cancelar', motivo: 'Cliente remarcou a viagem' }), params(rc)));
eq([canc.corpo.situacao, (await um(`SELECT data FROM contas_pagar WHERE id = $1`, [aprovC.corpo.conta_id])).data.status], ['CANCELADO', 'CANCELADO'], 'cancelado: a conta em aberto sai junto');
const manual = await json(await rotaReemb.POST(pedir('POST', '/api/reembolsos', { tipo: 'CLIENTE', venda_id: v2, pessoa_id: 'cli2', pessoa_nome: 'Davi Reis', valor_centavos: 30000, descricao: 'Devolução combinada' })));
eq([manual.status, manual.corpo.situacao], [201, 'SOLICITADO'], 'reembolso lançado à mão nasce solicitado');
const conv = await json(await rotaReembId.PATCH(pedir('PATCH', `/api/reembolsos/${manual.corpo.id}`, { acao: 'converter_em_credito' }), params(manual.corpo.id)));
eq([conv.corpo.situacao, await saldoCredito('cli2')], ['PAGO', 30000], 'convertido em crédito: pago, e o cliente tem 300 na carteira');

console.log('--- (e) Crédito usado em parte numa venda futura ---');
const venda3 = (credito, pix) => ({ id: 'v3', data_venda: HOJE, cliente: { id: 'cli', nome: 'Carla Dias' }, produtos: [{ id: 'p1', tipo: 'PACOTE', descricao: 'Pacote Bahia', fornecedor: { id: 'f-op', nome: 'Operadora' }, quantidade: 1, valor_unitario_centavos: 120000, componentes: [{ id: 'cc', tipo: 'COMISSAO', valor_centavos: 12000 }] }],
  pagamentos: [{ id: 'cre', forma: 'CREDITO_CLIENTE', valor_centavos: credito }, ...(pix ? [{ id: 'pix', forma: 'PIX', valor_centavos: pix }] : [])] });
await json(await rotaNova.POST(pedir('POST', '/api/vendas/completa', { venda: venda3(50000, 70000) })));
let pend = await um(`SELECT situacao, dados FROM venda_pendencias WHERE tenant_id = $1 AND venda_id = 'v3'`, [T]);
eq([pend.situacao, pend.dados.usado_centavos, await saldoCredito('cli')], ['RESOLVIDA', 50000, 47000], 'forma Crédito do cliente: sai 500 da carteira e a pendência se resolve');
await json(await rotaUma.PUT(pedir('PUT', '/api/vendas/completa/v3', { venda: venda3(30000, 90000) }), params('v3')));
pend = await um(`SELECT situacao, valor_centavos, dados FROM venda_pendencias WHERE tenant_id = $1 AND venda_id = 'v3'`, [T]);
eq([pend.situacao, Number(pend.valor_centavos), pend.dados.usado_centavos, await saldoCredito('cli')], ['RESOLVIDA', 30000, 30000, 67000], 'a venda passou a usar 300: os 200 voltam para a carteira');
const muito = await json(await rotaUma.PUT(pedir('PUT', '/api/vendas/completa/v3', { venda: venda3(120000, 0) }), params('v3')));
pend = await um(`SELECT situacao, dados FROM venda_pendencias WHERE tenant_id = $1 AND venda_id = 'v3'`, [T]);
eq([muito.status, pend.situacao, pend.dados.usado_centavos, await saldoCredito('cli')], [200, 'ABERTA', 97000, 0], 'pediu mais do que tem: usa o que há (970) e a pendência fica aberta');
eq((await todos(`SELECT detalhe FROM venda_eventos WHERE tenant_id = $1 AND venda_id = 'v3' ORDER BY criado_em DESC LIMIT 1`, [T]))[0].detalhe.avisos.includes('CREDITO_INSUFICIENTE'), true, 'e avisa que falta crédito');
await json(await rotaUma.PUT(pedir('PUT', '/api/vendas/completa/v3', { venda: { ...venda3(30000, 90000) } }), params('v3')));
eq(await saldoCredito('cli'), 67000, 'volta a usar 300: o resto retorna');

console.log('--- (f) Crédito vencido e aviso antes de vencer ---');
const cv = await emTransacao(e => carteira.criarCredito(e, T, { cliente_id: 'cli9', cliente_nome: 'Eva', origem: 'AJUSTE', valor_centavos: 5000, validade: somaDias(HOJE, 100), descricao: 'Bônus de fidelidade' }, 'teste'));
await query(`UPDATE creditos_cliente SET validade = $2::date WHERE id = $1`, [cv.id, somaDias(HOJE, -1)]);
const ca = await emTransacao(e => carteira.criarCredito(e, T, { cliente_id: 'cli9', cliente_nome: 'Eva', origem: 'AJUSTE', valor_centavos: 7000, validade: somaDias(HOJE, 10), descricao: 'Bônus de aniversário' }, 'teste'));
const noPrazo = await json(await rotaReemb.POST(pedir('POST', '/api/reembolsos', { tipo: 'CLIENTE', pessoa_id: 'cli9', pessoa_nome: 'Eva', valor_centavos: 4000, descricao: 'Taxa devolvida', prazo: HOJE, aprovar: true })));
eq([noPrazo.status, noPrazo.corpo.situacao], [201, 'APROVADO'], 'reembolso que já nasce aprovado');
const ctxTarefa = { exec: pool, emTransacao, agora: new Date(), restanteMs: () => 60_000 };
const agencias = await tarefaCreditosEReembolsos.agencias(ctxTarefa);
eq(agencias.includes(T), true, 'a tarefa encontra a agência');
let rodada = await tarefaCreditosEReembolsos.executar(ctxTarefa, T);
eq([rodada.vencidos, rodada.avisados, rodada.reembolsos_avisados], [1, 1, 1], 'vence o passado, avisa o crédito que vence em 10 dias e o reembolso no prazo');
eq([(await um(`SELECT situacao, saldo_centavos FROM creditos_cliente WHERE id = $1`, [cv.id])).situacao, await saldoCredito('cli9')], ['VENCIDO', 7000], 'crédito vencido sai do saldo');
eq((await todos(`SELECT tipo FROM creditos_cliente_movimentos WHERE credito_id = $1 ORDER BY criado_em`, [cv.id])).map(m => m.tipo), ['ENTRADA', 'VENCIMENTO'], 'e o extrato diz que venceu');
rodada = await tarefaCreditosEReembolsos.executar(ctxTarefa, T);
eq([rodada.vencidos, rodada.avisados, (await todos(`SELECT 1 FROM notificacoes WHERE tenant_id = $1 AND tipo = 'CREDITO_CLIENTE_VENCENDO'`, [T])).length], [0, 0, 1], 'rodar de novo não avisa duas vezes (um aviso por crédito)');
eq([rodada.reembolsos_avisados, (await todos(`SELECT 1 FROM notificacoes WHERE tenant_id = $1 AND tipo = 'REEMBOLSO_NO_PRAZO'`, [T])).length], [0, 1], 'o reembolso no prazo também é avisado uma vez só');
void ca;

console.log('--- (g) Sobra de pagamento vira crédito; liquidar com crédito ---');
await query(`INSERT INTO contas_receber (id, tenant_id, cliente_id, status, data) VALUES ('r-sobra', $1, 'cli7', 'PENDENTE', $2::jsonb), ('r-uso', $1, 'cli7', 'PENDENTE', $3::jsonb)`,
  [T, JSON.stringify({ id: 'r-sobra', cliente_id: 'cli7', cliente_nome: 'Gil', descricao: 'Sinal da viagem', valor_final: 100, data_vencimento: HOJE, status: 'PENDENTE' }),
    JSON.stringify({ id: 'r-uso', cliente_id: 'cli7', cliente_nome: 'Gil', descricao: 'Saldo da viagem', valor_final: 50, data_vencimento: HOJE, status: 'PENDENTE' })]);
let caixa = await saldoCaixa('b1');
const bs = await baixar('contas_receber', 'r-sobra', 130, { tratamento_diferenca: 'credito' });
eq([(await um(`SELECT data FROM contas_receber WHERE id = 'r-sobra'`)).data.status, await saldoCredito('cli7'), await saldoCaixa('b1') - caixa], ['RECEBIDO', 3000, 130], 'pagou 130 numa conta de 100: quitada, 30 viram crédito, os 130 entram no caixa');
caixa = await saldoCaixa('b1');
const usoResp = await json(await rotaCredUsar.POST(pedir('POST', '/api/creditos-cliente/usar', { conta_receber_id: 'r-uso', valor_centavos: 2000 })));
eq([usoResp.status, usoResp.corpo.status_depois, await saldoCredito('cli7'), await saldoCaixa('b1') - caixa], [200, 'PARCIAL', 1000, 0], 'liquidar com crédito: 20 da carteira, conta parcial, caixa parado');
eq(await um(`SELECT forma, caixa_centavos::int AS caixa FROM baixas WHERE id = $1`, [usoResp.corpo.baixa_id]), { forma: 'CREDITO_CLIENTE', caixa: 0 }, 'fica no histórico de baixas como Crédito do cliente');
await emTransacao(e => estornarBaixa(e, { tenantId: T, usuarioNome: 'Ana' }, usoResp.corpo.baixa_id, { motivo: 'Lançado errado' }));
eq([(await um(`SELECT data FROM contas_receber WHERE id = 'r-uso'`)).data.status, await saldoCredito('cli7'), await saldoCaixa('b1') - caixa], ['PENDENTE', 3000, 0], 'estorno: o crédito volta e o caixa continua parado');
await emTransacao(e => estornarBaixa(e, { tenantId: T, usuarioNome: 'Ana' }, bs.itens[0].baixa_id, { motivo: 'Pagamento devolvido' }));
eq([await saldoCredito('cli7'), await saldoCaixa('b1') - caixa], [0, -130], 'estorno da baixa com sobra: o crédito sai e os 130 saem do caixa');

console.log('--- (h) Sem zerar, manter na meta, reenvio do CRM e venda fechada ---');
const venda5 = { id: 'v5', data_venda: HOJE, cliente: { id: 'cli5', nome: 'Íris' }, vendedor: { id: 'vend', nome: 'Vera' }, produtos: [hotel([['x', 'Xavier'], ['y', 'Yara']])], pagamentos: [{ id: 'bol', forma: 'BOLETO', valor_centavos: 206000 }] };
await json(await rotaNova.POST(pedir('POST', '/api/vendas/completa', { venda: venda5 })));
await query(`INSERT INTO comissoes (id, tenant_id, venda_id, vendedor_id, status, data) VALUES ('k5', $1, 'v5', 'vend', 'CALCULADA', $2::jsonb)`,
  [T, JSON.stringify({ id: 'k5', venda_id: 'v5', vendedor_id: 'vend', vendedor_nome: 'Vera', valor_base: 260, valor_comissao: 26, status: 'CALCULADA' })]);
const antes5 = JSON.stringify((await contas('contas_receber', 'v5')).map(c => [c.id, c.valor_final]).concat((await contas('contas_pagar', 'v5')).map(c => [c.id, c.valor_final])));
const g5 = await cancelar('v5', 'gravar', { data: HOJE, motivo: 'Xavier não vai', itens: [{ produto_id: 'h1', passageiro_ids: ['x'] }], zerar_fornecedor: false, zerar_cliente: false, manter_na_meta: true });
const depois5 = JSON.stringify((await contas('contas_receber', 'v5')).map(c => [c.id, c.valor_final]).concat((await contas('contas_pagar', 'v5')).map(c => [c.id, c.valor_final])));
eq([g5.status, g5.corpo.mudancas.length, depois5 === antes5], [200, 0, true], 'sem zerar: cliente e fornecedor seguem devendo tudo, nenhuma conta muda');
eq([(await um(`SELECT data FROM comissoes WHERE id = 'k5'`)).data.valor_comissao, g5.corpo.comissoes.map(c => c.acao)], [26, ['manter']], 'manter na meta: comissão igual');
const v5Ficha = (await json(await rotaUma.GET(pedir('GET', '/api/vendas/completa/v5'), params('v5')))).corpo;
eq(v5Ficha.receita.linhas.filter(l => l.tipo === 'COBRADO_NO_CANCELAMENTO' || l.tipo === 'RETIDO_PELO_FORNECEDOR').map(l => l.valor), [103000, 90000], 'o que continua valendo aparece aberto na receita');
// O CRM manda a venda de novo (sem saber do cancelamento): continua cancelada.
const original = normalizarVenda({ ...venda5, origem: 'crm' }).venda;
await emTransacao(e => srv.salvarVenda(e, T, original, { usuario: { id: 'crm', nome: 'CRM' }, origem: 'crm', evento: 'recebida_do_crm' }));
const v5b = await srv.carregarVenda(pool, T, 'v5');
const depois5b = JSON.stringify((await contas('contas_receber', 'v5')).map(c => [c.id, c.valor_final]).concat((await contas('contas_pagar', 'v5')).map(c => [c.id, c.valor_final])));
eq([v5b.venda.produtos[0].passageiros.map(x => !!x.cancelado_em), depois5b === antes5], [[true, false], true], 'reenvio do CRM: o cancelamento feito aqui continua valendo');
// Venda fechada também cancela, e continua fechada.
await emTransacao(e => srv.fecharVenda(e, T, 'v5', { usuario: { id: 'u', nome: 'U' }, confirmar: true }));
const g6 = await cancelar('v5', 'gravar', { data: HOJE, motivo: 'Yara também desistiu', itens: [{ produto_id: 'h1', passageiro_ids: ['y'] }], zerar_fornecedor: true, zerar_cliente: true, manter_na_meta: true });
eq([g6.status, g6.corpo.ficha.situacao, (await contas('contas_receber', 'v5')).filter(c => c.status !== 'CANCELADO').reduce((a, c) => a + c.valor_final, 0)], [200, 'FECHADA', 1030], 'venda fechada: cancela sem reabrir; o cliente segue devendo só a parte do Xavier');
eq((await um(`SELECT data FROM vendas_crm WHERE id = 'v5'`)).data.meta_mantida.valor_final, 1030, 'manter na meta guarda o que saiu para a comissão e a meta');

console.log('--- (i) Isolamento e permissões ---');
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
eq((await cancelar('v5', 'previa', pedidoAna)).status, 403, 'vendedor não cancela');
eq((await rotaReembId.PATCH(pedir('PATCH', `/api/reembolsos/${rc}`, { acao: 'aprovar' }), params(rc))).status, 403, 'vendedor não aprova reembolso');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', T2);
eq([(await json(await rotaReemb.GET(pedir('GET', '/api/reembolsos')))).corpo.reembolsos.length, (await json(await rotaCred.GET(pedir('GET', '/api/creditos-cliente')))).corpo.carteiras.length], [0, 0], 'outra agência não vê reembolsos nem créditos');
eq((await json(await rotaCred.GET(pedir('GET', '/api/creditos-cliente?cliente_id=cli')))).corpo.extrato.length, 0, 'nem o extrato do cliente de outra agência');
eq((await cancelar(v1, 'previa', pedidoAna)).status, 404, 'nem cancela venda de outra agência');
eq((await rotaReembId.PATCH(pedir('PATCH', `/api/reembolsos/${manual.corpo.id}`, { acao: 'cancelar', motivo: 'tentativa de fora' }), params(manual.corpo.id))).status, 404, 'nem mexe em reembolso de outra agência');
eq((await json(await rotaCredUsar.POST(pedir('POST', '/api/creditos-cliente/usar', { conta_receber_id: 'r-uso', valor_centavos: 100 })))).status, 404, 'nem usa crédito em conta de outra agência');
globalThis.__SESSAO_DE_TESTE__ = null;

console.log('--- (a) Extrato imutável ---');
const recusou = await falha(query(`UPDATE creditos_cliente_movimentos SET valor_centavos = 1 WHERE tenant_id = $1`, [T]));
eq(Boolean(recusou), true, 'extrato do crédito não aceita UPDATE');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
