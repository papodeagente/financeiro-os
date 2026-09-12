export const NOTIFICACOES_SCHEMA_SQL = String.raw`
  ALTER TABLE notificacoes ADD COLUMN IF NOT EXISTS chave_deduplicacao TEXT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_notificacoes_deduplicacao
    ON notificacoes (tenant_id, chave_deduplicacao)
    WHERE chave_deduplicacao IS NOT NULL AND chave_deduplicacao <> '';
  CREATE INDEX IF NOT EXISTS idx_notificacoes_tenant_tipo_data
    ON notificacoes (tenant_id, tipo, created_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS notificacoes_leituras (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    usuario_id TEXT NOT NULL,
    notificacao_id TEXT NOT NULL,
    lida BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, usuario_id, notificacao_id)
  );
  CREATE INDEX IF NOT EXISTS idx_notificacoes_leituras_usuario
    ON notificacoes_leituras (tenant_id, usuario_id, notificacao_id, lida);

  CREATE TABLE IF NOT EXISTS notificacoes_preferencias (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    usuario_id TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, usuario_id)
  );
  CREATE INDEX IF NOT EXISTS idx_notificacoes_preferencias_usuario
    ON notificacoes_preferencias (tenant_id, usuario_id);
`;
