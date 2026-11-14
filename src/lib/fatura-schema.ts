/**
 * Esquema das faturas ao cliente e das Regras de faturamento (E5, parte B,
 * 05/11/2026). Idempotente; o initDB roda antes do razão e da auditoria.
 *
 *  - `regras_faturamento`: a regra de cada pessoa (cliente, fornecedor ou
 *    representante), geral ou só para um tipo de produto / um fornecedor.
 *    Uma regra ativa por pessoa × produto × fornecedor.
 *  - `faturas`: a fatura (número próprio da agência, pagante, janela,
 *    vencimento, situação Aberta/Fechada/Cancelada, conferência do cliente,
 *    modelo, retenções e totais em centavos). O dinheiro mora na conta a
 *    receber da fatura (`titulo_id`, origem FATURA): é ela que se cobra,
 *    se baixa e aparece nos relatórios. Uma fatura aberta por chave.
 *  - `fatura_itens`: as contas a receber da forma "Faturar" que estão dentro
 *    de cada fatura. Um item mora em UMA fatura só (chave primária pela
 *    conta). A conta do item fica Cancelada com o carimbo `na_fatura`
 *    enquanto estiver na fatura (o valor passa a contar na conta da fatura,
 *    nunca duas vezes) e volta ao que era ao sair dela.
 *  - `fatura_ajustes`: notas de crédito e de débito, sempre com o motivo
 *    escrito (correção de valor, saldo de pagamento parcial, diferença da
 *    venda). Sem fatura = esperando a próxima fatura do pagante.
 *  - `fatura_eventos`: histórico imutável (criada, fechada, reaberta com
 *    motivo, itens movidos, conferência, aprovação e contestação do cliente,
 *    cobrança). Fora do gatilho da auditoria e sem UPDATE.
 */
