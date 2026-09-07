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

    // NUNCA apagar conta que já movimentou dinheiro. Uma conta RECEBIDA sem
    // valor_final some daqui e o crédito correspondente fica órfão no saldo
    // bancário, sem nada que explique a diferença. Zumbi é registro que
    // nunca virou dinheiro; o resto é histórico.
    const STATUS_BAIXADOS = ['RECEBIDO', 'PARCIAL', 'PAGO'];

    const r1 = await pool.query(
      `DELETE FROM contas_receber
        WHERE tenant_id = $1 AND data->>'valor_final' IS NULL
          AND NOT (COALESCE(data->>'status', '') = ANY($2::text[]))`,
      [tenantId, STATUS_BAIXADOS],
    );
    counts.contas_receber_apagadas = r1.rowCount ?? 0;

    const r2 = await pool.query(
      `DELETE FROM contas_pagar
        WHERE tenant_id = $1 AND data->>'valor_final' IS NULL
          AND NOT (COALESCE(data->>'status', '') = ANY($2::text[]))`,
      [tenantId, STATUS_BAIXADOS],
    );
    counts.contas_pagar_apagadas = r2.rowCount ?? 0;

    // Venda só sai se não tiver sobrado nenhuma conta ligada a ela. Apagar a
    // venda deixando as contas quebra a rastreabilidade da conta até o cliente.
    const r3 = await pool.query(
      `DELETE FROM vendas_crm v
        WHERE v.tenant_id = $1 AND v.data->>'cliente_nome' IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM contas_receber cr
             WHERE cr.tenant_id = v.tenant_id AND cr.data->>'origem_venda_id' = v.id)
          AND NOT EXISTS (
            SELECT 1 FROM contas_pagar cp
             WHERE cp.tenant_id = v.tenant_id AND cp.data->>'origem_venda_id' = v.id)`,
      [tenantId],
    );
    counts.vendas_crm_apagadas = r3.rowCount ?? 0;

    // Chaves de idempotência NÃO são mais apagadas.
    //
    // Apagá-las era a parte mais perigosa desta rotina: liberava o CRM para
    // reenviar todo o histórico de VENDA_FECHADA, e cada reenvio criava uma
    // venda nova com contas próprias. Agora que a venda é identificada pelo
    // crm_venda_id, o reenvio atualiza a venda existente em vez de duplicar,
    // então não há motivo para descartar o histórico de eventos.
    counts.eventos_entrada_apagados = 0;

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
