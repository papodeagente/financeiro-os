import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

// Returns the plaintext HMAC secret for this tenant. Separate endpoint
// so the masked main GET is what the page renders by default and the
// reveal action is a deliberate, auditable click.
export async function GET() {
  try {
    if (!pool) return NextResponse.json({ secret: '' });
    await initDB();
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      "SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1",
      [tenantId],
    );
    if (rows.length === 0) return NextResponse.json({ secret: '' });
    const data = rows[0].data;
    return NextResponse.json({
      secret: (data.api_key_crm || data.api_key_entur || '') as string,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
