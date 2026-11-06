/**
 * PORTEIRO da E5 contra um Postgres real (PGlite): o que a venda de HOJE
 * grava no banco não muda.
 *
 * Roda o webhook de produção (`processarEventoCRM`, VENDA_FECHADA v1) e a
 * rota de venda lançada à mão (`POST /api/vendas-crm` com itens) e compara as
 * contas gravadas com `scripts/fixture-venda-v1-sql-congelada.json`, gravado
 * ANTES da E5. Prova também as regras que não podem piorar:
 *   - reentrega do mesmo evento não duplica (idempotência);
 *   - conta baixada é preservada na regeração e não ganha gêmea;
 *   - o índice do banco recusa a mesma parcela duas vezes.
 *
 * Regravar (só quando a mudança for de propósito):
 *   GRAVAR_CONGELADO=1 node --no-warnings scripts/test-sql-venda-v1-congelada.mjs
 */
import { register } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  CREATE TABLE notificacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', vendedor_id TEXT NOT NULL DEFAULT '', lida BOOLEAN NOT NULL DEFAULT FALSE, data JSONB NOT NULL DEFAULT '{}'::jsonb, chave_deduplicacao TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX idx_notificacoes_deduplicacao ON notificacoes (tenant_id, chave_deduplicacao) WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE TABLE plataformas_transacoes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', plataforma TEXT NOT NULL DEFAULT '', id_transacao TEXT NOT NULL DEFAULT '', cliente_id TEXT NOT NULL DEFAULT '', venda_id TEXT NOT NULL DEFAULT '', status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE UNIQUE INDEX uq_plataformas_transacoes ON plataformas_transacoes(tenant_id, plataforma, id_transacao);
`);
// Tabelas que a E5 acrescenta (o webhook v1 não pode depender delas, mas
// elas existem em produção). Só entram quando o esquema já existe.
try {
  register('./ts-resolve-hook.mjs', import.meta.url);
} catch { /* já registrado */ }

const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./db-de-teste-hook.mjs', import.meta.url);
globalThis.__SESSAO_DE_TESTE__ = null;
register('./sessao-de-teste-hook.mjs', import.meta.url);

const esquemaE5 = await import('../src/lib/venda-schema.ts').catch(() => null);
if (esquemaE5) await pg.exec(esquemaE5.VENDA_SCHEMA_SQL);

const { processarEventoCRM } = await import('../src/lib/crm-integration.ts');
const rotaVendas = await import('../src/app/api/vendas-crm/route.ts');

const T = 'agencia-congelada';
await query(`INSERT INTO contas_bancarias (id, tenant_id, data) VALUES ('b1',$1,'{"nome":"Itaú","saldo_atual":10000}')`, [T]);

let seq = 0;
const evento = (payload, id = `ev-${++seq}`) => processarEventoCRM('VENDA_FECHADA', payload, id, T);
const payload = (o = {}) => ({
  versao_contrato: 2, crm_venda_id: 'deal_1', cliente_id: 'contact_1',
  cliente_nome: 'Maria Souza', cliente_email: '', cliente_telefone: '',
  valor_total: 1000, custo_total: 600, data_venda: '2026-10-06',
  fornecedores: [{ fornecedor_id: 'sup_1', crm_supplier_id: '1', fornecedor_nome: 'Operadora Sol', valor_custo: 600, valor_venda: 1000 }],
  ...o,
});
const todos = async (sql, args = []) => (await query(sql, args)).rows;
const vendaId = async crmId => (await todos(`SELECT id FROM vendas_crm WHERE tenant_id = $1 AND data->>'crm_venda_id' = $2`, [T, crmId]))[0]?.id;

/** As contas de uma venda, sem id sorteado, sem data de hoje, em ordem estável. */
async function contasDa(vid) {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const limpa = d => {
    const o = { ...d };
    delete o.id; delete o.origem_item_id; delete o.venda_id; delete o.origem_venda_id;
    if (o.data_emissao === hoje) o.data_emissao = '<hoje>';
    if (o.cliente_da_venda_id) o.cliente_da_venda_id = '<cliente>';
    if (o.origem_fornecedor_id) o.origem_fornecedor_id = '<fornecedor>';
    return o;
  };
  const ordem = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
  const cr = (await todos(`SELECT status, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, vid]))
    .map(r => ({ status: r.status, ...limpa(r.data), cliente_id: r.data.origem === 'COMISSAO_FORNECEDOR' ? '<fornecedor>' : '<cliente>', fornecedor_id: r.data.fornecedor_id ? '<fornecedor>' : r.data.fornecedor_id })).sort(ordem);
  const cp = (await todos(`SELECT status, data FROM contas_pagar WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, vid]))
    .map(r => ({ status: r.status, ...limpa(r.data), fornecedor_id: r.data.fornecedor_id ? '<fornecedor>' : '' })).sort(ordem);
  return { contas_receber: cr, contas_pagar: cp };
}

const atual = {};

console.log('--- VENDA_FECHADA v1 ---');
// 1) O padrão de hoje: o cliente paga o fornecedor direto; comissão a receber.
let r = await evento(payload());
eq(r.processado, true, 'v1 pago direto: processado');
const v1 = await vendaId('deal_1');
atual.pago_direto = await contasDa(v1);

// 2) Reentrega do mesmo evento: duplicata ignorada; outro id do mesmo negócio regera igual.
r = await evento(payload(), 'ev-1');
eq(r.acao, 'duplicata ignorada', 'mesma idempotency_key: duplicata ignorada');
await evento(payload());
eq(await contasDa(v1), atual.pago_direto, 'reprocessar o mesmo negócio: as mesmas contas');

// 3) A agência recebe do cliente (cadastro do fornecedor diz AGENCIA), com
//    custo sem fornecedor e dois fornecedores.
await query(`UPDATE fornecedores_crm SET data = data || '{"quem_recebe_do_cliente":"AGENCIA"}' WHERE tenant_id = $1`, [T]);
await evento(payload({
  crm_venda_id: 'deal_2', valor_total: 3000, custo_total: 2300,
  fornecedores: [
    { fornecedor_id: 'sup_1', crm_supplier_id: '1', fornecedor_nome: 'Operadora Sol', valor_custo: 1500, valor_venda: 2000 },
    { fornecedor_id: 'sup_2', crm_supplier_id: '2', fornecedor_nome: 'Hotel Mar', valor_custo: 600, valor_venda: 800 },
  ],
  condicoes_pagamento: [{ parcela: 1 }, { parcela: 2 }],
}));
const v2 = await vendaId('deal_2');
atual.agencia_recebe = await contasDa(v2);

// 4) Conta baixada preservada: recebe uma conta e reprocessa.
const crs2 = await todos(`SELECT id, data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'origem' = 'VENDA' ORDER BY data->>'descricao' LIMIT 1`, [T, v2]);
await query(`UPDATE contas_receber SET status = 'RECEBIDO', data = data || '{"status":"RECEBIDO","valor_recebido":1000,"conta_bancaria_id":"b1"}' WHERE id = $1`, [crs2[0].id]);
const antesQtd = (await todos(`SELECT 1 FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, v2])).length;
await evento(payload({
  crm_venda_id: 'deal_2', valor_total: 3000, custo_total: 2300,
  fornecedores: [
    { fornecedor_id: 'sup_1', crm_supplier_id: '1', fornecedor_nome: 'Operadora Sol', valor_custo: 1500, valor_venda: 2000 },
    { fornecedor_id: 'sup_2', crm_supplier_id: '2', fornecedor_nome: 'Hotel Mar', valor_custo: 600, valor_venda: 800 },
  ],
  condicoes_pagamento: [{ parcela: 1 }, { parcela: 2 }],
}));
const depois = await todos(`SELECT id, status FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2`, [T, v2]);
eq([depois.length, depois.some(c => c.id === crs2[0].id && c.status === 'RECEBIDO')], [antesQtd, true], 'baixada preservada, sem gêmea');
atual.agencia_recebe_reprocessada = await contasDa(v2);

