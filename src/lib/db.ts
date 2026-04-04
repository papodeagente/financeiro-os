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

    CREATE TABLE IF NOT EXISTS planejamento_projetos (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'planejando',
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_planejamento_custos_mes ON planejamento_custos(mes);
    CREATE INDEX IF NOT EXISTS idx_planejamento_projetos_nome ON planejamento_projetos(nome);
    CREATE INDEX IF NOT EXISTS idx_planejamento_projetos_status ON planejamento_projetos(status);
  `);

  initialized = true;
}
