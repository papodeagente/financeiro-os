/**
 * Roteiro da venda do CRM na VERSÃO SIMPLES (14/11/2026).
 *
 * O mesmo roteiro roda em dois códigos:
 *  - o da versão simples de `origin/main` (commit a9fd7cf), uma vez, para
 *    gravar o retrato em scripts/fixtures/venda-crm-simples-a9fd7cf.json
 *    (scripts/gerar-retrato-venda-crm-simples.mjs);
 *  - o de hoje, para uma agência SEM módulos, no teste
 *    scripts/test-sql-venda-crm-simples-congelada.mjs, que exige o mesmo
 *    retrato.
 *
 * Cobre a regra de 13/11/2026 (8677b39, 092274a, b7360fd): a agência recebe
 * do cliente e abre um a pagar por fornecedor; "recebe direto do cliente" no
 * cadastro; pagamento por plataforma; custo sem fornecedor; margem zero;
 * forma e 1º vencimento das condições; parcelado no cartão (pergunta do
 * recebimento); itens sem fornecedor da Cotação e "cobrado pelo fornecedor";
 * forma e parcelas do pagamento ao fornecedor; reenvio; e a VENDA_FECHADA v2
 * numa agência sem o módulo (lida como v1). Mais a confirmação de pagamento.
 *
 * O retrato tira o que muda de uma rodada para outra (ids sorteados, hora,
 * data de hoje) e troca os ids sorteados de cliente, fornecedor e item por
 * nomes estáveis.
 */

export const TABELAS_SQL = `
  CREATE TABLE crm_eventos_entrada (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'RECEBIDO', processado BOOLEAN NOT NULL DEFAULT false, erro TEXT, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
  CREATE TABLE tenants (id TEXT PRIMARY KEY, numero INTEGER, data JSONB NOT NULL DEFAULT '{}'::jsonb);
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', cpf_cnpj TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT 'fisica', data JSONB NOT NULL, external_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE membros (id TEXT PRIMARY KEY, nome TEXT NOT NULL DEFAULT '', cargo TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE vendas_crm (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'orcamento', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE fornecedores_crm (id TEXT PRIMARY KEY, nome_fantasia TEXT NOT NULL DEFAULT '', cnpj TEXT NOT NULL DEFAULT '', categoria TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, external_id TEXT, crm_supplier_id TEXT, crm_atualizado_em TIMESTAMPTZ, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_fornecedores_crm_external_id ON fornecedores_crm(tenant_id, external_id) WHERE external_id IS NOT NULL AND external_id <> '';
  CREATE UNIQUE INDEX idx_fornecedores_crm_cnpj ON fornecedores_crm(tenant_id, cnpj) WHERE cnpj IS NOT NULL AND cnpj <> '';
  CREATE UNIQUE INDEX idx_fornecedores_crm_crm_supplier ON fornecedores_crm(tenant_id, crm_supplier_id) WHERE crm_supplier_id IS NOT NULL AND crm_supplier_id <> '';
  CREATE TABLE itens_venda (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', sequencia INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ativo', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_receber (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pendente', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_notificacoes_dedup ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE TABLE plataformas_transacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_transacao TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`;

export const T1 = 'agencia-simples';

const japao = (o = {}) => ({
  versao_contrato: 2, crm_venda_id: 'crm_deal_1', cliente_id: 'crm_contact_1', cliente_nome: 'Bruno Barbosa da Silva',
  cliente_cpf_cnpj: '52998224725', cliente_tipo: 'fisica', cliente_email: 'bruno@x.com', cliente_telefone: '11999990000',
  valor_total: 390.63, custo_total: 312.5, data_venda: '2026-10-09',
  fornecedores: [{
    fornecedor_id: 'crm_cnpj_11222333000181', crm_supplier_id: '7', financeiro_id: null,
    fornecedor_nome: 'Cativa Operadora', fornecedor_cnpj: '11222333000181',
    servico: 'PACOTE', descricao: 'Grupo Japão', valor_custo: 312.5, valor_venda: 390.63,
  }],
  ...o,
});

