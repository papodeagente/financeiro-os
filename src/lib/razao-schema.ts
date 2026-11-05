/**
 * Esquema do razão financeiro, do agendador e da fila de tarefas (05/11/2026).
 *
 * Tudo idempotente (roda no initDB a cada boot). Dinheiro em centavos BIGINT.
 *
 * - razao_lancamentos / razao_partidas: só acréscimo. UPDATE e DELETE são
 *   recusados pelo banco, exceto na limpeza explícita do "resetar dados"
 *   (configuração de sessão razao.limpeza = 'on', só dentro daquela transação).
 * - razao_lancar(): grava um lançamento. Se der QUALQUER erro, anota em
 *   razao_falhas e devolve 'falha' — nunca derruba a baixa/transferência que
 *   chamou. A conferência diária mostra as falhas.
 * - razao_estado: a agência só passa a gravar no razão depois da abertura
 *   (saldo de partida de cada conta), feita pelo agendador.
 */
export const RAZAO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS razao_estado (
    tenant_id TEXT PRIMARY KEY,
    aberto_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dados JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE TABLE IF NOT EXISTS razao_lancamentos (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    chave_natural TEXT NOT NULL,
    tipo_evento TEXT NOT NULL,
    data_competencia DATE NOT NULL,
    origem_tabela TEXT,
    origem_id TEXT,
    descricao TEXT NOT NULL DEFAULT '',
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, chave_natural)
  );
  CREATE INDEX IF NOT EXISTS idx_razao_lancamentos_origem
    ON razao_lancamentos(tenant_id, origem_tabela, origem_id);

  CREATE TABLE IF NOT EXISTS razao_partidas (
    tenant_id TEXT NOT NULL,
    lancamento_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    conta TEXT NOT NULL,
    conta_bancaria_id TEXT,
    valor_centavos BIGINT NOT NULL,
    titulo_tabela TEXT,
    titulo_id TEXT,
    pessoa_id TEXT,
    data_competencia DATE NOT NULL,
    PRIMARY KEY (tenant_id, lancamento_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_razao_partidas_conta
    ON razao_partidas(tenant_id, conta, conta_bancaria_id);

  CREATE TABLE IF NOT EXISTS razao_falhas (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    chave_natural TEXT,
    erro TEXT NOT NULL,
    dados JSONB,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_razao_falhas_tenant ON razao_falhas(tenant_id, criado_em DESC);

  CREATE TABLE IF NOT EXISTS razao_conferencias (
    tenant_id TEXT NOT NULL,
    dia DATE NOT NULL,
    tipo TEXT NOT NULL,
    conta_bancaria_id TEXT NOT NULL,
    saldo_atual_centavos BIGINT NOT NULL,
    razao_centavos BIGINT NOT NULL,
    diferenca_centavos BIGINT NOT NULL,
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, dia, tipo, conta_bancaria_id)
  );

  -- Retrato único dos saldos no dia em que o razão chegou (prova de antes e
  -- depois). Só lê; nunca é atualizado.
  CREATE TABLE IF NOT EXISTS retrato_saldos (
    tenant_id TEXT NOT NULL,
    conta_bancaria_id TEXT NOT NULL,
    saldo_atual_centavos BIGINT NOT NULL,
    capturado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, conta_bancaria_id)
  );
  INSERT INTO retrato_saldos (tenant_id, conta_bancaria_id, saldo_atual_centavos)
  SELECT tenant_id, id,
         ROUND((CASE WHEN data->>'saldo_atual' ~ '^-?[0-9]+([.][0-9]+)?$'
                     THEN (data->>'saldo_atual')::numeric ELSE 0 END) * 100)::bigint
    FROM contas_bancarias
   WHERE NOT EXISTS (SELECT 1 FROM retrato_saldos)
  ON CONFLICT DO NOTHING;

  CREATE OR REPLACE FUNCTION razao_imutavel()
  RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  BEGIN
    IF COALESCE(current_setting('razao.limpeza', true), '') = 'on' AND TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'O razão financeiro é imutável: operação % não permitida', TG_OP
      USING ERRCODE = '42501';
  END;
  $fn$;

  DO $inst$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'razao_lancamentos'::regclass AND tgname = 'razao_lancamentos_imutavel') THEN
      CREATE TRIGGER razao_lancamentos_imutavel BEFORE UPDATE OR DELETE ON razao_lancamentos
        FOR EACH ROW EXECUTE FUNCTION razao_imutavel();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'razao_partidas'::regclass AND tgname = 'razao_partidas_imutavel') THEN
      CREATE TRIGGER razao_partidas_imutavel BEFORE UPDATE OR DELETE ON razao_partidas
        FOR EACH ROW EXECUTE FUNCTION razao_imutavel();
    END IF;
  END
  $inst$;

  CREATE OR REPLACE FUNCTION razao_lancar(p_tenant TEXT, p_lanc JSONB, p_forcar BOOLEAN DEFAULT false)
  RETURNS TEXT LANGUAGE plpgsql AS $fn$
  DECLARE
    v_id TEXT;
    v_soma BIGINT;
    v_qtd INTEGER;
    v_partida JSONB;
    v_seq INTEGER := 0;
    v_data DATE;
  BEGIN
    IF NOT p_forcar AND NOT EXISTS (SELECT 1 FROM razao_estado WHERE tenant_id = p_tenant) THEN
      RETURN 'sem_abertura';
    END IF;
    BEGIN
      SELECT COALESCE(SUM((x->>'valor_centavos')::bigint), 0), COUNT(*)
        INTO v_soma, v_qtd
        FROM jsonb_array_elements(p_lanc->'partidas') x;
      IF v_soma <> 0 OR v_qtd < 2 THEN
        RAISE EXCEPTION 'lançamento não fecha em zero (soma %, partidas %)', v_soma, v_qtd;
      END IF;
      v_id := md5(p_tenant || ':' || (p_lanc->>'chave_natural'));
      v_data := COALESCE(NULLIF(p_lanc->>'data_competencia', '')::date,
                         (NOW() AT TIME ZONE 'America/Sao_Paulo')::date);
      INSERT INTO razao_lancamentos (id, tenant_id, chave_natural, tipo_evento, data_competencia,
                                     origem_tabela, origem_id, descricao, dados)
      VALUES (v_id, p_tenant, p_lanc->>'chave_natural', p_lanc->>'tipo_evento', v_data,
              p_lanc->>'origem_tabela', p_lanc->>'origem_id', COALESCE(p_lanc->>'descricao', ''),
              COALESCE(p_lanc->'dados', '{}'::jsonb))
      ON CONFLICT (tenant_id, chave_natural) DO NOTHING;
      IF NOT FOUND THEN
        RETURN 'duplicado';
      END IF;
      FOR v_partida IN SELECT value FROM jsonb_array_elements(p_lanc->'partidas') LOOP
        v_seq := v_seq + 1;
        INSERT INTO razao_partidas (tenant_id, lancamento_id, seq, conta, conta_bancaria_id, valor_centavos,
                                    titulo_tabela, titulo_id, pessoa_id, data_competencia)
        VALUES (p_tenant, v_id, v_seq, v_partida->>'conta', NULLIF(v_partida->>'conta_bancaria_id', ''),
                (v_partida->>'valor_centavos')::bigint, NULLIF(v_partida->>'titulo_tabela', ''),
                NULLIF(v_partida->>'titulo_id', ''), NULLIF(v_partida->>'pessoa_id', ''), v_data);
      END LOOP;
      RETURN 'ok';
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO razao_falhas (tenant_id, chave_natural, erro, dados)
      VALUES (p_tenant, p_lanc->>'chave_natural', SQLERRM, p_lanc);
      RETURN 'falha';
    END;
  END;
  $fn$;

  -- Saldo de cada conta bancária segundo o razão.
  CREATE OR REPLACE VIEW razao_saldo_bancario AS
    SELECT tenant_id, conta_bancaria_id, SUM(valor_centavos)::bigint AS saldo_centavos
      FROM razao_partidas
     WHERE conta = 'BANCO'
     GROUP BY tenant_id, conta_bancaria_id;

  -- Agendador: uma execução por tarefa/janela/agência, e o disjuntor.
  CREATE TABLE IF NOT EXISTS agendador_execucoes (
    tarefa TEXT NOT NULL,
    janela TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT '',
    iniciado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    terminado_em TIMESTAMPTZ,
    resultado JSONB,
    PRIMARY KEY (tarefa, janela, tenant_id)
  );
  CREATE TABLE IF NOT EXISTS agendador_estado (
    tarefa TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT '',
    falhas_seguidas INTEGER NOT NULL DEFAULT 0,
    aberto_ate TIMESTAMPTZ,
    ultimo_erro TEXT,
    ultima_execucao TIMESTAMPTZ,
    PRIMARY KEY (tarefa, tenant_id)
  );

  -- Fila de tarefas por agência, com justiça entre agências (usada pela
  -- cobrança, régua e importações).
  CREATE TABLE IF NOT EXISTS tarefas (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    tipo TEXT NOT NULL,
    chave_idem TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    proxima_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tentativas INTEGER NOT NULL DEFAULT 0,
    erro TEXT,
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, tipo, chave_idem)
  );
  CREATE INDEX IF NOT EXISTS idx_tarefas_fila ON tarefas(status, proxima_em);
`;

/** Tabelas novas que não entram na auditoria por gatilho (já são imutáveis ou são controle interno). */
export const TABELAS_FORA_DA_AUDITORIA = [
  'razao_estado', 'razao_lancamentos', 'razao_partidas', 'razao_falhas', 'razao_conferencias',
  'retrato_saldos', 'agendador_execucoes', 'agendador_estado', 'tarefas',
];

/**
 * Apaga o razão de UMA agência — só no "resetar dados" do financeiro, dentro
 * da mesma transação que apaga as contas. A abertura volta a rodar depois.
 */
export const RAZAO_LIMPEZA_DA_AGENCIA_SQL = [
  `SELECT set_config('razao.limpeza', 'on', true)`,
  `DELETE FROM razao_partidas WHERE tenant_id = $1`,
  `DELETE FROM razao_lancamentos WHERE tenant_id = $1`,
  `DELETE FROM razao_estado WHERE tenant_id = $1`,
  `DELETE FROM razao_conferencias WHERE tenant_id = $1`,
  `SELECT set_config('razao.limpeza', 'off', true)`,
];
