import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';

// One-shot cleanup of CRM-imported rows written by the OLD VENDA_FECHADA
// handler (before the JSONB-shape fix). Identifies records by the absence
// of fields the new handler always writes:
//   - contas_receber/pagar:  data->>'valor_final' IS NULL
//   - vendas_crm:            data->>'cliente_nome' IS NULL
//
// Idempotent — running it again on a clean DB is a no-op (zero rows match).
// Auth: requires session (tenant scope), so the caller must be logged in.
export async function POST() {
  try {
    if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();

    const counts: Record<string, number> = {};

    const r1 = await pool.query(
      `DELETE FROM contas_receber
        WHERE tenant_id = $1 AND data->>'valor_final' IS NULL`,
      [tenantId],
    );
    counts.contas_receber_apagadas = r1.rowCount ?? 0;

    const r2 = await pool.query(
      `DELETE FROM contas_pagar
        WHERE tenant_id = $1 AND data->>'valor_final' IS NULL`,
      [tenantId],
    );
    counts.contas_pagar_apagadas = r2.rowCount ?? 0;

    const r3 = await pool.query(
      `DELETE FROM vendas_crm
        WHERE tenant_id = $1 AND data->>'cliente_nome' IS NULL`,
      [tenantId],
    );
    counts.vendas_crm_apagadas = r3.rowCount ?? 0;

    // Free idempotency keys for old VENDA_FECHADA so the CRM may resend.
    // 5 min margin to protect events freshly handled by the new code.
    const r4 = await pool.query(
      `DELETE FROM crm_eventos_entrada
        WHERE tenant_id = $1
          AND tipo = 'VENDA_FECHADA'
          AND created_at < NOW() - INTERVAL '5 minutes'`,
      [tenantId],
    );
    counts.eventos_entrada_apagados = r4.rowCount ?? 0;

    // Outbound events that were emitted before the CRM config existed —
    // they have no destination. Mark as FAILED to clear the "pending"
    // counter without losing the audit trail.
    const r5 = await pool.query(
      `UPDATE crm_eventos_saida
          SET status = 'FALHA', updated_at = NOW()
        WHERE tenant_id = $1
          AND status = 'PENDENTE'
          AND created_at < NOW() - INTERVAL '5 minutes'`,
      [tenantId],
    );
    counts.eventos_saida_marcados_falha = r5.rowCount ?? 0;

    return NextResponse.json({ ok: true, tenant_id: tenantId, counts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
