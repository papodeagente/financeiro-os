import pool from './db';
import { hashPassword } from './auth';

const TENANT_TABLES = [
  'grupos', 'clientes', 'fornecedores_crm', 'membros', 'vendas_crm',
  'contas_receber', 'contas_pagar', 'plano_contas', 'contas_bancarias',
  'centros_custo', 'agencia', 'usuarios', 'cac_mensal', 'cenarios_cac',
  'transferencias', 'extrato_bancario', 'planos_comissao', 'comissoes',
  'metas', 'propostas', 'templates_proposta', 'audit_log', 'api_cache',
  'voos_monitorados', 'config_apis', 'destinos', 'crm_config',
  'crm_eventos_saida', 'crm_eventos_entrada', 'planejamento_custos',
  'orcamentos', 'planejamento_projetos',
];

export async function migrateToMultiTenant() {
  if (!pool) return;

  // Check if migration already done (any tenant exists)
  const { rows: existing } = await pool.query('SELECT id FROM tenants LIMIT 1');
  if (existing.length > 0) return;

  console.log('[migrate] Starting multi-tenant migration...');

  // 1. Create default tenant from existing agencia data
  const tenantId = 'tenant_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  let tenantNome = 'Agencia Padrao';
  let tenantSlug = 'default';

  const { rows: agenciaRows } = await pool.query('SELECT data FROM agencia LIMIT 1');
  if (agenciaRows.length > 0) {
    const ag = agenciaRows[0].data;
    tenantNome = ag.nome_fantasia || ag.razao_social || tenantNome;
    tenantSlug = (ag.cnpj || 'default').replace(/[^a-z0-9]/gi, '').toLowerCase().substring(0, 20) || 'default';
  }

  const tenantData = {
    id: tenantId,
    slug: tenantSlug,
    nome: tenantNome,
    cnpj: agenciaRows[0]?.data?.cnpj || '',
    plano: 'enterprise',
    status: 'ativo',
    email_contato: agenciaRows[0]?.data?.email || '',
    telefone: agenciaRows[0]?.data?.telefone || '',
    max_usuarios: -1,
    max_grupos: -1,
    features: ['crm', 'ai', 'propostas'],
  };

  await pool.query(
    `INSERT INTO tenants (id, slug, nome, cnpj, plano, status, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [tenantId, tenantSlug, tenantNome, tenantData.cnpj, 'enterprise', 'ativo', JSON.stringify(tenantData)]
  );

  // 2. Update all existing rows to belong to this tenant
  for (const table of TENANT_TABLES) {
    const result = await pool.query(
      `UPDATE ${table} SET tenant_id = $1 WHERE tenant_id = '' OR tenant_id IS NULL`,
      [tenantId]
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[migrate] ${table}: ${result.rowCount} rows assigned to tenant ${tenantSlug}`);
    }
  }

  // 3. Create super admin if env vars are set
  const saEmail = process.env.SUPER_ADMIN_EMAIL || 'super@entur.com.br';
  const saPassword = process.env.SUPER_ADMIN_PASSWORD || 'super123';
  const saId = 'sa_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
  const senhaHash = await hashPassword(saPassword);
  const saData = { id: saId, email: saEmail, nome: 'Super Admin', senha_hash: senhaHash, ativo: true };

  await pool.query(
    `INSERT INTO super_admins (id, email, nome, data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (email) DO NOTHING`,
    [saId, saEmail, 'Super Admin', JSON.stringify(saData)]
  );

  console.log(`[migrate] Multi-tenant migration complete. Tenant: ${tenantSlug} (${tenantId}), Super Admin: ${saEmail}`);
}
