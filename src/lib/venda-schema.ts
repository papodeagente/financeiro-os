/**
 * Esquema da venda completa (E5, parte A, 05/11/2026). Idempotente; o initDB
 * roda antes do razão e da auditoria.
 *
 * O cabeçalho continua em `vendas_crm` (o que as telas antigas, o painel e as
 * comissões leem). Estas tabelas guardam o modelo da venda completa
 * (venda-modelo.ts), com dinheiro em centavos:
 *  - `vendas_modelo`: uma linha por venda no modelo novo (situação
 *    Aberta/Fechada, origem, versão). Venda sem linha aqui é a de antes (v1);
 *    `versao_modelo = 1` marca a venda de antes que só foi fechada.
 *  - `venda_produtos`, `venda_passageiros`, `venda_componentes`: produtos,
 *    passageiros e componentes de receita.
 *  - `venda_pagamentos`: os pagamentos do cliente por forma.
 *  - `venda_pendencias`: o que a venda deixou para outra parte resolver
 *    (Crédito do cliente → carteira de crédito, parte D). Chave estável.
 *  - `venda_eventos`: histórico imutável (criada, alterada, recebida do CRM,
 *    fechada, reaberta com motivo, mudança do CRM recusada). Fica FORA do
 *    gatilho da auditoria (é ele próprio um registro) e não aceita UPDATE; só
 *    "Zerar a conta" (reset-da-conta.ts) apaga, junto com as vendas.
 */
