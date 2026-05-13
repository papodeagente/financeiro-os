import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { PeriodoVagasData } from '@/lib/gestao-grupos';

// PUT /api/gestao-grupos/[grupo_id]/vagas/[periodo_id]
// Atualiza vagas_total do período. Mantém os contadores reservadas/
// confirmadas calculados (recalcula vagas_disponiveis). Valida que
// vagas_total >= reservadas + confirmadas.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; periodo_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, periodo_id } = await params;
  const body = await req.json();

  const novoTotal = Math.max(0, Math.floor(Number(body.vagas_total) || 0));

  const { rows } = await pool.query(
    `SELECT id, data FROM grupo_periodos_vagas
     WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3 LIMIT 1`,
    [periodo_id, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Período não encontrado' }, { status: 404 });

  const atual = rows[0].data as PeriodoVagasData;
  const ocupadas = (atual.vagas_reservadas || 0) + (atual.vagas_confirmadas || 0);
  if (novoTotal < ocupadas) {
    return NextResponse.json({
      error: `Não é possível reduzir abaixo de ${ocupadas} (vagas já ocupadas: ${atual.vagas_reservadas} reservadas + ${atual.vagas_confirmadas} confirmadas)`,
    }, { status: 400 });
  }

  const atualizado: PeriodoVagasData = {
    ...atual,
    vagas_total: novoTotal,
    vagas_disponiveis: novoTotal - ocupadas,
  };
  await pool.query(
    `UPDATE grupo_periodos_vagas SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(atualizado), periodo_id, tenantId],
  );

  return NextResponse.json({ id: periodo_id, ...atualizado });
}
