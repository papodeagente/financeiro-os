/**
 * Esquema das comissões por função (E5, parte F). Idempotente; o initDB roda
 * antes do razão e da auditoria. Dinheiro em centavos (BIGINT).
 *
 *  - comissao_config: a escolha da agência (regra de hoje × por função,
 *    liberar na venda ou no recebimento, sobre o que se mede a meta...).
 *  - comissao_funcoes / comissao_pessoas / comissao_metas: funções, quem está
 *    em cada uma (plano, início, sem comissão) e a meta de cada mês.
 *  - comissao_planos: o plano em matriz (faixa × produto × função) em JSONB,
 *    lido sempre por `normalizarPlano`; `versao` sobe a cada mudança.
 *  - comissao_lancamentos: o resultado do cálculo (um por venda × produto ×
 *    pessoa na função), refeito todo dia; guarda quanto JÁ foi fechado, que é
 *    o que torna o estorno automático. Fica fora da auditoria (é recalculado).
 *  - comissao_fechamentos / comissao_fechamento_itens: cada "Fechar comissões"
 *    e o que entrou nele (imutável, menos o quanto já foi pago).
 *  - comissao_pagamentos: cada pagamento (total ou parcial) e a conta gerada.
 */
export const COMISSAO_FUNCOES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS comissao_config (
    tenant_id TEXT PRIMARY KEY,
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_por TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS comissao_funcoes (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    nome TEXT NOT NULL DEFAULT '',
    sistema TEXT,
    sobre_pessoas JSONB NOT NULL DEFAULT '[]'::jsonb,
    sobre_unidades JSONB NOT NULL DEFAULT '[]'::jsonb,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT comissao_funcoes_sistema_ok CHECK (sistema IS NULL OR sistema IN ('VENDEDOR','INTERMEDIARIO'))
  );

  CREATE TABLE IF NOT EXISTS comissao_pessoas (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    funcao_id TEXT NOT NULL,
    pessoa_id TEXT NOT NULL,
    pessoa_nome TEXT NOT NULL DEFAULT '',
    plano_id TEXT NOT NULL DEFAULT '',
    data_inicio DATE,
    nao_comissionado BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (tenant_id, id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_comissao_pessoas ON comissao_pessoas(tenant_id, funcao_id, pessoa_id);

  CREATE TABLE IF NOT EXISTS comissao_metas (
    tenant_id TEXT NOT NULL,
    pessoa_funcao_id TEXT NOT NULL,
    mes TEXT NOT NULL,
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, pessoa_funcao_id, mes),
    CONSTRAINT comissao_metas_ok CHECK (valor_centavos >= 0 AND mes ~ '^[0-9]{4}-[0-9]{2}$')
  );

  CREATE TABLE IF NOT EXISTS comissao_planos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    nome TEXT NOT NULL DEFAULT '',
    modo_faixa TEXT NOT NULL DEFAULT 'DEGRAU',
    faixas JSONB NOT NULL DEFAULT '[]'::jsonb,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    versao INTEGER NOT NULL DEFAULT 1,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT comissao_planos_modo_ok CHECK (modo_faixa IN ('DEGRAU','PROGRESSIVA'))
  );

  CREATE TABLE IF NOT EXISTS comissao_lancamentos (
    tenant_id TEXT NOT NULL,
    chave TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    venda_numero TEXT NOT NULL DEFAULT '',
    data_venda DATE,
    mes TEXT NOT NULL DEFAULT '',
    produto_id TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    pessoa_funcao_id TEXT NOT NULL,
    pessoa_id TEXT NOT NULL,
    pessoa_nome TEXT NOT NULL DEFAULT '',
    funcao_id TEXT NOT NULL DEFAULT '',
    funcao_nome TEXT NOT NULL DEFAULT '',
    plano_id TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    retido_centavos BIGINT NOT NULL DEFAULT 0,
    liberado_centavos BIGINT NOT NULL DEFAULT 0,
    liberado_retido_centavos BIGINT NOT NULL DEFAULT 0,
    fechado_centavos BIGINT NOT NULL DEFAULT 0,
    fechado_retido_centavos BIGINT NOT NULL DEFAULT 0,
    explicacao JSONB NOT NULL DEFAULT '{}'::jsonb,
    calculado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, chave)
  );
  CREATE INDEX IF NOT EXISTS idx_comissao_lancamentos_pessoa ON comissao_lancamentos(tenant_id, pessoa_id, mes);
  CREATE INDEX IF NOT EXISTS idx_comissao_lancamentos_venda ON comissao_lancamentos(tenant_id, venda_id);

  CREATE TABLE IF NOT EXISTS comissao_fechamentos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    ate DATE NOT NULL,
    usuario_id TEXT NOT NULL DEFAULT '',
    usuario_nome TEXT NOT NULL DEFAULT '',
    resumo JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
  );

  CREATE TABLE IF NOT EXISTS comissao_fechamento_itens (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    fechamento_id TEXT NOT NULL,
    chave TEXT NOT NULL,
    pessoa_funcao_id TEXT NOT NULL,
    pessoa_id TEXT NOT NULL,
    pessoa_nome TEXT NOT NULL DEFAULT '',
    funcao_nome TEXT NOT NULL DEFAULT '',
    venda_id TEXT NOT NULL DEFAULT '',
    venda_numero TEXT NOT NULL DEFAULT '',
    data_venda DATE,
    descricao TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL,
    retido_centavos BIGINT NOT NULL DEFAULT 0,
    saldo_centavos BIGINT NOT NULL,
    pago_centavos BIGINT NOT NULL DEFAULT 0,
    estorno BOOLEAN NOT NULL DEFAULT FALSE,
    explicacao JSONB,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_comissao_fech_itens_pessoa ON comissao_fechamento_itens(tenant_id, pessoa_id);

  CREATE TABLE IF NOT EXISTS comissao_pagamentos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    pessoa_id TEXT NOT NULL,
    pessoa_nome TEXT NOT NULL DEFAULT '',
    modo TEXT NOT NULL,
    valor_centavos BIGINT NOT NULL,
    conta_tabela TEXT NOT NULL DEFAULT '',
    conta_id TEXT NOT NULL DEFAULT '',
    itens JSONB NOT NULL DEFAULT '[]'::jsonb,
    usuario_id TEXT NOT NULL DEFAULT '',
    usuario_nome TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT comissao_pagamentos_modo_ok CHECK (modo IN ('TOTAL','PARCIAL'))
  );
`;
