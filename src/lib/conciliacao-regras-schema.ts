/**
 * Tabelas da conciliação com regras aprendidas (E6, 05/11/2026). Arquivo
 * sem imports: o initDB lê daqui sem puxar o resto do servidor.
 *  - conciliacao_regras: o que a agência ensinou conciliando (por descrição
 *    ou CNPJ, conta bancária e sentido) e se a regra pode conciliar sozinha.
 *  - conciliacoes_automaticas: a lista "conciliado sozinho", com quem
 *    desfez e quando. Controle: fora do gatilho de auditoria.
 */
export const CONCILIACAO_REGRAS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conciliacao_regras (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  chave TEXT NOT NULL,
  conta_bancaria_id TEXT NOT NULL DEFAULT '',
  sentido TEXT NOT NULL,
  padrao TEXT NOT NULL DEFAULT '',
  documento TEXT NOT NULL DEFAULT '',
  destino TEXT NOT NULL DEFAULT 'TITULO',
  titulo_tabela TEXT NOT NULL,
  pessoa_id TEXT NOT NULL DEFAULT '',
  pessoa_nome TEXT NOT NULL DEFAULT '',
  categoria_id TEXT NOT NULL DEFAULT '',
  valores_centavos BIGINT[] NOT NULL DEFAULT '{}',
  confirmacoes INTEGER NOT NULL DEFAULT 0,
  desfeitas INTEGER NOT NULL DEFAULT 0,
  auto_ligada BOOLEAN NOT NULL DEFAULT FALSE,
  auto_ligada_por TEXT,
  auto_ligada_em TIMESTAMPTZ,
  auto_suspensa_motivo TEXT NOT NULL DEFAULT '',
  exemplo TEXT NOT NULL DEFAULT '',
  ultima_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conciliacao_regras_chave ON conciliacao_regras (tenant_id, chave);

CREATE TABLE IF NOT EXISTS conciliacoes_automaticas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  extrato_id TEXT NOT NULL,
  regra_id TEXT NOT NULL,
  conta_bancaria_id TEXT NOT NULL DEFAULT '',
  data_extrato DATE,
  descricao TEXT NOT NULL DEFAULT '',
  valor_centavos BIGINT NOT NULL,
  pessoa_nome TEXT NOT NULL DEFAULT '',
  vinculos JSONB NOT NULL DEFAULT '[]'::jsonb,
  executada_por TEXT,
  executada_por_nome TEXT,
  executada_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  desfeita_em TIMESTAMPTZ,
  desfeita_por TEXT,
  desfeita_motivo TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conciliacoes_automaticas_ativa
  ON conciliacoes_automaticas (tenant_id, extrato_id) WHERE desfeita_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_conciliacoes_automaticas_recentes
  ON conciliacoes_automaticas (tenant_id, executada_em DESC);
`;
