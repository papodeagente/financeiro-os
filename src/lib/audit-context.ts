import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditContext {
  userId: string;
  userName: string;
  tenantId: string;
  perfil: string;
  source: 'USUARIO' | 'SISTEMA' | 'INTEGRACAO' | 'PUBLICO';
  requestId?: string;
  path?: string;
  method?: string;
}

export const SYSTEM_AUDIT_CONTEXT: AuditContext = {
  userId: '', userName: 'Sistema', tenantId: '', perfil: 'SISTEMA', source: 'SISTEMA',
};

const auditContext = new AsyncLocalStorage<AuditContext>();

/** Apenas código servidor, depois da autenticação, pode sobrescrever o ator. */
export function runWithAuditContext<T>(context: AuditContext, callback: () => T): T {
  return auditContext.run({ ...context }, callback);
}

export async function getAuditContext(): Promise<AuditContext> {
  const explicit = auditContext.getStore();
  if (explicit) return { ...explicit };

  let requestHeaders: Awaited<ReturnType<typeof import('next/headers')['headers']>>;
  try {
    const { headers } = await import('next/headers');
    requestHeaders = await headers();
  } catch {
    // Scripts, migrações e tarefas fora de uma requisição não têm cookies.
    return { ...SYSTEM_AUDIT_CONTEXT };
  }
  const { getSession } = await import('./auth');
  const session = await getSession();
  const path = (requestHeaders.get('x-audit-path') || '').split('?')[0]
    .replace(/(\/propostas\/public\/)[^/]+/g, '$1[slug]').slice(0, 500);
  const source = session ? 'USUARIO'
    : path.startsWith('/api/v1/crm/') ? 'INTEGRACAO' : 'PUBLICO';
  return {
    userId: session?.userId || '',
    userName: session?.nome || (source === 'INTEGRACAO' ? 'Integração CRM' : 'Visitante'),
    tenantId: session?.impersonatingTenantId || session?.tenantId || '',
    perfil: session?.perfil || source,
    source,
    path,
    method: (requestHeaders.get('x-audit-method') || '').slice(0, 12),
    requestId: (requestHeaders.get('x-audit-request-id') || '').slice(0, 100),
  };
}
