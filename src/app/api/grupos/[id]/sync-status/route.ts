import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

// GET status de sincronizacao do produto com o CRM.
// Retorna o ultimo evento PRODUTO_PUBLICADO emitido para o grupo,
// permitindo a UI mostrar se foi ENVIADO/PENDENTE/FALHA e quando.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();
    const { id: grupoId } = await params;

    // Busca o ultimo PRODUTO_PUBLICADO que tem este grupo_id no payload
    const { rows } = await pool.query(
      `SELECT id, status, tentativas, latencia_ms, proxima_tentativa, data, created_at, updated_at
         FROM crm_eventos_saida
        WHERE tenant_id = $1
          AND tipo = 'PRODUTO_PUBLICADO'
          AND data->'payload'->>'grupo_id' = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId, grupoId],
    );

    // Tambem verifica se ha config CRM ativa
    const cfgRes = await pool.query(
      "SELECT data FROM crm_config WHERE id = 'singleton' AND tenant_id = $1",
      [tenantId],
    );
    const cfg = cfgRes.rows[0]?.data;
    const crmConfigured = !!cfg?.ativo && !!cfg?.api_key_crm && !!cfg?.webhook_url_crm;
    const circuitOpen = cfg?.circuit_breaker_status === 'aberto';

    return NextResponse.json({
      grupo_id: grupoId,
      tenant_id: tenantId,
      crm_configured: crmConfigured,
      circuit_open: circuitOpen,
      ultimo_evento: rows[0] ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