// 5) O índice do banco recusa a mesma parcela duas vezes.
const umaCr = (await todos(`SELECT data FROM contas_receber WHERE tenant_id = $1 AND data->>'origem_venda_id' = $2 AND data->>'status' = 'PENDENTE' LIMIT 1`, [T, v2]))[0];
let recusou = false;
try { await query(`INSERT INTO contas_receber (id, tenant_id, data) VALUES ('dup', $1, $2)`, [T, JSON.stringify({ ...umaCr.data, id: 'dup' })]); } catch { recusou = true; }
eq(recusou, true, 'índice recusa a mesma parcela duas vezes');

console.log('--- Venda lançada à mão (POST /api/vendas-crm com itens) ---');
globalThis.__SESSAO_DE_TESTE__ = { userId: 'u-adm', nome: 'Adm', email: 'a@x.com', perfil: 'ADMIN', permissoes: {}, tenantId: T, tenantSlug: T };
const corpoManual = {
  cliente_nome: 'Ana Lima',
  venda: {
    id: 'vm-1', numero: 'VND-9001', data_venda: '2026-10-10', tipo: 'AVULSA', grupo_id: null, cliente_id: 'cli-x', vendedor_id: 'u-adm',
    desconto: 100, parcelas: 2, forma_pagamento: 'BOLETO', primeiro_vencimento: '2026-11-10', valor_final: 1900, centro_custo: '',
  },
  itens: [
    { id: 'im-1', venda_id: 'vm-1', fornecedor_id: '', sequencia: 1, status: 'ativo', data: { tipo: 'HOTEL', descricao: 'Hotel', fornecedor_nome: 'Hotel X', meio_pagamento: 'proprio', valor_custo: 700, valor_venda: 1000, comissao_percentual: 0, comissao_valor: 0, moeda: 'BRL', cambio: 1, localizador: '', data_inicio: '', data_fim: '', observacoes: '', contas_geradas_ids: [] } },
    { id: 'im-2', venda_id: 'vm-1', fornecedor_id: '', sequencia: 2, status: 'ativo', data: { tipo: 'PACOTE', descricao: 'Pacote', fornecedor_nome: 'Op Y', meio_pagamento: 'fornecedor', valor_custo: 900, valor_venda: 1000, comissao_percentual: 8, comissao_valor: 0, moeda: 'BRL', cambio: 1, localizador: '', data_inicio: '', data_fim: '', observacoes: '', contas_geradas_ids: [] } },
  ],
};
const resp = await rotaVendas.POST(new Request('http://localhost/api/vendas-crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoManual) }));
eq(resp.status, 200, 'POST manual: 200');
atual.manual = await contasDa('vm-1');
await rotaVendas.POST(new Request('http://localhost/api/vendas-crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoManual) }));
eq(await contasDa('vm-1'), atual.manual, 'POST manual repetido: as mesmas contas');
globalThis.__SESSAO_DE_TESTE__ = null;

const ARQUIVO = new URL('./fixture-venda-v1-sql-congelada.json', import.meta.url);
if (process.env.GRAVAR_CONGELADO === '1' || !existsSync(ARQUIVO)) {
  writeFileSync(ARQUIVO, JSON.stringify(atual, null, 2) + '\n');
  console.log('congelado gravado em scripts/fixture-venda-v1-sql-congelada.json');
}
const congelado = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
console.log('--- Igual ao congelado de antes da E5 ---');
for (const k of Object.keys(congelado)) eq(atual[k], congelado[k], `${k}: contas iguais às de antes da E5`);

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
