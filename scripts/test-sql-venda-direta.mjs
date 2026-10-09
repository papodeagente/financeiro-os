/**
 * Venda do CRM paga direto ao fornecedor (Bruno, 09/10/2026), contra um
 * Postgres real (PGlite), rodando o webhook DE PRODUÇÃO (processarEventoCRM).
 *
 * "Contas a pagar (o valor total da venda) na maioria das vezes é pago direto
 * ao fornecedor. Contas a receber: a comissão gerada com a venda, a margem de
 * dentro do produto. Toda venda gera uma comissão a receber."
 *
 * O que se prova:
 *   (a) o caso real: "Grupo Japão", R$ 390,63 de venda, R$ 312,50 de custo,
 *       Cativa Operadora. Nasce UMA conta: a comissão de R$ 78,13 a receber da
 *       Cativa, com a venda e o que o cliente pagou direto. Nenhuma conta do
 *       cliente, nenhuma conta a pagar;
 *   (b) reenviar a venda não duplica a comissão, nem a que já foi recebida;
 *   (c) fornecedor cujo cadastro diz que a agência recebe do cliente, e venda
 *       paga por plataforma da agência: conta do cliente e conta a pagar;
 *   (d) custo sem fornecedor vira comissão marcada para informar quem paga, e
 *       nunca cai na conta do cliente; venda sem custo é serviço da agência;
 *   (e) margem zero: vale a comissão padrão do cadastro do fornecedor;
 *   (f) a ficha do cliente que o CRM manda: a venda preenche, a mudança de
 *       cadastro sobrescreve, vazio não apaga.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-venda-direta.mjs
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
  CREATE TABLE crm_eventos_saida (id TEXT PRIMARY KEY, tipo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDENTE', tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa TIMESTAMPTZ, latencia_ms INTEGER, data JSONB NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE crm_config (id TEXT NOT NULL, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, PRIMARY KEY (id, tenant_id));
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
  CREATE TABLE plataformas_transacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_transacao TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
`);

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);

const { processarEventoCRM } = await import('../src/lib/crm-integration.ts');

const T1 = 'agencia-a';
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1',$1,'{"nome":"Itaú","saldo_atual":0}')`, [T1]);

let seq = 0;
const evento = (tipo, payload, id = `ev-${++seq}`) => processarEventoCRM(tipo, payload, id, T1);
const um = async (sql, args = []) => (await query(sql, args)).rows[0];
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const vendaDo = crmId => um(`SELECT id, data FROM vendas_crm WHERE tenant_id = $1 AND data->>'crm_venda_id' = $2`, [T1, crmId]);
const crs = vendaId => todos(`SELECT id, cliente_id, status, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 ORDER BY id`, [T1, vendaId]);
const cps = vendaId => todos(`SELECT id, fornecedor_id, status, data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 ORDER BY id`, [T1, vendaId]);
const cativa = () => um(`SELECT id, data FROM fornecedores_crm WHERE tenant_id = $1 AND crm_supplier_id = '7'`, [T1]);
const ficha = {
  data_nascimento: '1985-03-21', data_casamento: '11-02',
  telefones_adicionais: [{ numero: '+55 11 98888-7777', rotulo: 'Trabalho' }],
  endereco: { cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', complemento: '', bairro: 'Bela Vista', cidade: 'São Paulo', estado: 'SP', pais: 'Brasil' },
  passaporte: { numero: 'FX123456', validade: '2031-05-10', pais_emissor: 'BR' },
  estado_civil: 'casado', conjuge: { nome: 'Ana Souza', cpf: '', data_nascimento: '', passaporte: { numero: '', validade: '', pais_emissor: '' } },
  filhos: [{ nome: 'Lia', cpf: '', data_nascimento: '2015-02-03', passaporte_numero: '', passaporte_validade: '' }],
  profissao: 'Médico', site: '', mes_de_ferias: 'julho', origem: 'LP Japão', etiquetas: ['vip'], responsavel: 'Karen',
};
const japao = (o = {}) => ({
  versao_contrato: 2, crm_venda_id: 'crm_deal_1', cliente_id: 'crm_contact_1', cliente_nome: 'Bruno Barbosa da Silva',
  cliente_cpf_cnpj: '52998224725', cliente_tipo: 'fisica', cliente_email: 'bruno@x.com', cliente_telefone: '11999990000',
  valor_total: 390.63, custo_total: 312.5, data_venda: '2026-10-09',
  fornecedores: [{
    fornecedor_id: 'crm_cnpj_11222333000181', crm_supplier_id: '7', financeiro_id: null,
    fornecedor_nome: 'Cativa Operadora', fornecedor_cnpj: '11222333000181',
    servico: 'PACOTE', descricao: 'Grupo Japão', valor_custo: 312.5, valor_venda: 390.63,
  }],
  cliente_ficha: ficha,
  ...o,
});

// ══════════════════════════════════════════════════════════════════════
console.log('--- (a) o caso real: Grupo Japão, Cativa Operadora ---');
let vendaJapao;
{
  const r = await evento('VENDA_FECHADA', japao());
  eq(r.processado, true, 'a venda entra');
  vendaJapao = (await vendaDo('crm_deal_1')).id;
  const receber = await crs(vendaJapao);
  eq(receber.length, 1, 'nasce UMA conta a receber');
  const c = receber[0];
  const forn = await cativa();
  eq([c.data.origem, c.data.valor_final, c.cliente_id, c.data.cliente_nome, c.data.fornecedor_id], ['COMISSAO_FORNECEDOR', 78.13, forn.id, 'Cativa Operadora', forn.id], 'é a comissão de R$ 78,13, a receber da Cativa');
  eq([c.data.cliente_da_venda_nome, c.data.valor_pago_direto, c.data.custo_do_fornecedor], ['Bruno Barbosa da Silva', 390.63, 312.5], 'a conta diz de qual venda é e quanto o cliente pagou direto');
  eq([c.data.data_vencimento, c.data.descricao], ['2026-11-08', 'Comissão 20,0% — Grupo Japão'], 'vence 30 dias depois da venda (sem regra no cadastro); percentual em português');
  eq((await cps(vendaJapao)).length, 0, 'nenhuma conta a pagar: o cliente pagou o fornecedor');
  eq(/1 pago\(s\) direto ao fornecedor, comissão de R\$ 78\.13 a receber/.test(r.acao), true, 'o histórico diz que foi pago direto');
  const venda = await vendaDo('crm_deal_1');
  eq(venda.data.valor_final ?? venda.data.valor_total, 390.63, 'a venda continua valendo R$ 390,63');
}

console.log('\n--- (b) reenviar não duplica ---');
{
  await evento('VENDA_FECHADA', japao());
  eq((await crs(vendaJapao)).length, 1, 'reenvio: a mesma comissão, não outra');
  const [c] = await crs(vendaJapao);
  await query(`UPDATE contas_receber SET status = 'RECEBIDO', data = data || '{"status":"RECEBIDO","valor_recebido":78.13,"conta_bancaria_id":"b1"}' WHERE id = $1`, [c.id]);
  await evento('VENDA_FECHADA', japao());
  const depois = await crs(vendaJapao);
  eq(depois.map(x => [x.id, x.status]), [[c.id, 'RECEBIDO']], 'a comissão recebida é preservada e não nasce outra ao lado');
}

console.log('\n--- (c) quando a agência recebe do cliente ---');
{
  const forn = await cativa();
  await query(`UPDATE fornecedores_crm SET data = data || '{"quem_recebe_do_cliente":"AGENCIA"}' WHERE id = $1`, [forn.id]);
  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_2' }));
  const v = (await vendaDo('crm_deal_2')).id;
  const receber = await crs(v);
  const pagar = await cps(v);
  eq(receber.map(x => [x.data.origem, x.data.valor_final]), [['VENDA', 390.63]], 'cadastro diz "a agência": conta a receber do cliente');
  eq(pagar.map(x => [x.fornecedor_id, x.data.valor_final]), [[forn.id, 312.5]], 'e conta a pagar à Cativa pelo custo');
  await query(`UPDATE fornecedores_crm SET data = data - 'quem_recebe_do_cliente' WHERE id = $1`, [forn.id]);

  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_3', plataforma_origem: 'pagarme', plataforma_transacao: 'or_123', plataforma_transacoes: ['or_123'] }));
  const p = (await vendaDo('crm_deal_3')).id;
  eq([(await crs(p)).map(x => x.data.origem), (await cps(p)).length], [['VENDA'], 1], 'pago pela plataforma da agência: o dinheiro entrou aqui, então conta do cliente e conta a pagar');
}

console.log('\n--- (d) sem fornecedor e sem custo ---');
{
  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_4', valor_total: 600, custo_total: 500, fornecedores: [] }));
  const v = (await vendaDo('crm_deal_4')).id;
  const [c] = await crs(v);
  eq([c.data.origem, c.data.valor_final, c.cliente_id, c.data.cliente_nome, c.data.fornecedor_pendente], ['COMISSAO_FORNECEDOR', 100, '', 'Fornecedor não informado', true], 'custo sem fornecedor: comissão marcada para informar quem paga, fora da conta do cliente');
  eq((await cps(v)).length, 0, 'e nenhuma conta a pagar inventada');

  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_5', valor_total: 300, custo_total: 0, fornecedores: [] }));
  const s = (await vendaDo('crm_deal_5')).id;
  eq((await crs(s)).map(x => [x.data.origem, x.data.valor_final]), [['VENDA', 300]], 'venda sem custo é serviço da agência: o cliente paga a agência');
}

console.log('\n--- (e) margem zero ---');
{
  const forn = await cativa();
  await query(`UPDATE fornecedores_crm SET data = jsonb_set(data, '{regras_faturamento,comissao_padrao}', '10') WHERE id = $1`, [forn.id]);
  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_6', valor_total: 1000, custo_total: 1000, fornecedores: [{ ...japao().fornecedores[0], valor_custo: 1000, valor_venda: 1000 }] }));
  const v = (await vendaDo('crm_deal_6')).id;
  eq((await crs(v)).map(x => [x.data.origem, x.data.valor_final]), [['COMISSAO_FORNECEDOR', 100]], 'vendido a preço de custo: vale a comissão padrão do cadastro (10%)');
}

console.log('\n--- (f) a ficha do cliente ---');
{
  const cli = async () => (await um(`SELECT data FROM clientes WHERE tenant_id = $1 AND external_id = 'crm_contact_1'`, [T1])).data;
  let d = await cli();
  eq([d.cidade, d.cep, d.passaporte, d.validade_passaporte, d.data_nascimento, d.estado_civil, d.telefone_secundario], ['São Paulo', '01310-100', 'FX123456', '2031-05-10', '1985-03-21', 'casado', '+55 11 98888-7777'], 'a venda preenche endereço, passaporte, nascimento, estado civil e segundo telefone');
  eq([d.crm_ficha.conjuge.nome, d.crm_ficha.filhos[0].nome, d.crm_ficha.profissao, d.crm_ficha.responsavel, d.marcadores], ['Ana Souza', 'Lia', 'Médico', 'Karen', ['vip']], 'e guarda o resto da ficha (família, profissão, responsável) e as etiquetas');

  await evento('VENDA_FECHADA', japao({ crm_venda_id: 'crm_deal_7', cliente_ficha: { ...ficha, endereco: { ...ficha.endereco, cidade: 'Campinas' } } }));
  eq((await cli()).cidade, 'São Paulo', 'outra venda não troca o que já está preenchido');

  await evento('CLIENTE_ATUALIZADO', {
    versao_contrato: 2, cliente_id: 'crm_contact_1', campos_alterados: {}, cliente: { nome: 'Bruno Barbosa da Silva' },
    cliente_ficha: { ...ficha, endereco: { ...ficha.endereco, cidade: 'Campinas', cep: '' }, profissao: '', etiquetas: ['japão'] },
  });
  d = await cli();
  eq([d.cidade, d.cep, d.crm_ficha.profissao, d.marcadores], ['Campinas', '01310-100', 'Médico', ['vip', 'japão']], 'mudança no CRM sobrescreve; vazio não apaga; etiqueta nova soma às que já estavam');
}

console.log(`\n${total - falhas}/${total} testes da venda paga direto ao fornecedor passaram`);
if (falhas > 0) process.exit(1);
