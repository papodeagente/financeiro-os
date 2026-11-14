/**
 * Aba Histórico (06/11/2026, E7) contra um Postgres real (PGlite), chamando a
 * ROTA de produção GET /api/historico com sessões de teste e o gatilho de
 * auditoria de verdade (AUDIT_SCHEMA_SQL).
 *
 * Prova:
 *  1. o histórico é do registro pedido: filtra por agência, tabela e id;
 *  2. antes → depois legível (R$, data, nome da categoria/conta) e o ruído
 *     (updated_at, _versao) escondido;
 *  3. exclusão lógica: a linha sai (Excluiu) e volta (Restaurou);
 *  4. entidade fora da lista: 400; sem sessão: 401;
 *  5. perfil sem "Acessar o financeiro" (papel ou perfil de acesso): 403;
 *     cliente/fornecedor só para administrador (a regra do Registro de
 *     atividades); conta bancária não liberada: 404.
 *
 * Uso: node --no-warnings scripts/test-sql-historico.mjs
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
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', usuario_id TEXT,
    acao TEXT, modulo TEXT, entidade TEXT, entidade_id TEXT, data JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE contas_bancarias (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT DEFAULT '', banco TEXT DEFAULT '',
    data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE contas_pagar (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', fornecedor_id TEXT DEFAULT '',
    status TEXT DEFAULT '', data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE plano_contas (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE centros_custo (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE clientes (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW());
  CREATE TABLE usuarios (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}');
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
const pool = { query, connect: async () => ({ query, release() {} }) };
globalThis.__POOL_DE_TESTE__ = pool;
// Agência na versão completa: as rotas dos módulos conferem (scripts/db-de-teste.mjs).
globalThis.__VERSAO_DE_TESTE__ = 'completa';
globalThis.__SESSAO_DE_TESTE__ = null;
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);
process.env.JWT_SECRET = 'segredo-de-teste-historico';

const { PERMISSOES_SCHEMA_SQL } = await import('../src/lib/permissoes-schema.ts');
const { AUDIT_SCHEMA_SQL } = await import('../src/lib/audit-schema.ts');
await pg.exec(PERMISSOES_SCHEMA_SQL);
await pg.exec(AUDIT_SCHEMA_SQL);
const P = await import('../src/lib/permissoes-servidor.ts');
const R = await import('../src/app/api/historico/route.ts');

const T = 'ag-1', T2 = 'ag-2';
const sessao = (perfil, userId = `u-${perfil}`, tenant = T) => ({ userId, nome: `Pessoa ${userId}`, email: 'p@x.com', perfil, permissoes: {}, tenantId: tenant, tenantSlug: tenant });
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; P.invalidarPermissoes?.(); };
const ctx = (nome, tenant = T) => query(`SELECT set_config('app.audit_context', $1, false)`,
  [JSON.stringify({ userId: `id-${nome}`, userName: nome, tenantId: tenant, perfil: 'ADMIN', source: 'USUARIO' })]);
const pedir = async (entidade, id, extra = '') => {
  const r = await R.GET(new Request(`http://localhost/api/historico?entidade=${entidade}&id=${encodeURIComponent(id)}${extra}`));
  return { status: r.status, corpo: await r.json() };
};
const n = s => String(s).replace(/ /g, ' ');

// ---------------------------------------------------------------------------
await ctx('Sistema');
await query(`INSERT INTO plano_contas (id, tenant_id, codigo, descricao, tipo, data) VALUES ('cat-1', $1, '2.1', 'Aluguel', 'despesa', '{"nome":"Aluguel","codigo":"2.1"}')`, [T]);
await query(`INSERT INTO contas_bancarias (id, tenant_id, nome, data) VALUES ('b1', $1, 'Inter', '{"nome":"Inter"}'), ('b2', $1, 'Itaú', '{"nome":"Itaú"}')`, [T]);

await ctx('Ana');
const conta = { id: 't1', descricao: 'Aluguel de novembro', fornecedor_nome: 'Imobiliária', valor_final: 100, data_vencimento: '2026-11-10', status: 'PENDENTE' };
await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('t1', $1, 'PENDENTE', $2)`, [T, JSON.stringify(conta)]);
await ctx('Bruno');
await query(`UPDATE contas_pagar SET data = $2, updated_at = NOW() WHERE id = 't1' AND tenant_id = $1`,
  [T, JSON.stringify({ ...conta, valor_final: 150, data_vencimento: '2026-11-15', categoria_id: 'cat-1', _versao: '123' })]);
// Gravação só de campo técnico: não vira evento.
await query(`UPDATE contas_pagar SET updated_at = NOW() + interval '1 second' WHERE id = 't1'`);
// Exclusão lógica: a linha sai e volta.
await ctx('Carla');
await query(`DELETE FROM contas_pagar WHERE id = 't1'`);
await ctx('Davi');
await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('t1', $1, 'PENDENTE', $2)`, [T, JSON.stringify({ ...conta, valor_final: 150 })]);
// Outro título e outra agência com o MESMO id: nunca entram.
await ctx('Ana');
await query(`INSERT INTO contas_pagar (id, tenant_id, status, data) VALUES ('t2', $1, 'PENDENTE', '{"descricao":"Outra"}')`, [T]);
await ctx('Zé', T2);
await query(`INSERT INTO audit_log (id, tenant_id, usuario_id, acao, modulo, entidade, entidade_id, data, created_at)
             VALUES ('fora', $1, 'z', 'EDITAR', 'Financeiro', 'contas_pagar', 't1', '{"usuario_nome":"Zé","alteracoes":[{"campo":"data.descricao","valor_anterior":"a","valor_novo":"b"}]}', NOW())`, [T2]);
// Conta bancária com histórico.
await ctx('Ana');
await query(`UPDATE contas_bancarias SET data = '{"nome":"Inter PJ","ativo":false}', updated_at = NOW() WHERE id = 'b1'`);
await query(`INSERT INTO clientes (id, tenant_id, data) VALUES ('c1', $1, '{"nome":"Maria"}')`, [T]);

console.log('--- Sem sessão / entidade inválida ---');
como(null);
eq((await pedir('contas_pagar', 't1')).status, 401, 'sem sessão: 401');
como(sessao('ADMIN'));
eq((await pedir('usuarios', 'u1')).status, 400, 'tabela fora da lista: 400');
eq((await pedir('audit_log', 'x')).status, 400, 'o próprio log: 400');
eq((await pedir('contas_pagar', '')).status, 400, 'sem id: 400');
eq((await pedir('contas_pagar', 't1', '&pagina=0')).status, 400, 'página inválida: 400');

console.log('--- O histórico do registro ---');
const h = await pedir('contas_pagar', 't1');
eq(h.status, 200, 'admin lê');
eq(h.corpo.eventos.map(e => [e.tipo, e.quem]), [['restaurou', 'Davi'], ['excluiu', 'Carla'], ['alterou', 'Bruno'], ['criou', 'Ana']],
  'só este título desta agência; mais novo primeiro; exclusão e restauração; gravação técnica some');
const alteracao = h.corpo.eventos[2].alteracoes.map(a => [a.rotulo, n(a.antes), n(a.depois)]);
eq(alteracao, [['Categoria', 'vazio', '2.1 · Aluguel'], ['Vencimento', '10/11/2026', '15/11/2026'], ['Valor', 'R$ 100,00', 'R$ 150,00']],
  'antes → depois legível, categoria pelo nome, _versao escondido');
eq(h.corpo.eventos[3].alteracoes.map(a => a.rotulo), ['Descrição', 'Fornecedor', 'Valor', 'Vencimento', 'Situação'], 'criação resumida');
eq(h.corpo.total, 4, 'total de eventos');
eq((await pedir('contas_pagar', 't2')).corpo.eventos.length, 1, 'outro título: só o dele');
como(sessao('ADMIN', 'u-admin-2', T2));
eq((await pedir('contas_pagar', 't1')).corpo.eventos.map(e => e.quem), ['Zé'], 'outra agência só vê o dela');

console.log('--- Quem pode ver ---');
como(sessao('VENDEDOR'));
eq((await pedir('contas_pagar', 't1')).status, 403, 'vendedor (sem financeiro): 403');
await query(`INSERT INTO usuario_restricoes (tenant_id, usuario_id, contas_liberadas, acoes_negadas) VALUES ($1, 'u-op-sem', '[]', '["ver_financeiro"]')`, [T]);
como(sessao('OPERADOR', 'u-op-sem'));
eq((await pedir('contas_pagar', 't1')).status, 403, 'perfil de acesso sem "Acessar o financeiro": 403');
como(sessao('OPERADOR'));
eq((await pedir('contas_pagar', 't1')).status, 200, 'operador com financeiro lê o título');
eq((await pedir('clientes', 'c1')).status, 403, 'cliente: só administrador (regra do Registro de atividades)');
como(sessao('ADMIN'));
eq((await pedir('clientes', 'c1')).corpo.eventos.map(e => e.tipo), ['criou'], 'administrador vê o cliente');
const banco = await pedir('contas_bancarias', 'b1');
eq(banco.corpo.eventos[0].alteracoes.map(a => [a.rotulo, a.antes, a.depois]), [['Ativa', 'vazio', 'Não'], ['Nome', 'Inter', 'Inter PJ']], 'conta bancária: nome e desativação');
await query(`INSERT INTO usuario_restricoes (tenant_id, usuario_id, contas_liberadas, acoes_negadas) VALUES ($1, 'u-op-b2', '["b2"]', '[]')`, [T]);
como(sessao('OPERADOR', 'u-op-b2'));
eq((await pedir('contas_bancarias', 'b1')).status, 404, 'conta bancária não liberada: 404');
eq((await pedir('contas_bancarias', 'b2')).status, 200, 'conta liberada: 200');
await query(`UPDATE contas_pagar SET data = data || '{"status":"PAGO","conta_bancaria_id":"b1"}' WHERE id = 't2'`);
eq((await pedir('contas_pagar', 't2')).status, 404, 'título pago numa conta não liberada: 404');
eq((await pedir('contas_pagar', 't1')).status, 200, 'título em aberto: 200');

console.log(`\n${total - falhas}/${total} testes do histórico (SQL) passaram`);
if (falhas) process.exit(1);
