/**
 * Quem trabalha na plataforma (o painel /admin) e o que cada um pode fazer.
 *
 * Bruno, 10/11/2026: "dentro da área de admin, me permita criar novos
 * usuários super admin e CS com acesso ao dashboard super admin".
 *
 * As duas pessoas moram na tabela `super_admins`; o papel fica em
 * `data.papel` ('CS'). Cadastro sem papel é super admin, como sempre foi.
 *
 * O CS NÃO recebe `isSuperAdmin`. Essa marca libera tudo: entrar como
 * agência, passar por cima das permissões dentro dela, abrir qualquer
 * documento, cofre, planos. A sessão do CS leva `plataforma: 'CS'` e só
 * abre o que está em `DO_CS` (e, no middleware, os caminhos de
 * `csPodeAbrir`). Super admin pode tudo.
 *
 * Sem banco e sem Next: o middleware e os testes importam daqui.
 */

export type PapelDaPlataforma = 'SUPER_ADMIN' | 'CS';

export const PAPEIS_DA_PLATAFORMA: { valor: PapelDaPlataforma; rotulo: string; descricao: string }[] = [
  {
    valor: 'SUPER_ADMIN',
    rotulo: 'Super admin',
    descricao: 'Tudo no painel: agências, planos, convites, cofre, marketing, suporte e a equipe da plataforma.',
  },
  {
    valor: 'CS',
    rotulo: 'CS',
    descricao: 'Dashboard, agências (só consulta) e suporte. Não entra como agência nem altera planos, cofre ou equipe.',
  },
];

export const TENANT_DA_PLATAFORMA = '__platform__';

/** Senha que a própria pessoa escolhe em Minha conta. */
export const SENHA_MINIMA_DA_PLATAFORMA = 10;

/** O papel gravado no cadastro de `super_admins`. Sem papel é super admin. */
export function papelDoCadastro(dados: unknown): PapelDaPlataforma {
  return (dados as { papel?: unknown } | null)?.papel === 'CS' ? 'CS' : 'SUPER_ADMIN';
}

export function rotuloDoPapel(papel: PapelDaPlataforma): string {
  return PAPEIS_DA_PLATAFORMA.find(p => p.valor === papel)?.rotulo ?? papel;
}

interface SessaoDaPlataforma {
  isSuperAdmin?: boolean;
  plataforma?: string;
  tenantId?: string;
  impersonatingTenantId?: string;
}

/** O papel de quem está na sessão, ou null se não é da plataforma. */
export function papelDaSessao(s: SessaoDaPlataforma | null | undefined): PapelDaPlataforma | null {
  if (!s) return null;
  if (s.isSuperAdmin === true) return 'SUPER_ADMIN';
  // CS só existe na própria plataforma: nunca dentro de uma agência.
  if (s.plataforma === 'CS' && s.tenantId === TENANT_DA_PLATAFORMA && !s.impersonatingTenantId) return 'CS';
  return null;
}

export type AcaoDaPlataforma =
  | 'ver_painel'        // dashboard e métricas
  | 'ver_agencias'      // lista e ficha da agência, só leitura
  | 'atender_suporte'   // ver, responder e mudar o status dos chamados
  | 'gerir_agencias'    // criar, editar, suspender, reativar, entrar como
  | 'gerir_equipe';     // criar super admin e CS, trocar papel, desativar

const DO_CS: ReadonlySet<AcaoDaPlataforma> = new Set(['ver_painel', 'ver_agencias', 'atender_suporte']);

export function podeNaPlataforma(papel: PapelDaPlataforma | null, acao: AcaoDaPlataforma): boolean {
  if (papel === 'SUPER_ADMIN') return true;
  if (papel === 'CS') return DO_CS.has(acao);
  return false;
}

/** As telas do painel que aparecem para cada papel (menu e redirecionamento). */
export const TELAS_DO_CS = ['/admin/dashboard', '/admin/tenants', '/admin/support', '/admin/minha-conta'];

/**
 * O que a sessão do CS pode abrir, conferido no middleware antes de qualquer
 * rota. Tudo fora daqui é recusado: o app das agências, as rotas do painel
 * que só o super admin usa e qualquer método de escrita que não seja do
 * suporte. A rota confere de novo (podeNaPlataforma).
 */
export function csPodeAbrir(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  const leitura = m === 'GET' || m === 'HEAD';
  const id = '[^/]+';
  const casa = (re: string) => new RegExp(`^${re}/?$`).test(pathname);

  // Telas
  if (casa('/admin') || casa('/admin/dashboard') || casa('/admin/tenants') || casa('/admin/minha-conta')) return leitura;
  if (casa(`/admin/tenants/${id}`) && !casa('/admin/tenants/novo')) return leitura;
  if (casa('/admin/support') || casa(`/admin/support/${id}`)) return leitura;

  // Rotas
  if (casa('/api/admin/auth/session')) return leitura;
  if (casa('/api/admin/auth/senha')) return m === 'POST';
  if (casa('/api/admin/metrics') || casa('/api/admin/tenants') || casa(`/api/admin/tenants/${id}`)) return leitura;
  if (casa('/api/admin/support/tickets')) return leitura;
  if (casa(`/api/admin/support/tickets/${id}`)) return leitura || m === 'PATCH';
  if (casa(`/api/admin/support/tickets/${id}/messages`)) return m === 'POST';
  // Anexo na resposta do chamado e sair.
  if (casa('/api/upload')) return m === 'POST';
  if (casa('/api/auth/logout')) return m === 'POST';
  return false;
}
