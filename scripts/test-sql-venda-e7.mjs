/**
 * Venda e fornecedor no fechamento de paridade (E7) contra um Postgres real
 * (PGlite), pelo código de produção e pelas rotas com sessão de teste:
 *   (a) esquema; (b) liquidar automaticamente dinheiro e cheque pelo motor de
 *   baixas (tarefa do dia, período fechado); (c) taxa do cartão da agência
 *   congelada da forma, na receita e no vencimento; (d) pagamento avulso ao
 *   fornecedor e contas avulsas ligadas à venda; (e) produtos removidos,
 *   operação própria, abatimento e base do over; (f) link do CRM.
 *
 * Uso: node --no-warnings scripts/test-sql-venda-e7.mjs
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

const { FORMAS_PAGAMENTO_SCHEMA_SQL } = await import('../src/lib/formas-pagamento-servidor.ts');
await pg.exec(FORMAS_PAGAMENTO_SCHEMA_SQL);
const rotaNova = await import('../src/app/api/vendas/completa/route.ts');
const rotaUma = await import('../src/app/api/vendas/completa/[id]/route.ts');
const rotaConfig = await import('../src/app/api/config/vendas/route.ts');
const rotaAvulsas = await import('../src/app/api/vendas/completa/[id]/avulsas/route.ts');
const { tarefaLiquidarAutomaticamente } = await import('../src/lib/venda-liquidar-auto.ts');
const { linkDaNegociacaoNoCrm } = await import('../src/lib/venda-rota.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { hojeISO } = await import('../src/lib/money.ts');

const T = 'agencia-e7';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const sessao = (perfil, userId = `u-${perfil}`) => ({ userId, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: T, tenantSlug: T });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const params = id => ({ params: Promise.resolve({ id }) });
const contas = async (tabela, vendaId) => (await todos(`SELECT id, status, data FROM ${tabela} WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 ORDER BY data->>'origem_item_id', (data->>'parcela_numero')::int, id`, [T, vendaId]))
  .map(r => ({ id: r.id, status: r.data.status, ...r.data }));
const HOJE = hojeISO();
const dia = n => { const d = new Date(`${HOJE}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ('caixa', $1, 'Caixa da loja', '{"nome":"Caixa da loja","saldo_inicial":0,"saldo_atual":0}'), ('banco', $1, 'Banco', '{"nome":"Banco","saldo_inicial":0,"saldo_atual":0}'), ('alheia', 'outra', 'Outra', '{"nome":"Outra"}')`, [T]);
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');

const hotel = (o = {}) => ({
  id: 'p1', tipo: 'HOSPEDAGEM', descricao: 'Hotel Mar', fornecedor: { id: 'f-hotel', nome: 'Hotel Mar' },
  passageiros: [{ id: 'a', nome: 'Ana', tarifa_centavos: 100000 }],
  componentes: [{ id: 'cm', tipo: 'COMISSAO', valor_centavos: 10000 }], ...o,
});
const lancar = async venda => json(await rotaNova.POST(pedir('POST', '/api/vendas/completa', { venda })));

console.log('--- (a) Esquema ---');
const colunas = (await todos(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE table_name IN ('venda_pagamentos','venda_componentes','vendas_modelo') AND column_name IN ('dados','base','operacao_propria','produtos_removidos') ORDER BY 1`)).map(r => r.c);
eq(colunas, ['venda_componentes.base', 'venda_pagamentos.dados', 'vendas_modelo.operacao_propria', 'vendas_modelo.produtos_removidos'], 'colunas novas da E7 (esquema idempotente)');

console.log('--- (b) Liquidar automaticamente ---');
let r = await json(await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { liquidar_automaticamente: { DINHEIRO: { ligado: true, conta_bancaria_id: 'alheia' } } })));
eq(r.status, 400, 'conta de outra agência: recusada');
r = await json(await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { liquidar_automaticamente: { DINHEIRO: { ligado: true, conta_bancaria_id: 'caixa' }, CHEQUE: { ligado: true, conta_bancaria_id: 'banco' } } })));
eq([r.status, r.corpo.liquidar_automaticamente.DINHEIRO, r.corpo.receita.taxa_cartao], [200, { ligado: true, conta_bancaria_id: 'caixa' }, true], 'regra gravada; o resto da configuração fica como estava');

const v1 = await lancar({
  data_venda: dia(-3), cliente: { id: 'cli-1', nome: 'Ana' }, produtos: [hotel()],
  pagamentos: [
    { id: 'din', forma: 'DINHEIRO', valor_centavos: 40000 },
    { id: 'chq', forma: 'CHEQUE', valor_centavos: 60000, parcelas: 2, primeiro_vencimento: dia(-1), campos: { banco: 'Itaú', numero_cheque: '000123' } },
  ],
});
const vid1 = v1.corpo.venda.id;
let cr = await contas('contas_receber', vid1);
eq(cr.map(c => [c.venda_forma, c.parcela_numero, c.status, c.conta_bancaria_id]), [
  ['CHEQUE', 1, 'RECEBIDO', 'banco'], ['CHEQUE', 2, 'PENDENTE', null], ['DINHEIRO', 1, 'RECEBIDO', 'caixa'],
], 'dinheiro e o cheque já vencido baixados sozinhos; o cheque para frente espera');
const baixas = await todos(`SELECT titulo_id, origem, valor_centavos, data_baixa::text AS d FROM baixas WHERE tenant_id = $1 ORDER BY valor_centavos`, [T]);
eq(baixas.map(b => [b.origem, Number(b.valor_centavos), b.d]), [['venda', 30000, dia(-1)], ['venda', 40000, dia(-3)]], 'pelo motor de baixas de sempre, na data do vencimento');
eq(cr[0].observacoes.startsWith('Itaú · nº 000123'), true, 'os campos do cheque vão para a conta');
const saldo = async id => Number((await um(`SELECT data->>'saldo_atual' AS s FROM contas_bancarias WHERE id = $1`, [id])).s);
eq([await saldo('caixa'), await saldo('banco')], [400, 300], 'o caixa e o banco recebem o dinheiro');
const ev = (await todos(`SELECT detalhe FROM venda_eventos WHERE tenant_id = $1 AND venda_id = $2 ORDER BY criado_em`, [T, vid1]))[0].detalhe;
eq(ev.avisos.includes('LIQUIDADA_AUTOMATICAMENTE'), true, 'a venda avisa o que liquidou');

// Salvar de novo não liquida duas vezes nem mexe no que já foi baixado.
r = await json(await rotaUma.PUT(pedir('PUT', `/api/vendas/completa/${vid1}`, { venda: v1.corpo.venda }), params(vid1)));
eq([r.status, (await todos(`SELECT 1 FROM baixas WHERE tenant_id = $1`, [T])).length], [200, 2], 'salvar de novo: nenhuma baixa a mais');

// A tarefa do dia baixa o cheque quando ele vence.
const ctx = { exec: pool, emTransacao, agora: new Date(`${dia(40)}T15:00:00Z`), restanteMs: () => 60000 };
eq(await tarefaLiquidarAutomaticamente.agencias(ctx), [T], 'tarefa: só as agências com a regra ligada');
const res = await tarefaLiquidarAutomaticamente.executar(ctx, T);
cr = await contas('contas_receber', vid1);
eq([res.liquidadas, cr.find(c => c.parcela_numero === 2).status], [1, 'RECEBIDO'], 'tarefa: o 2º cheque baixado no vencimento');

// Período fechado: a conta fica em aberto, a venda grava e avisa.
await query(`INSERT INTO periodos_fechados (tenant_id, conta_bancaria_id, fechado_ate) VALUES ($1, 'caixa', $2)`, [T, dia(-5)]);
const v2 = await lancar({ data_venda: dia(-10), cliente: { id: 'cli-1', nome: 'Ana' }, produtos: [hotel()], pagamentos: [{ id: 'din', forma: 'DINHEIRO', valor_centavos: 100000 }] });
const cr2 = await contas('contas_receber', v2.corpo.venda.id);
const ev2 = (await todos(`SELECT detalhe FROM venda_eventos WHERE tenant_id = $1 AND venda_id = $2`, [T, v2.corpo.venda.id]))[0].detalhe;
eq([v2.status, cr2[0].status, ev2.avisos.includes('LIQUIDACAO_AUTOMATICA_RECUSADA')], [201, 'PENDENTE', true], 'período fechado: a venda grava, a conta fica em aberto e a venda avisa');
await query(`DELETE FROM periodos_fechados WHERE tenant_id = $1`, [T]);
await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { liquidar_automaticamente: { DINHEIRO: { ligado: false, conta_bancaria_id: 'caixa' }, CHEQUE: { ligado: false, conta_bancaria_id: 'banco' } } }));

console.log('--- (c) Taxa do cartão da agência ---');
await query(`INSERT INTO formas_pagamento (tenant_id, id, nome, sistema, dias_para_cair, taxa_pct, taxa_fixa_centavos) VALUES ($1, 'CARTAO_CREDITO', 'Cartão de crédito', true, 30, 3.5, 50)`, [T]);
const v3 = await lancar({ data_venda: '2026-11-01', cliente: { id: 'cli-1', nome: 'Ana' }, produtos: [hotel()], pagamentos: [{ id: 'car', forma: 'CARTAO', valor_centavos: 110000, parcelas: 2 }] });
const vid3 = v3.corpo.venda.id;
const pag3 = v3.corpo.venda.pagamentos[0];
eq([pag3.taxa_cartao_percentual, pag3.taxa_cartao_fixa_centavos, pag3.dias_para_cair], [3.5, 50, 30], 'a taxa e os dias da forma da agência ficam na venda');
eq([v3.corpo.receita.taxa_cartao, v3.corpo.receita.receita], [{ valor: 3900, entra: true }, 10000 - 3900], 'a taxa do cartão sai da receita, aberta');
eq(Number((await um(`SELECT receita_centavos FROM vendas_modelo WHERE venda_id = $1`, [vid3])).receita_centavos), 6100, 'a receita gravada (comissões, painel) já sem a taxa');
eq((await contas('contas_receber', vid3)).map(c => [c.data_vencimento, c.valor_final, c.taxa_cartao_prevista]), [['2026-12-01', 550, 19.5], ['2027-01-01', 550, 19.5]], 'vencimento pelos dias da forma; o cliente paga o mesmo');
await query(`UPDATE formas_pagamento SET taxa_pct = 9 WHERE tenant_id = $1`, [T]);
r = await json(await rotaUma.PUT(pedir('PUT', `/api/vendas/completa/${vid3}`, { venda: v3.corpo.venda }), params(vid3)));
eq(r.corpo.receita.taxa_cartao.valor, 3900, 'mudar a forma depois não muda a venda já feita');
await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { receita: { componentes: {}, taxa_cartao: false } }));
r = await json(await rotaUma.GET(pedir('GET', `/api/vendas/completa/${vid3}`), params(vid3)));
eq([r.corpo.receita.receita, r.corpo.receita.taxa_cartao.entra], [10000, false], 'Configurações › Vendas: a taxa pode ficar fora da receita');
await rotaConfig.PUT(pedir('PUT', '/api/config/vendas', { receita: { componentes: {}, taxa_cartao: true } }));

console.log('--- (d) Pagamento avulso ao fornecedor e contas avulsas ---');
const v4 = await lancar({ data_venda: '2026-11-01', cliente: { id: 'cli-1', nome: 'Ana' }, produtos: [hotel()] });
const vid4 = v4.corpo.venda.id;
let cp = await contas('contas_pagar', vid4);
eq(cp.map(c => [c.fornecedor_id, c.valor_final]), [['f-hotel', 900]], 'a venda deve 900 ao hotel');
r = await json(await rotaAvulsas.POST(pedir('POST', `/api/vendas/completa/${vid4}/avulsas`, { tipo: 'pagamento_fornecedor', pessoa: { id: 'f-outro', nome: 'Outro' }, valor_centavos: 30000 }), params(vid4)));
eq([r.status, r.corpo.codigo], [400, 'DADOS'], 'só um fornecedor desta venda');
r = await json(await rotaAvulsas.POST(pedir('POST', `/api/vendas/completa/${vid4}/avulsas`, { tipo: 'pagamento_fornecedor', pessoa: { id: 'f-hotel' }, valor_centavos: 30000, vencimento: '2026-11-05' }), params(vid4)));
cp = await contas('contas_pagar', vid4);
eq([r.status, cp.map(c => [c.auto_gerado, c.valor_final, c.avulsa_da_venda ?? '']).sort()], [201, [[false, 300, 'pagamento_fornecedor'], [true, 600, '']]], 'avulso de 300: a conta da venda cai para 600; o total segue 900');
r = await json(await rotaUma.PUT(pedir('PUT', `/api/vendas/completa/${vid4}`, { venda: r.corpo.ficha.venda }), params(vid4)));
cp = await contas('contas_pagar', vid4);
eq(cp.map(c => c.valor_final).sort((a, b) => a - b), [300, 600], 'salvar a venda de novo: a regeração respeita o avulso');
eq(r.corpo.posicao.fornecedor.a_pagar, 90000, 'a posição soma 900 a pagar ao hotel');
r = await json(await rotaAvulsas.POST(pedir('POST', `/api/vendas/completa/${vid4}/avulsas`, { tipo: 'receber', pessoa: { id: 'cli-1', nome: 'Ana' }, valor_centavos: 5000, descricao: 'Taxa de remarcação' }), params(vid4)));
const cr4 = await contas('contas_receber', vid4);
eq([r.status, cr4.filter(c => c.avulsa_da_venda === 'avulsa').map(c => [c.descricao, c.valor_final, c.auto_gerado])], [201, [['Taxa de remarcação', 50, false]]], 'conta a receber avulsa ligada à venda');
await json(await rotaUma.PUT(pedir('PUT', `/api/vendas/completa/${vid4}`, { venda: r.corpo.ficha.venda }), params(vid4)));
eq((await contas('contas_receber', vid4)).filter(c => c.avulsa_da_venda === 'avulsa').length, 1, 'a regeração não apaga a avulsa');
eq((await todos(`SELECT tipo FROM venda_eventos WHERE venda_id = $1 AND tipo = 'conta_avulsa'`, [vid4])).length, 2, 'cada avulsa fica no histórico da venda');
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
r = await json(await rotaAvulsas.POST(pedir('POST', `/api/vendas/completa/${vid4}/avulsas`, { tipo: 'pagar', pessoa: { id: 'x', nome: 'Motoboy' }, valor_centavos: 1000 }), params(vid4)));
eq(r.status >= 400, true, 'sem direito a lançar no financeiro: recusado');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN');

console.log('--- (e) Removidos, operação própria, abatimento e base do over gravados ---');
const v5 = await lancar({
  data_venda: '2026-11-01', cliente: { id: 'cli-1', nome: 'Ana' }, operacao_propria: true,
  produtos: [
    { id: 'g1', tipo: 'PACOTE', descricao: 'Grupo próprio', passageiros: [{ id: 'a', nome: 'Ana', tarifa_centavos: 300000 }], componentes: [{ id: 'mk', tipo: 'MARKUP', valor_centavos: 50000 }] },
    hotel({ id: 'p2', passageiros: [{ id: 'b', nome: 'Ana', tarifa_centavos: 100000 }], componentes: [{ id: 'cm', tipo: 'COMISSAO', valor_centavos: 10000 }, { id: 'ov', tipo: 'OVER', percentual: 20, base: 'COMISSAO' }, { id: 'ab', tipo: 'ABATIMENTO', valor_centavos: 5000 }] }),
  ],
  produtos_removidos: [{ id: 'rm', tipo: 'SEGURO', descricao: 'Seguro', quantidade: 1, valor_unitario_centavos: 9000 }],
});
const vid5 = v5.corpo.venda.id;
const comps = v5.corpo.venda.produtos[1].componentes;
eq([v5.status, v5.corpo.venda.operacao_propria, v5.corpo.venda.produtos_removidos.map(p => p.id)], [201, true, ['rm']], 'operação própria e produto removido gravados');
eq(comps.map(c => [c.tipo, c.valor_centavos, c.base ?? '']), [['COMISSAO', 10000, ''], ['OVER', 2000, 'COMISSAO'], ['ABATIMENTO', 5000, '']], 'over sobre a comissão e abatimento gravados');
eq((await contas('contas_pagar', vid5)).map(c => [c.fornecedor_id, c.valor_final]), [['f-hotel', 830]], 'operação própria: só o hotel a pagar (1.000 − 100 − 20 − 50)');
eq((await contas('contas_receber', vid5)).map(c => c.valor_final), [3500 + 950], 'o cliente paga o grupo e o hotel com o abatimento; o removido não entra');

console.log('--- (f) Contrato e voucher no CRM ---');
eq([
  linkDaNegociacaoNoCrm('crm_deal_812', 'https://crm.enturos.com/api/integracao-financeiro/webhook/150002'),
  linkDaNegociacaoNoCrm('', 'https://crm.enturos.com/x'),
  linkDaNegociacaoNoCrm('crm_deal_812', ''),
  linkDaNegociacaoNoCrm('crm_deal_812', 'javascript:alert(1)'),
], ['https://crm.enturos.com/deal/812', null, null, null], 'a negociação no CRM pelo id que ele manda; sem integração, sem link');
const f5 = await json(await rotaUma.GET(pedir('GET', `/api/vendas/completa/${vid5}`), params(vid5)));
eq(f5.corpo.link_crm, null, 'venda lançada à mão: sem link do CRM');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas) process.exit(1);
