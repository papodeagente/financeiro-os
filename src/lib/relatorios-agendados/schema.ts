/**
 * Envio agendado de relatório e link de leitura (E7, G3). Idempotente.
 *  - relatorios_agendados: o que enviar, quando e para quem (auditada).
 *  - relatorios_leituras: cada link de leitura, com a CÓPIA do relatório
 *    como foi enviado, o hash do token (nunca o token), validade e revogação.
 *  - relatorios_envios: histórico de cada envio (controle, fora da auditoria).
 */
export const RELATORIOS_AGENDADOS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS relatorios_agendados (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    nome TEXT NOT NULL,
    relatorio TEXT NOT NULL DEFAULT 'vendas',
    consulta TEXT NOT NULL DEFAULT '',
    frequencia TEXT NOT NULL,
    dia_semana INTEGER NOT NULL DEFAULT 1,
    dia_mes INTEGER NOT NULL DEFAULT 1,
    hora INTEGER NOT NULL DEFAULT 7,
    periodo TEXT NOT NULL DEFAULT 'mes_anterior',
    formato TEXT NOT NULL DEFAULT 'xlsx',
    destinatarios JSONB NOT NULL DEFAULT '[]'::jsonb,
    validade_dias INTEGER NOT NULL DEFAULT 30,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_por TEXT NOT NULL DEFAULT '',
    criado_por_nome TEXT NOT NULL DEFAULT '',
    ver_receita BOOLEAN NOT NULL DEFAULT FALSE,
    vendedor_id TEXT,
    proximo_envio TIMESTAMPTZ,
    ultimo_envio TIMESTAMPTZ,
    ultimo_resultado TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_relatorios_agendados_proximo ON relatorios_agendados (proximo_envio) WHERE ativo;
  CREATE INDEX IF NOT EXISTS idx_relatorios_agendados_tenant ON relatorios_agendados (tenant_id);

  CREATE TABLE IF NOT EXISTS relatorios_leituras (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agendamento_id TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    -- O token cifrado pelo cofre: a agência copia o link de novo (sem cofre, só na hora do envio).
    token_cifrado JSONB,
    titulo TEXT NOT NULL DEFAULT '',
    documento JSONB NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expira_em TIMESTAMPTZ NOT NULL,
    revogado_em TIMESTAMPTZ,
    revogado_por TEXT,
    acessos INTEGER NOT NULL DEFAULT 0,
    ultimo_acesso TIMESTAMPTZ
  );
  ALTER TABLE relatorios_leituras ADD COLUMN IF NOT EXISTS token_cifrado JSONB;
  CREATE INDEX IF NOT EXISTS idx_relatorios_leituras_agendamento ON relatorios_leituras (tenant_id, agendamento_id, criado_em DESC);

  CREATE TABLE IF NOT EXISTS relatorios_envios (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agendamento_id TEXT NOT NULL,
    previsto_para TIMESTAMPTZ,
    de TEXT NOT NULL DEFAULT '',
    ate TEXT NOT NULL DEFAULT '',
    canal TEXT NOT NULL,
    situacao TEXT NOT NULL,
    detalhe TEXT NOT NULL DEFAULT '',
    leitura_id TEXT,
    linhas INTEGER NOT NULL DEFAULT 0,
    manual BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_relatorios_envios_agendamento ON relatorios_envios (tenant_id, agendamento_id, criado_em DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_relatorios_envios_uma_vez ON relatorios_envios (agendamento_id, previsto_para) WHERE NOT manual;
`;
