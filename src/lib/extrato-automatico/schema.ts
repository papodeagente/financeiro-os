/**
 * Tabelas do extrato automático (06/11/2026). Arquivo sem importações para o
 * initDB (src/lib/db.ts) carregar sem puxar o resto do módulo.
 *
 * - conexoes_bancarias: uma por conta bancária; estado da leitura.
 * - conexoes_bancarias_segredo: o envelope cifrado (fora da auditoria).
 * - sincronizacoes_bancarias: histórico de leituras (fora da auditoria).
 */
export const EXTRATO_AUTOMATICO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS conexoes_bancarias (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conta_bancaria_id TEXT NOT NULL,
    provedor TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ATIVA',
    apelido TEXT NOT NULL DEFAULT '',
    vezes_por_dia INTEGER NOT NULL DEFAULT 1,
    expira_em DATE,
    conta_detectada TEXT,
    ultima_sincronizacao_em TIMESTAMPTZ,
    ultima_janela_de DATE,
    ultima_janela_ate DATE,
    proxima_sincronizacao_em TIMESTAMPTZ,
    falhas_consecutivas INTEGER NOT NULL DEFAULT 0,
    ultimo_erro JSONB,
    saldo_banco_centavos BIGINT,
    saldo_banco_em DATE,
    conectada_por TEXT,
    conectada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  -- Uma conta bancária tem no máximo uma conexão.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_conexoes_conta ON conexoes_bancarias (tenant_id, conta_bancaria_id);
  -- A fila do agendador: quem está na hora de ler.
  CREATE INDEX IF NOT EXISTS idx_conexoes_fila ON conexoes_bancarias (status, proxima_sincronizacao_em);

  -- Envelope AES-256-GCM {v, iv, tag, ct}. Nunca em claro.
  CREATE TABLE IF NOT EXISTS conexoes_bancarias_segredo (
    conexao_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    envelope JSONB NOT NULL,
    expira_em DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_segredo_expira ON conexoes_bancarias_segredo (tenant_id, expira_em);

  CREATE TABLE IF NOT EXISTS sincronizacoes_bancarias (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conexao_id TEXT NOT NULL,
    origem TEXT NOT NULL DEFAULT 'agendada',
    status TEXT NOT NULL DEFAULT 'EXECUTANDO',
    janela_de DATE,
    janela_ate DATE,
    inseridas INTEGER NOT NULL DEFAULT 0,
    atualizadas INTEGER NOT NULL DEFAULT 0,
    duplicadas INTEGER NOT NULL DEFAULT 0,
    paginas INTEGER NOT NULL DEFAULT 0,
    motivo TEXT,
    mensagem TEXT,
    pedida_por TEXT,
    iniciada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    terminada_em TIMESTAMPTZ
  );
  -- Serial por conta: só uma leitura em andamento por conexão.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_sinc_executando ON sincronizacoes_bancarias (tenant_id, conexao_id) WHERE status = 'EXECUTANDO';
  CREATE INDEX IF NOT EXISTS idx_sinc_conexao ON sincronizacoes_bancarias (tenant_id, conexao_id, iniciada_em DESC);
`;
