/**
 * Mudança de sistema (E4, 05/11/2026): esquema. Idempotente; roda no
 * initDB antes do razão. Tabelas de controle (fora do gatilho de auditoria:
 * o próprio lote é o registro do que aconteceu).
 *
 * - migracao_lotes: uma mudança (rascunho → ensaiado → aplicando → aplicado
 *   → concluido; ou desfeito). Guarda a data de corte, as opções, o
 *   resultado do ensaio e o progresso da aplicação.
 * - migracao_arquivos: cada arquivo solto, com a lista que ele é, os
 *   cabeçalhos, o mapeamento (campo → coluna) e os avisos (lista cortada,
 *   linha de total).
 * - migracao_linhas: cada linha do arquivo com o resultado do ensaio
 *   (criar, vincular, recusar, ignorar), o motivo e se já foi aplicada.
 * - migracao_vinculos: cada registro que o lote criou ou ligou (origem →
 *   registro), com o retrato (md5 dos dados) de quando a mudança terminou
 *   de mexer nele. É o que permite desfazer só o que ninguém mudou depois.
 */
export const MIGRACAO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS migracao_lotes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    nome TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'rascunho',
    data_corte DATE,
    opcoes JSONB NOT NULL DEFAULT '{}'::jsonb,
    resumo JSONB NOT NULL DEFAULT '{}'::jsonb,
    assinatura TEXT,
    progresso JSONB NOT NULL DEFAULT '{}'::jsonb,
    erro TEXT,
    versao INTEGER NOT NULL DEFAULT 1,
    versao_do_ensaio INTEGER,
    chave_criacao TEXT,
    idempotencia JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_por TEXT NOT NULL DEFAULT '',
    criado_por_nome TEXT NOT NULL DEFAULT '',
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ensaiado_em TIMESTAMPTZ,
    aplicado_em TIMESTAMPTZ,
    concluido_em TIMESTAMPTZ,
    desfeito_em TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_migracao_lotes_tenant ON migracao_lotes (tenant_id, criado_em DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_migracao_lotes_chave ON migracao_lotes (tenant_id, chave_criacao) WHERE chave_criacao IS NOT NULL;

  CREATE TABLE IF NOT EXISTS migracao_arquivos (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    lote_id TEXT NOT NULL,
    ordem INTEGER NOT NULL DEFAULT 0,
    nome TEXT NOT NULL DEFAULT '',
    tamanho INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL DEFAULT '',
    formato TEXT NOT NULL DEFAULT '',
    codificacao TEXT,
    separador TEXT,
    aba TEXT NOT NULL DEFAULT '',
    abas JSONB NOT NULL DEFAULT '[]'::jsonb,
    lista TEXT NOT NULL DEFAULT '',
    lista_reconhecida BOOLEAN NOT NULL DEFAULT true,
    periodo JSONB,
    linha_cabecalho INTEGER NOT NULL DEFAULT 1,
    cabecalhos JSONB NOT NULL DEFAULT '[]'::jsonb,
    mapeamento JSONB NOT NULL DEFAULT '{}'::jsonb,
    mapeamento_confirmado BOOLEAN NOT NULL DEFAULT false,
    opcoes JSONB NOT NULL DEFAULT '{}'::jsonb,
    avisos JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_rodape JSONB NOT NULL DEFAULT '{}'::jsonb,
    linhas INTEGER NOT NULL DEFAULT 0,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lote_id, hash)
  );
  CREATE INDEX IF NOT EXISTS idx_migracao_arquivos_lote ON migracao_arquivos (tenant_id, lote_id, ordem);

  CREATE TABLE IF NOT EXISTS migracao_linhas (
    tenant_id TEXT NOT NULL,
    lote_id TEXT NOT NULL,
    arquivo_id TEXT NOT NULL,
    linha INTEGER NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'dado',
    celulas JSONB NOT NULL DEFAULT '[]'::jsonb,
    agrupamento JSONB,
    etapa INTEGER NOT NULL DEFAULT 0,
    resultado TEXT NOT NULL DEFAULT 'pendente',
    codigo TEXT,
    motivo TEXT,
    avisos JSONB NOT NULL DEFAULT '[]'::jsonb,
    dados JSONB,
    chave TEXT,
    alvo_tabela TEXT,
    alvo_id TEXT,
    aplicada BOOLEAN NOT NULL DEFAULT false,
    aplicada_em TIMESTAMPTZ,
    PRIMARY KEY (arquivo_id, linha)
  );
  CREATE INDEX IF NOT EXISTS idx_migracao_linhas_lote ON migracao_linhas (tenant_id, lote_id, aplicada, etapa);
  CREATE INDEX IF NOT EXISTS idx_migracao_linhas_resultado ON migracao_linhas (tenant_id, lote_id, resultado, codigo);

  CREATE TABLE IF NOT EXISTS migracao_vinculos (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    lote_id TEXT NOT NULL,
    etapa INTEGER NOT NULL DEFAULT 0,
    tabela TEXT NOT NULL,
    registro_id TEXT NOT NULL,
    acao TEXT NOT NULL,
    arquivo_id TEXT,
    linha INTEGER,
    chave TEXT,
    hash TEXT,
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    desfeito BOOLEAN NOT NULL DEFAULT false,
    desfeito_em TIMESTAMPTZ,
    mantido_motivo TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (lote_id, tabela, registro_id, acao)
  );
  CREATE INDEX IF NOT EXISTS idx_migracao_vinculos_lote ON migracao_vinculos (tenant_id, lote_id, etapa);
  CREATE INDEX IF NOT EXISTS idx_migracao_vinculos_chave ON migracao_vinculos (tenant_id, tabela, chave) WHERE chave IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_migracao_vinculos_registro ON migracao_vinculos (tenant_id, tabela, registro_id);
`;
