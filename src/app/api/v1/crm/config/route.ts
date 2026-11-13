import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { randomBytes } from 'crypto';

function suggestedWebhookUrl(req: NextRequest, tenantId: string): string {
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('host') || 'localhost';
  return `${proto}://${host}/api/v1/crm/webhook/${tenantId}`;
}

export async function GET(req: NextRequest) {
  try {
    if (!pool) return NextResponse.json(null);
    await initDB();
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      "SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1",
      [tenantId],
    );
    const suggested = suggestedWebhookUrl(req, tenantId);

    if (rows.length === 0) {
      return NextResponse.json({
        ativo: false,
        webhook_url_entur: suggested,
        webhook_url_crm: '',
        api_key_entur: '',
        api_key_crm: '',
        retry_max: 5,
        circuit_breaker_threshold: 10,
        circuit_breaker_status: 'fechado',
        tenant_id: tenantId,
        suggested_webhook_url_entur: suggested,
      });
    }

    const config = rows[0].data;
    return NextResponse.json({
      ...config,
      // Mask the secret on the wire — UI can request the raw value via ?reveal=1
      api_key_crm: config.api_key_crm
        ? '****' + String(config.api_key_crm).slice(-4)
        : '',
      api_key_entur: config.api_key_entur
        ? '****' + String(config.api_key_entur).slice(-4)
        : '',
      tenant_id: tenantId,
      suggested_webhook_url_entur: suggested,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();
    const body = await req.json();

    // Load existing config (if any) so we can preserve masked values.
    const { rows: existing } = await pool.query(
      "SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1",
      [tenantId],
    );
    const prev = existing[0]?.data ?? {};

    // Preserve secrets when UI sends back the masked placeholder.
    if (typeof body.api_key_crm === 'string' && body.api_key_crm.startsWith('****')) {
      body.api_key_crm = prev.api_key_crm ?? '';
    }
    if (typeof body.api_key_entur === 'string' && body.api_key_entur.startsWith('****')) {
      body.api_key_entur = prev.api_key_entur ?? '';
    }

    // The CRM uses a single hmacSecret for both directions; keep the two
    // local fields in sync. If only one was provided, mirror it. If neither
    // was provided and nothing exists yet, generate a fresh secret.
    if (!body.api_key_crm && body.api_key_entur) {
      body.api_key_crm = body.api_key_entur;
    } else if (body.api_key_crm && !body.api_key_entur) {
      body.api_key_entur = body.api_key_crm;
    } else if (!body.api_key_crm && !body.api_key_entur) {
      const fresh = prev.api_key_crm || randomBytes(32).toString('hex');
      body.api_key_crm = fresh;
      body.api_key_entur = fresh;
    }

    // Default the inbound webhook URL to the canonical multi-tenant path
    // when the UI didn't supply one (or sent a stale value).
    if (!body.webhook_url_entur) {
      body.webhook_url_entur = suggestedWebhookUrl(req, tenantId);
    }

    // Multi-tenant upsert (PK is composite (id, tenant_id)).
    const upsert = await pool.query(
      `UPDATE crm_config SET data = $2, updated_at = NOW()
       WHERE id = 'singleton' AND tenant_id = $1`,
      [tenantId, JSON.stringify(body)],
    );
    if (upsert.rowCount === 0) {
      await pool.query(
        `INSERT INTO crm_config (id, tenant_id, data, updated_at)
         VALUES ('singleton', $1, $2, NOW())`,
        [tenantId, JSON.stringify(body)],
      );
    }
    return NextResponse.json({ ok: true, tenant_id: tenantId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
