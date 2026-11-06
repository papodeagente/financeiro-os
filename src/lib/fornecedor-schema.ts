/**
 * Esquema do lado do fornecedor (E5, parte C, 05/11/2026). Idempotente; o
 * initDB roda antes do razão e da auditoria (todas estas tabelas são
 * auditadas: mudança de acordo, fatura e sinal fica com antes/depois).
 *
 *  - `fornecedor_acordos`: acordos com fornecedores (comissão, over, Taxa CC
 *    DU/RAV, representante) com vigência. Dinheiro em centavos.
 *  - `faturas_fornecedor` + `fatura_fornecedor_itens`: a fatura que junta as
 *    contas a pagar de várias vendas numa só. Uma conta fica em UMA fatura
 *    valendo (índice único parcial). Desfazer não apaga: marca DESFEITA.
 *  - `fornecedor_sinais` + `fornecedor_sinal_compensacoes`: adiantamento ao
 *    fornecedor e o quanto dele cada fatura compensou.
 *  - `fornecedor_extrato_comissoes`: o que a operadora diz que pagou de
 *    comissão (a conferência de extrato da E6 grava aqui).
 */
export const FORNECEDOR_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS fornecedor_acordos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    fornecedor_id TEXT NOT NULL,
    fornecedor_nome TEXT NOT NULL DEFAULT '',
    representante_id TEXT NOT NULL DEFAULT '',
    representante_nome TEXT NOT NULL DEFAULT '',
    tipo_produto TEXT NOT NULL DEFAULT '',
    produto_crm_id TEXT NOT NULL DEFAULT '',
    produto_nome TEXT NOT NULL DEFAULT '',
    comissao_percentual NUMERIC(9,4),
    comissao_valor_centavos BIGINT,
    over_percentual NUMERIC(9,4),
    over_valor_centavos BIGINT,
    taxa_cc_du_percentual NUMERIC(9,4),
    taxa_cc_rav_percentual NUMERIC(9,4),
    vigencia_inicio DATE NOT NULL,
    vigencia_fim DATE,
    observacoes TEXT NOT NULL DEFAULT '',
    criado_por TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT fornecedor_acordos_vigencia_ok CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
    CONSTRAINT fornecedor_acordos_pct_ok CHECK (
      COALESCE(comissao_percentual, 0) BETWEEN 0 AND 100 AND COALESCE(over_percentual, 0) BETWEEN 0 AND 100
      AND COALESCE(taxa_cc_du_percentual, 0) BETWEEN 0 AND 100 AND COALESCE(taxa_cc_rav_percentual, 0) BETWEEN 0 AND 100),
    CONSTRAINT fornecedor_acordos_valor_ok CHECK (COALESCE(comissao_valor_centavos, 0) >= 0 AND COALESCE(over_valor_centavos, 0) >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_fornecedor_acordos_fornecedor ON fornecedor_acordos(tenant_id, fornecedor_id, vigencia_inicio);

  CREATE TABLE IF NOT EXISTS faturas_fornecedor (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    numero TEXT NOT NULL,
    parte_id TEXT NOT NULL,
    parte_nome TEXT NOT NULL DEFAULT '',
    situacao TEXT NOT NULL DEFAULT 'GERADA',
    periodo_inicio DATE,
    corte DATE,
    vencimento DATE NOT NULL,
    vencimento_pela_regra DATE,
    motivo_ajuste TEXT NOT NULL DEFAULT '',
    valor_itens_centavos BIGINT NOT NULL,
    sinal_centavos BIGINT NOT NULL DEFAULT 0,
    valor_centavos BIGINT NOT NULL,
    conta_pagar_id TEXT,
    regra JSONB NOT NULL DEFAULT '{}'::jsonb,
    observacoes TEXT NOT NULL DEFAULT '',
    automatica BOOLEAN NOT NULL DEFAULT FALSE,
    criada_por TEXT NOT NULL DEFAULT '',
    criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    desfeita_em TIMESTAMPTZ,
    desfeita_por TEXT,
    motivo_desfazer TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT faturas_fornecedor_numero_unico UNIQUE (tenant_id, numero),
    CONSTRAINT faturas_fornecedor_situacao_ok CHECK (situacao IN ('GERADA','DESFEITA')),
    CONSTRAINT faturas_fornecedor_valor_ok CHECK (valor_itens_centavos > 0 AND sinal_centavos >= 0 AND valor_centavos >= 0
      AND valor_centavos = valor_itens_centavos - sinal_centavos)
  );
  CREATE INDEX IF NOT EXISTS idx_faturas_fornecedor_parte ON faturas_fornecedor(tenant_id, parte_id, situacao, vencimento);

  CREATE TABLE IF NOT EXISTS fatura_fornecedor_itens (
    tenant_id TEXT NOT NULL,
    fatura_id TEXT NOT NULL,
    conta_pagar_id TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    venda_numero TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL,
    moeda TEXT NOT NULL DEFAULT 'BRL',
    valor_moeda_centavos BIGINT NOT NULL DEFAULT 0,
    saldo_cliente_centavos BIGINT NOT NULL DEFAULT 0,
    descricao TEXT NOT NULL DEFAULT '',
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (tenant_id, fatura_id, conta_pagar_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_fatura_fornecedor_item_ativo ON fatura_fornecedor_itens(tenant_id, conta_pagar_id) WHERE ativo;
  CREATE INDEX IF NOT EXISTS idx_fatura_fornecedor_itens_venda ON fatura_fornecedor_itens(tenant_id, venda_id);

  CREATE TABLE IF NOT EXISTS fornecedor_sinais (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    parte_id TEXT NOT NULL,
    parte_nome TEXT NOT NULL DEFAULT '',
    venda_id TEXT,
    valor_centavos BIGINT NOT NULL,
    data DATE NOT NULL,
    vencimento DATE NOT NULL,
    conta_pagar_id TEXT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '',
    situacao TEXT NOT NULL DEFAULT 'ABERTO',
    criado_por TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelado_em TIMESTAMPTZ,
    cancelado_por TEXT,
    motivo_cancelamento TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT fornecedor_sinais_valor_ok CHECK (valor_centavos > 0),
    CONSTRAINT fornecedor_sinais_situacao_ok CHECK (situacao IN ('ABERTO','CANCELADO'))
  );
  CREATE INDEX IF NOT EXISTS idx_fornecedor_sinais_parte ON fornecedor_sinais(tenant_id, parte_id, situacao);

  CREATE TABLE IF NOT EXISTS fornecedor_sinal_compensacoes (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    sinal_id TEXT NOT NULL,
    fatura_id TEXT NOT NULL,
    valor_centavos BIGINT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    desfeita_em TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT fornecedor_sinal_compensacoes_valor_ok CHECK (valor_centavos > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_fornecedor_sinal_compensacoes_sinal ON fornecedor_sinal_compensacoes(tenant_id, sinal_id) WHERE desfeita_em IS NULL;

  CREATE TABLE IF NOT EXISTS fornecedor_extrato_comissoes (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    parte_id TEXT NOT NULL,
    venda_id TEXT,
    localizador TEXT NOT NULL DEFAULT '',
    data DATE NOT NULL,
    valor_centavos BIGINT NOT NULL,
    origem TEXT NOT NULL DEFAULT 'extrato',
    referencia TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_fornecedor_extrato_comissoes_parte ON fornecedor_extrato_comissoes(tenant_id, parte_id, data);
`;

/**
 * As tabelas de movimento da parte C, na ordem de apagar ("Zerar a conta",
 * junto com as contas a pagar). Os acordos são cadastro: ficam.
 */
export const TABELAS_DO_FORNECEDOR = [
  'fornecedor_sinal_compensacoes', 'fornecedor_sinais', 'fatura_fornecedor_itens', 'faturas_fornecedor',
  'fornecedor_extrato_comissoes',
] as const;