export const FATURA_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS regras_faturamento (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    pessoa_tipo TEXT NOT NULL DEFAULT 'CLIENTE',
    pessoa_id TEXT NOT NULL,
    pessoa_nome TEXT NOT NULL DEFAULT '',
    produto_tipo TEXT NOT NULL DEFAULT '',
    fornecedor_id TEXT NOT NULL DEFAULT '',
    fornecedor_nome TEXT NOT NULL DEFAULT '',
    periodo TEXT NOT NULL DEFAULT 'MENSAL',
    inicio_semana SMALLINT NOT NULL DEFAULT 1,
    faturar_por TEXT NOT NULL DEFAULT 'VENDA',
    sentido TEXT NOT NULL DEFAULT 'DEPOIS',
    prazo_dias INTEGER NOT NULL DEFAULT 0,
    dia_nao_util TEXT NOT NULL DEFAULT 'PROXIMO',
    considerar_feriados BOOLEAN NOT NULL DEFAULT TRUE,
    faixas JSONB NOT NULL DEFAULT '[]'::jsonb,
    descricao TEXT NOT NULL DEFAULT '',
    solicitante TEXT NOT NULL DEFAULT '',
    centro_custo TEXT NOT NULL DEFAULT '',
    modelo TEXT NOT NULL DEFAULT 'PADRAO',
    campos JSONB NOT NULL DEFAULT '[]'::jsonb,
    retencoes JSONB NOT NULL DEFAULT '{}'::jsonb,
    ativa BOOLEAN NOT NULL DEFAULT TRUE,
    criado_por TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT regras_faturamento_pessoa_ok CHECK (pessoa_tipo IN ('CLIENTE','FORNECEDOR','REPRESENTANTE')),
    CONSTRAINT regras_faturamento_periodo_ok CHECK (periodo IN ('DIARIO','SEMANAL','SEMANAL_IATA','SEMANAL_MES','DECENDIAL','QUINZENAL','MENSAL','AVULSO','CUSTOMIZADO')),
    CONSTRAINT regras_faturamento_base_ok CHECK (faturar_por IN ('VENDA','INICIO','FIM') AND sentido IN ('ANTES','DEPOIS')),
    CONSTRAINT regras_faturamento_dia_ok CHECK (dia_nao_util IN ('PROXIMO','ANTERIOR','NAO_ALTERAR') AND inicio_semana BETWEEN 0 AND 6),
    CONSTRAINT regras_faturamento_prazo_ok CHECK (prazo_dias BETWEEN 0 AND 365),
    CONSTRAINT regras_faturamento_modelo_ok CHECK (modelo IN ('PADRAO','PERSONALIZADA','SIMPLIFICADA'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_regras_faturamento_ativa
    ON regras_faturamento(tenant_id, pessoa_tipo, pessoa_id, produto_tipo, fornecedor_id) WHERE ativa;

  CREATE TABLE IF NOT EXISTS faturas (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    numero INTEGER NOT NULL,
    pessoa_id TEXT NOT NULL,
    pessoa_nome TEXT NOT NULL DEFAULT '',
    regra_id TEXT NOT NULL DEFAULT '',
    chave TEXT NOT NULL,
    periodo_inicio DATE,
    periodo_fim DATE,
    vencimento DATE NOT NULL,
    vencimento_ajuste TEXT NOT NULL DEFAULT '',
    emissao DATE,
    situacao TEXT NOT NULL DEFAULT 'ABERTA',
    conferencia TEXT NOT NULL DEFAULT 'NAO_ENVIADA',
    avulsa BOOLEAN NOT NULL DEFAULT FALSE,
    complementar_de TEXT NOT NULL DEFAULT '',
    titulo_id TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    solicitante TEXT NOT NULL DEFAULT '',
    centro_custo TEXT NOT NULL DEFAULT '',
    observacoes TEXT NOT NULL DEFAULT '',
    modelo TEXT NOT NULL DEFAULT 'PADRAO',
    campos JSONB NOT NULL DEFAULT '[]'::jsonb,
    retencoes JSONB NOT NULL DEFAULT '{}'::jsonb,
    total_itens_centavos BIGINT NOT NULL DEFAULT 0,
    total_creditos_centavos BIGINT NOT NULL DEFAULT 0,
    total_debitos_centavos BIGINT NOT NULL DEFAULT 0,
    total_retencoes_centavos BIGINT NOT NULL DEFAULT 0,
    total_centavos BIGINT NOT NULL DEFAULT 0,
    invalida BOOLEAN NOT NULL DEFAULT FALSE,
    fechada_em TIMESTAMPTZ,
    fechada_por TEXT NOT NULL DEFAULT '',
    conferida_em TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT faturas_situacao_ok CHECK (situacao IN ('ABERTA','FECHADA','CANCELADA')),
    CONSTRAINT faturas_conferencia_ok CHECK (conferencia IN ('NAO_ENVIADA','AGUARDANDO','APROVADA','CONTESTADA')),
    CONSTRAINT faturas_modelo_ok CHECK (modelo IN ('PADRAO','PERSONALIZADA','SIMPLIFICADA'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_faturas_numero ON faturas(tenant_id, numero);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_faturas_aberta_por_chave ON faturas(tenant_id, pessoa_id, chave) WHERE situacao = 'ABERTA';
  CREATE INDEX IF NOT EXISTS idx_faturas_pessoa ON faturas(tenant_id, pessoa_id, vencimento);
  CREATE INDEX IF NOT EXISTS idx_faturas_vencimento ON faturas(tenant_id, vencimento);

  CREATE TABLE IF NOT EXISTS fatura_itens (
    tenant_id TEXT NOT NULL,
    conta_id TEXT NOT NULL,
    fatura_id TEXT NOT NULL,
    venda_id TEXT NOT NULL DEFAULT '',
    venda_numero TEXT NOT NULL DEFAULT '',
    data_venda DATE,
    data_referencia DATE,
    descricao TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    taxas_servico_centavos BIGINT NOT NULL DEFAULT 0,
    detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
    conferido BOOLEAN NOT NULL DEFAULT FALSE,
    conferencia_nota TEXT NOT NULL DEFAULT '',
    contestacao TEXT NOT NULL DEFAULT '',
    contestado_em TIMESTAMPTZ,
    resposta TEXT NOT NULL DEFAULT '',
    incluido_por TEXT NOT NULL DEFAULT '',
    incluido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, conta_id)
  );
  CREATE INDEX IF NOT EXISTS idx_fatura_itens_fatura ON fatura_itens(tenant_id, fatura_id);
  CREATE INDEX IF NOT EXISTS idx_fatura_itens_venda ON fatura_itens(tenant_id, venda_id) WHERE venda_id <> '';

  CREATE TABLE IF NOT EXISTS fatura_ajustes (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    pessoa_id TEXT NOT NULL,
    pessoa_nome TEXT NOT NULL DEFAULT '',
    fatura_id TEXT NOT NULL DEFAULT '',
    origem_fatura_id TEXT NOT NULL DEFAULT '',
    conta_id TEXT NOT NULL DEFAULT '',
    venda_id TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL,
    valor_centavos BIGINT NOT NULL,
    motivo TEXT NOT NULL,
    chave TEXT NOT NULL DEFAULT '',
    criado_por TEXT NOT NULL DEFAULT '',
    criado_por_nome TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT fatura_ajustes_tipo_ok CHECK (tipo IN ('CREDITO','DEBITO')),
    CONSTRAINT fatura_ajustes_valor_ok CHECK (valor_centavos > 0),
    CONSTRAINT fatura_ajustes_motivo_ok CHECK (length(trim(motivo)) >= 5)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_fatura_ajustes_chave ON fatura_ajustes(tenant_id, chave) WHERE chave <> '';
  CREATE INDEX IF NOT EXISTS idx_fatura_ajustes_fatura ON fatura_ajustes(tenant_id, fatura_id);
  CREATE INDEX IF NOT EXISTS idx_fatura_ajustes_pendentes ON fatura_ajustes(tenant_id, pessoa_id) WHERE fatura_id = '';

  CREATE TABLE IF NOT EXISTS fatura_eventos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    fatura_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    motivo TEXT NOT NULL DEFAULT '',
    usuario_id TEXT NOT NULL DEFAULT '',
    usuario_nome TEXT NOT NULL DEFAULT '',
    detalhe JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_fatura_eventos_fatura ON fatura_eventos(tenant_id, fatura_id, criado_em);

  CREATE OR REPLACE FUNCTION fatura_eventos_imutavel() RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    RAISE EXCEPTION 'O histórico da fatura não pode ser alterado.';
  END;
  $fn$;
  DO $faturaeventos$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'fatura_eventos'::regclass AND tgname = 'fatura_eventos_imutavel_v1' AND NOT tgisinternal) THEN
      CREATE TRIGGER fatura_eventos_imutavel_v1 BEFORE UPDATE ON fatura_eventos
        FOR EACH ROW EXECUTE FUNCTION fatura_eventos_imutavel();
    END IF;
  END;
  $faturaeventos$;
`;

/** Tabelas da fatura que "Zerar a conta" apaga junto com as contas a receber. */
export const TABELAS_DA_FATURA = ['fatura_eventos', 'fatura_ajustes', 'fatura_itens', 'faturas', 'regras_faturamento'] as const;
