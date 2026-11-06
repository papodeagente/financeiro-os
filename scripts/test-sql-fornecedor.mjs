/**
 * O lado do fornecedor (E5, parte C) contra um Postgres real (PGlite),
 * rodando o código DE PRODUÇÃO pelas rotas, com sessão de teste.
 *
 * O que se prova:
 *   (a) esquema idempotente; uma conta só numa fatura valendo;
 *   (b) acordos com vigência: sobreposição recusada; a venda lançada à mão
 *       ganha a comissão do acordo vigente NA DATA DELA;
 *   (c) fatura pela regra do fornecedor: período até o corte, vencimento no
 *       dia útil seguinte ao feriado, prévia com assinatura, itens que mudaram
 *       recusados, a conta da venda sai do caminho e a posição lê a fatura;
 *       a venda que muda depois de faturada gera complemento para a próxima;
 *   (d) sinal: só o pago compensa, sozinho, na fatura seguinte; sinal maior
 *       que a fatura cobre tudo sem conta a pagar; desfazer devolve o saldo;
 *   (e) Taxa CC DU/RAV com motivo, limites e trava depois de faturar;
 *   (f) desfazer fatura: só sem pagamento; as contas voltam e a venda acerta;
 *   (g) tarefa do dia: avisa no corte e monta sozinha quando a regra pede;
 *   (h) comissão esperada × lançada × recebida por operadora, com extrato;
 *   (i) isolamento entre agências e permissões.
 *
 * Uso: node --no-warnings scripts/test-sql-fornecedor.mjs
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
const { FORNECEDOR_SCHEMA_SQL } = await import('../src/lib/fornecedor-schema.ts');
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
await pg.exec(FORNECEDOR_SCHEMA_SQL);
await pg.exec(FORNECEDOR_SCHEMA_SQL); // idempotente: roda a cada boot
await pg.exec(RAZAO_SCHEMA_SQL);

const srv = await import('../src/lib/venda-servidor.ts');
const forn = await import('../src/lib/fornecedor-servidor.ts');
const { faturasDoDia } = await import('../src/lib/fornecedor-tarefa.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const rotaVenda = await import('../src/app/api/vendas/completa/route.ts');
const rotaVendaUma = await import('../src/app/api/vendas/completa/[id]/route.ts');
const rotaAcordos = await import('../src/app/api/fornecedores/acordos/route.ts');
const rotaAcordo = await import('../src/app/api/fornecedores/acordos/[id]/route.ts');
const rotaAFaturar = await import('../src/app/api/fornecedores/faturas/a-faturar/route.ts');
const rotaPrevia = await import('../src/app/api/fornecedores/faturas/previa/route.ts');
const rotaFaturas = await import('../src/app/api/fornecedores/faturas/route.ts');
const rotaFatura = await import('../src/app/api/fornecedores/faturas/[id]/route.ts');
const rotaDesfazer = await import('../src/app/api/fornecedores/faturas/[id]/desfazer/route.ts');
const rotaRegra = await import('../src/app/api/fornecedores/regra-faturamento/route.ts');
const rotaTaxa = await import('../src/app/api/fornecedores/taxa-cc/route.ts');
const rotaSinais = await import('../src/app/api/fornecedores/sinais/route.ts');
const rotaCancelarSinal = await import('../src/app/api/fornecedores/sinais/[id]/cancelar/route.ts');
const rotaComissoes = await import('../src/app/api/fornecedores/comissoes/route.ts');

const T = 'agencia-c';
const T2 = 'agencia-outra';
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const sessao = (perfil, tenant = T) => ({ userId: `u-${perfil}`, nome: `Pessoa ${perfil}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const pedir = (metodo, url, corpo) => new Request(`http://localhost${url}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const json = async r => ({ status: r.status, corpo: await r.json() });
const params = id => ({ params: Promise.resolve({ id }) });
const comoAdmin = () => { globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN'); };
const contaForn = async (vendaId) => (await todos(
  `SELECT id, data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 ORDER BY data->>'origem_item_id'`, [T, vendaId],
)).map(r => ({ id: r.id, ...r.data }));
const pagar = async (id, reais) => query(`UPDATE contas_pagar SET status = 'PAGO', data = data || jsonb_build_object('status', 'PAGO', 'valor_pago', $2::numeric) WHERE id = $1`, [id, reais]);

const cadastro = (id, tenant, nome, regras) => query(
  `INSERT INTO fornecedores_crm (id, tenant_id, nome_fantasia, data) VALUES ($1, $2, $3, $4::jsonb)`,
  [id, tenant, nome, JSON.stringify({ id, nome_fantasia: nome, tipo: 'OPERADORA', status: 'ATIVO', regras_faturamento: regras })],
);
await cadastro('f-sol', T, 'Operadora Sol', { dia_corte: 25, dia_vencimento: 15, prazo_pagamento_dias: 30, comissao_padrao: 0, moeda_padrao: 'BRL' });
await cadastro('f-hot', T, 'Hotel Bom', { dia_corte: 20, dia_vencimento: 5, gerar_sozinha: true });
await cadastro('f-x', T2, 'Outra Operadora', { dia_corte: 10, dia_vencimento: 20 });

console.log('--- (a) Esquema ---');
const tabelas = (await todos(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY 1`, [['fatura_fornecedor_itens', 'faturas_fornecedor', 'fornecedor_acordos', 'fornecedor_extrato_comissoes', 'fornecedor_sinal_compensacoes', 'fornecedor_sinais']])).map(r => r.table_name);
eq(tabelas.length, 6, 'as seis tabelas do lado do fornecedor');

console.log('--- (b) Acordos com vigência ---');
comoAdmin();
const novoAcordo = async corpo => json(await rotaAcordos.POST(pedir('POST', '/api/fornecedores/acordos', corpo)));
let r = await novoAcordo({ fornecedor: { id: 'f-sol' }, tipo_produto: 'PACOTE', comissao_percentual: 10, vigencia_inicio: '2026-01-01', vigencia_fim: '2026-10-31' });
eq([r.status, r.corpo.fornecedor.nome, r.corpo.comissao_percentual], [201, 'Operadora Sol', 10], 'acordo de 2026 até outubro: 10%');
r = await novoAcordo({ fornecedor: { id: 'f-sol' }, tipo_produto: 'PACOTE', comissao_percentual: 12, vigencia_inicio: '2026-11-01' });
const acordoNov = r.corpo.id;
eq(r.status, 201, 'acordo a partir de novembro: 12%');
r = await novoAcordo({ fornecedor: { id: 'f-sol' }, tipo_produto: 'PACOTE', comissao_percentual: 11, vigencia_inicio: '2026-10-15' });
eq([r.status, r.corpo.codigo], [409, 'VIGENCIA_SOBREPOSTA'], 'vigência que encosta em outra: recusada');
r = await novoAcordo({ fornecedor: { id: 'f-hot' }, tipo_produto: 'HOSPEDAGEM', comissao_percentual: 10, vigencia_inicio: '2026-01-01' });
eq(r.status, 201, 'acordo do hotel: 10%');
r = await novoAcordo({ fornecedor: { id: 'nao-existe' }, comissao_percentual: 5, vigencia_inicio: '2026-01-01' });
eq([r.status, r.corpo.codigo], [400, 'DADOS'], 'fornecedor fora do cadastro: recusado');
r = await json(await rotaAcordo.PUT(pedir('PUT', `/api/fornecedores/acordos/${acordoNov}`, { fornecedor: { id: 'f-sol' }, tipo_produto: 'PACOTE', comissao_percentual: 12, vigencia_inicio: '2026-11-01', observacoes: 'Tabela de verão' }), params(acordoNov)));
eq([r.status, r.corpo.observacoes], [200, 'Tabela de verão'], 'alterar o acordo sem conflitar com ele mesmo');

const lancar = async venda => json(await rotaVenda.POST(pedir('POST', '/api/vendas/completa', { venda })));
const pacote = (data, tarifa, markup) => ({
  data_venda: data, cliente: { id: 'cli-a', nome: 'Ana Lima' },
  produtos: [{ tipo: 'PACOTE', descricao: 'Pacote Bahia', fornecedor: { id: 'f-sol', nome: 'Operadora Sol' }, quem_cobra: 'AGENCIA', data_inicio: '2026-12-20', detalhes: { destino: 'Salvador' },
    passageiros: [{ nome: 'Ana Lima', documento: '111', tarifa_centavos: tarifa }], componentes: [{ tipo: 'MARKUP', valor_centavos: markup }] }],
  pagamentos: [{ forma: 'PIX', valor_centavos: tarifa + markup }],
});
let v = await lancar(pacote('2026-10-20', 100000, 20000));
const VA = v.corpo.venda.id;
const comissaoDe = venda => venda.produtos[0].componentes.filter(c => c.tipo === 'COMISSAO').map(c => [c.valor_centavos, /acordo/.test(c.descricao)]);
eq([v.status, comissaoDe(v.corpo.venda)], [201, [[10000, true]]], 'venda de 20/10: comissão de 10% pelo acordo de outubro');
eq((await contaForn(VA)).map(c => [c.fornecedor_nome, c.valor_final]), [['Operadora Sol', 900]], 'conta a pagar já com a comissão descontada');
v = await lancar(pacote('2026-11-03', 200000, 30000));
const VB = v.corpo.venda.id;
eq(comissaoDe(v.corpo.venda), [[24000, true]], 'venda de 03/11: comissão de 12% pelo acordo de novembro');
const comZero = pacote('2026-11-03', 50000, 0);
comZero.produtos[0].componentes.push({ tipo: 'COMISSAO', valor_centavos: 0 });
v = await lancar(comZero);
eq(comissaoDe(v.corpo.venda), [[0, false]], 'comissão zerada pela pessoa fica zerada');
await query(`UPDATE vendas_crm SET status = 'CANCELADO' WHERE id = $1`, [v.corpo.venda.id]);
await query(`UPDATE contas_pagar SET status = 'CANCELADO', data = data || '{"status":"CANCELADO"}' WHERE data->>'origem_venda_id' = $1`, [v.corpo.venda.id]);
v = await lancar({
  data_venda: '2026-11-04', cliente: { id: 'cli-b', nome: 'Bia Souza' },
  produtos: [{ tipo: 'AEREO', descricao: 'GRU-SSA', fornecedor: { id: 'f-sol', nome: 'Operadora Sol' }, quem_cobra: 'AGENCIA', quantidade: 1, valor_unitario_centavos: 300000,
    componentes: [{ tipo: 'TAXA_DU', valor_centavos: 10000 }, { tipo: 'RAV', valor_centavos: 5000 }, { tipo: 'COMISSAO', valor_centavos: 0 }] }],
  pagamentos: [{ forma: 'PIX', valor_centavos: 315000 }],
});
const VC = v.corpo.venda.id;
v = await lancar({
  data_venda: '2026-11-02', cliente: { id: 'cli-c', nome: 'Caio Reis' },
  produtos: [{ tipo: 'HOSPEDAGEM', descricao: 'Hotel Bom 3 noites', fornecedor: { id: 'f-hot', nome: 'Hotel Bom' }, quem_cobra: 'AGENCIA',
    passageiros: [{ nome: 'Caio Reis', tarifa_centavos: 200000 }], componentes: [{ tipo: 'COMISSAO', valor_centavos: 15000 }] }],
  pagamentos: [{ forma: 'PIX', valor_centavos: 200000 }],
});
const VH = v.corpo.venda.id;
eq(comissaoDe(v.corpo.venda), [[15000, false]], 'comissão informada (abaixo do acordo) não é trocada');

console.log('--- (c) Fatura pela regra: corte, vencimento e feriado ---');
let af = await json(await rotaAFaturar.GET(pedir('GET', '/api/fornecedores/faturas/a-faturar')));
eq(af.corpo.partes.map(p => [p.parte_nome, p.itens]).sort(), [['Hotel Bom', 1], ['Operadora Sol', 3]], 'a faturar: um resumo por fornecedor (venda cancelada fica de fora)');
const parte = await forn.aFaturarDaParte(pool, T, 'f-sol', '2026-11-05');
const itemVA = parte.itens.find(i => i.venda_id === VA);
eq([parte.periodo_sugerido.inicio, parte.periodo_sugerido.corte, parte.periodo_sugerido.vencimento.data, parte.periodo_sugerido.vencimento.motivo_ajuste],
  ['2026-09-26', '2026-10-25', '2026-11-16', 'Proclamação da República'], 'período até o corte de 25/10; vence 15/11 (feriado e domingo) → segunda 16/11');
eq(parte.sugeridos, [itemVA.conta_id], 'só a venda de 20/10 entra no período sugerido');
eq([itemVA.valor_cliente, itemVA.liquidado_cliente, itemVA.saldo_cliente, itemVA.saldo_fornecedor, itemVA.comissao, itemVA.destino],
  [120000, 0, 120000, 90000, 10000, 'Salvador'], 'linha: valor, liquidado e saldo do cliente ao lado do saldo do fornecedor');
eq(parte.proximas.length, 3, 'as próximas 3 faturas da regra');
const previa = async corpo => json(await rotaPrevia.POST(pedir('POST', '/api/fornecedores/faturas/previa', corpo)));
let pv = await previa({ parte_id: 'f-sol', conta_ids: [itemVA.conta_id], corte: '2026-10-25' });
eq([pv.status, pv.corpo.previa.total_itens, pv.corpo.previa.a_pagar, pv.corpo.previa.vencimento.data, pv.corpo.previa.alertas.map(a => a.codigo).includes('CLIENTE_NAO_PAGOU')],
  [200, 90000, 90000, '2026-11-16', true], 'prévia: 900 a pagar em 16/11, avisando que o cliente ainda não pagou');
const gerar = async corpo => json(await rotaFaturas.POST(pedir('POST', '/api/fornecedores/faturas', corpo)));
r = await gerar({ parte_id: 'f-sol', conta_ids: [itemVA.conta_id], corte: '2026-10-25', assinatura: 'outra' });
eq([r.status, r.corpo.codigo], [409, 'PREVIA_MUDOU'], 'assinatura diferente da prévia: nada é gravado');
r = await gerar({ parte_id: 'f-sol', conta_ids: [itemVA.conta_id], corte: '2026-10-25', assinatura: pv.corpo.assinatura });
const F1 = r.corpo;
eq([r.status, F1.numero, F1.valor, F1.vencimento, F1.periodo_inicio, F1.corte, F1.pagamento], [201, 'FF-0001', 90000, '2026-11-16', '2026-09-26', '2026-10-25', 'EM_ABERTO'], 'fatura gerada: FF-0001');
const contaF1 = (await um(`SELECT data FROM contas_pagar WHERE id = $1`, [F1.conta_pagar_id])).data;
eq([contaF1.valor_final, contaF1.data_vencimento, contaF1.origem, contaF1.auto_gerado, contaF1.fornecedor_id, contaF1.numero_documento], [900, '2026-11-16', 'VENDA', true, 'f-sol', 'FF-0001'], 'uma conta a pagar da fatura (repasse de venda, com o número)');
let cA = await contaForn(VA);
eq(cA.map(c => [c.status, c.fatura_fornecedor_numero]), [['CANCELADO', 'FF-0001']], 'a conta da venda sai do caminho, ligada à fatura');
let pos = await srv.posicaoDaVendaNoBanco(pool, T, VA, '2026-11-05');
eq(pos.posicao.fornecedores.map(f => [f.nome, f.a_pagar, f.pago, f.proximo_vencimento, f.situacao]), [['Operadora Sol', 90000, 0, '2026-11-16', 'PENDENTE']], 'a posição da venda lê a conta pela fatura');
pv = await previa({ parte_id: 'f-sol', conta_ids: [itemVA.conta_id] });
eq([pv.status, pv.corpo.codigo], [409, 'ITENS_MUDARAM'], 'item já faturado não entra de novo');
let dup = false;
try { await query(`INSERT INTO fatura_fornecedor_itens (tenant_id, fatura_id, conta_pagar_id, venda_id, valor_centavos) VALUES ($1, 'outra', $2, $3, 1)`, [T, itemVA.conta_id, VA]); } catch { dup = true; }
eq(dup, true, 'o banco recusa a mesma conta em duas faturas valendo');

// A venda muda depois de faturada: a conta da fatura fica, a diferença vira complemento.
let ficha = await json(await rotaVendaUma.GET(pedir('GET', `/api/vendas/completa/${VA}`), params(VA)));
const vendaA = ficha.corpo.venda;
vendaA.produtos[0].passageiros[0].tarifa_centavos = 110000;
vendaA.pagamentos[0].valor_centavos = 130000;
r = await json(await rotaVendaUma.PUT(pedir('PUT', `/api/vendas/completa/${VA}`, { venda: vendaA }), params(VA)));
cA = await contaForn(VA);
eq([r.status, cA.map(c => [c.status, c.valor_final, c.origem_item_id.endsWith(':complemento')])], [200, [['CANCELADO', 900, false], ['PENDENTE', 100, true]]], 'venda mudou: o faturado fica e a diferença (100) entra na próxima fatura');

console.log('--- (d) Sinal compensado sozinho ---');
r = await json(await rotaSinais.POST(pedir('POST', '/api/fornecedores/sinais', { parte_id: 'f-sol', valor_centavos: 50000, vencimento: '2026-11-10', descricao: 'Bloqueio de réveillon' })));
const S1 = r.corpo;
eq([r.status, S1.valor_centavos, S1.disponivel, /Sinal - Operadora Sol/.test((await um(`SELECT data FROM contas_pagar WHERE id = $1`, [S1.conta_pagar_id])).data.descricao)], [201, 50000, 0, true], 'sinal lançado vira conta a pagar; nada a compensar antes de pagar');
const itemVB = (await forn.aFaturarDaParte(pool, T, 'f-sol', '2026-11-05')).itens.find(i => i.venda_id === VB);
pv = await previa({ parte_id: 'f-sol', conta_ids: [itemVB.conta_id], corte: '2026-11-25' });
eq([pv.corpo.previa.total_sinal, pv.corpo.previa.a_pagar], [0, 176000], 'sinal não pago não compensa');
await pagar(S1.conta_pagar_id, 500);
pv = await previa({ parte_id: 'f-sol', conta_ids: [itemVB.conta_id], corte: '2026-11-25' });
eq([pv.corpo.previa.total_sinal, pv.corpo.previa.a_pagar, pv.corpo.previa.vencimento.data], [50000, 126000, '2026-12-15'], 'sinal pago: 1.760 − 500 = 1.260, vence 15/12');
r = await gerar({ parte_id: 'f-sol', conta_ids: [itemVB.conta_id], corte: '2026-11-25', assinatura: pv.corpo.assinatura });
const F2 = r.corpo;
eq([r.status, F2.numero, F2.valor_itens, F2.sinal, F2.valor, F2.compensacoes.map(c => c.valor_centavos)], [201, 'FF-0002', 176000, 50000, 126000, [50000]], 'FF-0002 com o sinal descontado');
let sinais = await json(await rotaSinais.GET(pedir('GET', '/api/fornecedores/sinais?parte_id=f-sol')));
eq(sinais.corpo.sinais.map(s => [s.compensado_centavos, s.disponivel]), [[50000, 0]], 'saldo do sinal foi todo para a fatura');
r = await json(await rotaCancelarSinal.POST(pedir('POST', `/api/fornecedores/sinais/${S1.id}/cancelar`, { motivo: 'Fornecedor devolveu o sinal' }), params(S1.id)));
eq([r.status, r.corpo.codigo], [409, 'COMPENSADO'], 'sinal já descontado não se cancela');
await pagar(F2.conta_pagar_id, 1260);
pos = await srv.posicaoDaVendaNoBanco(pool, T, VB, '2026-11-05');
eq(pos.posicao.fornecedores.map(f => [f.a_pagar, f.pago, f.situacao]), [[176000, 176000, 'PAGO']], 'fatura paga (com o sinal): o fornecedor da venda está pago');
r = await json(await rotaFatura.GET(pedir('GET', `/api/fornecedores/faturas/${F2.id}`), params(F2.id)));
eq([r.corpo.pagamento, r.corpo.pago, r.corpo.linhas.map(l => l.venda_id)], ['PAGA', 176000, [VB]], 'detalhe: paga, com os itens');
r = await json(await rotaDesfazer.POST(pedir('POST', `/api/fornecedores/faturas/${F2.id}/desfazer`, { motivo: 'Fornecedor mandou outra fatura' }), params(F2.id)));
eq([r.status, r.corpo.codigo], [409, 'FATURA_PAGA'], 'fatura com pagamento não se desfaz');

console.log('--- (e) Taxa CC DU/RAV ---');
const prodC = (await json(await rotaVendaUma.GET(pedir('GET', `/api/vendas/completa/${VC}`), params(VC)))).corpo.venda.produtos[0];
const taxa = async corpo => json(await rotaTaxa.POST(pedir('POST', '/api/fornecedores/taxa-cc', corpo)));
r = await taxa({ venda_id: VC, produto_id: prodC.id, lado: 'DU', valor_centavos: 500, motivo: 'x' });
eq([r.status, r.corpo.codigo], [400, 'MOTIVO'], 'sem motivo de verdade: recusado');
r = await taxa({ venda_id: VC, produto_id: prodC.id, lado: 'DU', valor_centavos: 20000, motivo: 'Operadora cobrou no cartão' });
eq([r.status, r.corpo.codigo], [400, 'ACIMA_DA_TAXA'], 'Taxa CC DU acima da Taxa DU: recusada');
r = await taxa({ venda_id: VC, produto_id: prodC.id, lado: 'DU', valor_centavos: 500, motivo: 'Operadora cobrou no cartão' });
eq([r.status, r.corpo], [200, { de: 0, para: 500 }], 'Taxa CC DU alterada');
eq((await contaForn(VC)).map(c => c.valor_final), [3005], 'a conta do fornecedor sobe a Taxa CC');
const evento = await um(`SELECT detalhe FROM venda_eventos WHERE tenant_id = $1 AND venda_id = $2 ORDER BY criado_em DESC LIMIT 1`, [T, VC]);
eq([evento.detalhe.acao, evento.detalhe.motivo, evento.detalhe.lado], ['taxa_cc_alterada', 'Operadora cobrou no cartão', 'DU'], 'o motivo fica no histórico da venda');

console.log('--- (d) Sinal maior que a fatura ---');
r = await json(await rotaSinais.POST(pedir('POST', '/api/fornecedores/sinais', { parte_id: 'f-sol', valor_centavos: 400000, vencimento: '2026-11-06' })));
const S2 = r.corpo;
await pagar(S2.conta_pagar_id, 4000);
const itemVC = (await forn.aFaturarDaParte(pool, T, 'f-sol', '2026-11-05')).itens.find(i => i.venda_id === VC);
eq([itemVC.taxa_cc_du, itemVC.taxa_du, itemVC.rav, itemVC.pode_alterar_taxa_cc], [500, 10000, 5000, true], 'a linha mostra Taxa DU, RAV e Taxa CC DU');
pv = await previa({ parte_id: 'f-sol', conta_ids: [itemVC.conta_id], corte: '2026-11-25' });
r = await gerar({ parte_id: 'f-sol', conta_ids: [itemVC.conta_id], corte: '2026-11-25', assinatura: pv.corpo.assinatura });
const F3 = r.corpo;
eq([r.status, F3.valor_itens, F3.sinal, F3.valor, F3.conta_pagar_id, F3.pagamento], [201, 300500, 300500, 0, null, 'PAGA'], 'sinal cobre a fatura inteira: nenhuma conta a pagar');
pos = await srv.posicaoDaVendaNoBanco(pool, T, VC, '2026-11-05');
eq(pos.posicao.fornecedores[0].situacao, 'PAGO', 'a venda vê o fornecedor pago pelo sinal');
r = await taxa({ venda_id: VC, produto_id: prodC.id, lado: 'RAV', valor_centavos: 100, motivo: 'Operadora cobrou no cartão' });
eq([r.status, r.corpo.codigo], [409, 'JA_FATURADO'], 'depois de faturado, a Taxa CC não muda');
sinais = await forn.sinaisComSaldo(pool, T, { ids: [S2.id] });
eq(sinais[0].disponivel, 99500, 'sobra do sinal fica para a próxima');
r = await json(await rotaDesfazer.POST(pedir('POST', `/api/fornecedores/faturas/${F3.id}/desfazer`, { motivo: 'Teste do sinal que volta' }), params(F3.id)));
sinais = await forn.sinaisComSaldo(pool, T, { ids: [S2.id] });
eq([r.status, r.corpo.situacao, sinais[0].disponivel], [200, 'DESFEITA', 400000], 'desfazer devolve o sinal inteiro');

console.log('--- (f) Desfazer a fatura sem pagamento ---');
r = await json(await rotaDesfazer.POST(pedir('POST', `/api/fornecedores/faturas/${F1.id}/desfazer`, { motivo: 'curto' }), params(F1.id)));
eq([r.status, r.corpo.codigo], [400, 'MOTIVO'], 'sem motivo: recusado');
r = await json(await rotaDesfazer.POST(pedir('POST', `/api/fornecedores/faturas/${F1.id}/desfazer`, { motivo: 'Fornecedor pediu para refazer' }), params(F1.id)));
eq([r.status, r.corpo.situacao, r.corpo.motivo_desfazer], [200, 'DESFEITA', 'Fornecedor pediu para refazer'], 'fatura desfeita, com o motivo');
cA = await contaForn(VA);
eq(cA.filter(c => c.status !== 'CANCELADO').map(c => [c.status, c.valor_final]), [['PENDENTE', 1000]], 'as contas voltam para a venda e se acertam numa só (1.000)');
eq((await um(`SELECT data->>'status' AS s FROM contas_pagar WHERE id = $1`, [F1.conta_pagar_id])).s, 'CANCELADO', 'a conta da fatura é cancelada (nada apagado)');
eq((await forn.aFaturarDaParte(pool, T, 'f-sol', '2026-11-05')).itens.map(i => i.venda_id).includes(VA), true, 'e a venda volta a estar a faturar');

console.log('--- Regra de faturamento editável ---');
r = await json(await rotaRegra.PUT(pedir('PUT', '/api/fornecedores/regra-faturamento?parte_id=f-sol', { ajuste_vencimento: 'anterior' })));
eq([r.status, r.corpo.regra.regra.ajuste_vencimento, r.corpo.regra.regra.dia_corte, r.corpo.proximas.length], [200, 'anterior', 25, 3], 'regra gravada, com a prévia das próximas 3');
eq((await um(`SELECT data FROM fornecedores_crm WHERE id = 'f-sol'`)).data.regras_faturamento.prazo_pagamento_dias, 30, 'o resto do cadastro fica');
await rotaRegra.PUT(pedir('PUT', '/api/fornecedores/regra-faturamento?parte_id=f-sol', { ajuste_vencimento: 'proximo' }));

console.log('--- (g) Tarefa do dia: aviso no corte e fatura sozinha ---');
let t = await faturasDoDia(pool, emTransacao, T, new Date('2026-11-21T13:00:00Z'));
eq([t.avisos, t.geradas], [1, 1], 'Operadora Sol avisada; Hotel Bom (gerar sozinha) montada');
const fh = (await forn.listarFaturas(pool, T, { parte_id: 'f-hot' }, '2026-11-21'))[0];
eq([fh.valor, fh.vencimento, fh.automatica, fh.corte], [185000, '2026-12-07', true, '2026-11-20'], 'Hotel Bom: vence 05/12 (sábado) → segunda 07/12');
t = await faturasDoDia(pool, emTransacao, T, new Date('2026-11-21T15:00:00Z'));
eq((await todos(`SELECT tipo FROM notificacoes WHERE tenant_id = $1 AND tipo = 'FATURA_FORNECEDOR_PRONTA'`, [T])).length, 2, 'rodar de novo no mesmo dia não repete o aviso');

console.log('--- (h) Comissão esperada × recebida ---');
let com = await forn.comissoesNoPeriodo(pool, T, { de: '2026-10-01', ate: '2026-11-30' }, '2026-12-20');
const op = nome => com.operadoras.find(o => o.nome === nome);
eq([op('Hotel Bom').esperada, op('Hotel Bom').lancada, op('Hotel Bom').recebida, op('Hotel Bom').alertas.map(a => a.codigo)], [20000, 15000, 0, ['ABAIXO_DO_ACORDO']], 'hotel: esperado 200 pelo acordo, lançado 150, nada recebido');
eq([op('Operadora Sol').esperada, op('Operadora Sol').lancada, op('Operadora Sol').recebida], [35000, 34000, 24000], 'operadora: esperado 350, lançado 340, recebido 240 (venda paga pela fatura)');
await pagar(fh.conta_pagar_id, 1850);
await forn.registrarComissoesDoExtrato(pool, T, [{ parte_id: 'f-hot', data: '2026-11-25', valor_centavos: 14000, referencia: 'extrato-hotel:1' }]);
eq(await forn.registrarComissoesDoExtrato(pool, T, [{ parte_id: 'f-hot', data: '2026-11-25', valor_centavos: 14000, referencia: 'extrato-hotel:1' }]), 0, 'a mesma linha do extrato não entra duas vezes');
com = await forn.comissoesNoPeriodo(pool, T, { de: '2026-10-01', ate: '2026-11-30' }, '2026-12-20');
eq([op('Hotel Bom').recebida, op('Hotel Bom').informada, op('Hotel Bom').alertas.map(a => a.codigo)], [15000, 14000, ['ABAIXO_DO_ACORDO', 'EXTRATO_DIVERGENTE']], 'fatura do hotel paga: comissão recebida; o extrato diz menos');
r = await json(await rotaComissoes.GET(pedir('GET', '/api/fornecedores/comissoes?de=2026-10-01&ate=2026-11-30')));
eq([r.status, r.corpo.operadoras.length, r.corpo.extrato_disponivel], [200, 2, true], 'rota da comissão por operadora');

console.log('--- (i) Isolamento e permissões ---');
globalThis.__SESSAO_DE_TESTE__ = sessao('VENDEDOR');
eq((await rotaComissoes.GET(pedir('GET', '/api/fornecedores/comissoes'))).status, 403, 'vendedor não vê a comissão da agência');
eq((await rotaFaturas.POST(pedir('POST', '/api/fornecedores/faturas', { parte_id: 'f-sol', conta_ids: [] }))).status, 403, 'vendedor não monta fatura');
globalThis.__SESSAO_DE_TESTE__ = sessao('ADMIN', T2);
eq((await json(await rotaAcordos.GET(pedir('GET', '/api/fornecedores/acordos')))).corpo.acordos.length, 0, 'outra agência: não vê os acordos');
eq((await json(await rotaFaturas.GET(pedir('GET', '/api/fornecedores/faturas')))).corpo.faturas.length, 0, 'outra agência: não vê as faturas');
eq((await rotaFatura.GET(pedir('GET', `/api/fornecedores/faturas/${F2.id}`), params(F2.id))).status, 404, 'outra agência: fatura alheia é 404');
eq((await rotaDesfazer.POST(pedir('POST', `/api/fornecedores/faturas/${fh.id}/desfazer`, { motivo: 'Tentativa de outra agência' }), params(fh.id))).status, 404, 'outra agência: não desfaz fatura alheia');
eq((await json(await rotaAFaturar.GET(pedir('GET', '/api/fornecedores/faturas/a-faturar')))).corpo.partes.length, 0, 'outra agência: nada a faturar');
eq((await previa({ parte_id: 'f-sol', conta_ids: [itemVA.conta_id] })).status, 409, 'outra agência: conta alheia não entra na prévia');
eq((await taxa({ venda_id: VC, produto_id: prodC.id, lado: 'DU', valor_centavos: 1, motivo: 'Tentativa de outra agência' })).status, 404, 'outra agência: não mexe na Taxa CC da venda alheia');
eq((await rotaCancelarSinal.POST(pedir('POST', `/api/fornecedores/sinais/${S2.id}/cancelar`, { motivo: 'Tentativa de outra agência' }), params(S2.id))).status, 404, 'outra agência: não cancela sinal alheio');
eq((await rotaRegra.GET(pedir('GET', '/api/fornecedores/regra-faturamento?parte_id=f-sol'))).status, 404, 'outra agência: não lê a regra do fornecedor alheio');
eq((await json(await rotaComissoes.GET(pedir('GET', '/api/fornecedores/comissoes?de=2026-10-01&ate=2026-11-30')))).corpo.operadoras.length, 0, 'outra agência: comissão vazia');
const alheio = await json(await rotaAcordo.PUT(pedir('PUT', `/api/fornecedores/acordos/${acordoNov}`, { fornecedor: { id: 'f-x' }, comissao_percentual: 50, vigencia_inicio: '2026-01-01' }), params(acordoNov)));
eq([alheio.status, (await um(`SELECT comissao_percentual FROM fornecedor_acordos WHERE id = $1`, [acordoNov])).comissao_percentual], [404, '12.0000'], 'outra agência: não muda o acordo alheio');
eq((await rotaAcordo.DELETE(pedir('DELETE', `/api/fornecedores/acordos/${acordoNov}`), params(acordoNov))).status, 404, 'outra agência: não exclui o acordo alheio');
globalThis.__SESSAO_DE_TESTE__ = null;

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
