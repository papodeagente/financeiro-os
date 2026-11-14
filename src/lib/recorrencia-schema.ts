/**
 * Esquema da recorrência (05/11/2026). Idempotente: roda no initDB a cada boot.
 *
 * - recorrencias: uma linha por série (conta que se repete ou parcelada).
 *   Guarda o modelo do título, a regra, o valor em centavos e até onde já
 *   gerou. É cadastro editável e FICA na auditoria: quem criou, mudou ou
 *   encerrou a repetição é histórico que a agência quer ver. A tarefa diária
 *   só grava aqui quando cria título novo, então não enche o histórico.
 * - Índice único parcial nas contas por (tenant, serie_id, serie_ordem): a
 *   mesma ocorrência nunca nasce duas vezes, nem com duplo clique nem com o
 *   agendador rodando junto com a tela.
 * - Índice único parcial por copia_chave: "Copiar mês" não duplica o mesmo
 *   título no mesmo mês de destino.
 */
export const RECORRENCIA_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS recorrencias (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    tabela_alvo TEXT NOT NULL CHECK (tabela_alvo IN ('contas_pagar', 'contas_receber')),
    modo TEXT NOT NULL CHECK (modo IN ('recorrente', 'parcelado')),
    modelo JSONB NOT NULL DEFAULT '{}'::jsonb,
    regra JSONB NOT NULL,
    inicio DATE NOT NULL,
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    horizonte_meses INTEGER NOT NULL DEFAULT 3,
    gerado_ate DATE,
    ocorrencias_geradas INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'concluida', 'encerrada')),
    versao INTEGER NOT NULL DEFAULT 1,
    ultima_chave TEXT,
    encerrada_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_recorrencias_tenant_status ON recorrencias (tenant_id, status);

  DO $$
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_pagar_serie
      ON contas_pagar (tenant_id, (data->>'serie_id'), (data->>'serie_ordem'))
      WHERE COALESCE(data->>'serie_id', '') <> '';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'chave da serie em contas_pagar nao criada: %', SQLERRM;
  END
  $$;

  DO $$
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_receber_serie
      ON contas_receber (tenant_id, (data->>'serie_id'), (data->>'serie_ordem'))
      WHERE COALESCE(data->>'serie_id', '') <> '';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'chave da serie em contas_receber nao criada: %', SQLERRM;
  END
  $$;

  DO $$
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_pagar_copia
      ON contas_pagar (tenant_id, (data->>'copia_chave'))
      WHERE COALESCE(data->>'copia_chave', '') <> '';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'chave da copia em contas_pagar nao criada: %', SQLERRM;
  END
  $$;

  DO $$
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contas_receber_copia
      ON contas_receber (tenant_id, (data->>'copia_chave'))
      WHERE COALESCE(data->>'copia_chave', '') <> '';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'chave da copia em contas_receber nao criada: %', SQLERRM;
  END
  $$;
`;
