// Perfis de acesso (tabela grupos_usuario), restrição por usuário, pedidos de aprovação e alçadas
// (05/11/2026). Idempotente: o initDB roda a cada boot, antes do razão.
//
// Tabelas vazias = comportamento de antes (o papel decide tudo). Ficam no
// gatilho de auditoria de propósito: quem mudou direito, conta liberada ou
// decidiu um pedido aparece na Consulta Global de Log com antes e depois.
export const PERMISSOES_SCHEMA_SQL = String.raw`
  CREATE TABLE IF NOT EXISTS grupos_usuario (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    nome TEXT NOT NULL,
    acesso_total BOOLEAN NOT NULL DEFAULT FALSE,
    acoes JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Vazio = todas as contas bancárias.
    contas JSONB NOT NULL DEFAULT '[]'::jsonb,
    criado_por TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT grupos_usuario_acoes_lista CHECK (jsonb_typeof(acoes) = 'array'),
    CONSTRAINT grupos_usuario_contas_lista CHECK (jsonb_typeof(contas) = 'array')
  );
  CREATE UNIQUE INDEX IF NOT EXISTS grupos_usuario_nome_unico
    ON grupos_usuario (tenant_id, lower(nome));

  CREATE TABLE IF NOT EXISTS grupo_usuario_membros (
    tenant_id TEXT NOT NULL,
    grupo_id TEXT NOT NULL,
    usuario_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, grupo_id, usuario_id),
    FOREIGN KEY (tenant_id, grupo_id) REFERENCES grupos_usuario (tenant_id, id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS grupo_usuario_membros_usuario
    ON grupo_usuario_membros (tenant_id, usuario_id);

  CREATE TABLE IF NOT EXISTS usuario_restricoes (
    tenant_id TEXT NOT NULL,
    usuario_id TEXT NOT NULL,
    -- Vazio = sem restrição própria de conta.
    contas_liberadas JSONB NOT NULL DEFAULT '[]'::jsonb,
    acoes_negadas JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, usuario_id)
  );

  CREATE TABLE IF NOT EXISTS pedidos_aprovacao (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    alvo_tabela TEXT NOT NULL DEFAULT '',
    alvo_id TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    payload_hash TEXT NOT NULL DEFAULT '',
    valor_centavos BIGINT NOT NULL DEFAULT 0,
    solicitante_id TEXT NOT NULL,
    solicitante_nome TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PENDENTE',
    alcada_id TEXT,
    aprovadores JSONB NOT NULL DEFAULT '[]'::jsonb,
    niveis INTEGER NOT NULL DEFAULT 1,
    decisoes JSONB NOT NULL DEFAULT '[]'::jsonb,
    motivo TEXT NOT NULL DEFAULT '',
    motivo_decisao TEXT NOT NULL DEFAULT '',
    erro_execucao TEXT NOT NULL DEFAULT '',
    resultado JSONB,
    expira_em TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decidido_em TIMESTAMPTZ,
    executado_em TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT pedidos_aprovacao_status CHECK (status IN ('PENDENTE','APROVADO','RECUSADO','EXECUTADO','EXPIRADO')),
    CONSTRAINT pedidos_aprovacao_niveis CHECK (niveis BETWEEN 1 AND 3)
  );
  CREATE INDEX IF NOT EXISTS pedidos_aprovacao_fila
    ON pedidos_aprovacao (tenant_id, status, created_at DESC);
  -- Um pedido aberto por alvo e tipo: o duplo clique não abre dois.
  CREATE UNIQUE INDEX IF NOT EXISTS pedidos_aprovacao_um_aberto
    ON pedidos_aprovacao (tenant_id, tipo, alvo_tabela, alvo_id)
    WHERE status = 'PENDENTE' AND alvo_id <> '';

  CREATE TABLE IF NOT EXISTS alcadas_aprovacao (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    nome TEXT NOT NULL DEFAULT '',
    prioridade INTEGER NOT NULL DEFAULT 100,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    categoria_id TEXT,
    centro_custo TEXT,
    valor_min_centavos BIGINT,
    valor_max_centavos BIGINT,
    -- 'usuario:<id>', 'grupo:<id>' ou 'papel:ADMIN'. Vazio = quem tiver o direito.
    aprovadores JSONB NOT NULL DEFAULT '[]'::jsonb,
    niveis INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT alcadas_aprovacao_niveis CHECK (niveis BETWEEN 1 AND 3)
  );

  -- Aprovação do pagamento separada do status da conta: '' = não exige
  -- (todas as contas de hoje), PENDENTE, APROVADO ou RECUSADO. Coluna fora do
  -- JSON de propósito: o POST/PUT da tela não consegue forjar.
  DO $aprov$
  BEGIN
    IF to_regclass('public.contas_pagar') IS NOT NULL THEN
      ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS aprovacao_status TEXT NOT NULL DEFAULT '';
      ALTER TABLE contas_pagar ADD COLUMN IF NOT EXISTS aprovacao_pedido_id TEXT;
    END IF;
  END;
  $aprov$;
`;
