import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

// Read-only audit endpoint. Surfaces the state of the CRM integration so we
// can diagnose "events not arriving" cases without touching the DB directly.
export async function GET(req: NextRequest) {
  try {
    if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();

    const proto = req.headers.get('x-forwarded-proto') || 'https';
    const host = req.headers.get('host') || '';
    const canonicaWebhookEntur = `${proto}://${host}/api/v1/crm/webhook/${tenantId}`;

    // --- config -----------------------------------------------------------
    const cfgRes = await pool.query(
      "SELECT data, updated_at FROM crm_config WHERE id = 'singleton' AND tenant_id = $1",
      [tenantId],
    );
    const cfgRow = cfgRes.rows[0];
    const cfg = cfgRow?.data ?? null;

    const config = cfg ? {
      ativo: cfg.ativo ?? false,
      circuit_breaker_status: cfg.circuit_breaker_status ?? 'fechado',
      webhook_url_entur_configurada: cfg.webhook_url_entur || null,
      webhook_url_entur_canonica: canonicaWebhookEntur,
      url_match: !!cfg.webhook_url_entur && cfg.webhook_url_entur === canonicaWebhookEntur,
      webhook_url_crm: cfg.webhook_url_crm || null,
      tem_secret: !!cfg.api_key_entur,
      secret_tail: cfg.api_key_entur
        ? '****' + String(cfg.api_key_entur).slice(-6)
        : null,
      secrets_em_sincronia: !!cfg.api_key_entur && cfg.api_key_entur === cfg.api_key_crm,
      retry_max: cfg.retry_max ?? 5,
      circuit_breaker_threshold: cfg.circuit_breaker_threshold ?? 10,
      atualizado_em: cfgRow?.updated_at ?? null,
    } : null;

    // --- contadores -------------------------------------------------------
    const counts: Record<string, number> = {};
    for (const [label, sql] of [
      ['entrada_total', `SELECT COUNT(*) FROM crm_eventos_entrada WHERE tenant_id = $1`],
      ['entrada_processadas', `SELECT COUNT(*) FROM crm_eventos_entrada WHERE tenant_id = $1 AND processado = true`],
      ['entrada_com_erro', `SELECT COUNT(*) FROM crm_eventos_entrada WHERE tenant_id = $1 AND erro IS NOT NULL`],
      ['saida_pendente', `SELECT COUNT(*) FROM crm_eventos_saida WHERE tenant_id = $1 AND status = 'PENDENTE'`],
      ['saida_falha', `SELECT COUNT(*) FROM crm_eventos_saida WHERE tenant_id = $1 AND status = 'FALHA'`],
      ['saida_enviado', `SELECT COUNT(*) FROM crm_eventos_saida WHERE tenant_id = $1 AND status = 'ENVIADO'`],
    ] as const) {
      const r = await pool.query(sql, [tenantId]);
      counts[label] = parseInt(r.rows[0].count, 10);
    }

    // --- amostras (ultimos 5 entrada / 5 saida) ---------------------------
    const ultEntrada = await pool.query(
      `SELECT id, tipo, status, processado, erro, created_at
         FROM crm_eventos_entrada
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 5`,
      [tenantId],
    );

    // Last VENDA_FECHADA payload (raw body the CRM sent). Critical to
    // compare against what the handler expects when contas don't show up.
    const ultVenda = await pool.query(
      `SELECT id, status, processado, erro, data, created_at
         FROM crm_eventos_entrada
        WHERE tenant_id = $1 AND tipo = 'VENDA_FECHADA'
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId],
    );
    const ultSaida = await pool.query(
      `SELECT id, tipo, status, tentativas, latencia_ms, created_at
         FROM crm_eventos_saida
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 5`,
      [tenantId],
    );

    // --- linhas zumbi remanescentes (sanity) -----------------------------
    const zr = await pool.query(
      `SELECT COUNT(*) FROM contas_receber WHERE tenant_id = $1 AND data->>'valor_final' IS NULL`,
      [tenantId],
    );
    const zp = await pool.query(
      `SELECT COUNT(*) FROM contas_pagar WHERE tenant_id = $1 AND data->>'valor_final' IS NULL`,
      [tenantId],
    );

    return NextResponse.json({
      tenant_id: tenantId,
      config,
      contagens: counts,
      ultimos_eventos_entrada: ultEntrada.rows,
      ultimos_eventos_saida: ultSaida.rows,
      ultima_venda_fechada: ultVenda.rows[0] ?? null,
      sanity: {
        contas_receber_sem_valor_final: parseInt(zr.rows[0].count, 10),
        contas_pagar_sem_valor_final: parseInt(zp.rows[0].count, 10),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
