/** Integração do booking do Sites. O histórico não cria vendas ou contas em duplicidade. */
export const SITES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sites_config (
    tenant_id TEXT PRIMARY KEY,
    company_id INTEGER NOT NULL,
    segredo TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS sites_eventos (
    tenant_id TEXT NOT NULL,
    id UUID NOT NULL,
    company_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    pedido_codigo TEXT,
    pedido_id TEXT,
    reserva_id TEXT,
    agregado_tipo TEXT NOT NULL,
    agregado_id TEXT NOT NULL,
    agregado_versao INTEGER NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL,
    corpo_sha256 TEXT NOT NULL,
    dados JSONB NOT NULL,
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_sites_eventos_pedido
    ON sites_eventos(tenant_id, pedido_codigo, criado_em DESC);
  CREATE INDEX IF NOT EXISTS idx_sites_eventos_tipo
    ON sites_eventos(tenant_id, tipo, recebido_em DESC);
`;
