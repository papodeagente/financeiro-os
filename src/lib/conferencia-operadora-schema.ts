/**
 * Tabelas da conferência do extrato de operadora (E6, 05/11/2026). Arquivo
 * sem imports: o initDB lê daqui sem puxar o resto do servidor.
 *  - conferencias_operadora: um extrato conferido (operadora, período,
 *    totais declarados, aberta ou fechada). O mesmo arquivo (hash) não vira
 *    duas conferências.
 *  - conferencias_operadora_linhas: cada linha lida, com o casamento, a
 *    situação, a diferença explicada, a proposta de cancelamento e quem
 *    aceitou. Controle: fora do gatilho de auditoria.
 * Dinheiro em centavos (BIGINT).
 */
export const CONFERENCIA_OPERADORA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS conferencias_operadora (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  arquivo_hash TEXT NOT NULL,
  arquivo_nome TEXT NOT NULL DEFAULT '',
  origem TEXT NOT NULL DEFAULT '',
  fornecedor_id TEXT NOT NULL DEFAULT '',
  fornecedor_nome TEXT NOT NULL DEFAULT '',
  operadora_cnpj TEXT NOT NULL DEFAULT '',
  periodo_de DATE,
  periodo_ate DATE,
  status TEXT NOT NULL DEFAULT 'ABERTA',
  total_bruto_centavos BIGINT,
  total_comissao_centavos BIGINT,
  total_liquido_centavos BIGINT,
  soma_liquido_centavos BIGINT NOT NULL DEFAULT 0,
  avisos JSONB NOT NULL DEFAULT '[]'::jsonb,
  criada_por TEXT,
  criada_por_nome TEXT,
  fechada_em TIMESTAMPTZ,
  fechada_por TEXT,
  reaberta_em TIMESTAMPTZ,
  reaberta_por TEXT,
  reaberta_motivo TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conferencias_operadora_arquivo ON conferencias_operadora (tenant_id, arquivo_hash);
CREATE INDEX IF NOT EXISTS idx_conferencias_operadora_periodo ON conferencias_operadora (tenant_id, fornecedor_nome, periodo_de);

CREATE TABLE IF NOT EXISTS conferencias_operadora_linhas (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  conferencia_id TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  data DATE,
  localizador TEXT NOT NULL DEFAULT '',
  passageiro TEXT NOT NULL DEFAULT '',
  descricao TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT 'venda',
  bruto_centavos BIGINT,
  taxas_centavos BIGINT,
  comissao_centavos BIGINT,
  liquido_centavos BIGINT,
  valido BOOLEAN NOT NULL DEFAULT TRUE,
  motivos_invalida JSONB NOT NULL DEFAULT '[]'::jsonb,
  situacao TEXT NOT NULL DEFAULT 'NAO_ENCONTRADO',
  como_casou TEXT NOT NULL DEFAULT 'nenhum',
  ambiguos INTEGER NOT NULL DEFAULT 0,
  venda_id TEXT NOT NULL DEFAULT '',
  venda_numero TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  diferencas JSONB NOT NULL DEFAULT '[]'::jsonb,
  comissao_esperada_centavos BIGINT NOT NULL DEFAULT 0,
  proposta JSONB,
  proposta_status TEXT,
  aceita_motivo TEXT,
  aceita_por TEXT,
  aceita_em TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conferencias_operadora_linhas ON conferencias_operadora_linhas (tenant_id, conferencia_id, ordem);
`;
