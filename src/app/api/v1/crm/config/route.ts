import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

export async function GET() {
  try {
    if (!pool) return NextResponse.json(null);
    await initDB();
    const tenantId = await getTenantId();
    const { rows } = await pool.query("SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1", [tenantId]);
    if (rows.length === 0) return NextResponse.json(null);
    const config = rows[0].data;
    // Mask api_key_crm
    if (config.api_key_crm && config.api_key_crm.length > 4) {
      config.api_key_crm = '****' + config.api_key_crm.slice(-4);
    }
    return NextResponse.json(config);
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

    // If api_key_crm is masked, preserve existing value
    if (body.api_key_crm && body.api_key_crm.startsWith('****')) {
      const { rows } = await pool.query("SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1", [tenantId]);
      if (rows.length > 0) {
        body.api_key_crm = rows[0].data.api_key_crm;
      }
    }

    await pool.query(
      `INSERT INTO crm_config (id, tenant_id, data, updated_at) VALUES ('singleton', $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
      [tenantId, JSON.stringify(body)]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
