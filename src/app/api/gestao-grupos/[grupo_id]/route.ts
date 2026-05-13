import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { ensureGestaoGrupo, KANBAN_STAGES, type GestaoGrupoData, type KanbanStage, type PeriodoVagasData } from '@/lib/gestao-grupos';
import type { GrupoViagem } from '@/lib/types';

// GET /api/gestao-grupos/[grupo_id]
// Retorna: gestao_grupos + periodos_vagas + contagem de reservas por status
// + lista de materiais (sem conteúdo binário, apenas metadados).
// Se o grupo ainda não tem registros de gestão (legado), cria sob demanda.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;

  const { rows: grupoRows } = await pool.query(
    `SELECT data FROM grupos WHERE id = $1 AND tenant_id = $2`,
    [grupo_id, tenantId],
  );
  if (grupoRows.length === 0) return NextResponse.json({ error: 'Grupo não encontrado' }, { status: 404 });
  const grupo = grupoRows[0].data as GrupoViagem;

  // Lazy bootstrap pra grupos legados ou recém-criados que ainda não têm gestao
  await ensureGestaoGrupo(pool, grupo, tenantId);

  const [gestaoRes, periodosRes, statusCountRes, materiaisRes] = await Promise.all([
    pool.query(
      `SELECT id, status, data FROM gestao_grupos WHERE grupo_id = $1 AND tenant_id = $2 LIMIT 1`,
      [grupo_id, tenantId],
    ),
    pool.query(
      `SELECT id, periodo_index, data FROM grupo_periodos_vagas
       WHERE grupo_id = $1 AND tenant_id = $2 ORDER BY periodo_index ASC`,
      [grupo_id, tenantId],
    ),
    pool.query(
      `SELECT status, COUNT(*)::int AS n FROM grupo_reservas
       WHERE grupo_id = $1 AND tenant_id = $2 GROUP BY status`,
      [grupo_id, tenantId],
    ),
    pool.query(
      `SELECT id, tipo, nome, data, created_at FROM grupo_materiais
       WHERE grupo_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
      [grupo_id, tenantId],
    ),
  ]);

  const gestao = gestaoRes.rows[0] || null;
  const periodos = periodosRes.rows.map(r => ({
    id: r.id,
    periodo_index: r.periodo_index,
    ...(r.data as PeriodoVagasData),
  }));
  const statusCount: Record<string, number> = {};
  for (const r of statusCountRes.rows) statusCount[r.status] = r.n;
  const materiais = materiaisRes.rows.map(r => ({
    id: r.id, tipo: r.tipo, nome: r.nome, ...r.data, created_at: r.created_at,
  }));

  return NextResponse.json({
    grupo_id,
    grupo: { id: grupo.id, grp_id: grupo.grp_id, origem_destino: grupo.origem_destino, tipo: grupo.tipo, tarifas_ativas: grupo.tarifas_ativas },
    gestao: gestao ? { id: gestao.id, status: gestao.status, ...(gestao.data as GestaoGrupoData) } : null,
    periodos,
    contagem_reservas: statusCount,
    materiais,
  });
}

// PUT /api/gestao-grupos/[grupo_id]
// Atualiza observacoes e config_vagas em gestao_grupos.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const body = await req.json();

  const { rows } = await pool.query(
    `SELECT id, data FROM gestao_grupos WHERE grupo_id = $1 AND tenant_id = $2 LIMIT 1`,
    [grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'gestao_grupo não encontrado' }, { status: 404 });

  const atual = rows[0].data as GestaoGrupoData;
  const stagesValidos: KanbanStage[] = KANBAN_STAGES.map(s => s.key);
  const kanbanStage: KanbanStage | undefined =
    typeof body.kanban_stage === 'string' && stagesValidos.includes(body.kanban_stage as KanbanStage)
      ? (body.kanban_stage as KanbanStage)
      : atual.kanban_stage;
  const atualizado: GestaoGrupoData = {
    observacoes: typeof body.observacoes === 'string' ? body.observacoes : atual.observacoes,
    config_vagas: body.config_vagas ? { ...atual.config_vagas, ...body.config_vagas } : atual.config_vagas,
    kanban_stage: kanbanStage,
  };
  await pool.query(
    `UPDATE gestao_grupos SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(atualizado), rows[0].id, tenantId],
  );

  return NextResponse.json({ id: rows[0].id, ...atualizado });
}
