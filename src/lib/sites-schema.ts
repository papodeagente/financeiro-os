/** Integração do booking do Sites. O histórico não cria vendas ou contas em duplicidade. */
export const SITES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sites_config (
    tenant_id TEXT PRIMARY KEY,
    company_id INTEGER NOT NULL,
    segredo JSONB NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_config_company
    ON sites_config(company_id);
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
    projetado_em TIMESTAMPTZ,
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_sites_eventos_pedido
    ON sites_eventos(tenant_id, pedido_codigo, criado_em DESC);
  CREATE INDEX IF NOT EXISTS idx_sites_eventos_tipo
    ON sites_eventos(tenant_id, tipo, recebido_em DESC);
  ALTER TABLE sites_eventos ADD COLUMN IF NOT EXISTS projetado_em TIMESTAMPTZ;

  -- Retrato mais novo de cada reserva. Eventos fora de ordem ficam no
  -- histórico, mas uma versão antiga nunca volta o estado operacional.
  CREATE TABLE IF NOT EXISTS sites_reservas (
    tenant_id TEXT NOT NULL,
    reserva_id TEXT NOT NULL,
    pedido_id TEXT,
    pedido_codigo TEXT,
    numero TEXT,
    versao INTEGER NOT NULL,
    situacao TEXT NOT NULL,
    total_centavos BIGINT,
    moeda TEXT,
    servico_id TEXT,
    inicio TIMESTAMPTZ,
    fim TIMESTAMPTZ,
    ocorrido_em TIMESTAMPTZ NOT NULL,
    evento_id UUID NOT NULL,
    dados JSONB NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, reserva_id),
    UNIQUE (tenant_id, evento_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sites_reservas_pedido
    ON sites_reservas(tenant_id, pedido_codigo, atualizado_em DESC);

  -- Livro de origem Sites. A chave natural, além do UUID do evento, evita
  -- duplicar um pagamento/reembolso quando a origem o reemite com novo UUID.
  CREATE TABLE IF NOT EXISTS sites_movimentos (
    tenant_id TEXT NOT NULL,
    chave_natural TEXT NOT NULL,
    evento_id UUID NOT NULL,
    company_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    categoria TEXT NOT NULL,
    referencia TEXT NOT NULL,
    pedido_id TEXT,
    pedido_codigo TEXT,
    reserva_id TEXT,
    valor_centavos BIGINT,
    taxa_centavos BIGINT,
    liquido_centavos BIGINT,
    moeda TEXT,
    estado TEXT NOT NULL,
    efetivo BOOLEAN NOT NULL DEFAULT false,
    ocorrido_em TIMESTAMPTZ NOT NULL,
    dados JSONB NOT NULL,
    recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, chave_natural),
    UNIQUE (tenant_id, evento_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sites_movimentos_pedido
    ON sites_movimentos(tenant_id, pedido_codigo, ocorrido_em DESC);
  CREATE INDEX IF NOT EXISTS idx_sites_movimentos_categoria
    ON sites_movimentos(tenant_id, categoria, ocorrido_em DESC);
`;
