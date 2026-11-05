import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { normalizarPolitica, type PoliticaCobranca } from '@/lib/baixa-calculo';

// Configurações › Financeiro (05/11/2026): juros, multa, tolerância e
// desconto por antecipação que a liquidação SUGERE. A pessoa sempre pode
// mudar o valor na hora de liquidar. Grava só esta chave no cadastro da
// agência, sem tocar o resto.
export const dynamic = 'force-dynamic';

export async function GET() {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ politica_cobranca: null });
  const tenantId = await getTenantId();
  const { rows } = await pool.query(
    `SELECT data->'politica_cobranca' AS p FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  return NextResponse.json({ politica_cobranca: rows[0]?.p ?? null });
}

export async function PUT(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => ({}))) as { politica_cobranca?: Partial<PoliticaCobranca> };
  const politica = normalizarPolitica(corpo.politica_cobranca);
  const tenantId = await getTenantId();
  const { rows } = await pool.query(
    `SELECT id FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`,
    [tenantId],
  );
  if (rows.length) {
    await pool.query(
      `UPDATE agencia SET data = jsonb_set(data, '{politica_cobranca}', $3::jsonb, true), updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [rows[0].id, tenantId, JSON.stringify(politica)],
    );
  } else {
    await pool.query(
      `INSERT INTO agencia (id, tenant_id, data, updated_at) VALUES ($1, $2, $3::jsonb, NOW())`,
      [`agencia-${tenantId}`, tenantId, JSON.stringify({ politica_cobranca: politica })],
    );
  }
  return NextResponse.json({ politica_cobranca: politica });
}
