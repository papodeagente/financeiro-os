/**
 * Fechamento de período — o "Fechar Caixa" (05/11/2026).
 *
 * Fechar até uma data trava, NO BANCO, qualquer mudança de dinheiro com data
 * até ela: baixa, estorno, edição de valor/conta/data de título já baixado,
 * transferência efetivada, exclusão de conta baixada. Vale para a agência
 * inteira (conta_bancaria_id = '') ou só para uma conta. Mudar descrição ou
 * categoria de um título antigo continua livre.
 *
 * O gatilho só trabalha quando a agência tem algum período fechado: sem
 * fechamento, custo zero e comportamento de sempre.
 *
 * Reabrir exige motivo e fica registrado (periodos_eventos + auditoria).
 */
import type { ExecutorSQL } from './caixa-atomico';
import { addDias } from './money';

export const PERIODO_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS periodos_fechados (
    tenant_id TEXT NOT NULL,
    conta_bancaria_id TEXT NOT NULL DEFAULT '',
    fechado_ate DATE NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_por TEXT,
    PRIMARY KEY (tenant_id, conta_bancaria_id)
  );
  CREATE TABLE IF NOT EXISTS periodos_eventos (
    id BIGSERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conta_bancaria_id TEXT NOT NULL DEFAULT '',
    acao TEXT NOT NULL,
    de DATE,
    ate DATE,
    motivo TEXT,
    usuario_id TEXT,
    usuario_nome TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_periodos_eventos ON periodos_eventos(tenant_id, criado_em DESC);

  CREATE OR REPLACE FUNCTION fin_data_segura(p TEXT) RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $fn$
  BEGIN
    IF p IS NULL OR substring(p, 1, 10) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
    RETURN substring(p, 1, 10)::date;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
  $fn$;

  CREATE OR REPLACE FUNCTION fin_fechado_ate(p_tenant TEXT, p_conta TEXT) RETURNS DATE LANGUAGE sql STABLE AS $fn$
    SELECT MAX(fechado_ate) FROM periodos_fechados
     WHERE tenant_id = p_tenant AND conta_bancaria_id IN ('', COALESCE(p_conta, ''));
  $fn$;

  CREATE OR REPLACE FUNCTION fin_periodo_fechado(p_tenant TEXT, p_conta TEXT, p_data DATE) RETURNS BOOLEAN LANGUAGE sql STABLE AS $fn$
    SELECT p_data IS NOT NULL AND p_data <= COALESCE(fin_fechado_ate(p_tenant, p_conta), '0001-01-01'::date);
  $fn$;

  -- Quanto o título já recebeu/pagou (mesma regra do saldo: PARCIAL pelo acumulado).
  CREATE OR REPLACE FUNCTION fin_valor_baixado(p_tabela TEXT, d JSONB) RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $fn$
  DECLARE campo TEXT := CASE WHEN p_tabela = 'contas_receber' THEN 'valor_recebido' ELSE 'valor_pago' END;
          v NUMERIC; f NUMERIC;
  BEGIN
    IF d IS NULL THEN RETURN 0; END IF;
    v := CASE WHEN COALESCE(d->>campo, '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (d->>campo)::numeric ELSE 0 END;
    f := CASE WHEN COALESCE(d->>'valor_final', '') ~ '^-?[0-9]+([.][0-9]+)?$' THEN (d->>'valor_final')::numeric ELSE 0 END;
    IF d->>'status' = 'PARCIAL' THEN RETURN v; END IF;
    IF d->>'status' IN ('RECEBIDO', 'PAGO') THEN RETURN CASE WHEN v <> 0 THEN v ELSE f END; END IF;
    RETURN 0;
  END;
  $fn$;

  CREATE OR REPLACE FUNCTION fin_trava_periodo() RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
  DECLARE
    v_tenant TEXT := COALESCE(NEW.tenant_id, OLD.tenant_id);
    campo_data TEXT;
    o_data DATE; n_data DATE; o_conta TEXT; n_conta TEXT; o_conta2 TEXT; n_conta2 TEXT;
    o_val NUMERIC := 0; n_val NUMERIC := 0; o_din JSONB; n_din JSONB;
    o_fech BOOLEAN := false; n_fech BOOLEAN := false; v_ate DATE; v_estorno DATE;
    v_fechado_val NUMERIC := 0; v_fechado_conta TEXT;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM periodos_fechados WHERE tenant_id = v_tenant) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_TABLE_NAME IN ('contas_receber', 'contas_pagar') THEN
      campo_data := CASE WHEN TG_TABLE_NAME = 'contas_receber' THEN 'data_recebimento' ELSE 'data_pagamento' END;
      IF TG_OP <> 'INSERT' THEN
        o_val := fin_valor_baixado(TG_TABLE_NAME, OLD.data);
        o_data := CASE WHEN o_val <> 0 THEN fin_data_segura(OLD.data->>campo_data) END;
        o_conta := OLD.data->>'conta_bancaria_id';
        o_fech := o_data IS NOT NULL AND fin_periodo_fechado(v_tenant, o_conta, o_data);
        o_din := jsonb_build_object('s', OLD.data->'status', 'v', o_val, 'f', OLD.data->'valor_final',
          'c', OLD.data->'conta_bancaria_id', 'dt', OLD.data->campo_data, 'j', OLD.data->'juros',
          'm', OLD.data->'multa', 'd', OLD.data->'desconto', 't', OLD.data->'taxa');
      END IF;
      IF TG_OP <> 'DELETE' THEN
        n_val := fin_valor_baixado(TG_TABLE_NAME, NEW.data);
        n_data := CASE WHEN n_val <> 0 THEN fin_data_segura(NEW.data->>campo_data) END;
        n_conta := NEW.data->>'conta_bancaria_id';
        n_fech := n_data IS NOT NULL AND fin_periodo_fechado(v_tenant, n_conta, n_data);
        n_din := jsonb_build_object('s', NEW.data->'status', 'v', n_val, 'f', NEW.data->'valor_final',
          'c', NEW.data->'conta_bancaria_id', 'dt', NEW.data->campo_data, 'j', NEW.data->'juros',
          'm', NEW.data->'multa', 'd', NEW.data->'desconto', 't', NEW.data->'taxa');
      END IF;

      IF TG_OP = 'INSERT' THEN
        IF n_fech THEN v_ate := fin_fechado_ate(v_tenant, n_conta); RAISE EXCEPTION 'PERIODO_FECHADO:%', v_ate USING ERRCODE = 'P0001'; END IF;
        RETURN NEW;
      END IF;
      -- Dinheiro que o histórico de baixas registra em datas fechadas: o
      -- título guarda só a data da ÚLTIMA baixa, então uma parcela antiga
      -- fechada só aparece aqui.
      IF to_regclass('public.baixas') IS NOT NULL THEN
        SELECT COALESCE(SUM(b.valor_centavos), 0) / 100.0, MIN(b.conta_bancaria_id)
          INTO v_fechado_val, v_fechado_conta
          FROM baixas b
         WHERE b.tenant_id = v_tenant AND b.titulo_tabela = TG_TABLE_NAME AND b.titulo_id = OLD.id
           AND b.tipo IN ('baixa', 'anterior', 'legada')
           AND NOT EXISTS (SELECT 1 FROM baixas e WHERE e.tenant_id = b.tenant_id AND e.estorna_baixa_id = b.id)
           AND fin_periodo_fechado(v_tenant, b.conta_bancaria_id, b.data_baixa);
      END IF;
      IF TG_OP = 'DELETE' THEN
        IF o_fech OR v_fechado_val > 0 THEN v_ate := fin_fechado_ate(v_tenant, o_conta); RAISE EXCEPTION 'PERIODO_FECHADO:%', v_ate USING ERRCODE = 'P0001'; END IF;
        RETURN OLD;
      END IF;
      IF o_din IS NOT DISTINCT FROM n_din THEN RETURN NEW; END IF;
      -- Nunca abaixo do que foi pago em datas fechadas, nem mudando a conta delas.
      IF v_fechado_val > 0 AND (n_val < v_fechado_val - 0.005 OR n_conta IS DISTINCT FROM o_conta) THEN
        v_ate := fin_fechado_ate(v_tenant, COALESCE(v_fechado_conta, o_conta)); RAISE EXCEPTION 'PERIODO_FECHADO:%', v_ate USING ERRCODE = 'P0001';
      END IF;
      -- Estorno de uma baixa de data ABERTA (a liquidação avisa a data em
      -- fin.estorno_data): passa, mesmo que a data do título volte para a de
      -- uma baixa anterior já fechada.
      v_estorno := fin_data_segura(NULLIF(current_setting('fin.estorno_data', true), ''));
      IF v_estorno IS NOT NULL AND n_val < o_val AND n_conta IS NOT DISTINCT FROM o_conta
         AND NOT fin_periodo_fechado(v_tenant, o_conta, v_estorno) THEN
        RETURN NEW;
      END IF;
      -- Data nova num período fechado: nunca.
      IF n_fech AND (n_data IS DISTINCT FROM o_data OR n_val <> o_val OR n_conta IS DISTINCT FROM o_conta OR NOT o_fech) THEN
        v_ate := fin_fechado_ate(v_tenant, n_conta); RAISE EXCEPTION 'PERIODO_FECHADO:%', v_ate USING ERRCODE = 'P0001';
      END IF;
      -- O título tem dinheiro num período fechado: só pode receber mais
      -- dinheiro depois, na mesma conta. Diminuir só no estorno de uma baixa
      -- de data aberta (a liquidação avisa a data em fin.estorno_data).
      IF o_fech THEN
        IF n_conta IS DISTINCT FROM o_conta
           OR n_val < o_val
           OR (n_val >= o_val AND n_data IS NOT NULL AND n_data < o_data) THEN
          v_ate := fin_fechado_ate(v_tenant, o_conta); RAISE EXCEPTION 'PERIODO_FECHADO:%', v_ate USING ERRCODE = 'P0001';
        END IF;
      END IF;
      RETURN NEW;
    ELSIF TG_TABLE_NAME = 'transferencias' THEN
      IF TG_OP <> 'INSERT' THEN
        o_data := CASE WHEN OLD.data->>'status' = 'EFETIVADA'
                       THEN fin_data_segura(COALESCE(NULLIF(OLD.data->>'data_efetivacao', ''), OLD.data->>'data')) END;
        o_conta := OLD.data->>'conta_origem_id'; o_conta2 := OLD.data->>'conta_destino_id';
        o_din := jsonb_build_object('s', OLD.data->'status', 'v', OLD.data->'valor', 'o', OLD.data->'conta_origem_id',
          'd', OLD.data->'conta_destino_id', 'de', OLD.data->'data_efetivacao', 'dt', OLD.data->'data');
      END IF;
      IF TG_OP <> 'DELETE' THEN
        n_data := CASE WHEN NEW.data->>'status' = 'EFETIVADA'
                       THEN fin_data_segura(COALESCE(NULLIF(NEW.data->>'data_efetivacao', ''), NEW.data->>'data')) END;
        n_conta := NEW.data->>'conta_origem_id'; n_conta2 := NEW.data->>'conta_destino_id';
        n_din := jsonb_build_object('s', NEW.data->'status', 'v', NEW.data->'valor', 'o', NEW.data->'conta_origem_id',
          'd', NEW.data->'conta_destino_id', 'de', NEW.data->'data_efetivacao', 'dt', NEW.data->'data');
      END IF;
    ELSIF TG_TABLE_NAME = 'baixas' THEN
      IF TG_OP = 'INSERT' THEN
        n_data := NEW.data_baixa; n_conta := NEW.conta_bancaria_id; n_din := '{}'::jsonb;
        -- Estorno: vale a data da baixa estornada.
        IF NEW.estorna_baixa_id IS NOT NULL THEN
          SELECT data_baixa, conta_bancaria_id INTO n_data, n_conta FROM baixas
           WHERE tenant_id = NEW.tenant_id AND id = NEW.estorna_baixa_id;
        END IF;
        IF NEW.tipo IN ('anterior', 'legada') THEN RETURN NEW; END IF;
      ELSE
        o_data := OLD.data_baixa; o_conta := OLD.conta_bancaria_id; o_din := '{"x":1}'::jsonb;
        IF TG_OP = 'UPDATE' THEN n_din := '{}'::jsonb; END IF;
      END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND o_din IS NOT DISTINCT FROM n_din THEN
      RETURN NEW;
    END IF;
    IF (o_data IS NOT NULL AND (fin_periodo_fechado(v_tenant, o_conta, o_data) OR fin_periodo_fechado(v_tenant, o_conta2, o_data)))
       OR (n_data IS NOT NULL AND (fin_periodo_fechado(v_tenant, n_conta, n_data) OR fin_periodo_fechado(v_tenant, n_conta2, n_data))) THEN
      v_ate := GREATEST(fin_fechado_ate(v_tenant, COALESCE(n_conta, o_conta)), fin_fechado_ate(v_tenant, COALESCE(n_conta2, o_conta2)));
      RAISE EXCEPTION 'PERIODO_FECHADO:%', v_ate USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END;
  $fn$;

  DO $inst$
  DECLARE t TEXT;
  BEGIN
    FOREACH t IN ARRAY ARRAY['contas_receber', 'contas_pagar', 'transferencias', 'baixas'] LOOP
      IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass AND tgname = 'fin_trava_periodo_v1'
      ) THEN
        EXECUTE format('CREATE TRIGGER fin_trava_periodo_v1 BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION fin_trava_periodo()', t);
      END IF;
    END LOOP;
  END
  $inst$;
