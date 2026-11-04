/**
 * Rotas cuja autenticacao acontece no proprio handler (assinatura, token ou
 * credencial publica). Manter esta decisao fora do middleware permite testa-la
 * sem iniciar o Next e evita que uma integracao assinada seja bloqueada pelo
 * cookie de sessao.
 */
export const PUBLIC_PATHS = [
  '/login', '/api/auth/login', '/api/auth/seed', '/api/auth/session',
  '/api/auth/signup',
  '/signup',
  '/api/health',
  '/p/', '/api/propostas/public/', '/api/uploads/',
  '/api/v1/crm/webhook', '/api/v1/crm/health',
  '/api/v1/sites/webhook/',
  '/api/v1/plataformas/',
  '/admin/login', '/api/admin/auth/login', '/api/admin/auth/seed',
  '/api/planos',
  '/api/marketing/',
  '/api/convites/',
] as const;

export const PUBLIC_EXACT_PATHS = new Set(['/']);

export function isPublicBasePath(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  return PUBLIC_PATHS.some((prefix) =>
    pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`),
  );
}
