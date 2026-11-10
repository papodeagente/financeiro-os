/**
 * Papéis da plataforma (src/lib/plataforma.ts): super admin e CS. Bruno,
 * 10/11/2026: "me permita criar novos usuários super admin e CS com acesso
 * ao dashboard super admin".
 *
 * Roda com: node --experimental-strip-types scripts/run-tests.mjs scripts/test-plataforma.ts
 */
import { csPodeAbrir, papelDaSessao, papelDoCadastro, podeNaPlataforma } from '../src/lib/plataforma.ts';

let falhas = 0, total = 0;
function eq(atual: unknown, esperado: unknown, label: string) {
  total++;
  const ok = JSON.stringify(atual) === JSON.stringify(esperado);
  if (!ok) { falhas++; console.log(`FAIL  ${label}\n        esperado: ${JSON.stringify(esperado)}\n        obtido:   ${JSON.stringify(atual)}`); }
  else console.log(`PASS  ${label}`);
}

console.log('--- papel do cadastro e da sessão ---');
eq([papelDoCadastro({}), papelDoCadastro({ papel: 'CS' }), papelDoCadastro({ papel: 'qualquer' }), papelDoCadastro(null)],
  ['SUPER_ADMIN', 'CS', 'SUPER_ADMIN', 'SUPER_ADMIN'], 'cadastro sem papel (os de hoje) é super admin; só "CS" é CS');
eq(papelDaSessao({ isSuperAdmin: true, tenantId: '__platform__' }), 'SUPER_ADMIN', 'sessão de super admin de antes (sem plataforma) continua super admin');
eq(papelDaSessao({ isSuperAdmin: true, tenantId: 'ag-1', impersonatingTenantId: 'ag-1' }), 'SUPER_ADMIN', 'super admin dentro de uma agência continua super admin');
eq(papelDaSessao({ plataforma: 'CS', tenantId: '__platform__' }), 'CS', 'sessão do CS');
eq([
  papelDaSessao({ plataforma: 'CS', tenantId: 'ag-1' }),
  papelDaSessao({ plataforma: 'CS', tenantId: '__platform__', impersonatingTenantId: 'ag-1' }),
  papelDaSessao({ plataforma: 'SUPER_ADMIN', tenantId: '__platform__' }),
  papelDaSessao({ tenantId: 'ag-1' }),
  papelDaSessao(null),
], [null, null, null, null, null], 'CS fora da plataforma, "SUPER_ADMIN" sem a marca, usuário de agência e sem sessão: ninguém da plataforma');

console.log('--- o que cada papel faz ---');
eq(['ver_painel', 'ver_agencias', 'atender_suporte', 'gerir_agencias', 'gerir_equipe'].map(a => podeNaPlataforma('CS', a as never)),
  [true, true, true, false, false], 'CS vê painel e agências e atende suporte; não gere agências nem a equipe');
eq(['ver_painel', 'gerir_agencias', 'gerir_equipe'].map(a => podeNaPlataforma('SUPER_ADMIN', a as never)), [true, true, true], 'super admin faz tudo');
eq(podeNaPlataforma(null, 'ver_painel'), false, 'quem não é da plataforma não faz nada');

console.log('--- caminhos do CS (middleware) ---');
const abre: [string, string][] = [
  ['/admin', 'GET'], ['/admin/dashboard', 'GET'], ['/admin/tenants', 'GET'], ['/admin/tenants/ag-1', 'GET'],
  ['/admin/support', 'GET'], ['/admin/support/t-1', 'GET'], ['/admin/minha-conta', 'GET'],
  ['/api/admin/auth/session', 'GET'], ['/api/admin/auth/senha', 'POST'], ['/api/admin/metrics', 'GET'],
  ['/api/admin/tenants', 'GET'], ['/api/admin/tenants/ag-1', 'GET'],
  ['/api/admin/support/tickets', 'GET'], ['/api/admin/support/tickets/t-1', 'GET'], ['/api/admin/support/tickets/t-1', 'PATCH'],
  ['/api/admin/support/tickets/t-1/messages', 'POST'], ['/api/upload', 'POST'], ['/api/auth/logout', 'POST'],
];
eq(abre.filter(([p, m]) => !csPodeAbrir(p, m)), [], 'o CS abre o dashboard, as agências, o suporte, Minha conta e sai');
const fecha: [string, string][] = [
  ['/admin/tenants/novo', 'GET'], ['/admin/planos', 'GET'], ['/admin/convites', 'GET'], ['/admin/marketing', 'GET'],
  ['/admin/cofre', 'GET'], ['/admin/equipe', 'GET'],
  ['/api/admin/tenants', 'POST'], ['/api/admin/tenants/ag-1', 'PUT'], ['/api/admin/tenants/ag-1/impersonate', 'POST'],
  ['/api/admin/tenants/ag-1/suspend', 'POST'], ['/api/admin/tenants/ag-1/reactivate', 'POST'],
  ['/api/admin/planos', 'GET'], ['/api/admin/cofre-plataforma', 'GET'], ['/api/admin/razao', 'GET'],
  ['/api/admin/equipe', 'GET'], ['/api/admin/equipe', 'POST'], ['/api/admin/equipe/sa-1', 'PATCH'],
  ['/api/admin/convites', 'GET'], ['/api/admin/marketing/login', 'GET'],
  ['/api/admin/support/tickets', 'POST'],
  ['/dashboard', 'GET'], ['/financeiro-ag/contas', 'GET'], ['/api/contas-receber', 'GET'], ['/api/arquivos/x.pdf', 'GET'],
  ['/api/admin/tenantsx', 'GET'], ['/api/admin/metrics/../planos', 'GET'],
];
eq(fecha.filter(([p, m]) => csPodeAbrir(p, m)), [], 'o CS não abre telas e rotas do super admin nem o app das agências');

console.log(`\n${total - falhas}/${total} testes dos papéis da plataforma passaram`);
if (falhas > 0) process.exit(1);
