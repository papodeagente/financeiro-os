import { Pool } from 'pg';

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  : null;

export default pool;

let initialized = false;

export async function initDB() {
  if (!pool || initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grupos (
      id TEXT PRIMARY KEY,
      grp_id TEXT NOT NULL DEFAULT '',
      origem_destino TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS clientes (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      cpf_cnpj TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'fisica',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fornecedores_crm (
      id TEXT PRIMARY KEY,
      nome_fantasia TEXT NOT NULL DEFAULT '',
      cnpj TEXT NOT NULL DEFAULT '',
      categoria TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS membros (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      cargo TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vendas_crm (
      id TEXT PRIMARY KEY,
      cliente_id TEXT NOT NULL DEFAULT '',
      vendedor_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'orcamento',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contas_receber (
      id TEXT PRIMARY KEY,
      venda_id TEXT NOT NULL DEFAULT '',
      cliente_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contas_pagar (
      id TEXT PRIMARY KEY,
      fornecedor_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendente',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS plano_contas (
      id TEXT PRIMARY KEY,
      codigo TEXT NOT NULL DEFAULT '',
      descricao TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'receita',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contas_bancarias (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      banco TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS centros_custo (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agencia (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cac_mensal (
      id TEXT PRIMARY KEY,
      mes TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cenarios_cac (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      mes_referencia TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transferencias (
      id TEXT PRIMARY KEY,
      conta_origem_id TEXT NOT NULL DEFAULT '',
      conta_destino_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS extrato_bancario (
      id TEXT PRIMARY KEY,
      conta_bancaria_id TEXT NOT NULL DEFAULT '',
      status_conciliacao TEXT NOT NULL DEFAULT 'PENDENTE',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS planos_comissao (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS comissoes (
      id TEXT PRIMARY KEY,
      venda_id TEXT NOT NULL DEFAULT '',
      vendedor_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'CALCULADA',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS metas (
      id TEXT PRIMARY KEY,
      vendedor_id TEXT NOT NULL DEFAULT '',
      mes_referencia TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS propostas (
      id TEXT PRIMARY KEY,
      numero TEXT NOT NULL DEFAULT '',
      cliente_id TEXT NOT NULL DEFAULT '',
      vendedor_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'RASCUNHO',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS templates_proposta (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL DEFAULT '',
      acao TEXT NOT NULL DEFAULT '',
      modulo TEXT NOT NULL DEFAULT '',
      entidade TEXT NOT NULL DEFAULT '',
      entidade_id TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      key TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      calls_saved INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS voos_monitorados (
      id TEXT PRIMARY KEY,
      grupo_id TEXT NOT NULL DEFAULT '',
      cia TEXT NOT NULL DEFAULT '',
      numero_voo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS config_apis (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS destinos (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      pais TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_config (
      id TEXT PRIMARY KEY DEFAULT 'singleton',
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_eventos_saida (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      tentativas INTEGER NOT NULL DEFAULT 0,
      proxima_tentativa TIMESTAMPTZ,
      latencia_ms INTEGER,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crm_eventos_entrada (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'RECEBIDO',
      processado BOOLEAN NOT NULL DEFAULT false,
      erro TEXT,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS planejamento_custos (
      id TEXT PRIMARY KEY,
      mes TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orcamentos (
      id TEXT PRIMARY KEY,
      numero TEXT NOT NULL DEFAULT '',
      cliente_id TEXT NOT NULL DEFAULT '',
      grupo_id TEXT NOT NULL DEFAULT '',
      proposta_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'RASCUNHO',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS planejamento_projetos (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planejando',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fluxograma_categorias (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      ordem INTEGER NOT NULL DEFAULT 0,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fluxogramas (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      categoria_id TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cartoes_corp (
      id TEXT PRIMARY KEY,
      apelido TEXT NOT NULL DEFAULT '',
      bandeira TEXT NOT NULL DEFAULT '',
      ativo BOOLEAN NOT NULL DEFAULT true,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS funis (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'rascunho',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS funis_simulacoes (
      id TEXT PRIMARY KEY,
      funil_id TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS funis_templates (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      categoria TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Create indices for new tables (IF NOT EXISTS prevents errors on re-run)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_saida_tipo ON crm_eventos_saida(tipo);
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_saida_status ON crm_eventos_saida(status);
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_saida_proxima ON crm_eventos_saida(proxima_tentativa);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_eventos_entrada_idem ON crm_eventos_entrada(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_entrada_tipo ON crm_eventos_entrada(tipo);
    CREATE INDEX IF NOT EXISTS idx_crm_eventos_entrada_proc ON crm_eventos_entrada(processado);
    -- NOTE: o índice único em planejamento_custos é (tenant_id, mes) — criado mais abaixo
    -- após o ALTER TABLE que adiciona tenant_id. Não criar UNIQUE em mes apenas, pois
    -- duplicatas entre tenants quebram initDB() e impedem login.
    CREATE INDEX IF NOT EXISTS idx_planejamento_projetos_nome ON planejamento_projetos(nome);
    CREATE INDEX IF NOT EXISTS idx_planejamento_projetos_status ON planejamento_projetos(status);
    CREATE INDEX IF NOT EXISTS idx_fluxograma_categorias_ordem ON fluxograma_categorias(ordem);
    CREATE INDEX IF NOT EXISTS idx_fluxogramas_categoria ON fluxogramas(categoria_id);
    CREATE INDEX IF NOT EXISTS idx_fluxogramas_nome ON fluxogramas(nome);
    CREATE INDEX IF NOT EXISTS idx_funis_nome ON funis(nome);
    CREATE INDEX IF NOT EXISTS idx_funis_status ON funis(status);
    CREATE INDEX IF NOT EXISTS idx_funis_simulacoes_funil ON funis_simulacoes(funil_id);
    CREATE INDEX IF NOT EXISTS idx_funis_templates_categoria ON funis_templates(categoria);
  `);

  // ============================================================
  // MULTI-TENANT TABLES
  // ============================================================
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL DEFAULT '',
      cnpj TEXT NOT NULL DEFAULT '',
      plano TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'ativo',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
    CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

    CREATE TABLE IF NOT EXISTS super_admins (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      nome TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tenant_usage (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      mes TEXT NOT NULL DEFAULT '',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_super_admins_email ON super_admins(email);
    CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant ON tenant_usage(tenant_id);
  `);

  // ============================================================
  // ADD tenant_id TO ALL EXISTING TABLES
  // ============================================================
  const TENANT_TABLES = [
    'grupos', 'clientes', 'fornecedores_crm', 'membros', 'vendas_crm',
    'contas_receber', 'contas_pagar', 'plano_contas', 'contas_bancarias',
    'centros_custo', 'agencia', 'usuarios', 'cac_mensal', 'cenarios_cac',
    'transferencias', 'extrato_bancario', 'planos_comissao', 'comissoes',
    'metas', 'propostas', 'templates_proposta', 'audit_log', 'api_cache',
    'voos_monitorados', 'config_apis', 'destinos', 'crm_config',
    'crm_eventos_saida', 'crm_eventos_entrada', 'planejamento_custos',
    'orcamentos', 'planejamento_projetos',
    'fluxograma_categorias', 'fluxogramas',
    'cartoes_corp',
    'funis', 'funis_simulacoes', 'funis_templates',
  ];
  for (const table of TENANT_TABLES) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id)`);
  }

  // Drop the old unique constraint on planejamento_custos(mes) — now needs (tenant_id, mes)
  await pool.query(`DROP INDEX IF EXISTS idx_planejamento_custos_mes`);
  // Deduplicate planejamento_custos before creating the composite unique index.
  // Keep only the row with the highest updated_at per (tenant_id, mes); fallback to id as tiebreaker.
  await pool.query(`
    DELETE FROM planejamento_custos a USING planejamento_custos b
    WHERE a.tenant_id IS NOT DISTINCT FROM b.tenant_id
      AND a.mes IS NOT DISTINCT FROM b.mes
      AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.id < b.id))
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_planejamento_custos_tenant_mes ON planejamento_custos(tenant_id, mes)`);

  // Run multi-tenant migration (assign existing data to default tenant)
  const { migrateToMultiTenant } = await import('./migrate-multitenant');
  await migrateToMultiTenant();

  // Seed dos 6 templates de funis (idempotente via WHERE NOT EXISTS por id fixo).
  // Templates são globais (tenant_id = '') para aparecer em qualquer tenant.
  const { FUNIL_TEMPLATES_SEED } = await import('./funil-templates-seed');
  for (const tpl of FUNIL_TEMPLATES_SEED) {
    await pool.query(
      `INSERT INTO funis_templates (id, nome, categoria, data, tenant_id, created_at)
       SELECT $1, $2, $3, $4::jsonb, '', NOW()
       WHERE NOT EXISTS (SELECT 1 FROM funis_templates WHERE id = $1)`,
      [tpl.id, tpl.nome, tpl.categoria, JSON.stringify(tpl)],
    );
  }

  initialized = true;
}
