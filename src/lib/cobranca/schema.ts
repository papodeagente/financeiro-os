/**
 * Esquema da cobrança (E3, 05/11/2026). Idempotente; o initDB roda antes do
 * razão e da auditoria.
 *
 * - `cobrancas`: uma linha por boleto/Pix/link/parcela de carnê, sempre de
 *   uma conta a receber. Dinheiro em centavos. UMA cobrança valendo por
 *   conta (índice parcial sobre emitindo/aberta/vencida).
 * - `cobranca_eventos`: o histórico de cada cobrança (quem, quando, o quê).
 * - `cobranca_portal_links`: o link do portal por cliente, no formato que a
 *   parte B (portal-servidor.ts) usa: SHA-256 do token, cópia cifrada
 *   opcional, um ativo por cliente, revogável. Criada aqui para o initDB
 *   ter tudo num lugar; as colunas são as da parte B.
 * - `cobranca_lembretes` e `cobranca_disjuntor`: controle (régua que não
 *   repete; disjuntor por agência × provedor). Fora da auditoria.
 */
export const COBRANCA_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS cobrancas (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    titulo_tabela TEXT NOT NULL DEFAULT 'contas_receber',
    titulo_id TEXT NOT NULL,
    cliente_id TEXT,
    provedor TEXT NOT NULL,
    id_externo TEXT,
    referencia TEXT NOT NULL,
    tipo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'emitindo',
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    vencimento DATE,
    descricao TEXT NOT NULL DEFAULT '',
    linha_digitavel TEXT NOT NULL DEFAULT '',
    codigo_barras TEXT NOT NULL DEFAULT '',
    pix_copia_cola TEXT NOT NULL DEFAULT '',
    pix_qrcode_url TEXT NOT NULL DEFAULT '',
    url_boleto TEXT NOT NULL DEFAULT '',
    url_fatura TEXT NOT NULL DEFAULT '',
    url_link TEXT NOT NULL DEFAULT '',
    carne_id TEXT,
    carne_parcela INTEGER,
    carne_id_externo TEXT,
    conta_bancaria_id TEXT,
    encargos JSONB,
    pago_centavos BIGINT,
    taxa_centavos BIGINT,
    pago_em DATE,
    baixa_id TEXT,
    tentativas INTEGER NOT NULL DEFAULT 0,
    erro TEXT,
    substitui_id TEXT,
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_por TEXT,
    criado_por_nome TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT cobrancas_tipo_ok CHECK (tipo IN ('boleto','pix','boleto_pix','link','carne')),
    CONSTRAINT cobrancas_status_ok CHECK (status IN ('emitindo','aberta','vencida','paga','cancelada','estornada','falhou')),
    CONSTRAINT cobrancas_provedor_ok CHECK (provedor IN ('asaas','pagarme')),
    CONSTRAINT cobrancas_valor_ok CHECK (valor_centavos > 0)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_valendo_por_conta
    ON cobrancas(tenant_id, titulo_tabela, titulo_id) WHERE status IN ('emitindo','aberta','vencida');
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_externa
    ON cobrancas(tenant_id, provedor, id_externo) WHERE id_externo IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_referencia ON cobrancas(tenant_id, referencia);
  CREATE INDEX IF NOT EXISTS idx_cobrancas_lista ON cobrancas(tenant_id, status, vencimento);
  CREATE INDEX IF NOT EXISTS idx_cobrancas_titulo ON cobrancas(tenant_id, titulo_tabela, titulo_id);
  CREATE INDEX IF NOT EXISTS idx_cobrancas_carne ON cobrancas(tenant_id, carne_id) WHERE carne_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS cobranca_eventos (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    cobranca_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    de_status TEXT,
    para_status TEXT,
    detalhe JSONB NOT NULL DEFAULT '{}'::jsonb,
    usuario_id TEXT,
    usuario_nome TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (tenant_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_cobranca_eventos ON cobranca_eventos(tenant_id, cobranca_id, criado_em);

  CREATE TABLE IF NOT EXISTS cobranca_portal_links (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    cliente_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    token_cifrado JSONB,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    criado_por TEXT,
    revogado_em TIMESTAMPTZ,
    expira_em TIMESTAMPTZ,
    ultimo_acesso_em TIMESTAMPTZ,
    acessos INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_portal_links_hash ON cobranca_portal_links(token_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_cobranca_portal_links_ativo ON cobranca_portal_links(tenant_id, cliente_id) WHERE revogado_em IS NULL;

  CREATE TABLE IF NOT EXISTS cobranca_lembretes (
    tenant_id TEXT NOT NULL,
    cobranca_id TEXT NOT NULL,
    dia INTEGER NOT NULL,
    data_aviso DATE NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, cobranca_id, dia)
  );

  CREATE TABLE IF NOT EXISTS cobranca_disjuntor (
    tenant_id TEXT NOT NULL,
    provedor TEXT NOT NULL,
    falhas_seguidas INTEGER NOT NULL DEFAULT 0,
    aberto_ate TIMESTAMPTZ,
    ultimo_erro TEXT,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, provedor)
  );
`;

/** Tabelas de controle: fora do gatilho de auditoria (audit-schema.ts). */
/** O portal fica fora para o token (mesmo cifrado) nunca ir parar no registro de atividades. */
export const TABELAS_DE_CONTROLE_DA_COBRANCA = ['cobranca_eventos', 'cobranca_lembretes', 'cobranca_disjuntor', 'cobranca_portal_links'];
