/**
 * Número do título e "cadastrado por/em" (06/11/2026, E7).
 *
 * Cada conta a pagar ou a receber ganha um Nº sequencial por agência, único
 * entre pagar e receber, que nunca é reaproveitado (nem depois de excluir).
 *
 * Fica numa tabela À PARTE (titulos_numeros), ligada pelo id do título, e
 * não numa coluna das contas: assim
 *   - a numeração dos títulos que já existem não regrava nenhuma conta (sem
 *     milhares de "Alterou conta" no registro de atividades, sem passar pelo
 *     gatilho de período fechado);
 *   - o número sobrevive à exclusão (o título sai da tabela, a linha daqui
 *     fica) e a restauração, que volta o título com o mesmo id, encontra o
 *     mesmo número;
 *   - um título apagado de vez continua com o número "gasto".
 *
 * Quem dá o número é um gatilho AFTER INSERT nas duas tabelas: vale para
 * qualquer caminho que cria título (tela, venda, fatura, plataforma,
 * recorrência, importação). "Cadastrado por" vem do contexto da requisição
 * (app.audit_context, o mesmo do registro de atividades); sem contexto, fica
 * "Sistema".
 *
 * Os títulos de antes ganham número uma vez só (marco
 * `titulos_numeros_inicio`), em ordem de criação; quem cadastrou sai do
 * registro de atividades quando ele tem o "Criou".
 *
 * Tabelas de controle: fora do gatilho de auditoria.
 */
export const NUMERACAO_TITULOS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS titulos_numeracao (
    tenant_id TEXT PRIMARY KEY,
    ultimo BIGINT NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS titulos_numeros (
    tenant_id TEXT NOT NULL,
    tabela TEXT NOT NULL,
    id TEXT NOT NULL,
    numero BIGINT NOT NULL,
    cadastrado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cadastrado_por TEXT NOT NULL DEFAULT '',
    cadastrado_por_nome TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (tenant_id, tabela, id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_titulos_numeros_numero ON titulos_numeros(tenant_id, numero);
  CREATE TABLE IF NOT EXISTS marcos_de_migracao (
    chave TEXT PRIMARY KEY,
    em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE OR REPLACE FUNCTION fin_numerar_titulo() RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  DECLARE
    v_tenant TEXT := COALESCE(NEW.tenant_id, '');
    v_numero BIGINT;
    v_ctx JSONB;
  BEGIN
    -- Restauração (mesmo id) ou título que já tinha número: fica com o dele.
    IF EXISTS (SELECT 1 FROM titulos_numeros WHERE tenant_id = v_tenant AND tabela = TG_TABLE_NAME AND id = NEW.id) THEN
      RETURN NEW;
    END IF;
    BEGIN
      v_ctx := COALESCE(NULLIF(current_setting('app.audit_context', true), ''), '{}')::jsonb;
    EXCEPTION WHEN OTHERS THEN v_ctx := '{}'::jsonb;
    END;
    INSERT INTO titulos_numeracao (tenant_id, ultimo) VALUES (v_tenant, 1)
      ON CONFLICT (tenant_id) DO UPDATE SET ultimo = titulos_numeracao.ultimo + 1
      RETURNING ultimo INTO v_numero;
    INSERT INTO titulos_numeros (tenant_id, tabela, id, numero, cadastrado_em, cadastrado_por, cadastrado_por_nome)
      VALUES (v_tenant, TG_TABLE_NAME, NEW.id, v_numero, COALESCE(NEW.created_at, NOW()),
              COALESCE(v_ctx->>'userId', ''), COALESCE(v_ctx->>'userName', ''))
      ON CONFLICT (tenant_id, tabela, id) DO NOTHING;
    RETURN NEW;
  END;
  $fn$;

  DO $numeracao$
  DECLARE t TEXT;
  BEGIN
    FOREACH t IN ARRAY ARRAY['contas_pagar', 'contas_receber'] LOOP
      IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgrelid = format('public.%I', t)::regclass AND tgname = 'fin_numerar_titulo_v1' AND NOT tgisinternal
      ) THEN
        EXECUTE format('CREATE TRIGGER fin_numerar_titulo_v1 AFTER INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION fin_numerar_titulo()', t);
      END IF;
    END LOOP;

    IF to_regclass('public.contas_pagar') IS NOT NULL AND to_regclass('public.contas_receber') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM marcos_de_migracao WHERE chave = 'titulos_numeros_inicio') THEN
      -- Os de antes, em ordem de criação, depois do maior número já dado.
      WITH todos AS (
        SELECT COALESCE(tenant_id, '') AS tenant_id, 'contas_pagar'::text AS tabela, id, created_at FROM contas_pagar
        UNION ALL
        SELECT COALESCE(tenant_id, ''), 'contas_receber', id, created_at FROM contas_receber
      ), faltam AS (
        SELECT a.* FROM todos a
         WHERE NOT EXISTS (SELECT 1 FROM titulos_numeros n WHERE n.tenant_id = a.tenant_id AND n.tabela = a.tabela AND n.id = a.id)
      ), base AS (
        SELECT f.tenant_id, COALESCE(MAX(c.ultimo), 0) AS ultimo FROM faltam f
          LEFT JOIN titulos_numeracao c ON c.tenant_id = f.tenant_id
         GROUP BY f.tenant_id
      )
      INSERT INTO titulos_numeros (tenant_id, tabela, id, numero, cadastrado_em)
      SELECT f.tenant_id, f.tabela, f.id,
             b.ultimo + ROW_NUMBER() OVER (PARTITION BY f.tenant_id ORDER BY f.created_at, f.tabela, f.id),
             COALESCE(f.created_at, NOW())
        FROM faltam f JOIN base b ON b.tenant_id = f.tenant_id
      ON CONFLICT (tenant_id, tabela, id) DO NOTHING;

      INSERT INTO titulos_numeracao (tenant_id, ultimo)
      SELECT tenant_id, MAX(numero) FROM titulos_numeros GROUP BY tenant_id
      ON CONFLICT (tenant_id) DO UPDATE SET ultimo = GREATEST(titulos_numeracao.ultimo, EXCLUDED.ultimo);

      -- Quem cadastrou, quando o registro de atividades guardou o "Criou".
      IF to_regclass('public.audit_log') IS NOT NULL THEN
        UPDATE titulos_numeros n
           SET cadastrado_por = a.usuario_id, cadastrado_por_nome = COALESCE(a.data->>'usuario_nome', '')
          FROM (
            SELECT DISTINCT ON (tenant_id, entidade, entidade_id) tenant_id, entidade, entidade_id, usuario_id, data
              FROM audit_log
             WHERE acao = 'CRIAR' AND entidade IN ('contas_pagar', 'contas_receber')
             ORDER BY tenant_id, entidade, entidade_id, created_at
          ) a
         WHERE a.tenant_id = n.tenant_id AND a.entidade = n.tabela AND a.entidade_id = n.id
           AND n.cadastrado_por = '' AND COALESCE(a.usuario_id, '') <> '';
      END IF;

      INSERT INTO marcos_de_migracao (chave) VALUES ('titulos_numeros_inicio') ON CONFLICT DO NOTHING;
    END IF;
  END $numeracao$;
`;
