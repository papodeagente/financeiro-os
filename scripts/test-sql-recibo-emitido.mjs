/**
 * Recibo emitido e a trava da venda (E7, 06/11/2026), contra um Postgres
 * real (PGlite) e as rotas DE PRODUÇÃO (sessão de teste).
 *
 * Prova: abrir o recibo (POST) registra o número; abrir de novo devolve o
 * mesmo; mudar só a observação grava sem perguntar; mudar o valor ou quem
 * paga responde 409 VENDA_COM_RECIBO na primeira tentativa e NÃO grava;
 * confirmado, grava, o histórico registra e o recibo emitido fica
 * substituído; o próximo recibo sai .2 dizendo qual substitui. O GET segue só
 * leitura (não registra). Venda sem recibo emitido: edição como sempre.
 *
 * Uso: node --no-warnings scripts/test-sql-recibo-emitido.mjs
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
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
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

const { RECIBOS_EMITIDOS_SCHEMA_SQL } = await import('../src/lib/recibo-emitido.ts');
await pg.exec(RECIBOS_EMITIDOS_SCHEMA_SQL);
await pg.exec(RECIBOS_EMITIDOS_SCHEMA_SQL); // idempotente
const rotaUma = await import('../src/app/api/vendas/completa/[id]/route.ts');
const emitir = async id => json(await rotaRecibo.POST(pedir('POST', `/api/vendas/completa/${id}/recibo`), params(id)));
const salvar = async (id, venda, extra = {}) => json(await rotaUma.PUT(pedir('PUT', `/api/vendas/completa/${id}`, { venda, ...extra }), params(id)));
const ler = async id => (await json(await rotaUma.GET(pedir('GET', `/api/vendas/completa/${id}`), params(id)))).corpo.venda;
const emitidos = async id => todos(`SELECT numero, versao, substituido_em IS NOT NULL AS subst, substituido_motivo FROM recibos_emitidos WHERE tenant_id = $1 AND origem_id = $2 ORDER BY versao`, [T, id]);

console.log('--- Venda e recibo emitido ---');
let r = await json(await rotaVendas.POST(pedir('POST', '/api/vendas/completa', { venda: {
  id: 've1', data_venda: '2026-11-01', cliente: { id: 'cli-ana', nome: 'Ana Lima' },
  produtos: [{ id: 'p1', tipo: 'HOTEL', descricao: 'Hotel Lisboa', fornecedor: { id: 'f1', nome: 'Operadora Sol' }, quantidade: 1, valor_unitario_centavos: 100000 }],
  pagamentos: [{ id: 'g1', forma: 'PIX', valor_centavos: 100000, parcelas: 1, primeiro_vencimento: '2026-11-05' }],
} })));
eq(r.status, 201, 'venda lançada');
let venda = r.corpo.venda;
const [conta] = await contasDa('ve1');
await baixar(conta.id, 1000, '2026-11-05');
r = await recibo('ve1');
eq([r.status, (await emitidos('ve1')).length], [200, 0], 'GET só lê: nada registrado');
r = await emitir('ve1');
const numero1 = r.corpo.recibo?.numero;
eq([r.status, typeof numero1, r.corpo.recibo?.substitui ?? null, (await emitidos('ve1')).length], [200, 'string', null, 1], 'POST emite: número registrado');
r = await emitir('ve1');
eq([r.corpo.recibo.numero, (await emitidos('ve1')).length], [numero1, 1], 'abrir de novo, sem mudança: o mesmo número');

console.log('--- Trava ---');
r = await salvar('ve1', { ...venda, observacoes: 'cliente pediu quarto alto' });
eq(r.status, 200, 'mudar só a observação: grava sem perguntar');
venda = r.corpo.venda;
const maisCara = { ...venda, produtos: venda.produtos.map(p => ({ ...p, valor_unitario_centavos: 120000 })), pagamentos: venda.pagamentos.map(g => ({ ...g, valor_centavos: 120000 })) };
r = await salvar('ve1', maisCara);
eq([r.status, r.corpo.codigo, r.corpo.detalhes?.recibos?.map(x => x.numero), r.corpo.detalhes?.resumo], [409, 'VENDA_COM_RECIBO', [numero1], 'valor de R$ 1.000,00 para R$ 1.200,00'], 'mudar o valor: 409 com o recibo e a mudança');
eq((await ler('ve1')).produtos[0].valor_unitario_centavos, 100000, 'sem confirmar: nada gravado');
r = await salvar('ve1', maisCara, { confirmar_recibo: true });
eq(r.status, 200, 'confirmado: grava');
const ev = (r.corpo.eventos ?? []).find(e => e.detalhe?.recibo_emitido_alterado);
eq([ev?.tipo, ev?.detalhe?.recibo_emitido_alterado?.recibos, ev?.detalhe?.recibo_emitido_alterado?.confirmado], ['alterada', [numero1], true], 'o histórico da venda registra o recibo e a mudança');
const e1 = await emitidos('ve1');
eq([e1[0].subst, /Venda alterada depois de emitido/.test(e1[0].substituido_motivo ?? '')], [true, true], 'o recibo emitido fica substituído, com o motivo');
r = await emitir('ve1');
eq([r.corpo.recibo.numero, r.corpo.recibo.substitui], [`${numero1}.2`, numero1], 'o próximo recibo: número novo, dizendo qual substitui');
const agora = await ler('ve1');
r = await salvar('ve1', { ...agora, pagamentos: agora.pagamentos.map(g => ({ ...g, pagante: { id: 'cli-emp', nome: 'Empresa Alfa' } })) });
eq([r.status, r.corpo.codigo], [409, 'VENDA_COM_RECIBO'], 'trocar quem paga também pede confirmação');

console.log('--- Venda sem recibo emitido ---');
r = await json(await rotaVendas.POST(pedir('POST', '/api/vendas/completa', { venda: {
  id: 've2', data_venda: '2026-11-01', cliente: { id: 'cli-ana', nome: 'Ana Lima' },
  produtos: [{ id: 'p1', tipo: 'HOTEL', descricao: 'Hotel', fornecedor: { id: 'f1', nome: 'Operadora Sol' }, quantidade: 1, valor_unitario_centavos: 50000 }],
  pagamentos: [{ id: 'g1', forma: 'PIX', valor_centavos: 50000, parcelas: 1 }],
} })));
const v2 = r.corpo.venda;
r = await salvar('ve2', { ...v2, produtos: v2.produtos.map(p => ({ ...p, valor_unitario_centavos: 60000 })), pagamentos: v2.pagamentos.map(g => ({ ...g, valor_centavos: 60000 })) });
eq(r.status, 200, 'sem recibo emitido: muda o valor como sempre');

console.log(`\n${total - falhas}/${total} passaram`);
if (falhas > 0) process.exit(1);
