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
  `);
  initialized = true;
}
