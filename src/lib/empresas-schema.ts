// Várias empresas dentro da agência (06/11/2026, E7 frente G2). Idempotente:
// o initDB roda a cada boot, depois das tabelas de permissões, cobrança,
// fiscal e faturas, e antes do razão e da auditoria.
//
// O que faz:
//  1. `empresas`: o cadastro (nome, razão social, CNPJ, principal, ativa).
//     A principal tem id fixo 'principal' e nasce sozinha dos dados da
//     agência (`fin_empresa_principal`).
//  2. `empresa_selecao`: o que cada pessoa marcou no seletor (lembrado por
//     usuário). `empresa_configuracoes`: as configurações das empresas além
//     da principal (a principal continua lendo e gravando onde sempre).
//  3. Empresas no perfil de acesso (`grupos_usuario.empresas`) e na
//     restrição própria (`usuario_restricoes.empresas_liberadas`). Vazio =
//     todas, como as contas bancárias.
//  4. `empresa_id` em títulos, contas bancárias, cartões, vendas e notas (no
//     JSON `data`, o padrão dessas tabelas) e em faturas e cobranças (coluna,
//     o padrão delas). Um gatilho preenche quando vem vazio — pela venda, pelo
//     título, pela conta bancária, pelo cartão, pela empresa em que a pessoa
//     está trabalhando ou, no fim, a principal — e, numa regravação que não
//     mandou a empresa, mantém a de antes. Assim todo caminho de gravação
//     (tela, CRM, migração, recorrência, conciliação...) sai com empresa.
//  5. Migração única (marco 'empresas_v1'): a principal de cada agência e
//     todos os registros existentes nela.
//
// Com uma empresa só, nada disso aparece: os registros ganham
// `empresa_id = 'principal'` e as telas não mostram seletor nem coluna.
export const EMPRESAS_SCHEMA_SQL = String.raw`
  CREATE TABLE IF NOT EXISTS empresas (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    nome TEXT NOT NULL,
    razao_social TEXT NOT NULL DEFAULT '',
    cnpj TEXT NOT NULL DEFAULT '',
    principal BOOLEAN NOT NULL DEFAULT FALSE,
    ativa BOOLEAN NOT NULL DEFAULT TRUE,
    ordem INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    -- A principal nunca se desativa: os registros de antes moram nela.
    CONSTRAINT empresas_principal_ativa CHECK (NOT principal OR ativa),
    CONSTRAINT empresas_principal_id CHECK (principal = (id = 'principal'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS empresas_cnpj_unico ON empresas (tenant_id, cnpj) WHERE cnpj <> '';
  CREATE UNIQUE INDEX IF NOT EXISTS empresas_nome_unico ON empresas (tenant_id, lower(nome));

  CREATE TABLE IF NOT EXISTS empresa_selecao (
    tenant_id TEXT NOT NULL,
    usuario_id TEXT NOT NULL,
    -- Vazio = todas as empresas que a pessoa pode ver.
    empresas JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, usuario_id),
    CONSTRAINT empresa_selecao_lista CHECK (jsonb_typeof(empresas) = 'array')
  );

  CREATE TABLE IF NOT EXISTS empresa_configuracoes (
    tenant_id TEXT NOT NULL,
    empresa_id TEXT NOT NULL,
    secao TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    copiada_de TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, empresa_id, secao),
    CONSTRAINT empresa_configuracoes_secao CHECK (secao IN ('financeiro', 'cobranca', 'vendas', 'notas'))
  );

  DO $empresas_colunas$
  BEGIN
    IF to_regclass('public.grupos_usuario') IS NOT NULL THEN
      ALTER TABLE grupos_usuario ADD COLUMN IF NOT EXISTS empresas JSONB NOT NULL DEFAULT '[]'::jsonb;
    END IF;
    IF to_regclass('public.usuario_restricoes') IS NOT NULL THEN
      ALTER TABLE usuario_restricoes ADD COLUMN IF NOT EXISTS empresas_liberadas JSONB NOT NULL DEFAULT '[]'::jsonb;
    END IF;
    IF to_regclass('public.faturas') IS NOT NULL THEN
      ALTER TABLE faturas ADD COLUMN IF NOT EXISTS empresa_id TEXT NOT NULL DEFAULT '';
    END IF;
    IF to_regclass('public.cobrancas') IS NOT NULL THEN
      ALTER TABLE cobrancas ADD COLUMN IF NOT EXISTS empresa_id TEXT NOT NULL DEFAULT '';
    END IF;
  END;
  $empresas_colunas$;

  -- A principal da agência, criada na primeira vez a partir dos dados da
  -- agência (nome fantasia, razão social, CNPJ). Devolve sempre 'principal'.
  CREATE OR REPLACE FUNCTION fin_empresa_principal(p_tenant TEXT) RETURNS TEXT LANGUAGE plpgsql AS $fn$
  DECLARE a JSONB := '{}'::jsonb;
  BEGIN
    IF COALESCE(p_tenant, '') = '' THEN RETURN 'principal'; END IF;
    IF EXISTS (SELECT 1 FROM empresas WHERE tenant_id = p_tenant AND id = 'principal') THEN RETURN 'principal'; END IF;
    IF to_regclass('public.agencia') IS NOT NULL THEN
      BEGIN
        EXECUTE 'SELECT data FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1'
          INTO a USING p_tenant;
      EXCEPTION WHEN undefined_column THEN a := '{}'::jsonb;
      END;
    END IF;
    a := COALESCE(a, '{}'::jsonb);
    INSERT INTO empresas (tenant_id, id, nome, razao_social, cnpj, principal, ativa, ordem)
    VALUES (
      p_tenant, 'principal',
      left(COALESCE(NULLIF(btrim(a->>'nome_fantasia'), ''), NULLIF(btrim(a->>'razao_social'), ''), 'Empresa principal'), 80),
      left(COALESCE(btrim(a->>'razao_social'), ''), 160),
      regexp_replace(COALESCE(a->>'cnpj', ''), '\D', '', 'g'),
      TRUE, TRUE, 0)
    ON CONFLICT DO NOTHING;
    RETURN 'principal';
  END;
  $fn$;

  -- Empresa existe e está ativa nesta agência?
  CREATE OR REPLACE FUNCTION fin_empresa_valida(p_tenant TEXT, p_empresa TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
    SELECT COALESCE(p_empresa, '') <> '' AND EXISTS (
      SELECT 1 FROM empresas WHERE tenant_id = p_tenant AND id = p_empresa AND ativa);
  $fn$;

  -- A empresa em que a pessoa está trabalhando (quem grava vem do contexto
  -- de auditoria): uma empresa só marcada no seletor; senão a principal.
  CREATE OR REPLACE FUNCTION fin_empresa_padrao(p_tenant TEXT) RETURNS TEXT LANGUAGE plpgsql AS $fn$
  DECLARE v_usuario TEXT; v TEXT;
  BEGIN
    -- Mesma leitura do gatilho de auditoria (sem bloco de exceção: nada de
    -- subtransação a cada gravação).
    v_usuario := COALESCE(NULLIF(current_setting('app.audit_context', true), ''), '{}')::jsonb->>'userId';
    IF COALESCE(v_usuario, '') <> '' THEN
      SELECT s.empresas->>0 INTO v FROM empresa_selecao s
       WHERE s.tenant_id = p_tenant AND s.usuario_id = v_usuario AND jsonb_array_length(s.empresas) = 1;
      IF fin_empresa_valida(p_tenant, v) THEN RETURN v; END IF;
    END IF;
    RETURN fin_empresa_principal(p_tenant);
  END;
  $fn$;

  -- A empresa de um registro que veio sem ela.
  CREATE OR REPLACE FUNCTION fin_empresa_derivada(p_tabela TEXT, p_tenant TEXT, d JSONB, p_titulo_tabela TEXT DEFAULT NULL, p_titulo_id TEXT DEFAULT NULL)
  RETURNS TEXT LANGUAGE plpgsql AS $fn$
  DECLARE v TEXT; ref TEXT;
  BEGIN
    d := COALESCE(d, '{}'::jsonb);
    IF p_tabela IN ('contas_receber', 'contas_pagar', 'notas_fiscais') THEN
      -- A venda manda (os títulos da venda são da empresa da venda).
      ref := COALESCE(NULLIF(d->>'venda_id', ''), NULLIF(d->>'origem_venda_id', ''));
      IF ref IS NOT NULL AND to_regclass('public.vendas_crm') IS NOT NULL THEN
        SELECT data->>'empresa_id' INTO v FROM vendas_crm WHERE tenant_id = p_tenant AND id = ref;
        IF fin_empresa_valida(p_tenant, v) THEN RETURN v; END IF;
      END IF;
    END IF;
    IF p_tabela = 'notas_fiscais' THEN
      ref := NULLIF(d->>'conta_receber_id', '');
      IF ref IS NOT NULL THEN
        SELECT data->>'empresa_id' INTO v FROM contas_receber WHERE tenant_id = p_tenant AND id = ref;
        IF fin_empresa_valida(p_tenant, v) THEN RETURN v; END IF;
      END IF;
    END IF;
    IF p_tabela = 'cobrancas' AND p_titulo_tabela IN ('contas_receber', 'contas_pagar') THEN
      EXECUTE format('SELECT data->>''empresa_id'' FROM %I WHERE tenant_id = $1 AND id = $2', p_titulo_tabela)
        INTO v USING p_tenant, p_titulo_id;
      IF fin_empresa_valida(p_tenant, v) THEN RETURN v; END IF;
    END IF;
    IF p_tabela IN ('contas_receber', 'contas_pagar') THEN
      -- Compra no cartão corporativo: a fatura nasce na empresa do cartão.
      ref := NULLIF(d->>'cartao_id', '');
      IF ref IS NOT NULL AND to_regclass('public.cartoes_corp') IS NOT NULL THEN
        SELECT COALESCE(NULLIF(data->>'empresa_fatura_id', ''), data->>'empresa_id') INTO v
          FROM cartoes_corp WHERE tenant_id = p_tenant AND id = ref;
        IF fin_empresa_valida(p_tenant, v) THEN RETURN v; END IF;
      END IF;
      -- A conta bancária do título.
      ref := NULLIF(d->>'conta_bancaria_id', '');
      IF ref IS NOT NULL THEN
        SELECT data->>'empresa_id' INTO v FROM contas_bancarias WHERE tenant_id = p_tenant AND id = ref;
        IF fin_empresa_valida(p_tenant, v) THEN RETURN v; END IF;
      END IF;
    END IF;
    -- Fatura sem empresa é da principal (o código grava a empresa dos itens).
    IF p_tabela = 'faturas' THEN RETURN fin_empresa_principal(p_tenant); END IF;
    RETURN fin_empresa_padrao(p_tenant);
  END;
  $fn$;

  -- Gatilho das tabelas com 'data' JSONB.
  CREATE OR REPLACE FUNCTION fin_empresa_no_registro() RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  DECLARE v TEXT; antes TEXT; d JSONB;
  BEGIN
    IF NEW.data IS NULL OR jsonb_typeof(NEW.data) <> 'object' THEN RETURN NEW; END IF;
    v := NULLIF(btrim(COALESCE(NEW.data->>'empresa_id', '')), '');
    IF TG_OP = 'UPDATE' THEN
      antes := NULLIF(OLD.data->>'empresa_id', '');
      -- Regravação que não mandou a empresa: fica a de antes.
      IF v IS NULL THEN v := antes; END IF;
      IF v IS NOT NULL AND v IS NOT DISTINCT FROM antes THEN
        IF NEW.data->>'empresa_id' IS DISTINCT FROM v THEN
          NEW.data := jsonb_set(NEW.data, '{empresa_id}', to_jsonb(v), true);
        END IF;
        RETURN NEW;
      END IF;
    END IF;
    IF v IS NOT NULL AND NOT fin_empresa_valida(NEW.tenant_id, v) THEN v := NULL; END IF;
    IF v IS NULL THEN
      d := NEW.data;
      -- Nas notas, a conta e a venda moram em colunas.
      IF TG_TABLE_NAME = 'notas_fiscais' THEN
        d := d || jsonb_strip_nulls(jsonb_build_object(
          'conta_receber_id', NULLIF(to_jsonb(NEW)->>'conta_receber_id', ''),
          'venda_id', NULLIF(to_jsonb(NEW)->>'venda_id', '')));
      END IF;
      v := fin_empresa_derivada(TG_TABLE_NAME, NEW.tenant_id, d);
    END IF;
    NEW.data := jsonb_set(NEW.data, '{empresa_id}', to_jsonb(v), true);
    RETURN NEW;
  END;
  $fn$;

  -- Gatilho das tabelas com a coluna empresa_id (faturas, cobranças).
  CREATE OR REPLACE FUNCTION fin_empresa_na_coluna() RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  DECLARE v TEXT; tt TEXT; ti TEXT;
  BEGIN
    v := NULLIF(btrim(COALESCE(NEW.empresa_id, '')), '');
    IF TG_OP = 'UPDATE' THEN
      IF v IS NULL THEN v := NULLIF(OLD.empresa_id, ''); END IF;
      IF v IS NOT NULL AND v IS NOT DISTINCT FROM NULLIF(OLD.empresa_id, '') THEN NEW.empresa_id := v; RETURN NEW; END IF;
    END IF;
    IF v IS NOT NULL AND NOT fin_empresa_valida(NEW.tenant_id, v) THEN v := NULL; END IF;
    IF v IS NULL THEN
      IF TG_TABLE_NAME = 'cobrancas' THEN
        tt := to_jsonb(NEW)->>'titulo_tabela'; ti := to_jsonb(NEW)->>'titulo_id';
      END IF;
      v := fin_empresa_derivada(TG_TABLE_NAME, NEW.tenant_id, '{}'::jsonb, tt, ti);
    END IF;
    NEW.empresa_id := v;
    RETURN NEW;
  END;
  $fn$;

  -- A venda mudou de empresa: os títulos dela ainda em aberto vão junto. Os
  -- já pagos ou recebidos ficam onde o dinheiro entrou.
  CREATE OR REPLACE FUNCTION fin_empresa_da_venda_nos_titulos() RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  DECLARE v TEXT := NEW.data->>'empresa_id';
  BEGIN
    IF v IS NOT DISTINCT FROM OLD.data->>'empresa_id' OR COALESCE(v, '') = '' THEN RETURN NEW; END IF;
    UPDATE contas_receber SET data = jsonb_set(data, '{empresa_id}', to_jsonb(v), true), updated_at = NOW()
     WHERE tenant_id = NEW.tenant_id AND (venda_id = NEW.id OR data->>'venda_id' = NEW.id OR data->>'origem_venda_id' = NEW.id)
       AND COALESCE(data->>'status', '') NOT IN ('RECEBIDO', 'PARCIAL', 'CANCELADO')
       AND data->>'empresa_id' IS DISTINCT FROM v;
    UPDATE contas_pagar SET data = jsonb_set(data, '{empresa_id}', to_jsonb(v), true), updated_at = NOW()
     WHERE tenant_id = NEW.tenant_id AND (data->>'venda_id' = NEW.id OR data->>'origem_venda_id' = NEW.id)
       AND COALESCE(data->>'status', '') NOT IN ('PAGO', 'PARCIAL', 'CANCELADO')
       AND data->>'empresa_id' IS DISTINCT FROM v;
    RETURN NEW;
  END;
  $fn$;

  CREATE TABLE IF NOT EXISTS marcos_de_migracao (
    chave TEXT PRIMARY KEY,
    em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Migração única: a principal de cada agência e todo registro de antes nela.
  -- Roda ANTES dos gatilhos existirem (o jsonb_set é direto, sem consulta por
  -- linha). Registro gravado depois, por qualquer caminho, passa pelo gatilho.
  DO $empresas_v1$
  DECLARE t TEXT; tab TEXT;
  BEGIN
    IF EXISTS (SELECT 1 FROM marcos_de_migracao WHERE chave = 'empresas_v1') THEN RETURN; END IF;
    IF to_regclass('public.agencia') IS NOT NULL THEN
      BEGIN
        FOR t IN EXECUTE 'SELECT DISTINCT tenant_id FROM agencia WHERE COALESCE(tenant_id, '''') <> ''''' LOOP
          PERFORM fin_empresa_principal(t);
        END LOOP;
      EXCEPTION WHEN undefined_column THEN NULL;
      END;
    END IF;
    FOREACH tab IN ARRAY ARRAY['contas_receber', 'contas_pagar', 'contas_bancarias', 'cartoes_corp', 'vendas_crm', 'notas_fiscais'] LOOP
      IF to_regclass('public.' || tab) IS NOT NULL THEN
        EXECUTE format(
          'UPDATE %I SET data = jsonb_set(data, ''{empresa_id}'', ''"principal"''::jsonb, true)
            WHERE jsonb_typeof(data) = ''object'' AND COALESCE(data->>''empresa_id'', '''') = ''''
              AND COALESCE(tenant_id, '''') <> ''''', tab);
        EXECUTE format(
          'SELECT fin_empresa_principal(tenant_id) FROM (SELECT DISTINCT tenant_id FROM %I WHERE COALESCE(tenant_id, '''') <> '''') x', tab);
      END IF;
    END LOOP;
    FOREACH tab IN ARRAY ARRAY['faturas', 'cobrancas'] LOOP
      IF to_regclass('public.' || tab) IS NOT NULL THEN
        EXECUTE format('UPDATE %I SET empresa_id = ''principal'' WHERE empresa_id = ''''', tab);
        EXECUTE format(
          'SELECT fin_empresa_principal(tenant_id) FROM (SELECT DISTINCT tenant_id FROM %I WHERE COALESCE(tenant_id, '''') <> '''') x', tab);
      END IF;
    END LOOP;
    INSERT INTO marcos_de_migracao (chave) VALUES ('empresas_v1') ON CONFLICT DO NOTHING;
  END;
  $empresas_v1$;

  DO $empresas_gatilhos$
  DECLARE tab TEXT;
  BEGIN
    FOREACH tab IN ARRAY ARRAY['contas_receber', 'contas_pagar', 'contas_bancarias', 'cartoes_corp', 'vendas_crm', 'notas_fiscais'] LOOP
      IF to_regclass('public.' || tab) IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', tab)::regclass AND tgname = 'fin_empresa_v1' AND NOT tgisinternal
      ) THEN
        EXECUTE format('CREATE TRIGGER fin_empresa_v1 BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION fin_empresa_no_registro()', tab);
      END IF;
    END LOOP;
    IF to_regclass('public.vendas_crm') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.vendas_crm'::regclass AND tgname = 'fin_empresa_da_venda_v1' AND NOT tgisinternal
    ) THEN
      CREATE TRIGGER fin_empresa_da_venda_v1 AFTER UPDATE ON public.vendas_crm
        FOR EACH ROW EXECUTE FUNCTION fin_empresa_da_venda_nos_titulos();
    END IF;
    FOREACH tab IN ARRAY ARRAY['faturas', 'cobrancas'] LOOP
      IF to_regclass('public.' || tab) IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', tab)::regclass AND tgname = 'fin_empresa_v1' AND NOT tgisinternal
      ) THEN
        EXECUTE format('CREATE TRIGGER fin_empresa_v1 BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION fin_empresa_na_coluna()', tab);
      END IF;
    END LOOP;
  END;
  $empresas_gatilhos$;
`;