/** Roda o roteiro inteiro. `processar` = processarEventoCRM do código em teste. */
export async function rodar(processar, query) {
  await query(`INSERT INTO tenants (id, numero, data) VALUES ($1, 1, '{}')`, [T1]);
  await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1',$1,'{"nome":"Itaú","saldo_atual":0}')`, [T1]);
  let seq = 0;
  const acoes = [];
  const evento = async (tipo, payload) => {
    const r = await processar(tipo, payload, `ev-${++seq}`, T1);
    acoes.push({ ev: seq, tipo, processado: r.processado });
  };
  const cativa = async () => (await query(`SELECT id FROM fornecedores_crm WHERE tenant_id = $1 AND crm_supplier_id = '7'`, [T1])).rows[0].id;

  // (0) o padrão: a agência recebe do cliente e paga o fornecedor.
  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_0' }));
  // (a) Cativa marcada como "recebe direto do cliente": só a comissão.
  await query(`UPDATE fornecedores_crm SET data = data || '{"recebe_direto_do_cliente":true}' WHERE id = $1`, [await cativa()]);
  await evento('VENDA_FECHADA', japao());
  // (b) reenvio, com a comissão já recebida.
  await evento('VENDA_FECHADA', japao());
  await query(`UPDATE contas_receber SET status = 'RECEBIDO', data = data || '{"status":"RECEBIDO","valor_recebido":78.13,"conta_bancaria_id":"b1"}'
                WHERE tenant_id = $1 AND data->>'origem_venda_id' = (SELECT id FROM vendas_crm WHERE data->>'crm_venda_id' = 'crm_deal_1')`, [T1]);
  await evento('VENDA_FECHADA', japao());
  // (c) pago pela plataforma da agência desfaz a exceção.
  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_3', plataforma_origem: 'pagarme', plataforma_transacao: 'or_123', plataforma_transacoes: ['or_123'] }));
  // (d) custo sem fornecedor; venda sem custo.
  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_4', valor_total: 600, custo_total: 500, fornecedores: [] }));
  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_5', valor_total: 300, custo_total: 0, fornecedores: [] }));
  // (e) margem zero: a comissão padrão do cadastro.
  await query(`UPDATE fornecedores_crm SET data = jsonb_set(data, '{regras_faturamento}', '{"comissao_padrao":10}') WHERE id = $1`, [await cativa()]);
  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_6', valor_total: 1000, custo_total: 1000, fornecedores: [{ ...japao().fornecedores[0], valor_custo: 1000, valor_venda: 1000 }] }));
  // Daqui em diante, a Cativa volta ao padrão (a agência recebe).
  await query(`UPDATE fornecedores_crm SET data = data - 'recebe_direto_do_cliente' WHERE id = $1`, [await cativa()]);
  // (f) cartão em 3x: forma e 1º vencimento do CRM, pergunta do recebimento.
  await evento('VENDA_FECHADA', japao({
    crm_venda_id: 'crm_deal_8', valor_total: 900, custo_total: 600,
    fornecedores: [{ ...japao().fornecedores[0], valor_custo: 600, valor_venda: 900 }],
    condicoes_pagamento: [
      { parcela: 1, valor: 300, vencimento: '2026-11-15', forma_pagamento: 'cartao_credito' },
      { parcela: 2, valor: 300, vencimento: '2026-12-15', forma_pagamento: 'cartao_credito' },
      { parcela: 3, valor: 300, vencimento: '2027-01-15', forma_pagamento: 'cartao_credito' },
    ],
  }));
  // (g) boleto à vista com vencimento informado.
  await evento('VENDA_FECHADA', japao({
    crm_venda_id: 'crm_deal_9',
    condicoes_pagamento: [{ parcela: 1, valor: 390.63, vencimento: '2026-10-20', forma_pagamento: 'boleto' }],
  }));
  // (h) Cotação: item sem fornecedor e item cobrado pelo fornecedor.
  await evento('VENDA_FECHADA', japao({
    crm_venda_id: 'crm_deal_10', valor_total: 1500, custo_total: 1200,
    fornecedores: [
      { ...japao().fornecedores[0], valor_custo: 500, valor_venda: 700, crm_item_ids: [11, 12] },
      { fornecedor_id: 'crm_cnpj_33444555000172', crm_supplier_id: '9', fornecedor_nome: 'Hotel Sol', fornecedor_cnpj: '33444555000172',
        servico: 'HOSPEDAGEM', descricao: 'Hotel', valor_custo: 200, valor_venda: 300, crm_item_ids: [13], cobrado_pelo_fornecedor: true },
    ],
    itens_sem_fornecedor: [{ crm_item_id: 14, descricao: 'Passeio', servico: 'PASSEIO', valor_custo: 500, valor_venda: 500 }],
  }));
  // (i) pagamento ao fornecedor em boleto 2x.
  await evento('VENDA_FECHADA', japao({
    crm_venda_id: 'crm_deal_11',
    fornecedores: [{ ...japao().fornecedores[0], pagamento_ao_fornecedor: { forma: 'boleto', parcelas: [
      { numero: 1, valor: 156.25, vencimento: '2026-10-20' }, { numero: 2, valor: 156.25, vencimento: '2026-11-20' },
    ] } }],
  }));
  // (j) VENDA_FECHADA v2 numa agência sem o módulo: lida pelos campos da v1.
  await evento('VENDA_FECHADA', japao({
    crm_venda_id: 'crm_deal_12', versao_venda: 2,
    venda: { produtos: [{ ref: 'p1', tipo: 'PACOTE', descricao: 'Grupo Japão', quantidade: 1, valor_unitario: 390.63, quem_cobra: 'AGENCIA',
      fornecedor: { fornecedor_id: 'crm_cnpj_11222333000181', crm_supplier_id: '7', fornecedor_nome: 'Cativa Operadora' },
      componentes: [{ tipo: 'TARIFA', valor: 312.5 }] }], pagamentos: [{ ref: 'g1', forma: 'PIX', valor: 390.63, parcelas: 1 }] },
  }));
  // (k) o CRM confirma o pagamento da 1ª parcela da venda (0).
  const v0 = (await query(`SELECT id FROM vendas_crm WHERE data->>'crm_venda_id' = 'crm_deal_0'`)).rows[0].id;
  await query(`UPDATE contas_receber SET data = data || '{"conta_bancaria_id":"b1"}' WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T1, v0]);
  await evento('PAGAMENTO_CONFIRMADO', { entur_venda_id: v0, parcela: 1, valor: 390.63, data_pagamento: '2026-10-15' });
  return acoes;
}

const VOLATEIS = new Set(['created_at', 'updated_at', 'data_emissao', 'received_at', 'id']);

/** O estado do banco depois do roteiro, sem o que muda de uma rodada para outra. */
export async function retrato(query) {
  const nomes = new Map();
  for (const r of (await query(`SELECT id, external_id FROM clientes WHERE tenant_id = $1`, [T1])).rows) nomes.set(r.id, `cliente:${r.external_id}`);
  for (const r of (await query(`SELECT id, crm_supplier_id, nome_fantasia FROM fornecedores_crm WHERE tenant_id = $1`, [T1])).rows) nomes.set(r.id, `fornecedor:${r.crm_supplier_id || r.nome_fantasia}`);
  const itens = (await query(`SELECT id, venda_id, data FROM itens_venda WHERE tenant_id = $1`, [T1])).rows
    .sort((a, b) => `${a.venda_id}|${a.data.descricao}|${a.data.valor_custo}`.localeCompare(`${b.venda_id}|${b.data.descricao}|${b.data.valor_custo}`));
  itens.forEach((r, i) => nomes.set(r.id, `item:${r.venda_id}:${r.data.descricao}:${r.data.valor_custo}`));
  const limpar = v => {
    if (Array.isArray(v)) return v.map(limpar);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) {
        if (VOLATEIS.has(k)) continue;
        if (k === 'contas_geradas_ids') { o[k] = Array.isArray(v[k]) ? v[k].length : v[k]; continue; }
        // Chave natural: "<fornecedor>|<itens>|parcela:n", com o id sorteado do fornecedor.
        if (k === 'chave_natural' && typeof v[k] === 'string') { o[k] = v[k].split('|').map(p => nomes.get(p) ?? p).join('|'); continue; }
        // Conta preservada de um item que a regeração já trocou: o id antigo é sorteado.
        if (k === 'origem_item_id' && typeof v[k] === 'string' && !nomes.has(v[k])) { o[k] = '(item anterior)'; continue; }
        o[k] = limpar(v[k]);
      }
      return o;
    }
    if (typeof v === 'string' && nomes.has(v)) return nomes.get(v);
    return v;
  };
  const chave = c => JSON.stringify([c.origem_venda_id ?? c.venda_id, c.origem, c.descricao, c.parcela_numero, c.valor_final, c.fornecedor_id ?? c.cliente_id]);
  const ordenar = lista => lista.sort((a, b) => chave(a).localeCompare(chave(b)));
  const linhas = async (sql) => (await query(sql, [T1])).rows;
  return {
    vendas: (await linhas(`SELECT data, status FROM vendas_crm WHERE tenant_id = $1 ORDER BY id`)).map(r => limpar({ ...r.data, _status: r.status })),
    itens: itens.map(r => limpar(r.data)),
    receber: ordenar((await linhas(`SELECT data, status FROM contas_receber WHERE tenant_id = $1`)).map(r => limpar({ ...r.data, _status: r.status }))),
    pagar: ordenar((await linhas(`SELECT data, status FROM contas_pagar WHERE tenant_id = $1`)).map(r => limpar({ ...r.data, _status: r.status }))),
    bancos: (await linhas(`SELECT id, data FROM contas_bancarias WHERE tenant_id = $1 ORDER BY id`)).map(r => ({ id: r.id, saldo_atual: r.data.saldo_atual })),
    notificacoes: (await linhas(`SELECT tipo, titulo, link, chave_deduplicacao FROM notificacoes WHERE tenant_id = $1 ORDER BY tipo, titulo`)).map(limpar),
    saida: (await linhas(`SELECT tipo, data FROM crm_eventos_saida WHERE tenant_id = $1 ORDER BY tipo`)).map(r => limpar({ tipo: r.tipo, evento: r.data?.tipo ?? null })),
  };
}
