/**
 * Vendas do CRM (contrato v2) contra um Postgres real (PGlite), rodando o
 * webhook DE PRODUÇÃO inteiro: processarEventoCRM, a rota HTTP, a
 * conciliação das plataformas e a unificação, com o pool trocado pelo PGlite
 * (scripts/db-de-teste-hook.mjs). Nenhum banco de verdade é tocado.
 *
 * O que se prova:
 *   (a) identidade do cliente: adota cadastro sem vínculo pelo CPF/CNPJ e
 *       pelo e-mail, nunca adota cadastro ligado a outro contato do CRM, e o
 *       id antigo de um contato mesclado leva o vínculo para o id novo;
 *   (b) venda fechada só preenche vazio; CLIENTE_ATUALIZADO sobrescreve
 *       colunas e JSON; null nunca apaga;
 *   (c) a venda que informa a transação vincula o pagamento já importado e
 *       sem dono, a conta a receber é consumida UMA vez (reprocessar move
 *       zero), o carimbo feito à mão vence, e o pagamento que chega depois
 *       acha a venda pelo id, mesmo com a conciliação automática desligada;
 *   (d) VENDA_CANCELADA cancela o que está em aberto, preserva o baixado, é
 *       idempotente, e "aprovar" não cancela nada;
 *   (e) o webhook responde 5xx quando o processamento falha.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-vendas-do-crm.mjs
 */
import { register } from 'node:module';
import { createHmac } from 'node:crypto';
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
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', banco TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_notificacoes_deduplicacao ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE TABLE plataformas_transacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_transacao TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX uq_plataformas_transacoes ON plataformas_transacoes(tenant_id, plataforma, id_transacao);
`);

// O pool de produção, trocado pelo PGlite. `falharSQL` simula o banco caindo
// no meio do processamento.
let falharSQL = null;
const query = async (text, values) => {
  if (falharSQL && falharSQL.test(text)) throw new Error('conexão perdida no meio do evento');
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { processarEventoCRM } = await import('../src/lib/crm-integration.ts');
const { sincronizarTransacao } = await import('../src/lib/plataformas/servico.ts');
const { vincularVenda } = await import('../src/lib/plataformas/fila.ts');
const { emTransacao } = await import('../src/lib/caixa-atomico.ts');
const { montarParcelas } = await import('../src/lib/plataformas/comum.ts');
const { mesclarCliente } = await import('../src/lib/crm-cliente.ts');
const { decidirCarimbo, lerPlataformaDoPayload } = await import('../src/lib/crm-venda-plataforma.ts');
const rota = await import('../src/app/api/v1/crm/webhook/[tenantId]/route.ts');
const { NextRequest } = await import('next/server.js');

const T1 = 'agencia-a', T2 = 'agencia-b';
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1',$1,'{"nome":"Itaú","saldo_atual":10000}'), ('b2',$2,'{"nome":"Inter","saldo_atual":500}')`, [T1, T2]);

let seq = 0;
const evento = (tipo, payload, id = `ev-${++seq}`, tenant = T1) => processarEventoCRM(tipo, payload, id, tenant);
const venda = (o = {}) => ({
  versao_contrato: 2, crm_venda_id: 'crm_deal_1', cliente_id: 'crm_contact_1',
  cliente_nome: 'Maria Souza', cliente_cpf_cnpj: null, cliente_tipo: null, cliente_email: '', cliente_telefone: '',
  valor_total: 1000, custo_total: 600, data_venda: '2026-10-06',
  fornecedores: [{ fornecedor_id: 'crm_supplier_1', fornecedor_nome: 'CVC', valor_custo: 600, valor_venda: 1000 }],
  ...o,
});
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const cliente = id => um(`SELECT id, nome, cpf_cnpj, tipo, external_id, data FROM clientes WHERE id = $1`, [id]);
const vendaDo = crmId => um(`SELECT id, status, cliente_id, data FROM vendas_crm WHERE tenant_id = $1 AND data->>'crm_venda_id' = $2`, [T1, crmId]);
const crsDaVenda = vendaId => todos(`SELECT id, status, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 ORDER BY id`, [T1, vendaId]);
const saldo = async (id = 'b1') => Number((await um(`SELECT (data->>'saldo_atual')::numeric s FROM contas_bancarias WHERE id = $1`, [id])).s);
async function novoCliente(id, tenant, d, extra = {}) {
  await query(
    `INSERT INTO clientes (id, tenant_id, nome, cpf_cnpj, tipo, data, external_id, created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7, NOW() - ($8 || ' minutes')::interval)`,
    [id, tenant, d.nome ?? '', extra.cpf_cnpj ?? d.cpf_cnpj ?? '', extra.tipo ?? d.tipo ?? 'fisica', JSON.stringify({ id, ...d }), extra.external_id ?? null, String(extra.idade ?? 60)],
  );
}