`;

/** Erro de período fechado vindo do banco? Devolve a data até onde está fechado. */
export function periodoFechadoDoErro(e: unknown): string | null {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const m = /PERIODO_FECHADO:(\d{4}-\d{2}-\d{2})/.exec(msg);
  return m ? m[1] : null;
}

export function mensagemPeriodoFechado(ate: string): string {
  const [a, m, d] = ate.split('-');
  return `O caixa está fechado até ${d}/${m}/${a}. Para mexer em dinheiro dessa data, reabra o período (Financeiro › Fechar Caixa).`;
}

/** Até quando a agência (ou a conta) está fechada; null se não há fechamento. */
export async function fechadoAte(exec: ExecutorSQL, tenantId: string, contaId?: string | null): Promise<string | null> {
  // Perguntar se a tabela existe nunca dá erro; consultar uma função que não
  // existe daria, e dentro de uma transação isso a envenenaria inteira.
  const { rows: tem } = await exec.query(`SELECT to_regprocedure('fin_fechado_ate(text,text)') IS NOT NULL AS ok`);
  if (!tem[0]?.ok) return null;
  const { rows } = await exec.query(`SELECT fin_fechado_ate($1, $2)::text AS d`, [tenantId, contaId ?? '']);
  return (rows[0]?.d as string | null) ?? null;
}

/**
 * Data que uma INTEGRAÇÃO (CRM, plataforma) pode usar: se a data do
 * pagamento cai num período fechado, o lançamento vai para o dia seguinte
 * ao fechamento — a integração nunca falha por causa disso. A data original
 * fica guardada no próprio título por quem chamou.
 */
export async function dataForaDoFechamento(exec: ExecutorSQL, tenantId: string, contaId: string | null, data: string): Promise<string> {
  try {
    const ate = await fechadoAte(exec, tenantId, contaId);
    if (ate && data.slice(0, 10) <= ate) return addDias(ate, 1);
  } catch {
    /* sem o esquema ainda: usa a data pedida */
  }
  return data.slice(0, 10);
}

export interface PeriodoFechado { conta_bancaria_id: string; fechado_ate: string; atualizado_em: string; atualizado_por: string | null }

export async function listarPeriodos(exec: ExecutorSQL, tenantId: string): Promise<{ periodos: PeriodoFechado[]; eventos: Record<string, unknown>[] }> {
  const [{ rows: p }, { rows: e }] = await Promise.all([
    exec.query(`SELECT conta_bancaria_id, fechado_ate::text AS fechado_ate, atualizado_em::text AS atualizado_em, atualizado_por
                  FROM periodos_fechados WHERE tenant_id = $1 ORDER BY conta_bancaria_id`, [tenantId]),
    exec.query(`SELECT conta_bancaria_id, acao, de::text AS de, ate::text AS ate, motivo, usuario_nome, criado_em::text AS criado_em
                  FROM periodos_eventos WHERE tenant_id = $1 ORDER BY criado_em DESC LIMIT 100`, [tenantId]),
  ]);
  return { periodos: p as unknown as PeriodoFechado[], eventos: e };
}

/** Fecha até `ate` (só avança; para voltar use reabrir). */
export async function fecharPeriodo(
  exec: ExecutorSQL,
  p: { tenantId: string; contaId?: string | null; ate: string; usuarioId?: string; usuarioNome?: string },
): Promise<void> {
  const conta = p.contaId ?? '';
  const { rows } = await exec.query(
    `SELECT fechado_ate::text AS d FROM periodos_fechados WHERE tenant_id = $1 AND conta_bancaria_id = $2`,
    [p.tenantId, conta],
  );
  const antes = (rows[0]?.d as string | undefined) ?? null;
  if (antes && p.ate <= antes) throw new Error(`Já está fechado até ${antes.split('-').reverse().join('/')}.`);
  await exec.query(
    `INSERT INTO periodos_fechados (tenant_id, conta_bancaria_id, fechado_ate, atualizado_por)
     VALUES ($1, $2, $3::date, $4)
     ON CONFLICT (tenant_id, conta_bancaria_id) DO UPDATE SET fechado_ate = EXCLUDED.fechado_ate, atualizado_em = NOW(), atualizado_por = EXCLUDED.atualizado_por`,
    [p.tenantId, conta, p.ate, p.usuarioNome ?? p.usuarioId ?? null],
  );
  await exec.query(
    `INSERT INTO periodos_eventos (tenant_id, conta_bancaria_id, acao, de, ate, usuario_id, usuario_nome) VALUES ($1, $2, 'FECHAR', $3::date, $4::date, $5, $6)`,
    [p.tenantId, conta, antes, p.ate, p.usuarioId ?? null, p.usuarioNome ?? null],
  );
}

/** Reabre: volta o fechamento para `ate` (ou abre tudo, se null). Motivo obrigatório. */
export async function reabrirPeriodo(
  exec: ExecutorSQL,
  p: { tenantId: string; contaId?: string | null; ate: string | null; motivo: string; usuarioId?: string; usuarioNome?: string },
): Promise<void> {
  const motivo = (p.motivo ?? '').trim();
  if (motivo.length < 5) throw new Error('Explique o motivo da reabertura (pelo menos 5 letras).');
  const conta = p.contaId ?? '';
  const { rows } = await exec.query(
    `SELECT fechado_ate::text AS d FROM periodos_fechados WHERE tenant_id = $1 AND conta_bancaria_id = $2`,
    [p.tenantId, conta],
  );
  const antes = (rows[0]?.d as string | undefined) ?? null;
  if (!antes) throw new Error('Este período não está fechado.');
  if (p.ate && p.ate >= antes) throw new Error('Para reabrir, escolha uma data anterior ao fechamento atual.');
  if (p.ate) {
    await exec.query(`UPDATE periodos_fechados SET fechado_ate = $3::date, atualizado_em = NOW(), atualizado_por = $4 WHERE tenant_id = $1 AND conta_bancaria_id = $2`,
      [p.tenantId, conta, p.ate, p.usuarioNome ?? p.usuarioId ?? null]);
  } else {
    await exec.query(`DELETE FROM periodos_fechados WHERE tenant_id = $1 AND conta_bancaria_id = $2`, [p.tenantId, conta]);
  }
  await exec.query(
    `INSERT INTO periodos_eventos (tenant_id, conta_bancaria_id, acao, de, ate, motivo, usuario_id, usuario_nome) VALUES ($1, $2, 'REABRIR', $3::date, $4::date, $5, $6, $7)`,
    [p.tenantId, conta, antes, p.ate, motivo, p.usuarioId ?? null, p.usuarioNome ?? null],
  );
}
