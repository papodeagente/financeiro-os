import { getSession } from './auth';
import pool from './db';

export async function getTenantId(): Promise<string> {
  const session = await getSession();
  if (session?.impersonatingTenantId) return session.impersonatingTenantId;
  if (session?.tenantId) return session.tenantId;
  throw new Error('No tenant context');
}

export async function getTenantIdSafe(): Promise<string | null> {
  try {
    return await getTenantId();
  } catch {
    return null;
  }
}

export interface TenantInfo {
  id: string;
  slug: string;
  nome: string;
  plano: string;
  status: string;
  max_usuarios: number;
  max_grupos: number;
  features: string[];
}

export async function getTenant(tenantId: string): Promise<TenantInfo | null> {
  if (!pool) return null;
  const { rows } = await pool.query('SELECT data FROM tenants WHERE id = $1', [tenantId]);
  if (rows.length === 0) return null;
  const d = rows[0].data;
  return {
    id: d.id,
    slug: d.slug,
    nome: d.nome,
    plano: d.plano || 'free',
    status: d.status || 'ativo',
    max_usuarios: d.max_usuarios ?? PLAN_LIMITS[d.plano as keyof typeof PLAN_LIMITS]?.usuarios ?? 3,
    max_grupos: d.max_grupos ?? PLAN_LIMITS[d.plano as keyof typeof PLAN_LIMITS]?.grupos ?? 10,
    features: d.features || PLAN_LIMITS[d.plano as keyof typeof PLAN_LIMITS]?.features || [],
  };
}

// Fallback static — usado quando a query a tabela planos falha. Fonte
// REAL de limites/features e a tabela planos (editavel via /admin/planos).
// Aliases legados (free/pro/enterprise) mantidos pra tenants criados
// antes da migracao para Basic/Founder/Founder Pro.
const PLAN_LIMITS = {
  basic:         { usuarios: 3,   grupos: 10,  propostas: 50,  features: [] },
  founder:       { usuarios: 10,  grupos: 50,  propostas: 200, features: ['crm', 'ai'] },
  'founder-pro': { usuarios: -1,  grupos: -1,  propostas: -1,  features: ['crm', 'ai', 'white_label'] },
  free:          { usuarios: 3,   grupos: 10,  propostas: 50,  features: [] },
  pro:           { usuarios: 15,  grupos: 100, propostas: -1,  features: ['crm', 'ai'] },
  enterprise:    { usuarios: -1,  grupos: -1,  propostas: -1,  features: ['crm', 'ai', 'white_label'] },
};

export async function checkPlanLimit(tenantId: string, table: string): Promise<string | null> {
  if (!pool) return null;
  const tenant = await getTenant(tenantId);
  if (!tenant) return 'Tenant nao encontrado';
  if (tenant.status !== 'ativo') return 'Agencia suspensa';

  const limits = PLAN_LIMITS[tenant.plano as keyof typeof PLAN_LIMITS];
  if (!limits) return null;

  let maxCount = -1;
  if (table === 'grupos') maxCount = limits.grupos;
  else if (table === 'usuarios') maxCount = limits.usuarios;
  else if (table === 'propostas') maxCount = limits.propostas;

  if (maxCount < 0) return null; // unlimited

  const { rows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM ${table} WHERE tenant_id = $1`,
    [tenantId]
  );
  const count = parseInt(rows[0].cnt, 10);
  if (count >= maxCount) {
    return `Limite do plano ${tenant.plano}: maximo de ${maxCount} ${table}`;
  }
  return null;
}