/** O pagamento como a integração da plataforma grava: o caminho de escrita único. */
function transacaoAsaas(id, o = {}) {
  const parcelas = montarParcelas({
    total: o.total ?? 1000, taxaTotal: o.taxa ?? 50, quantidade: 1, status: o.status ?? 'RECEBIDO',
    primeiroVencimento: o.data ?? '2026-10-06', dataPagamento: o.data ?? '2026-10-06', dataRecebimento: o.status && o.status !== 'RECEBIDO' ? '' : (o.data ?? '2026-10-06'), idBase: id,
  });
  return {
    id_transacao: id, id_assinatura: '',
    comprador: { nome: o.nome ?? 'Comprador', email: o.email ?? '', documento: o.documento ?? '', telefone: '' },
    itens: [], valor_bruto: o.total ?? 1000, valor_taxa: o.taxa ?? 50, valor_liquido: (o.total ?? 1000) - (o.taxa ?? 50),
    desconto: 0, juros: 0, moeda: 'BRL', forma_pagamento: 'PIX', detalhe_pagamento: '', parcelas,
    data_venda: o.data ?? '2026-10-06', descricao: 'Pacote', bruto: {},
  };
}
const importar = (t, auto = false, tenant = T1) =>
  emTransacao(exec => sincronizarTransacao(exec, tenant, 'asaas', t, { contaBancariaId: tenant === T1 ? 'b1' : 'b2', conciliacaoAutomatica: auto }));
const tx = id => um(`SELECT venda_id, status_conciliacao, data FROM plataformas_transacoes WHERE tenant_id = $1 AND id_transacao = $2`, [T1, id]);

// ══════════════════════════════════════════════════════════════════════
console.log('--- (a) identidade: adoção pelo documento ---');
{
  // A Hotmart criou a Maria antes do CRM mandar a venda. Mesmo CPF.
  await novoCliente('c-hot', T1, { nome: 'Maria (Hotmart)', cpf_cnpj: '52998224725', email: 'maria.hot@x.com', origem: 'hotmart' });
  // A outra agência tem uma Maria com o mesmo CPF: não pode ser tocada.
  await novoCliente('c-b', T2, { nome: 'Maria da agência B', cpf_cnpj: '52998224725' });
  const r = await evento('VENDA_FECHADA', venda({
    cliente_cpf_cnpj: '52998224725', cliente_tipo: 'fisica', cliente_email: 'maria@x.com', cliente_telefone: '11999998888',
    cliente_empresa: { nome: 'Souza Turismo', cnpj: '11222333000181' },
  }));
  eq(r.processado, true, 'a venda entra');
  const v = await vendaDo('crm_deal_1');
  eq(v.cliente_id, 'c-hot', 'a venda aponta para o cadastro que já existia, adotado pelo CPF');
  eq((await um(`SELECT COUNT(*)::int c FROM clientes WHERE tenant_id = $1`, [T1])).c, 1, 'nenhum cadastro duplicado');
  const c = await cliente('c-hot');
  eq(c.external_id, 'crm_contact_1', 'o cadastro adotado passa a carregar o id do contato');
  eq([c.nome, c.data.email], ['Maria (Hotmart)', 'maria.hot@x.com'], 'nome e e-mail que já existiam não são trocados pela venda');
  eq([c.data.telefone, c.data.empresa?.nome], ['11999998888', 'Souza Turismo'], 'telefone e empresa, que estavam vazios, são preenchidos');
  eq((await cliente('c-b')).external_id, null, 'a outra agência não é tocada');
  eq(/adotado pelo CPF/.test(r.acao), true, 'o evento diz como achou o cliente');
}

console.log('\n--- (a) identidade: adoção pelo e-mail ---');
{
  // Cadastro feito à mão na tela (vocabulário PF/PJ), sem documento.
  await novoCliente('c-mail', T1, { tipo: 'PF', nome_completo: 'João Lima', nome: 'João Lima', email: 'JOAO@x.com', cpf: '' }, { tipo: 'PF' });
  // O CRM manda um CPF que ninguém tem aqui: cai no e-mail.
  const r = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_2', cliente_id: 'crm_contact_2', cliente_nome: 'João', cliente_cpf_cnpj: '11144477735', cliente_email: 'joao@x.com' }));
  eq((await vendaDo('crm_deal_2')).cliente_id, 'c-mail', 'sem documento que case, adota pelo e-mail, sem diferenciar maiúscula');
  const c = await cliente('c-mail');
  eq([c.external_id, c.cpf_cnpj, c.data.cpf, c.tipo], ['crm_contact_2', '11144477735', '11144477735', 'PF'], 'o CPF vazio é preenchido na coluna e no JSON, no vocabulário do cadastro');
  eq(c.data.nome_completo, 'João Lima', 'o nome digitado na tela fica');
  eq(/adotado pelo e-mail/.test(r.acao), true, 'o evento diz que adotou pelo e-mail');
}

