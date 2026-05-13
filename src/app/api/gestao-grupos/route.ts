import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { GrupoViagem } from '@/lib/types';
import type { PeriodoVagasData, GestaoGrupoData } from '@/lib/gestao-grupos';

// GET /api/gestao-grupos
// Lista todos os grupos do tenant com resumo de vagas/reservas/materiais.
// Inclui grupos que ainda não têm registro de gestão (vão vazios mas
// aparecem — útil para o operador identificar quais precisam de bootstrap).
export async function GET() {
  if (!pool) return NextResponse.json([]);
  await initDB();
  const tenantId = await getTenantId();

  const { rows } = await pool.query(
    `SELECT
       g.id,
       g.data AS grupo_data,
       g.updated_at,
       gg.data AS gestao_data,
       gg.status AS gestao_status,
       (
         SELECT COALESCE(JSONB_AGG(pv.data ORDER BY pv.periodo_index), '[]'::jsonb)
           FROM grupo_periodos_vagas pv
          WHERE pv.grupo_id = g.id AND pv.tenant_id = g.tenant_id
       ) AS periodos,
       (
         SELECT COUNT(*)::int FROM grupo_reservas r
          WHERE r.grupo_id = g.id AND r.tenant_id = g.tenant_id
            AND r.status IN ('reservado', 'lista_espera')
       ) AS reservas,
       (
         SELECT COUNT(*)::int FROM grupo_reservas r
          WHERE r.grupo_id = g.id AND r.tenant_id = g.tenant_id
            AND r.status = 'confirmado'
       ) AS confirmadas,
       (
         SELECT COUNT(*)::int FROM grupo_materiais m
          WHERE m.grupo_id = g.id AND m.tenant_id = g.tenant_id
            AND (m.data->>'removido') IS DISTINCT FROM 'true'
       ) AS materiais
     FROM grupos g
     LEFT JOIN gestao_grupos gg ON gg.grupo_id = g.id AND gg.tenant_id = g.tenant_id
     WHERE g.tenant_id = $1
     ORDER BY g.updated_at DESC`,
    [tenantId],
  );

  const lista = rows.map(r => {
    const grupo = r.grupo_data as GrupoViagem;
    const periodos = (r.periodos as PeriodoVagasData[]) || [];
    const totalVagas = periodos.reduce((s, p) => s + (p.vagas_total || 0), 0);
    const ocupadas = periodos.reduce((s, p) => s + (p.vagas_reservadas || 0) + (p.vagas_confirmadas || 0), 0);
    const disponiveis = periodos.reduce((s, p) => s + (p.vagas_disponiveis || 0), 0);
    const config = (r.gestao_data as GestaoGrupoData | null)?.config_vagas;

    const dataInicio = grupo.periodos?.[0]?.check_in || '';
    const dataFim = grupo.periodos?.[grupo.periodos.length - 1]?.check_out || '';

    return {
      id: r.id,
      grp_id: grupo.grp_id || '',
      origem_destino: grupo.origem_destino || '',
      status_pipeline: grupo.status_pipeline || 'PRODUTO',
      gestao_status: r.gestao_status || null,
      data_inicio: dataInicio,
      data_fim: dataFim,
      periodos_count: periodos.length,
      vagas: {
        total: totalVagas,
        ocupadas,
        disponiveis,
        reservadas: periodos.reduce((s, p) => s + (p.vagas_reservadas || 0), 0),
        confirmadas: periodos.reduce((s, p) => s + (p.vagas_confirmadas || 0), 0),
      },
      reservas: r.reservas as number,
      confirmadas: r.confirmadas as number,
      materiais: r.materiais as number,
      alerta_vagas_restantes: config?.alerta_vagas_restantes ?? 5,
      updated_at: r.updated_at,
    };
  });

  return NextResponse.json(lista);
}
