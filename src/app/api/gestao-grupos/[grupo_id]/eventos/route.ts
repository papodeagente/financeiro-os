import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { EventoData, EventoTipo } from '@/lib/gestao-grupos';

// GET /api/gestao-grupos/[grupo_id]/eventos?limit=100&tipo=
//
// Timeline cronológica reversa do grupo. Não permite POST direto —
// eventos são gravados pelas APIs que mexem em dados (via helper
// registrarEvento).
export async function GET(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ eventos: [] });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200') || 200, 500);
  const tipoFiltro = url.searchParams.get('tipo') || '';

  const wheres = ['grupo_id = $1', 'tenant_id = $2'];
  const params_: unknown[] = [grupo_id, tenantId];
  if (tipoFiltro) { params_.push(tipoFiltro); wheres.push(`tipo = $${params_.length}`); }
  params_.push(limit);

  const { rows } = await pool.query(
    `SELECT id, tipo, data, created_at
       FROM grupo_eventos
      WHERE ${wheres.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params_.length}`,
    params_,
  );

  const eventos = rows.map(r => ({
    id: r.id,
    grupo_id,
    tipo: r.tipo as EventoTipo,
    ...(r.data as EventoData),
    created_at: r.created_at,
  }));

  return NextResponse.json({ eventos });
}