console.log('\n--- (a) identidade: nunca adota o que é de outro contato ---');
{
  await novoCliente('c-outro', T1, { nome: 'Ana Outra', cpf_cnpj: '39053344705', email: 'ana@x.com' }, { external_id: 'crm_contact_99' });
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_3', cliente_id: 'crm_contact_3', cliente_nome: 'Ana', cliente_cpf_cnpj: '39053344705', cliente_email: 'ana@x.com' }));
  const v = await vendaDo('crm_deal_3');
  eq(v.cliente_id === 'c-outro', false, 'cadastro ligado a OUTRO contato do CRM não é adotado, nem pelo CPF, nem pelo e-mail');
  eq((await cliente('c-outro')).external_id, 'crm_contact_99', 'e o vínculo dele fica como estava');
  const novo = await cliente(v.cliente_id);
  eq([novo.external_id, novo.cpf_cnpj, novo.tipo, novo.data.origem], ['crm_contact_3', '39053344705', 'fisica', 'crm'], 'nasce um cadastro novo, ligado ao contato certo');
}
{
  // Mesmo e-mail, documento diferente: é outra pessoa (família, empresa).
  await novoCliente('c-familia', T1, { nome: 'Pai', cpf_cnpj: '15350946056', email: 'familia@x.com' });
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_4', cliente_id: 'crm_contact_4', cliente_nome: 'Filha', cliente_cpf_cnpj: '71428793860', cliente_email: 'familia@x.com' }));
  eq((await vendaDo('crm_deal_4')).cliente_id === 'c-familia', false, 'e-mail igual com outro CPF não adota');
  eq((await cliente('c-familia')).external_id, null, 'o cadastro do pai continua sem vínculo');
}

