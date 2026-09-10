/** SQL compartilhado com os testes PostgreSQL/PGlite. Sem backfill de eventos. */
export const AUDIT_SCHEMA_SQL = String.raw`
  -- Serializa somente a instalação, inclusive quando duas réplicas sobem juntas.
  SELECT pg_advisory_xact_lock(731945281);

  CREATE TABLE IF NOT EXISTS audit_config (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_created
    ON audit_log (tenant_id, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_usuario_created
    ON audit_log (tenant_id, usuario_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_modulo_created
    ON audit_log (tenant_id, modulo, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_acao_created
    ON audit_log (tenant_id, acao, created_at DESC);

  CREATE OR REPLACE FUNCTION audit_sensitive_key(key_name TEXT)
  RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $fn$
    SELECT regexp_replace(lower(key_name), '[^a-z0-9]', '', 'g') ~
      '(senha|password|passwd|secret|token|apikey|apisecret|chaveapi|chaveprivada|privatekey|credential|credencial|authorization|cookie|certificado|certificate|pfx|base64|hash|salt|cvv|cvc|numerocartao|cardnumber|payload|rawbody|requestbody|responsebody|xml|connectionstring|databaseurl)'
      OR lower(key_name) IN ('headers', 'body', 'raw', 'chave', 'key', 'segredo');
  $fn$;

  CREATE OR REPLACE FUNCTION audit_safe_json(value JSONB, key_name TEXT DEFAULT '', depth INTEGER DEFAULT 0)
  RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $fn$
  DECLARE
    result JSONB;
    item RECORD;
    string_value TEXT;
    parsed JSONB;
  BEGIN
    IF value IS NULL OR value = 'null'::jsonb THEN RETURN 'null'::jsonb; END IF;
    IF audit_sensitive_key(key_name) THEN RETURN to_jsonb('[PROTEGIDO]'::text); END IF;
    IF depth >= 12 THEN RETURN to_jsonb('[CONTEÚDO EXTENSO]'::text); END IF;
    IF jsonb_typeof(value) = 'object' THEN
      result := '{}'::jsonb;
      FOR item IN SELECT key, val FROM jsonb_each(value) AS pairs(key, val) LOOP
        result := result || jsonb_build_object(item.key, audit_safe_json(item.val, item.key, depth + 1));
      END LOOP;
      RETURN result;
    ELSIF jsonb_typeof(value) = 'array' THEN
      result := '[]'::jsonb;
      FOR item IN SELECT val, ord FROM jsonb_array_elements(value) WITH ORDINALITY AS values_with_order(val, ord) LOOP
        IF item.ord > 100 THEN
          RETURN result || jsonb_build_array('[LISTA LIMITADA A 100 ITENS]');
        END IF;
        result := result || jsonb_build_array(audit_safe_json(item.val, key_name, depth + 1));
      END LOOP;
      RETURN result;
    ELSIF jsonb_typeof(value) = 'string' THEN
      string_value := value #>> '{}';
      -- Alguns provedores guardam JSON serializado dentro de strings.
      IF left(ltrim(string_value), 1) IN ('{', '[') THEN
        BEGIN
          parsed := string_value::jsonb;
          RETURN audit_safe_json(parsed, key_name, depth + 1);
        EXCEPTION WHEN invalid_text_representation THEN
          NULL;
        END;
      END IF;
      IF string_value ~* '(bearer[[:space:]]+|-----BEGIN|data:[^;]+;base64,|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|(password|senha|token|secret|api[_-]?key|authorization)["'':=[:space:]]+["'']?[^[:space:]]+)' THEN
        RETURN to_jsonb('[PROTEGIDO]'::text);
      END IF;
      -- URLs assinadas e com credenciais não devem reproduzir o segredo.
      IF string_value ~* '(https?://[^/[:space:]]+:[^/@[:space:]]+@|[?&](token|key|secret|signature|credential|password|senha)=)' THEN
        RETURN to_jsonb('[URL PROTEGIDA]'::text);
      END IF;
      IF length(string_value) > 1500 THEN
        RETURN to_jsonb(left(string_value, 1500) || '… [CONTEÚDO LIMITADO]');
      END IF;
    END IF;
    RETURN value;
  END;
  $fn$;

  CREATE OR REPLACE FUNCTION audit_display(value JSONB, key_name TEXT DEFAULT '')
  RETURNS TEXT LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE
      WHEN value IS NULL OR value = 'null'::jsonb THEN ''
      WHEN jsonb_typeof(audit_safe_json(value, key_name)) = 'string'
        THEN audit_safe_json(value, key_name) #>> '{}'
      ELSE audit_safe_json(value, key_name)::text END;
  $fn$;

  CREATE OR REPLACE FUNCTION audit_safe_event(event JSONB)
  RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $fn$
  DECLARE result JSONB; changes JSONB := '[]'::jsonb; item JSONB; field_name TEXT;
  BEGIN
    result := audit_safe_json(event);
    IF jsonb_typeof(event->'alteracoes') = 'array' THEN
      FOR item IN SELECT val FROM jsonb_array_elements(event->'alteracoes') AS elements(val) LOOP
        field_name := COALESCE(item->>'campo', '');
        changes := changes || jsonb_build_array(jsonb_build_object(
          'campo', left(field_name, 300),
          'valor_anterior', audit_display(item->'valor_anterior', field_name),
          'valor_novo', audit_display(item->'valor_novo', field_name)
        ));
      END LOOP;
      result := jsonb_set(result, '{alteracoes}', changes);
    END IF;
    RETURN result;
  END;
  $fn$;

  CREATE OR REPLACE FUNCTION audit_protect_insert()
  RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  BEGIN
    NEW.data := audit_safe_event(NEW.data);
    RETURN NEW;
  END;
  $fn$;

  CREATE OR REPLACE FUNCTION audit_changes(before_row JSONB, after_row JSONB, field_path TEXT DEFAULT '', depth INTEGER DEFAULT 0)
  RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $fn$
  DECLARE
    result JSONB := '[]'::jsonb;
    key_name TEXT;
    next_path TEXT;
  BEGIN
    IF before_row IS NOT DISTINCT FROM after_row THEN RETURN result; END IF;
    IF depth < 8 AND NOT audit_sensitive_key(field_path)
      AND (before_row IS NULL OR jsonb_typeof(before_row) = 'object')
      AND (after_row IS NULL OR jsonb_typeof(after_row) = 'object') THEN
      FOR key_name IN
        SELECT jsonb_object_keys(COALESCE(before_row, '{}'::jsonb))
        UNION SELECT jsonb_object_keys(COALESCE(after_row, '{}'::jsonb))
        ORDER BY 1
      LOOP
        IF key_name IN ('updated_at', 'updatedAt', 'atualizado_em') THEN CONTINUE; END IF;
        IF depth = 0 AND key_name IN ('created_at', 'tenant_id') THEN CONTINUE; END IF;
        next_path := CASE WHEN field_path = '' THEN key_name ELSE field_path || '.' || key_name END;
        result := result || audit_changes(before_row->key_name, after_row->key_name, next_path, depth + 1);
      END LOOP;
      RETURN result;
    END IF;
    RETURN jsonb_build_array(jsonb_build_object(
      'campo', field_path,
      'valor_anterior', audit_display(before_row, field_path),
      'valor_novo', audit_display(after_row, field_path)
    ));
  END;
  $fn$;

  CREATE OR REPLACE FUNCTION audit_module(table_name TEXT)
  RETURNS TEXT LANGUAGE sql IMMUTABLE AS $fn$
    SELECT CASE
      WHEN table_name IN ('contas_receber','contas_pagar','contas_bancarias','plano_contas','centros_custo','transferencias','extrato_bancario','cartoes_corp') THEN 'Financeiro'
      WHEN table_name IN ('config_fiscal','notas_fiscais') THEN 'Fiscal'
      WHEN table_name IN ('usuarios','membros','planos_comissao','comissoes','metas') THEN 'Equipe'
      WHEN table_name IN ('clientes','fornecedores_crm','vendas_crm','itens_venda','negociacao_anotacoes','negociacao_tarefas') THEN 'CRM'
      WHEN table_name IN ('propostas','templates_proposta','proposta_eventos_publicos','orcamentos') THEN 'Propostas'
      WHEN table_name LIKE 'grupo%' OR table_name IN ('gestao_grupos','voos_monitorados') THEN 'Grupos'
      WHEN table_name LIKE 'crm_eventos_%' OR table_name IN ('crm_config','config_apis') THEN 'Integrações'
      WHEN table_name LIKE 'support_%' THEN 'Suporte'
      WHEN table_name LIKE 'planejamento_%' OR table_name IN ('cac_mensal','cenarios_cac','fluxogramas','fluxograma_categorias','mapas_mentais') THEN 'Planejamento'
      WHEN table_name LIKE 'funis%' THEN 'Funis'
      WHEN table_name = 'notificacoes' THEN 'Notificações'
      WHEN table_name IN ('tenants','super_admins','tenant_usage','assinaturas','convites','convite_usos','planos','saas_config') THEN 'Administração'
      ELSE 'Configurações'
    END;
  $fn$;

  CREATE OR REPLACE FUNCTION audit_capture_row()
  RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  DECLARE
    previous_row JSONB;
    current_row JSONB;
    reference_row JSONB;
    context JSONB;
    changes JSONB;
    entry_id TEXT := 'aud_' || gen_random_uuid()::text;
    event_time TIMESTAMPTZ := clock_timestamp();
    event_action TEXT;
    row_tenant TEXT;
    row_id TEXT;
    row_name TEXT;
    module_name TEXT;
    event_source TEXT;
  BEGIN
    IF TG_OP <> 'INSERT' THEN previous_row := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN current_row := to_jsonb(NEW); END IF;
    changes := audit_changes(previous_row, current_row);
    -- No-op e updates exclusivos de timestamps não produzem falsos movimentos.
    IF TG_OP = 'UPDATE' AND changes = '[]'::jsonb
      AND previous_row->'tenant_id' IS NOT DISTINCT FROM current_row->'tenant_id' THEN RETURN NEW; END IF;

    context := COALESCE(NULLIF(current_setting('app.audit_context', true), ''), '{}')::jsonb;
    reference_row := COALESCE(current_row, previous_row);
    -- UPDATE/DELETE permanecem no tenant ORIGINAL, nunca no tenant do header.
    row_tenant := CASE WHEN TG_TABLE_NAME = 'tenants'
      THEN COALESCE(previous_row->>'id', current_row->>'id', '')
      ELSE COALESCE(NULLIF(previous_row->>'tenant_id',''), NULLIF(current_row->>'tenant_id',''), '__platform__') END;
    IF previous_row->'tenant_id' IS DISTINCT FROM current_row->'tenant_id' AND TG_OP = 'UPDATE' THEN
      changes := changes || jsonb_build_array(jsonb_build_object('campo', 'tenant_id',
        'valor_anterior', COALESCE(previous_row->>'tenant_id',''), 'valor_novo', COALESCE(current_row->>'tenant_id','')));
    END IF;
    row_id := COALESCE(reference_row->>'id', reference_row->>'key', '');
    row_name := COALESCE(NULLIF(reference_row->'data'->>'nome',''), NULLIF(reference_row->>'nome',''),
      NULLIF(reference_row->'data'->>'descricao',''), NULLIF(reference_row->>'titulo',''),
      NULLIF(reference_row->'data'->>'numero',''), NULLIF(reference_row->>'numero',''),
      NULLIF(reference_row->'data'->>'nome_fantasia',''), NULLIF(reference_row->>'nome_fantasia',''), row_id);
    row_name := left(audit_display(to_jsonb(row_name)), 200);
    module_name := audit_module(TG_TABLE_NAME);
    event_action := CASE TG_OP WHEN 'INSERT' THEN 'CRIAR' WHEN 'UPDATE' THEN 'EDITAR' ELSE 'EXCLUIR' END;
    event_source := CASE WHEN context->>'source' IN ('USUARIO','SISTEMA','INTEGRACAO','PUBLICO')
      THEN context->>'source' ELSE 'SISTEMA' END;

    INSERT INTO audit_log (id, tenant_id, usuario_id, acao, modulo, entidade, entidade_id, data, created_at)
    VALUES (entry_id, row_tenant, COALESCE(context->>'userId',''), event_action, module_name, TG_TABLE_NAME, row_id,
      jsonb_build_object(
        'id', entry_id, 'timestamp', to_char(event_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'usuario_id', COALESCE(context->>'userId',''), 'usuario_nome', COALESCE(NULLIF(context->>'userName',''),'Sistema'),
        'perfil', COALESCE(context->>'perfil','SISTEMA'), 'acao', event_action, 'modulo', module_name,
        'entidade', TG_TABLE_NAME, 'entidade_id', row_id, 'entidade_nome', row_name,
        'descricao', CASE TG_OP WHEN 'INSERT' THEN 'Criou ' WHEN 'UPDATE' THEN 'Alterou ' ELSE 'Excluiu ' END || replace(TG_TABLE_NAME,'_',' ') || ': ' || row_name,
        'alteracoes', changes, 'origem', event_source,
        'request_id', COALESCE(context->>'requestId',''), 'rota', COALESCE(context->>'path',''),
        'metodo', COALESCE(context->>'method',''), 'captura', 'BANCO'
      ), event_time);
    RETURN COALESCE(NEW, OLD);
  END;
  $fn$;

  CREATE OR REPLACE FUNCTION audit_deny_mutation()
  RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  BEGIN
    RAISE EXCEPTION 'O histórico de auditoria é imutável: operação % não permitida', TG_OP
      USING ERRCODE = '42501';
  END;
  $fn$;

  DO $install$
  DECLARE table_name TEXT; covered JSONB := '[]'::jsonb;
  BEGIN
    FOR table_name IN
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
        AND c.table_name NOT IN ('audit_log','api_cache','audit_config','grupo_eventos')
      UNION SELECT t.table_name FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_name IN ('tenants','super_admins','planos','saas_config','convites')
      ORDER BY 1
    LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', table_name)::regclass
        AND tgname = 'audit_capture_row_v1' AND NOT tgisinternal) THEN
        EXECUTE format('CREATE TRIGGER audit_capture_row_v1 AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION audit_capture_row()', table_name);
      END IF;
      covered := covered || to_jsonb(table_name);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND tgname = 'audit_log_immutable_v1') THEN
      CREATE TRIGGER audit_log_immutable_v1 BEFORE UPDATE OR DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_deny_mutation();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND tgname = 'audit_log_protect_insert_v1') THEN
      CREATE TRIGGER audit_log_protect_insert_v1 BEFORE INSERT ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_protect_insert();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND tgname = 'audit_log_no_truncate_v1') THEN
      CREATE TRIGGER audit_log_no_truncate_v1 BEFORE TRUNCATE ON audit_log
        FOR EACH STATEMENT EXECUTE FUNCTION audit_deny_mutation();
    END IF;
    INSERT INTO audit_config (id, data) VALUES ('capture-v1', jsonb_build_object('tables', covered, 'version', 1))
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;
  END;
  $install$;
`;
