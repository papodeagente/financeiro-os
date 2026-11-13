/**
 * As rotas do painel /admin com cada papel da plataforma, chamando os
 * handlers de verdade contra PGlite (sessão de teste: sessao-de-teste-hook).
 *
 * O que se prova:
 *   (a) equipe: super admin lista, cria (senha provisória volta uma vez) e
 *       altera; CS e usuário de agência levam 403/401;
 *   (b) o CS passa nas travas do dashboard, das agências (leitura) e do
 *       suporte; e é barrado onde só o super admin entra (planos, cofre,
 *       criar e editar agência, entrar como agência);
 *   (c) a sessão de uma agência não entra em nenhuma rota do painel.
 *
 * Uso: node --experimental-strip-types --no-warnings scripts/test-sql-rotas-da-plataforma.mjs
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
  CREATE TABLE super_admins (id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, usuario_id TEXT, acao TEXT, modulo TEXT, entidade TEXT, entidade_id TEXT,
    data JSONB, created_at TIMESTAMPTZ DEFAULT NOW());
  INSERT INTO super_admins (id, email, nome, data) VALUES ('sa-bruno', 'bruno@entur.com.br', 'Bruno', '{"id":"sa-bruno","nome":"Bruno","email":"bruno@entur.com.br","ativo":true}');
`);
const query = async (text, values) => {
  const r = await pg.query(text, values ?? []);
  return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
};
globalThis.__POOL_DE_TESTE__ = { query, connect: async () => ({ query, release() {} }) };
register('./ts-resolve-hook.mjs', import.meta.url);
register('./db-de-teste-hook.mjs', import.meta.url);
register('./sessao-de-teste-hook.mjs', import.meta.url);

const SA = { userId: 'sa-bruno', nome: 'Bruno', email: 'bruno@entur.com.br', perfil: 'SUPER_ADMIN', permissoes: {}, tenantId: '__platform__', tenantSlug: '__platform__', isSuperAdmin: true, plataforma: 'SUPER_ADMIN', tv: 0 };
const CS = { userId: 'cs-carla', nome: 'Carla', email: 'carla@entur.com.br', perfil: 'CS', permissoes: {}, tenantId: '__platform__', tenantSlug: '__platform__', plataforma: 'CS', tv: 0 };
const AGENCIA = { userId: 'u-1', nome: 'Ana', email: 'ana@agencia.com', perfil: 'ADMIN', permissoes: {}, tenantId: 'ag-1', tenantSlug: 'ag' };
const como = s => { globalThis.__SESSAO_DE_TESTE__ = s; };
const json = (url, method, corpo) => new Request('http://localhost' + url, { method, headers: { 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
const ctx = id => ({ params: Promise.resolve({ id }) });

const Equipe = await import('../src/app/api/admin/equipe/route.ts');
const EquipeId = await import('../src/app/api/admin/equipe/[id]/route.ts');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (a) equipe ---');
como(SA);
let r = await Equipe.POST(json('/api/admin/equipe', 'POST', { nome: 'Carla', email: 'carla@entur.com.br', papel: 'CS' }));
let d = await r.json();
eq([r.status, d.pessoa?.papel, typeof d.senha], [201, 'CS', 'string'], 'super admin cria a CS e recebe a senha provisória');
const idCarla = d.pessoa.id;
r = await Equipe.GET();
d = await r.json();
eq([r.status, d.equipe.map(p => p.papel), d.eu], [200, ['SUPER_ADMIN', 'CS'], 'sa-bruno'], 'super admin lista a equipe e sabe quem é');
r = await EquipeId.PATCH(json(`/api/admin/equipe/${idCarla}`, 'PATCH', { nova_senha: true }), ctx(idCarla));
d = await r.json();
eq([r.status, typeof d.senha], [200, 'string'], 'super admin gera senha nova para a CS');
r = await EquipeId.PATCH(json('/api/admin/equipe/sa-bruno', 'PATCH', { papel: 'CS' }), ctx('sa-bruno'));
eq([r.status, (await r.json()).error], [400, 'Você não pode tirar o próprio acesso. Peça a outro super admin.'], 'a rota devolve a trava em palavras');
const audit = (await query(`SELECT acao, data->>'descricao' AS d FROM audit_log ORDER BY created_at`)).rows.map(x => [x.acao, x.d]);
eq(audit, [['CRIAR', 'Adicionou Carla (carla@entur.com.br) à equipe da plataforma como CS.'], ['EDITAR', 'Equipe da plataforma, Carla: senha nova gerada.']],
  'criar e gerar senha ficam na auditoria (a senha não)');

como(CS);
eq([(await Equipe.GET()).status, (await Equipe.POST(json('/api/admin/equipe', 'POST', { nome: 'X', email: 'x@x.com', papel: 'SUPER_ADMIN' }))).status,
  (await EquipeId.PATCH(json('/api/admin/equipe/sa-bruno', 'PATCH', { ativo: false }), ctx('sa-bruno'))).status], [403, 403, 403],
  'CS não lista, não cria (nem se promove) e não altera ninguém');
como(AGENCIA);
eq((await Equipe.GET()).status, 401, 'usuário de agência não é da plataforma');
como(null);
eq((await Equipe.GET()).status, 401, 'sem sessão: 401');
eq((await query(`SELECT COUNT(*)::int AS n FROM super_admins`)).rows[0].n, 2, 'ninguém além da CS foi criado');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (b) o CS nas outras rotas do painel ---');
const passa = s => s !== 401 && s !== 403;
como(CS);
const metrics = await import('../src/app/api/admin/metrics/route.ts');
const tenants = await import('../src/app/api/admin/tenants/route.ts');
const tenant = await import('../src/app/api/admin/tenants/[id]/route.ts');
const tickets = await import('../src/app/api/admin/support/tickets/route.ts');
const ticket = await import('../src/app/api/admin/support/tickets/[id]/route.ts');
const mensagens = await import('../src/app/api/admin/support/tickets/[id]/messages/route.ts');
eq([
  passa((await metrics.GET()).status),
  passa((await tenants.GET()).status),
  passa((await tenant.GET(json('/api/admin/tenants/ag-1', 'GET'), ctx('ag-1'))).status),
  passa((await tickets.GET(json('/api/admin/support/tickets', 'GET'))).status),
  passa((await ticket.GET(json('/api/admin/support/tickets/t-1', 'GET'), ctx('t-1'))).status),
  passa((await ticket.PATCH(json('/api/admin/support/tickets/t-1', 'PATCH', { status: 'em_andamento' }), ctx('t-1'))).status),
  passa((await mensagens.POST(json('/api/admin/support/tickets/t-1/messages', 'POST', { mensagem: 'oi' }), ctx('t-1'))).status),
], [true, true, true, true, true, true, true], 'o CS passa nas travas do dashboard, das agências (leitura) e do suporte');

const planos = await import('../src/app/api/admin/planos/route.ts');
const impersonar = await import('../src/app/api/admin/tenants/[id]/impersonate/route.ts');
const suspender = await import('../src/app/api/admin/tenants/[id]/suspend/route.ts');
eq([
  passa((await planos.GET()).status),
  passa((await tenants.POST(json('/api/admin/tenants', 'POST', { nome: 'X' }))).status),
  passa((await tenant.PUT(json('/api/admin/tenants/ag-1', 'PUT', { nome: 'X' }), ctx('ag-1'))).status),
  passa((await impersonar.POST(json('/api/admin/tenants/ag-1/impersonate', 'POST'), ctx('ag-1'))).status),
  passa((await suspender.POST(json('/api/admin/tenants/ag-1/suspend', 'POST'), ctx('ag-1'))).status),
], [false, false, false, false, false], 'o CS é barrado em planos, criar e editar agência, entrar como agência e suspender');

// ══════════════════════════════════════════════════════════════════════
console.log('\n--- (c) sessão de agência ---');
como(AGENCIA);
eq([
  passa((await metrics.GET()).status),
  passa((await tenants.GET()).status),
  passa((await tickets.GET(json('/api/admin/support/tickets', 'GET'))).status),
], [false, false, false], 'usuário de agência não entra no dashboard, nas agências nem no suporte da plataforma');

console.log(`\n${total - falhas}/${total} testes das rotas da plataforma passaram`);
if (falhas > 0) process.exit(1);