console.log('\n--- (a) identidade: contato mesclado no CRM ---');
{
  await novoCliente('c-velho', T1, { nome: 'Carla', email: 'carla@x.com' }, { external_id: 'crm_contact_50' });
  const r = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_5', cliente_id: 'crm_contact_51', cliente_ids_anteriores: ['crm_contact_50', 'crm_contact_51'], cliente_nome: 'Carla Dias' }));
  eq((await vendaDo('crm_deal_5')).cliente_id, 'c-velho', 'o id antigo do contato mesclado acha o cadastro');
  const c = await cliente('c-velho');
  eq([c.external_id, c.data.external_id, c.data.external_ids_anteriores], ['crm_contact_51', 'crm_contact_51', ['crm_contact_50']], 'o vínculo passa para o id novo e o antigo fica registrado');
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_6', cliente_id: 'crm_contact_51' }));
  eq((await vendaDo('crm_deal_6')).cliente_id, 'c-velho', 'a venda seguinte, só com o id novo, acha o mesmo cadastro');
  eq(/id antigo/.test(r.acao), true, 'o evento diz que achou pelo id antigo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) venda só preenche, mudança de cadastro sobrescreve ---');
{
  // Segunda venda da Maria, com outro nome e outro e-mail no CRM.
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_7', cliente_nome: 'Maria S. Souza', cliente_email: 'outra@x.com', cliente_telefone: '' }));
  let c = await cliente('c-hot');
  eq([c.nome, c.data.email, c.data.telefone], ['Maria (Hotmart)', 'maria.hot@x.com', '11999998888'], 'venda fechada nunca troca o que já estava preenchido, e vazio não apaga');

  const r = await evento('CLIENTE_ATUALIZADO', {
    cliente_id: 'crm_contact_1', cliente_ids_anteriores: [],
    campos_alterados: { nome: 'Maria Souza Lima', email: 'maria.lima@x.com', telefone: null, cpf_cnpj: null, tipo: null },
    cliente: { nome: 'Maria Souza Lima', email: 'maria.lima@x.com', telefone: null, cpf_cnpj: null, tipo: null, empresa: null },
  });
  eq(r.processado, true, 'a mudança de cadastro é processada');
  c = await cliente('c-hot');
  eq([c.nome, c.data.nome, c.data.nome_completo], ['Maria Souza Lima', 'Maria Souza Lima', 'Maria Souza Lima'], 'o nome alterado no CRM sobrescreve a COLUNA e o JSON');
  eq(c.data.email, 'maria.lima@x.com', 'o e-mail alterado sobrescreve');
  eq([c.data.telefone, c.cpf_cnpj, c.data.empresa?.nome], ['11999998888', '52998224725', 'Souza Turismo'], 'null nunca apaga telefone, documento nem empresa');

  await evento('CLIENTE_ATUALIZADO', { cliente_id: 'crm_contact_1', campos_alterados: { cpf_cnpj: '11222333000181', tipo: 'juridica' }, cliente: { cpf_cnpj: '11222333000181', tipo: 'juridica' } });
  c = await cliente('c-hot');
  eq([c.cpf_cnpj, c.data.cpf_cnpj, c.data.cnpj, c.tipo, c.data.tipo], ['11222333000181', '11222333000181', '11222333000181', 'juridica', 'juridica'], 'documento e tipo alterados sobrescrevem colunas e JSON');

  await evento('CLIENTE_ATUALIZADO', { cliente_id: 'crm_contact_1', campos_alterados: { nome: '', email: '   ' }, cliente: {} });
  c = await cliente('c-hot');
  eq([c.nome, c.data.email], ['Maria Souza Lima', 'maria.lima@x.com'], 'campo alterado em branco não apaga');
}
{
  // Contato que nunca comprou: nasce pela mesma regra de identidade.
  await novoCliente('c-tela', T1, { tipo: 'PF', nome_completo: 'Paulo Reis', cpf: '935.411.347-80', email: '' }, { tipo: 'PF', cpf_cnpj: '935.411.347-80' });
  const r = await evento('CLIENTE_ATUALIZADO', { cliente_id: 'crm_contact_70', campos_alterados: { email: 'paulo@x.com' }, cliente: { nome: 'Paulo', cpf_cnpj: '93541134780', email: 'paulo@x.com' } });
  const c = await cliente('c-tela');
  eq([c.external_id, c.data.email, c.data.nome_completo, c.cpf_cnpj], ['crm_contact_70', 'paulo@x.com', 'Paulo Reis', '935.411.347-80'], 'cliente inexistente adota pelo CPF formatado; o nome digitado fica; o documento digitado não é reescrito');
  eq(/atualizado/.test(r.acao), true, 'e o evento diz que atualizou');
  await evento('CLIENTE_ATUALIZADO', { cliente_id: 'crm_contact_71', campos_alterados: { nome: 'Rita Nova' }, cliente: { nome: 'Rita Nova', email: 'rita@x.com' } });
  const rita = await um(`SELECT nome, data FROM clientes WHERE tenant_id = $1 AND external_id = 'crm_contact_71'`, [T1]);
  eq([rita.nome, rita.data.email], ['Rita Nova', 'rita@x.com'], 'sem ninguém para adotar, cria o cadastro');
}
{
  // A mescla pura, nos dois modos.
  const linha = { nome: 'Ana', cpf_cnpj: '', tipo: 'fisica', data: { nome: 'Ana', tipo: 'fisica', email: 'ana@x.com' } };
  const dados = { nome: 'Ana Maria', documento: '52998224725', email: 'outra@x.com', telefone: '', tipo: '', empresa: null };
  const venda1 = mesclarCliente(linha, dados, null);
  eq([venda1.linha.nome, venda1.linha.cpf_cnpj, venda1.linha.data.email, venda1.campos], ['Ana', '52998224725', 'ana@x.com', ['cpf_cnpj']], 'na venda, só o documento vazio é preenchido');
  const mudanca = mesclarCliente(linha, dados, { nome: 'Ana Maria', email: 'outra@x.com' });
  eq([mudanca.linha.nome, mudanca.linha.data.email], ['Ana Maria', 'outra@x.com'], 'na mudança de cadastro, o alterado sobrescreve');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) o pagamento chegou antes da venda ---');
let vendaPaga;
{
  // Pix de R$ 1.000 no Asaas, taxa de R$ 50, já caiu na conta. Ninguém sabe
  // ainda de que venda é: a agência pediu para confirmar antes de vincular.
  const antes = await saldo();
  const r = await importar(transacaoAsaas('pay_777', { documento: '', email: '' }));
  eq([r.status_conciliacao, r.caixa_movido], ['DIRETA', 950], 'o pagamento entra como venda direta e credita o líquido');
  eq(await saldo(), antes + 950, 'o saldo sobe o líquido');

  const ev = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_300', cliente_id: 'crm_contact_300', cliente_nome: 'Lia', plataforma_origem: 'Asaas', plataforma_transacao: 'pay_777', plataforma_transacoes: ['pay_777'] }));
  eq(ev.processado, true, 'a venda que informa a transação entra');
  vendaPaga = (await vendaDo('crm_deal_300')).id;
  const t = await tx('pay_777');
  eq([t.venda_id, t.status_conciliacao], [vendaPaga, 'VINCULADA'], 'a transação já importada e sem dono é vinculada à venda, mesmo com a conciliação automática desligada');
  const crs = await crsDaVenda(vendaPaga);
  eq(crs.map(c => [c.status, c.data.substituida_por_plataforma?.id_transacao]), [['CANCELADO', 'pay_777']], 'a conta a receber da venda é consumida pelo pagamento');
  const plat = await um(`SELECT venda_id, data FROM contas_receber WHERE id = 'plat-asaas-pay_777-1'`);
  eq([plat.venda_id, plat.data.origem, plat.data.status], [vendaPaga, 'VENDA', 'RECEBIDO'], 'a conta da plataforma passa a ser da venda');
  eq(await saldo(), antes + 950, 'vincular não move caixa');
  const v = await vendaDo('crm_deal_300');
  eq([v.data.plataforma_origem, v.data.plataforma_transacao, v.data.plataforma_transacoes, v.data.versao_contrato], ['asaas', 'pay_777', ['pay_777'], 2], 'a venda guarda a plataforma e a transação');
  eq(/pagamento vinculado/.test(ev.acao), true, 'o evento diz que vinculou');
}

console.log('\n--- (c) reprocessar não consome de novo ---');
{
  const antes = await saldo();
  // O CRM manda a mesma venda de novo (outro evento), e depois como histórico.
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_300', cliente_id: 'crm_contact_300', plataforma_origem: 'asaas', plataforma_transacao: 'pay_777' }));
  let crs = await crsDaVenda(vendaPaga);
  eq(crs.map(c => c.status), ['CANCELADO'], 'a conta regerada pela reentrega é consumida de novo: nada fica a receber em dobro');
  const ev = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_300', cliente_id: 'crm_contact_300', plataforma_origem: 'asaas', plataforma_transacao: 'pay_777', historico: true }));
  crs = await crsDaVenda(vendaPaga);
  eq(crs.map(c => c.status), ['CANCELADO'], 'o reenvio histórico é tratado como venda normal');
  eq((await vendaDo('crm_deal_300')).data.historico, true, 'e fica marcado na venda');
  eq(/reenvio histórico/.test(ev.acao), true, 'e no evento');
  const r = await importar(transacaoAsaas('pay_777', { documento: '', email: '' }));
  eq([r.caixa_movido, r.unificacao?.consumido, r.status_conciliacao], [0, 0, 'VINCULADA'], 'a plataforma avisando de novo move zero de caixa e consome zero');
  eq(await saldo(), antes, 'o saldo não mexe em nenhum reprocessamento');
  const abertas = await um(`SELECT COUNT(*)::int c FROM contas_receber WHERE tenant_id = $1 AND (venda_id = $2 OR data->>'origem_venda_id' = $2) AND status <> 'CANCELADO'`, [T1, vendaPaga]);
  eq(abertas.c, 1, 'sobra uma conta viva da venda: a da plataforma, recebida');
}

console.log('\n--- (c) o carimbo feito à mão vence ---');
{
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_400', cliente_id: 'crm_contact_400', cliente_nome: 'Rui' }));
  const vendaId = (await vendaDo('crm_deal_400')).id;
  await importar(transacaoAsaas('pay_888', { documento: '', email: '' }));
  await importar(transacaoAsaas('pay_999', { documento: '', email: '' }));
  await vincularVenda(T1, 'asaas', 'pay_888', vendaId);
  eq((await vendaDo('crm_deal_400')).data.plataforma_transacao, 'pay_888', 'o vínculo feito na tela carimba a venda');
  const ev = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_400', cliente_id: 'crm_contact_400', plataforma_origem: 'asaas', plataforma_transacao: 'pay_999' }));
  const v = await vendaDo('crm_deal_400');
  eq([v.data.plataforma_transacao, v.data.crm_plataforma_transacao], ['pay_888', 'pay_999'], 'o carimbo feito à mão não é trocado pelo que o CRM informou');
  eq([(await tx('pay_999')).status_conciliacao, (await tx('pay_999')).venda_id], ['DIRETA', ''], 'e a transação que o CRM informou não é vinculada no conflito');
  eq(/conflito/.test(ev.acao), true, 'o conflito fica escrito no evento');
  const reg = await um(`SELECT data->>'acao' a FROM crm_eventos_entrada WHERE tenant_id = $1 AND idempotency_key = $2`, [T1, `ev-${seq}`]);
  eq(/conflito/.test(reg.a), true, 'e gravado no registro do evento');
  eq((await crsDaVenda(vendaId)).map(c => c.status), ['CANCELADO'], 'o vínculo manual continua consumindo a conta regerada');
}

console.log('\n--- (c) transação vinculada a outra venda não muda de dono ---');
{
  const ev = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_450', cliente_id: 'crm_contact_450', plataforma_origem: 'asaas', plataforma_transacao: 'pay_777' }));
  eq((await tx('pay_777')).venda_id, vendaPaga, 'a transação segue com a venda dela');
  eq(/já está vinculada à venda/.test(ev.acao), true, 'e o evento conta o conflito');
  eq((await crsDaVenda((await vendaDo('crm_deal_450')).id)).map(c => c.status), ['PENDENTE'], 'a venda nova segue a receber');
}

console.log('\n--- (c) o pagamento chegou depois da venda ---');
{
  const ev = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_500', cliente_id: 'crm_contact_500', cliente_nome: 'Bia', plataforma_origem: 'asaas', plataforma_transacao: 'pay_555', data_venda: '2026-06-01' }));
  eq(/ainda não importada/.test(ev.acao), true, 'a venda avisa que a transação ainda não chegou');
  const vendaId = (await vendaDo('crm_deal_500')).id;
  // Quem pagou foi outra pessoa (documento diferente), quatro meses depois:
  // fora da janela de datas. Só o id liga os dois, e o id é prova.
  const r = await importar(transacaoAsaas('pay_555', { documento: '15350946056', email: 'pagador@x.com', data: '2026-10-05' }), false);
  eq([r.status_conciliacao, r.venda_id], ['VINCULADA', vendaId], 'o pagamento acha a venda pelo id, fora da janela e com a conciliação automática desligada');
  eq((await crsDaVenda(vendaId)).map(c => c.status), ['CANCELADO'], 'e consome a conta a receber dela');
  eq(r.conciliacao?.escolhida?.prova_transacao, true, 'a decisão registra que foi por prova');
}
{
  // Duas vendas dizendo ter a mesma transação: conflito, não chute.
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_510', cliente_id: 'crm_contact_510', plataforma_transacoes: ['pay_dup'] }));
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_511', cliente_id: 'crm_contact_511', plataforma_transacao: 'pay_dup' }));
  const r = await importar(transacaoAsaas('pay_dup', { documento: '', email: '' }), true);
  eq(r.status_conciliacao, 'SUGERIDA', 'duas vendas com a mesma transação viram sugestão, mesmo com vínculo automático');
}
{
  const c = decidirCarimbo({ plataforma_transacao: 'tx_manual', crm_plataforma_transacao: '' }, lerPlataformaDoPayload({ plataforma_transacao: 'tx_crm', plataforma_transacoes: ['tx_crm', 'tx_manual'] }));
  eq([c.plataforma_transacao, c.conflito, c.vincular], ['tx_manual', '', ['tx_crm', 'tx_manual']], 'carimbo manual que o CRM também lista não é conflito');
  const vazio = decidirCarimbo({ plataforma_transacao: 'tx_a', plataforma_origem: 'asaas', crm_plataforma_transacao: 'tx_a' }, lerPlataformaDoPayload({}));
  eq([vazio.plataforma_transacao, vazio.plataforma_origem], ['tx_a', 'asaas'], 'reenvio sem plataforma não apaga o carimbo');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (d) VENDA_CANCELADA: cancelar ---');
let vendaPerdida;
{
  // Estes dois fornecedores cobram a agência (ela recebe do cliente e paga o
  // custo): é o caso com conta a pagar, que o cancelamento também fecha. O
  // padrão, pago direto ao fornecedor, está em test-sql-fornecedores-crm.mjs.
  await query(`INSERT INTO fornecedores_crm (id, nome_fantasia, data, crm_supplier_id, tenant_id) VALUES ('f-hotel', 'Hotel', '{"id":"f-hotel","nome_fantasia":"Hotel"}', '2', $1) ON CONFLICT DO NOTHING`, [T1]);
  await query(`UPDATE fornecedores_crm SET data = data || '{"quem_recebe_do_cliente":"AGENCIA"}' WHERE tenant_id = $1 AND crm_supplier_id IN ('1', '2')`, [T1]);
  await evento('VENDA_FECHADA', venda({
    crm_venda_id: 'crm_deal_600', cliente_id: 'crm_contact_600', cliente_nome: 'Davi', valor_total: 3000, custo_total: 2000,
    fornecedores: [
      { fornecedor_id: 'crm_supplier_1', fornecedor_nome: 'CVC', valor_custo: 1200, valor_venda: 2000 },
      { fornecedor_id: 'crm_supplier_2', fornecedor_nome: 'Hotel', valor_custo: 800, valor_venda: 1000 },
    ],
  }));
  vendaPerdida = (await vendaDo('crm_deal_600')).id;
  const crs = await crsDaVenda(vendaPerdida);
  eq(crs.length, 2, 'a venda tem duas contas a receber');
  // A primeira já foi recebida: o dinheiro entrou no Itaú.
  await query(`UPDATE contas_receber SET status = 'RECEBIDO', data = data || '{"status":"RECEBIDO","valor_recebido":2000,"conta_bancaria_id":"b1"}' WHERE id = $1`, [crs[0].id]);
  const antes = await saldo();
  const r = await evento('VENDA_CANCELADA', { crm_venda_id: 'crm_deal_600', motivo: 'lost', acao_solicitada: 'cancelar' });
  eq(r.processado, true, 'o cancelamento é processado (antes era descartado em silêncio)');
  const v = await vendaDo('crm_deal_600');
  eq([v.status, v.data.status, v.data.cancelada_no_crm?.motivo], ['CANCELADO', 'CANCELADO', 'lost'], 'a venda é cancelada, na coluna e no JSON');
  const depois = await crsDaVenda(vendaPerdida);
  eq(depois.map(c => c.status), ['RECEBIDO', 'CANCELADO'], 'a conta recebida fica como está; a em aberto é cancelada');
  const cps = await todos(`SELECT status FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T1, vendaPerdida]);
  eq(cps.map(c => c.status), ['CANCELADO', 'CANCELADO'], 'as contas a pagar em aberto também');
  eq(await saldo(), antes, 'nenhum caixa se move: o dinheiro recebido continua lançado');
  const n = await todos(`SELECT titulo, descricao, link FROM notificacoes WHERE tenant_id = $1 AND tipo = 'VENDA_CANCELADA_CRM'`, [T1]);
  eq(n.length, 1, 'quem cuida do financeiro é avisado');
  eq([/dinheiro/.test(n[0].titulo), /2\.000,00/.test(n[0].descricao), n[0].link], [true, true, `/vendas/${vendaPerdida}`], 'com o valor recebido e o link da venda');
  eq(/\u2014/.test(n[0].titulo + n[0].descricao), false, 'sem travessão no texto');
}

{
  // Cartão confirmado na plataforma, dinheiro ainda por cair: não é caixa,
  // mas alguém precisa devolver ao cliente na plataforma.
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_660', cliente_id: 'crm_contact_660', plataforma_origem: 'asaas', plataforma_transacao: 'pay_660' }));
  const vendaId = (await vendaDo('crm_deal_660')).id;
  await importar(transacaoAsaas('pay_660', { status: 'CONFIRMADO', documento: '', email: '' }));
  eq((await tx('pay_660')).venda_id, vendaId, 'o cartão confirmado acha a venda pelo id');
  const antes = await saldo();
  await evento('VENDA_CANCELADA', { crm_venda_id: 'crm_deal_660', motivo: 'lost', acao_solicitada: 'cancelar' });
  const plat = await um(`SELECT status FROM contas_receber WHERE id = 'plat-asaas-pay_660-1'`);
  eq([plat.status, await saldo()], ['PENDENTE', antes], 'a conta da plataforma não é cancelada por aqui e o caixa não se move');
  const n = await um(`SELECT descricao FROM notificacoes WHERE tenant_id = $1 AND data->>'venda_id' = $2`, [T1, vendaId]);
  eq(/1\.000,00 ainda vão cair pela plataforma/.test(n?.descricao ?? ''), true, 'o aviso diz quanto ainda vai cair pela plataforma');
}

console.log('\n--- (d) VENDA_CANCELADA: idempotente ---');
{
  const r = await evento('VENDA_CANCELADA', { crm_venda_id: 'crm_deal_600', motivo: 'lost', acao_solicitada: 'cancelar' });
  eq([r.processado, /já estava cancelada/.test(r.acao)], [true, true], 'o segundo evento igual não muda nada');
  eq((await crsDaVenda(vendaPerdida)).map(c => c.status), ['RECEBIDO', 'CANCELADO'], 'as contas seguem iguais');
  eq((await um(`SELECT COUNT(*)::int c FROM notificacoes WHERE tenant_id = $1 AND tipo = 'VENDA_CANCELADA_CRM' AND data->>'venda_id' = $2`, [T1, vendaPerdida])).c, 1, 'e não avisa de novo');
  const dup = await evento('VENDA_CANCELADA', { crm_venda_id: 'crm_deal_600', motivo: 'lost', acao_solicitada: 'cancelar' }, `ev-${seq}`);
  eq(dup.acao, 'duplicata ignorada', 'a reentrega do mesmo evento é duplicata');
  const hist = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_600', cliente_id: 'crm_contact_600', historico: true }));
  eq([(await vendaDo('crm_deal_600')).status, /não a reabre/.test(hist.acao)], ['CANCELADO', true], 'o reenvio histórico não reabre a venda cancelada');
  eq((await crsDaVenda(vendaPerdida)).map(c => c.status), ['RECEBIDO', 'CANCELADO'], 'nem regera as contas dela');
}

console.log('\n--- (d) VENDA_CANCELADA: aprovar ---');
{
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_700', cliente_id: 'crm_contact_700', cliente_nome: 'Eva' }));
  const vendaId = (await vendaDo('crm_deal_700')).id;
  const r = await evento('VENDA_CANCELADA', { crm_venda_id: 'crm_deal_700', motivo: 'won_reverted', acao_solicitada: 'aprovar' });
  eq([r.processado, /aguardando aprovação/.test(r.acao)], [true, true], 'pedido de aprovação é processado');
  eq([(await vendaDo('crm_deal_700')).status, (await crsDaVenda(vendaId)).map(c => c.status)], ['CONFIRMADO', ['PENDENTE']], '"aprovar" não cancela a venda nem as contas');
  const n = await todos(`SELECT titulo FROM notificacoes WHERE tenant_id = $1 AND data->>'venda_id' = $2`, [T1, vendaId]);
  eq([n.length, /confirme o cancelamento/.test(n[0]?.titulo ?? '')], [1, true], 'e pede a alguém que confirme');
  await evento('VENDA_CANCELADA', { crm_venda_id: 'crm_deal_700', motivo: 'won_reverted', acao_solicitada: 'aprovar' });
  eq((await um(`SELECT COUNT(*)::int c FROM notificacoes WHERE tenant_id = $1 AND data->>'venda_id' = $2`, [T1, vendaId])).c, 1, 'o pedido repetido não avisa duas vezes');
  const semAcao = await evento('VENDA_CANCELADA', { crm_venda_id: 'crm_deal_700', motivo: 'lost' });
  eq([(await vendaDo('crm_deal_700')).status, /aguardando aprovação/.test(semAcao.acao)], ['CONFIRMADO', true], 'pedido sem ação conhecida é tratado como aprovar');
  const desconhecida = await evento('VENDA_CANCELADA', { crm_venda_id: 'crm_deal_404', motivo: 'lost', acao_solicitada: 'cancelar' });
  eq([desconhecida.processado, /não existe no financeiro/.test(desconhecida.acao)], [true, true], 'venda que não existe aqui é marcada como processada, com o motivo');
}
{
  // Fora de ordem: a reentrega da venda falha no meio, a venda é perdida no
  // CRM, e só então a nova tentativa da venda chega. O estado mais novo é o
  // cancelamento.
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_650', cliente_id: 'crm_contact_650' }));
  const vendaId = (await vendaDo('crm_deal_650')).id;
  falharSQL = /INSERT INTO itens_venda/;
  const falhou = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_650', cliente_id: 'crm_contact_650' }), 'ev-650-reentrega');
  falharSQL = null;
  eq(falhou.processado, false, 'a reentrega falha no meio');
  await evento('VENDA_CANCELADA', { crm_venda_id: 'crm_deal_650', motivo: 'lost', acao_solicitada: 'cancelar' });
  const tarde = await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_650', cliente_id: 'crm_contact_650' }), 'ev-650-reentrega');
  eq([tarde.processado, /a nova tentativa não a reabre/.test(tarde.acao)], [true, true], 'a nova tentativa de um evento anterior ao cancelamento não reabre a venda');
  eq([(await vendaDo('crm_deal_650')).status, (await crsDaVenda(vendaId)).map(c => c.status)], ['CANCELADO', ['CANCELADO']], 'a venda e as contas continuam canceladas');
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_650', cliente_id: 'crm_contact_650' }));
  eq((await vendaDo('crm_deal_650')).status, 'CONFIRMADO', 'um evento novo de venda fechada (negócio ganho de novo) reabre');
}
{
  // A venda ganha de novo no CRM (sem a marca de histórico) reabre.
  await evento('VENDA_FECHADA', venda({ crm_venda_id: 'crm_deal_600', cliente_id: 'crm_contact_600', valor_total: 3000, custo_total: 2000,
    fornecedores: [
      { fornecedor_id: 'crm_supplier_1', fornecedor_nome: 'CVC', valor_custo: 1200, valor_venda: 2000 },
      { fornecedor_id: 'crm_supplier_2', fornecedor_nome: 'Hotel', valor_custo: 800, valor_venda: 1000 },
    ] }));
  const v = await vendaDo('crm_deal_600');
  eq([v.status, v.data.status], ['CONFIRMADO', 'CONFIRMADO'], 'a venda fechada de novo no CRM volta a ser confirmada, na coluna e no JSON');
  eq((await crsDaVenda(vendaPerdida)).map(c => c.status).sort(), ['PENDENTE', 'RECEBIDO'], 'com a conta recebida preservada e a outra de volta');
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (e) o webhook responde 5xx quando o evento falha ---');
{
  await query(`INSERT INTO crm_config (id, tenant_id, data) VALUES ('singleton', $1, '{"ativo":true,"api_key_entur":"segredo-a"}')`, [T1]);
  const chamar = async (corpo, assinatura) => {
    const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
    const req = new NextRequest(`https://fin.test/api/v1/crm/webhook/${T1}`, {
      method: 'POST', body: texto,
      headers: { 'x-crm-signature': assinatura ?? createHmac('sha256', 'segredo-a').update(texto).digest('hex') },
    });
    const res = await rota.POST(req, { params: Promise.resolve({ tenantId: T1 }) });
    return { status: res.status, corpo: await res.json() };
  };

  const ok = await chamar({ id: 'wh-1', tipo: 'VENDA_FECHADA', payload: venda({ crm_venda_id: 'crm_deal_800', cliente_id: 'crm_contact_800' }) });
  eq([ok.status, ok.corpo.processado], [200, true], 'evento processado responde 200');

  const quebrado = await chamar({ id: 'wh-2', tipo: 'VENDA_FECHADA', payload: { crm_venda_id: 'crm_deal_801' } });
  eq([quebrado.status, quebrado.corpo.processado, quebrado.corpo.erro], [500, false, 'VENDA_FECHADA sem cliente_id'], 'evento que falha responde 500, para o CRM tentar de novo');
  eq((await um(`SELECT status FROM crm_eventos_entrada WHERE tenant_id = $1 AND idempotency_key = 'wh-2'`, [T1])).status, 'ERRO', 'e fica marcado como ERRO, o que autoriza o reprocessamento');

  falharSQL = /INSERT INTO vendas_crm/;
  const caiu = await chamar({ id: 'wh-3', tipo: 'VENDA_FECHADA', payload: venda({ crm_venda_id: 'crm_deal_802', cliente_id: 'crm_contact_802' }) });
  falharSQL = null;
  eq([caiu.status, caiu.corpo.processado], [500, false], 'o banco caindo no meio do evento responde 500');
  const retentativa = await chamar({ id: 'wh-3', tipo: 'VENDA_FECHADA', payload: venda({ crm_venda_id: 'crm_deal_802', cliente_id: 'crm_contact_802' }) });
  eq([retentativa.status, retentativa.corpo.processado, !!(await vendaDo('crm_deal_802'))], [200, true, true], 'a nova tentativa do CRM processa o evento');

  const dup = await chamar({ id: 'wh-1', tipo: 'VENDA_FECHADA', payload: venda({ crm_venda_id: 'crm_deal_800', cliente_id: 'crm_contact_800' }) });
  eq([dup.status, dup.corpo.acao], [200, 'duplicata ignorada'], 'duplicata continua 200');
  const outro = await chamar({ id: 'wh-4', tipo: 'EVENTO_NOVO_DO_CRM', payload: { qualquer: 1 } });
  eq([outro.status, outro.corpo.processado], [200, true], 'tipo desconhecido continua 200');
  const extra = await chamar({ id: 'wh-5', tipo: 'VENDA_FECHADA', payload: venda({ crm_venda_id: 'crm_deal_803', cliente_id: 'crm_contact_803', campo_que_ainda_nao_existe: { a: 1 } }) });
  eq(extra.status, 200, 'campo desconhecido no payload continua 200');
  const legado = await chamar({ id: 'wh-6', tipo: 'VENDA_FECHADA', payload: { crm_venda_id: 'crm_deal_804', cliente_id: 'crm_contact_804', cliente_nome: 'Legado', cliente_cpf: '529.982.247-25', valor_total: 500, fornecedores: [] } });
  eq(legado.status, 200, 'o payload do contrato antigo continua funcionando');
  const assinatura = await chamar({ id: 'wh-7', tipo: 'VENDA_FECHADA', payload: {} }, 'assinatura-errada');
  eq(assinatura.status, 401, 'assinatura errada continua 401');
  const json = await chamar('{"id": "wh-8", ', undefined);
  eq(json.status, 400, 'JSON quebrado responde 400: tentar de novo não conserta');
}

console.log(`\n${total - falhas}/${total} testes das vendas do CRM passaram`);
if (falhas > 0) process.exit(1);
