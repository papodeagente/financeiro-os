/**
 * Integração com o CRM, fechamento da E7 (frente E, 06/11/2026), contra um
 * Postgres real (PGlite), pelo código DE PRODUÇÃO do webhook
 * (`processarEventoCRM`).
 *
 * O que se prova:
 *  (a) VENDA_FECHADA v2 completa no formato que o CRM passa a mandar: Taxa DU
 *      e RAV como componentes (o acerto com o fornecedor sem eles, a receita
 *      igual à margem do CRM), a comissão do vendedor guardada como
 *      referência e a multa da reserva sugerida no cancelamento;
 *  (b) empresa da venda: sem o campo, a principal (como sempre); pelo CNPJ a
 *      filial, com as contas junto; CNPJ desconhecido = principal com aviso no
 *      sino; reenvio sem o campo não muda a empresa; venda que já existe com
 *      CNPJ desconhecido fica onde está; `empresa_id` direto também vale;
 *  (c) EXTRATO_CONSOLIDADORA: vira conferência de operadora ABERTA (nada é
 *      aplicado sozinho: contas iguais), casa pelo localizador da venda, a
 *      comissão entra no esperado × recebido do fornecedor, aviso no sino;
 *      o mesmo extrato não abre outra conferência; extrato sem linha é
 *      ignorado sem erro; linha em outra moeda fica de fora com aviso.
 *
 * Uso: node --no-warnings scripts/test-sql-crm-venda-v2-completa.mjs
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
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'receita', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE config_apis (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (id, tenant_id));
  CREATE TABLE cartoes_corp (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', apelido TEXT DEFAULT '', bandeira TEXT DEFAULT '',
    ativo BOOLEAN DEFAULT TRUE, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE notas_fiscais (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', conta_receber_id TEXT NOT NULL DEFAULT '',
    venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RASCUNHO',
    referencia_gateway TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', usuario_id TEXT NOT NULL DEFAULT '', acao TEXT NOT NULL DEFAULT '', modulo TEXT NOT NULL DEFAULT '', entidade TEXT NOT NULL DEFAULT '', entidade_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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

for (const [mod, nome] of [
  ['../src/lib/baixas-servidor.ts', 'BAIXAS_SCHEMA_SQL'], ['../src/lib/periodo-fechado.ts', 'PERIODO_SCHEMA_SQL'],
  ['../src/lib/cobranca/schema.ts', 'COBRANCA_SCHEMA_SQL'], ['../src/lib/permissoes-schema.ts', 'PERMISSOES_SCHEMA_SQL'],
  ['../src/lib/venda-schema.ts', 'VENDA_SCHEMA_SQL'], ['../src/lib/fornecedor-schema.ts', 'FORNECEDOR_SCHEMA_SQL'],
  ['../src/lib/conferencia-operadora-schema.ts', 'CONFERENCIA_OPERADORA_SCHEMA_SQL'],
  ['../src/lib/fatura-schema.ts', 'FATURA_SCHEMA_SQL'],
  ['../src/lib/empresas-schema.ts', 'EMPRESAS_SCHEMA_SQL'],
  ['../src/lib/razao-schema.ts', 'RAZAO_SCHEMA_SQL'],
]) await pg.exec((await import(mod))[nome]);

const { processarEventoCRM } = await import('../src/lib/crm-integration.ts');
const srv = await import('../src/lib/venda-servidor.ts');
const { sugerirMulta } = await import('../src/lib/cancelamento.ts');
const { empresaPedidaPeloCrm } = await import('../src/lib/venda-crm-empresa.ts');
const { lerExtratoDoCrm } = await import('../src/lib/conferencia-operadora-crm.ts');

const T = 'agencia-e7e';
// Versão por agência (14/11/2026): o que este teste prova é da versão COMPLETA (modulos.ts).
await query(`INSERT INTO tenants (id, numero, data) VALUES ($1, 1, '{"fin_versao":"completa"}') ON CONFLICT (id) DO UPDATE SET data = tenants.data || EXCLUDED.data`, [T]);
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
await query(`INSERT INTO agencia (id, tenant_id, data) VALUES ('ag', $1, $2)`, [T, JSON.stringify({ nome_fantasia: 'Agência Matriz', cnpj: '11.111.111/0001-11' })]);
await query(`SELECT fin_empresa_principal($1)`, [T]);
await query(`INSERT INTO empresas (tenant_id, id, nome, cnpj) VALUES ($1, 'filial', 'Filial Centro', '98765432000110')`, [T]);

const empresaDaVenda = async crm => (await um(`SELECT data->>'empresa_id' AS e FROM vendas_crm WHERE tenant_id = $1 AND data->>'crm_venda_id' = $2`, [T, crm]))?.e ?? null;
const vendaPeloCrm = async crm => (await um(`SELECT id, data FROM vendas_crm WHERE tenant_id = $1 AND data->>'crm_venda_id' = $2`, [T, crm]));
const empresasDasContas = async vendaId => [...new Set([
  ...(await todos(`SELECT data->>'empresa_id' AS e FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, vendaId])).map(r => r.e),
  ...(await todos(`SELECT data->>'empresa_id' AS e FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, vendaId])).map(r => r.e),
])].sort();
const sino = async tipo => (await todos(`SELECT titulo, descricao, link FROM notificacoes WHERE tenant_id = $1 AND tipo = $2 ORDER BY created_at, id`, [T, tipo]));

const consolidadora = { fornecedor_id: 'crm_cnpj_11222333000181', crm_supplier_id: '44', fornecedor_nome: 'Consolidadora Azul', fornecedor_cnpj: '11222333000181' };
const v1 = (crm, o = {}) => ({
  versao_contrato: 2, crm_venda_id: crm, cliente_id: 'crm_contact_9', cliente_nome: 'Carla Dias', cliente_email: 'carla@x.com',
  data_venda: '2026-11-01', valor_total: 1000, custo_total: 800, vendedor_id: 'crm_user_5', vendedor_nome: 'Vendedora',
  fornecedores: [{ fornecedor_id: 'crm_supplier_11', fornecedor_nome: 'Hotel Mar', servico: 'HOTEL', valor_custo: 800, valor_venda: 1000 }],
  ...o,
});
// A v2 como o CRM passa a mandar: o aéreo do Studio com tarifa cotada, DU e
// RAV que voltam para a agência, a multa da reserva e a comissão do vendedor.
const v2 = (crm, o = {}) => ({
  ...v1(crm, { valor_total: 1280, custo_total: 950, fornecedores: [{ ...consolidadora, servico: 'AEREO', valor_custo: 950, valor_venda: 1280 }] }),
  versao_venda: 2,
  venda: {
    intermediario: null, centro_custo: '', observacoes: '',
    produtos: [{
      ref: 'item900', tipo: 'AEREO', descricao: 'GRU-SSA', produto_crm_id: '', fornecedor: consolidadora, representante: null,
      quem_cobra: 'AGENCIA', moeda: 'BRL', cambio: 1, localizador: 'AZ9876', data_inicio: '2026-12-20', data_fim: '2026-12-27', data_pagamento_fornecedor: '',
      quantidade: 1, valor_unitario: 0, taxas: 0, detalhes: { multa_a_partir_de: '2026-12-15', multa_cancelamento: '200.00' },
      passageiros: [{ ref: 'pax1', nome: 'Carla Dias', tipo: 'ADT', documento: '52998224725', tarifa: 975, taxas: 10, outras_taxas: 0 }],
      componentes: [
        { ref: 'comissao', tipo: 'COMISSAO', valor: 100 }, { ref: 'du', tipo: 'TAXA_DU', valor: 35 },
        { ref: 'rav', tipo: 'RAV', valor: 30 }, { ref: 'markup', tipo: 'MARKUP', valor: 230 },
      ],
    }],
    pagamentos: [{ ref: 'pp31', forma: 'PIX', valor: 500, parcelas: 1, primeiro_vencimento: '2026-11-01', intervalo_dias: 0, detalhe: 'Sinal da proposta, pago' }],
    comissao_vendedor: { percentual: 5, valor: 16.5 },
  },
  ...o,
});

try {
  console.log('--- regras puras ---');
  eq([empresaPedidaPeloCrm({}), empresaPedidaPeloCrm({ empresa_cnpj: '98.765.432/0001-10' }), empresaPedidaPeloCrm({ empresa_id: 'filial' })],
    [null, { id: '', cnpj: '98765432000110' }, { id: 'filial', cnpj: '' }], 'empresa pedida: nada, CNPJ (só dígitos) ou id');
  const semLinhas = lerExtratoDoCrm({ extrato_id: 'crm_extrato_1', linhas: [] });
  eq([semLinhas.ok, lerExtratoDoCrm({ linhas: [{}] }).ok], [false, false], 'extrato sem linha ou sem id: nada a conferir');

  console.log('--- (b) empresa: sem o campo, a principal, como sempre ---');
  let r = await processarEventoCRM('VENDA_FECHADA', v1('crm_deal_1'), 'e-1', T);
  eq([r.processado, await empresaDaVenda('crm_deal_1')], [true, 'principal'], 'venda sem empresa_cnpj nasce na principal');
  eq(await empresasDasContas((await vendaPeloCrm('crm_deal_1')).id), ['principal'], 'e as contas também');
  eq((await sino('VENDA_EMPRESA_NAO_ENCONTRADA')).length, 0, 'sem aviso');

  console.log('--- (a) v2 completa, (b) pelo CNPJ da filial ---');
  r = await processarEventoCRM('VENDA_FECHADA', v2('crm_deal_2', { empresa_cnpj: '98765432000110' }), 'e-2', T);
  if (!r.processado) console.log('ERRO v2:', r.erro, r.acao);
  eq([r.processado, /pelo contrato v2/.test(r.acao)], [true, true], 'v2 processada');
  const V2 = await vendaPeloCrm('crm_deal_2');
  eq([V2.data.empresa_id, await empresasDasContas(V2.id)], ['filial', ['filial']], 'venda e contas na filial do CNPJ');
  const carregada = await srv.carregarVenda(pool, T, V2.id);
  const produto = carregada.venda.produtos[0];
  eq(produto.componentes.map(c => [c.tipo, c.valor_centavos]).sort(), [['COMISSAO', 10000], ['MARKUP', 23000], ['RAV', 3000], ['TAXA_DU', 3500]].sort(), 'Taxa DU e RAV gravadas como componentes');
  const pagar = await todos(`SELECT data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, V2.id]);
  eq(pagar.map(p => [p.data.fornecedor_nome, p.data.valor_final]), [['Consolidadora Azul', 885]], 'acerto com a consolidadora: tarifa + taxas − comissão (sem DU e RAV, que voltam)');
  const receber = (await todos(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, V2.id])).map(c => c.data);
  eq(receber.reduce((a, c) => a + Math.round(c.valor_final * 100), 0), 128000, 'o cliente paga a venda inteira do CRM');
  const modelo = await um(`SELECT receita_centavos FROM vendas_modelo WHERE tenant_id = $1 AND venda_id = $2`, [T, V2.id]);
  eq(Number(modelo.receita_centavos), 128000 - 95000 + 6500, 'receita = margem bruta do CRM (venda − custo + DU + RAV)');
  eq(V2.data.comissao_vendedor_crm, { percentual: 5, valor_centavos: 1650 }, 'comissão do vendedor do CRM guardada como referência');
  const multa = sugerirMulta(produto, 88500, '2026-12-16', null);
  eq([multa.origem, multa.centavos], ['reserva', 20000], 'cancelamento depois do prazo: sugere a multa da reserva');
  eq(sugerirMulta(produto, 88500, '2026-12-10', null).centavos, 0, 'antes do prazo da reserva: sem multa');

  console.log('--- (b) reenvio sem o campo não muda; CNPJ desconhecido ---');
  r = await processarEventoCRM('VENDA_FECHADA', v2('crm_deal_2'), 'e-2b', T);
  eq([r.processado, await empresaDaVenda('crm_deal_2')], [true, 'filial'], 'reenvio sem empresa_cnpj: continua na filial');
  r = await processarEventoCRM('VENDA_FECHADA', v1('crm_deal_3', { empresa_cnpj: '55555555000155' }), 'e-3', T);
  eq([r.processado, await empresaDaVenda('crm_deal_3'), /não é de nenhuma empresa ativa/.test(r.acao)], [true, 'principal', true], 'CNPJ desconhecido: principal, com o motivo no histórico do evento');
  const avisos = await sino('VENDA_EMPRESA_NAO_ENCONTRADA');
  eq([avisos.length, /55\.555\.555\/0001-55/.test(avisos[0]?.descricao ?? ''), /Configurações › Empresas/.test(avisos[0]?.descricao ?? '')], [1, true, true], 'aviso no sino com o CNPJ e onde conferir');
  r = await processarEventoCRM('VENDA_FECHADA', v2('crm_deal_2', { empresa_cnpj: '55555555000155' }), 'e-2c', T);
  eq([await empresaDaVenda('crm_deal_2'), /continua na empresa em que estava/.test(r.acao)], ['filial', true], 'venda que já existe com CNPJ desconhecido: fica onde está');
  r = await processarEventoCRM('VENDA_FECHADA', v1('crm_deal_4', { empresa_id: 'filial' }), 'e-4', T);
  eq(await empresaDaVenda('crm_deal_4'), 'filial', 'empresa_id daqui também vale');
  r = await processarEventoCRM('VENDA_FECHADA', v1('crm_deal_1', { empresa_cnpj: '98765432000110' }), 'e-1b', T);
  eq([await empresaDaVenda('crm_deal_1'), await empresasDasContas((await vendaPeloCrm('crm_deal_1')).id)], ['filial', ['filial']], 'venda em aberto mudada de empresa pelo CRM: as contas em aberto vão junto');

  console.log('--- (c) extrato da consolidadora ---');
  const contasAntes = await todos(`SELECT id, data->>'status' AS s, data->>'valor_final' AS v FROM contas_receber WHERE tenant_id = $1 UNION ALL SELECT id, data->>'status', data->>'valor_final' FROM contas_pagar WHERE tenant_id = $1 ORDER BY 1`, [T]);
  const extrato = {
    versao: 1, extrato_id: 'crm_extrato_5', arquivo_nome: 'extrato-out.csv', formato: 'csv', impressao: 'abc',
    operadora_nome: 'Consolidadora Azul', fornecedor: consolidadora, moeda: 'BRL', periodo_de: '2026-10-01', periodo_ate: '2026-10-31', total_comissao: 230,
    linhas: [
      { ref: 'l11', localizador: 'XYZ999', localizador_da_venda: '', passageiro: 'Davi Dias', bilhete: '', data: '2026-10-12', comissao: 100, moeda: 'BRL', crm_venda_id: '', situacao_no_crm: 'sem_reserva' },
      { ref: 'l12', localizador: 'AZ98-76X', localizador_da_venda: 'AZ9876', passageiro: 'Carla Dias', bilhete: '9571234567890', data: '2026-10-10', comissao: 150, moeda: 'BRL', crm_venda_id: 'crm_deal_2', situacao_no_crm: 'a_maior' },
      { ref: 'l13', localizador: 'AZ98-76X', localizador_da_venda: 'AZ9876', passageiro: 'Carla Dias', bilhete: '9571234567890', data: '2026-10-20', comissao: -20, moeda: 'BRL', crm_venda_id: 'crm_deal_2', situacao_no_crm: 'a_menor' },
    ],
  };
  r = await processarEventoCRM('EXTRATO_CONSOLIDADORA', extrato, 'x-1', T);
  eq([r.processado, /aberto para conferir/.test(r.acao)], [true, true], 'extrato do CRM aberto para conferir');
  const confs = await todos(`SELECT id, origem, status, fornecedor_id, fornecedor_nome, arquivo_hash FROM conferencias_operadora WHERE tenant_id = $1`, [T]);
  const forn = await um(`SELECT id FROM fornecedores_crm WHERE tenant_id = $1 AND crm_supplier_id = '44'`, [T]);
  eq(confs.map(c => [c.origem, c.status, c.fornecedor_id === forn.id, c.fornecedor_nome, c.arquivo_hash]), [['crm', 'ABERTA', true, 'Consolidadora Azul', 'crm:crm_extrato_5']],
    'uma conferência ABERTA, origem CRM, ligada à consolidadora (o mesmo cadastro da venda)');
  const linhas = await todos(`SELECT ordem, localizador, tipo, comissao_centavos, venda_id, como_casou, descricao FROM conferencias_operadora_linhas WHERE tenant_id = $1 AND conferencia_id = $2 ORDER BY ordem`, [T, confs[0].id]);
  eq(linhas.map(l => [l.localizador, l.tipo, Number(l.comissao_centavos), l.venda_id === V2.id, l.como_casou]), [
    ['XYZ999', 'venda', 10000, false, 'nenhum'],
    ['AZ9876', 'venda', 15000, true, 'localizador'],
    ['AZ9876', 'cancelamento', 2000, true, 'localizador'],
  ], 'casa pelo localizador que a venda guarda; o estorno devolve');
  eq(/localizador no extrato AZ9876X/.test(linhas[1].descricao) && /Bilhete 9571234567890/.test(linhas[1].descricao), true, 'o localizador do extrato e o bilhete ficam na descrição');
  const esperado = await todos(`SELECT venda_id, valor_centavos, parte_id FROM fornecedor_extrato_comissoes WHERE tenant_id = $1 AND referencia LIKE $2 ORDER BY referencia`, [T, `conferencia:${confs[0].id}:%`]);
  eq(esperado.map(x => [x.venda_id === V2.id, Number(x.valor_centavos), x.parte_id === forn.id]), [[false, 10000, true], [true, 15000, true], [true, -2000, true]],
    'a comissão de cada linha entra no esperado × recebido da consolidadora');
  const contasDepois = await todos(`SELECT id, data->>'status' AS s, data->>'valor_final' AS v FROM contas_receber WHERE tenant_id = $1 UNION ALL SELECT id, data->>'status', data->>'valor_final' FROM contas_pagar WHERE tenant_id = $1 ORDER BY 1`, [T]);
  eq(contasDepois, contasAntes, 'nada aplicado sozinho: nenhuma conta mudou');
  const avisoExtrato = await sino('EXTRATO_OPERADORA_DO_CRM');
  eq([avisoExtrato.length, avisoExtrato[0]?.link, /Nada foi baixado nem cancelado/.test(avisoExtrato[0]?.descricao ?? '')],
    [1, `/financeiro-ag/conferencia-operadora?id=${encodeURIComponent(confs[0].id)}`, true], 'aviso no sino com o link da conferência');

  r = await processarEventoCRM('EXTRATO_CONSOLIDADORA', { ...extrato, impressao: 'def' }, 'x-2', T);
  eq([r.processado, /já está na conferência/.test(r.acao), (await todos(`SELECT id FROM conferencias_operadora WHERE tenant_id = $1`, [T])).length],
    [true, true, 1], 'o mesmo extrato de novo: não abre outra conferência');
  r = await processarEventoCRM('EXTRATO_CONSOLIDADORA', { extrato_id: 'crm_extrato_6', linhas: [] }, 'x-3', T);
  eq([r.processado, /nada a conferir/.test(r.acao)], [true, true], 'extrato sem linha: processado, nada a conferir');
  r = await processarEventoCRM('EXTRATO_CONSOLIDADORA', {
    extrato_id: 'crm_extrato_7', operadora_nome: 'Operadora Sem Cadastro', moeda: 'BRL', total_comissao: 60,
    linhas: [{ ref: 'a', localizador: 'QQ1111', data: '2026-10-02', comissao: 10, moeda: 'BRL' }, { ref: 'b', localizador: 'QQ2222', data: '2026-10-02', comissao: 50, moeda: 'USD' }],
  }, 'x-4', T);
  const c7 = await um(`SELECT fornecedor_id, fornecedor_nome FROM conferencias_operadora WHERE tenant_id = $1 AND arquivo_hash = 'crm:crm_extrato_7'`, [T]);
  eq([r.processado, /em outra moeda ficaram de fora/.test(r.acao), /sem operadora ligada/.test(r.acao), c7.fornecedor_id, c7.fornecedor_nome],
    [true, true, true, '', 'Operadora Sem Cadastro'], 'linha em outra moeda fica de fora; sem cadastro, a conferência abre sem operadora ligada');

  console.log('--- (d) regra de 13/11 também na v2: quem recebe do cliente ---');
  {
    const hotel = { fornecedor_id: 'crm_cnpj_33444555000172', crm_supplier_id: '61', fornecedor_nome: 'Hotel Sol', fornecedor_cnpj: '33444555000172' };
    const produto = (ref, o = {}) => ({
      ref, tipo: 'HOTEL', descricao: `Hotel ${ref}`, fornecedor: hotel, representante: null, moeda: 'BRL', cambio: 1,
      quantidade: 1, valor_unitario: 1000, taxas: 0, passageiros: [], componentes: [{ ref: 'c', tipo: 'COMISSAO', valor: 150 }], ...o,
    });
    const venda = (crm, produtos, o = {}) => ({
      ...v1(crm, { valor_total: 1000, custo_total: 850, fornecedores: [{ ...hotel, servico: 'HOTEL', valor_custo: 850, valor_venda: 1000 }] }),
      versao_venda: 2, venda: { intermediario: null, centro_custo: '', observacoes: '', produtos, pagamentos: [] }, ...o,
    });
    const contas = async crm => {
      const v = await vendaPeloCrm(crm);
      return {
        receber: (await todos(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, v.id])).map(c => [c.data.origem, c.data.valor_final]).sort(),
        pagar: (await todos(`SELECT data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, v.id])).map(c => [c.data.fornecedor_nome, c.data.valor_final, c.data.crm_item_ids ?? null]).sort(),
      };
    };
    r = await processarEventoCRM('VENDA_FECHADA', venda('crm_deal_r1', [produto('p1')]), 'r-1', T);
    eq([r.processado, await contas('crm_deal_r1')], [true, { receber: [['VENDA', 1000]], pagar: [['Hotel Sol', 850, null]] }],
      'padrão: a agência recebe do cliente e abre a conta a pagar do fornecedor');
    const hotelId = (await um(`SELECT id FROM fornecedores_crm WHERE tenant_id = $1 AND crm_supplier_id = '61'`, [T])).id;
    await query(`UPDATE fornecedores_crm SET data = data || '{"recebe_direto_do_cliente":true}' WHERE id = $1`, [hotelId]);
    r = await processarEventoCRM('VENDA_FECHADA', venda('crm_deal_r2', [produto('p1')]), 'r-2', T);
    eq(await contas('crm_deal_r2'), { receber: [['COMISSAO_FORNECEDOR', 150]], pagar: [] },
      'fornecedor marcado "recebe direto do cliente": só a comissão a receber, como na v1');
    r = await processarEventoCRM('VENDA_FECHADA', venda('crm_deal_r3', [produto('p1')], { plataforma_origem: 'pagarme', plataforma_transacao: 'or_9', plataforma_transacoes: ['or_9'] }), 'r-3', T);
    eq((await contas('crm_deal_r3')).pagar.length, 1, 'pago pela plataforma da agência: a agência recebe e paga o fornecedor');
    await query(`UPDATE fornecedores_crm SET data = data - 'recebe_direto_do_cliente' WHERE id = $1`, [hotelId]);
    r = await processarEventoCRM('VENDA_FECHADA', venda('crm_deal_r4', [produto('p1', { cobrado_pelo_fornecedor: true })]), 'r-4', T);
    eq(await contas('crm_deal_r4'), { receber: [['COMISSAO_FORNECEDOR', 150]], pagar: [] }, 'item cobrado pelo fornecedor na Cotação: pago direto');
    r = await processarEventoCRM('VENDA_FECHADA', venda('crm_deal_r5', [produto('p1', { fornecedor: null, crm_item_ids: [301, 302] })]), 'r-5', T);
    const semForn = await todos(`SELECT data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, (await vendaPeloCrm('crm_deal_r5')).id]);
    eq(semForn.map(c => [c.data.fornecedor_pendente === true, c.data.crm_item_ids]), [[true, [301, 302]]],
      'produto sem fornecedor: conta pendente com os itens da Cotação (para o FORNECEDOR_DO_ITEM)');
  }
} finally {
  console.log(`\n${total - falhas}/${total} passaram`);
  if (falhas > 0) process.exit(1);
}
