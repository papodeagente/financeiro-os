/**
 * Esquema das notas por regra e das retenções na fonte (E5, parte E).
 * Idempotente: roda a cada boot, depois de notas_fiscais existir e antes do
 * razão e da auditoria (as duas tabelas são de configuração e ficam na
 * auditoria, como os outros cadastros).
 */
export const NOTAS_REGRAS_SCHEMA_SQL = String.raw`
  -- Regras da nota: seletores (tipo de produto, fornecedor, representante,
  -- pagante) e os três destinos (ao pagante, ao fornecedor, ao
  -- representante). O JSON completo fica em data; combinacao é a chave dos
  -- seletores (duas regras ativas não podem ter a mesma).
  CREATE TABLE IF NOT EXISTS nota_regras (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '',
    ativa BOOLEAN NOT NULL DEFAULT TRUE,
    combinacao TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_por TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_nota_regras_tenant ON nota_regras(tenant_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_nota_regras_combinacao ON nota_regras(tenant_id, combinacao) WHERE ativa;

  -- Retenções na fonte (Lei 9.430) por cliente e tipo de produto ('' = todos).
  CREATE TABLE IF NOT EXISTS retencoes_cliente (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL DEFAULT '',
    cliente_id TEXT NOT NULL DEFAULT '',
    tipo_produto TEXT NOT NULL DEFAULT '',
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_retencoes_cliente ON retencoes_cliente(tenant_id, cliente_id, tipo_produto);

  -- A mesma nota da regra nunca sai duas vezes: a chave da geração
  -- (venda|destino|tomador|nº) é única entre as notas vivas.
  DO $notas$
  BEGIN
    IF to_regclass('public.notas_fiscais') IS NOT NULL THEN
      CREATE UNIQUE INDEX IF NOT EXISTS uq_nota_chave_geracao
        ON notas_fiscais (tenant_id, (data->>'chave_geracao'))
        WHERE status IN ('RASCUNHO', 'PROCESSANDO', 'AUTORIZADA') AND COALESCE(data->>'chave_geracao', '') <> '';
      CREATE INDEX IF NOT EXISTS idx_notas_fiscais_venda ON notas_fiscais(tenant_id, venda_id);
    END IF;
  END
  $notas$;
`;