export const VENDA_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS vendas_modelo (
    tenant_id TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    versao_modelo INTEGER NOT NULL DEFAULT 2,
    origem TEXT NOT NULL DEFAULT 'manual',
    situacao TEXT NOT NULL DEFAULT 'ABERTA',
    numero TEXT NOT NULL DEFAULT '',
    data_venda DATE,
    cliente JSONB NOT NULL DEFAULT '{}'::jsonb,
    vendedor JSONB,
    intermediario JSONB,
    grupo_id TEXT,
    centro_custo TEXT NOT NULL DEFAULT '',
    observacoes TEXT NOT NULL DEFAULT '',
    crm_venda_id TEXT NOT NULL DEFAULT '',
    total_cliente_centavos BIGINT NOT NULL DEFAULT 0,
    receita_centavos BIGINT NOT NULL DEFAULT 0,
    revisao INTEGER NOT NULL DEFAULT 1,
    fechada_em TIMESTAMPTZ,
    fechada_por TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, venda_id),
    CONSTRAINT vendas_modelo_situacao_ok CHECK (situacao IN ('ABERTA','FECHADA')),
    CONSTRAINT vendas_modelo_origem_ok CHECK (origem IN ('manual','crm')),
    CONSTRAINT vendas_modelo_versao_ok CHECK (versao_modelo IN (1, 2))
  );
  -- E7: operação própria (a agência opera a viagem) e os produtos removidos
  -- da venda, guardados para restaurar.
  ALTER TABLE vendas_modelo ADD COLUMN IF NOT EXISTS operacao_propria BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE vendas_modelo ADD COLUMN IF NOT EXISTS produtos_removidos JSONB NOT NULL DEFAULT '[]'::jsonb;
  CREATE INDEX IF NOT EXISTS idx_vendas_modelo_crm ON vendas_modelo(tenant_id, crm_venda_id) WHERE crm_venda_id <> '';
  CREATE INDEX IF NOT EXISTS idx_vendas_modelo_situacao ON vendas_modelo(tenant_id, situacao, data_venda);

  CREATE TABLE IF NOT EXISTS venda_produtos (
    tenant_id TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    id TEXT NOT NULL,
    sequencia INTEGER NOT NULL DEFAULT 1,
    tipo TEXT NOT NULL DEFAULT 'OUTROS',
    descricao TEXT NOT NULL DEFAULT '',
    fornecedor_id TEXT NOT NULL DEFAULT '',
    fornecedor_nome TEXT NOT NULL DEFAULT '',
    fornecedor_externo TEXT NOT NULL DEFAULT '',
    representante_id TEXT NOT NULL DEFAULT '',
    representante_nome TEXT NOT NULL DEFAULT '',
    representante_externo TEXT NOT NULL DEFAULT '',
    quem_cobra TEXT NOT NULL DEFAULT 'AGENCIA',
    moeda TEXT NOT NULL DEFAULT 'BRL',
    cambio NUMERIC(18,6) NOT NULL DEFAULT 1,
    localizador TEXT NOT NULL DEFAULT '',
    data_inicio DATE,
    data_fim DATE,
    data_pagamento_fornecedor DATE,
    quantidade INTEGER NOT NULL DEFAULT 1,
    valor_unitario_centavos BIGINT NOT NULL DEFAULT 0,
    taxas_centavos BIGINT NOT NULL DEFAULT 0,
    detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
    cancelado_em DATE,
    produto_crm_id TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tenant_id, venda_id, id),
    CONSTRAINT venda_produtos_tipo_ok CHECK (tipo IN ('AEREO','AEREO_AGENCIA','HOSPEDAGEM','PACOTE','CRUZEIRO','SEGURO','LOCACAO','RECEPTIVO','INGRESSO','OUTROS')),
    CONSTRAINT venda_produtos_quem_cobra_ok CHECK (quem_cobra IN ('AGENCIA','FORNECEDOR')),
    CONSTRAINT venda_produtos_valores_ok CHECK (valor_unitario_centavos >= 0 AND taxas_centavos >= 0 AND cambio > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_venda_produtos_fornecedor ON venda_produtos(tenant_id, fornecedor_id) WHERE fornecedor_id <> '';
  CREATE INDEX IF NOT EXISTS idx_venda_produtos_representante ON venda_produtos(tenant_id, representante_id) WHERE representante_id <> '';

  CREATE TABLE IF NOT EXISTS venda_passageiros (
    tenant_id TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    produto_id TEXT NOT NULL,
    id TEXT NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 1,
    nome TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'ADT',
    documento TEXT NOT NULL DEFAULT '',
    tarifa_centavos BIGINT NOT NULL DEFAULT 0,
    taxas_centavos BIGINT NOT NULL DEFAULT 0,
    outras_taxas_centavos BIGINT NOT NULL DEFAULT 0,
    cancelado_em DATE,
    PRIMARY KEY (tenant_id, venda_id, id),
    CONSTRAINT venda_passageiros_tipo_ok CHECK (tipo IN ('ADT','CHD','INF')),
    CONSTRAINT venda_passageiros_valores_ok CHECK (tarifa_centavos >= 0 AND taxas_centavos >= 0 AND outras_taxas_centavos >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_venda_passageiros_produto ON venda_passageiros(tenant_id, venda_id, produto_id);

  CREATE TABLE IF NOT EXISTS venda_componentes (
    tenant_id TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    produto_id TEXT NOT NULL,
    id TEXT NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 1,
    tipo TEXT NOT NULL,
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    percentual NUMERIC(9,4),
    passageiro_id TEXT,
    descricao TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tenant_id, venda_id, id),
    CONSTRAINT venda_componentes_tipo_ok CHECK (tipo IN ('COMISSAO','OVER','TAXA_DU','RAV','FEE','MARKUP','DESCONTO','TAXA_CC','REPASSE_INTERMEDIARIO','COBRADO_NO_CANCELAMENTO','RETIDO_PELO_FORNECEDOR','ABATIMENTO')),
    CONSTRAINT venda_componentes_valor_ok CHECK (valor_centavos >= 0)
  );
  CREATE INDEX IF NOT EXISTS idx_venda_componentes_tipo ON venda_componentes(tenant_id, tipo);
  -- Os componentes do cancelamento (parte D) entram na lista em quem já tinha a tabela.
  DO $vendacomp$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'venda_componentes'::regclass AND conname = 'venda_componentes_tipo_ok'
         AND pg_get_constraintdef(oid) LIKE '%ABATIMENTO%'
    ) THEN
      ALTER TABLE venda_componentes DROP CONSTRAINT IF EXISTS venda_componentes_tipo_ok;
      ALTER TABLE venda_componentes ADD CONSTRAINT venda_componentes_tipo_ok CHECK (tipo IN ('COMISSAO','OVER','TAXA_DU','RAV','FEE','MARKUP','DESCONTO','TAXA_CC','REPASSE_INTERMEDIARIO','COBRADO_NO_CANCELAMENTO','RETIDO_PELO_FORNECEDOR','ABATIMENTO'));
    END IF;
  END;
  $vendacomp$;
  -- E7: base do percentual (Over sobre a tarifa, a tarifa com taxas ou a comissão).
  ALTER TABLE venda_componentes ADD COLUMN IF NOT EXISTS base TEXT NOT NULL DEFAULT '';

  CREATE TABLE IF NOT EXISTS venda_pagamentos (
    tenant_id TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    id TEXT NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 1,
    forma TEXT NOT NULL,
    valor_centavos BIGINT NOT NULL,
    parcelas INTEGER NOT NULL DEFAULT 1,
    primeiro_vencimento DATE,
    intervalo_dias INTEGER NOT NULL DEFAULT 0,
    pagante JSONB,
    fornecedor JSONB,
    conta_bancaria_id TEXT,
    cartao_tipo TEXT,
    detalhe TEXT NOT NULL DEFAULT '',
    venda_origem_credito TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tenant_id, venda_id, id),
    CONSTRAINT venda_pagamentos_forma_ok CHECK (forma IN ('DINHEIRO','CHEQUE','BOLETO','CARTAO','DEPOSITO','PIX','FATURAR','OUTROS','CREDITO_CLIENTE','CREDITO_FORNECEDOR','RETIDO_INTERMEDIARIO','PAGO_DIRETO_FORNECEDOR')),
    CONSTRAINT venda_pagamentos_valor_ok CHECK (valor_centavos > 0 AND parcelas BETWEEN 1 AND 120)
  );
  CREATE INDEX IF NOT EXISTS idx_venda_pagamentos_forma ON venda_pagamentos(tenant_id, forma);
  -- E7: o que a forma guarda além do de sempre (taxa e prazo do cartão da
  -- agência congelados ao gravar, campos do cheque e do cartão, a forma
  -- própria da agência em "Outros").
  ALTER TABLE venda_pagamentos ADD COLUMN IF NOT EXISTS dados JSONB NOT NULL DEFAULT '{}'::jsonb;

  CREATE TABLE IF NOT EXISTS venda_pendencias (
    tenant_id TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    chave TEXT NOT NULL,
    tipo TEXT NOT NULL,
    pessoa_id TEXT NOT NULL DEFAULT '',
    pessoa_nome TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    situacao TEXT NOT NULL DEFAULT 'ABERTA',
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolvido_em TIMESTAMPTZ,
    resolvido_por TEXT,
    PRIMARY KEY (tenant_id, venda_id, chave),
    CONSTRAINT venda_pendencias_situacao_ok CHECK (situacao IN ('ABERTA','RESOLVIDA','CANCELADA'))
  );
  CREATE INDEX IF NOT EXISTS idx_venda_pendencias_abertas ON venda_pendencias(tenant_id, tipo, pessoa_id) WHERE situacao = 'ABERTA';

  CREATE TABLE IF NOT EXISTS venda_eventos (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    venda_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    motivo TEXT NOT NULL DEFAULT '',
    usuario_id TEXT NOT NULL DEFAULT '',
    usuario_nome TEXT NOT NULL DEFAULT '',
    detalhe JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_venda_eventos_venda ON venda_eventos(tenant_id, venda_id, criado_em);

  CREATE OR REPLACE FUNCTION venda_eventos_imutavel() RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    RAISE EXCEPTION 'O histórico da venda não pode ser alterado.';
  END;
  $fn$;
  DO $vendaeventos$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'venda_eventos'::regclass AND tgname = 'venda_eventos_imutavel_v1' AND NOT tgisinternal) THEN
      CREATE TRIGGER venda_eventos_imutavel_v1 BEFORE UPDATE ON venda_eventos
        FOR EACH ROW EXECUTE FUNCTION venda_eventos_imutavel();
    END IF;
  END;
  $vendaeventos$;
`;
