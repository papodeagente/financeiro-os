import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import {
  createTarefaData, registrarEvento,
  TAREFA_TIPO_LABEL, TAREFA_STATUS_LABEL, TAREFA_PRIORIDADE_LABEL,
  type TarefaData, type TarefaTipo, type TarefaStatus, type TarefaPrioridade,
} from '@/lib/gestao-grupos';

const TIPOS: TarefaTipo[] = Object.keys(TAREFA_TIPO_LABEL) as TarefaTipo[];
const STATUS: TarefaStatus[] = Object.keys(TAREFA_STATUS_LABEL) as TarefaStatus[];
const PRIORIDADES: TarefaPrioridade[] = Object.keys(TAREFA_PRIORIDADE_LABEL) as TarefaPrioridade[];

// GET /api/gestao-grupos/[grupo_id]/tarefas?status=&prioridade=
export async function GET(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ tarefas: [], stats: {} });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const url = new URL(req.url);
  const statusFiltro = url.searchParams.get('status') || '';
  const prioridadeFiltro = url.searchParams.get('prioridade') || '';

  const wheres = ['grupo_id = $1', 'tenant_id = $2'];
  const params_: unknown[] = [grupo_id, tenantId];
  if (statusFiltro) { params_.push(statusFiltro); wheres.push(`status = $${params_.length}`); }
  if (prioridadeFiltro) { params_.push(prioridadeFiltro); wheres.push(`prioridade = $${params_.length}`); }

  const { rows } = await pool.query(
    `SELECT id, tipo, status, prioridade, data, created_at, updated_at
       FROM grupo_tarefas
      WHERE ${wheres.join(' AND ')}
      ORDER BY
        CASE WHEN status = 'concluida' OR status = 'cancelada' THEN 1 ELSE 0 END,
        CASE prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
        (data->>'prazo') ASC NULLS LAST,
        created_at DESC`,
    params_,
  );

  const tarefas = rows.map(r => ({
    id: r.id,
    grupo_id,
    tipo: r.tipo as TarefaTipo,
    status: r.status as TarefaStatus,
    prioridade: r.prioridade as TarefaPrioridade,
    ...(r.data as TarefaData),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  // Stats por status
  const hoje = new Date().toISOString().split('T')[0];
  const stats = {
    total: tarefas.length,
    pendente: tarefas.filter(t => t.status === 'pendente').length,
    em_andamento: tarefas.filter(t => t.status === 'em_andamento').length,
    concluida: tarefas.filter(t => t.status === 'concluida').length,
    cancelada: tarefas.filter(t => t.status === 'cancelada').length,
    atrasadas: tarefas.filter(t =>
      (t.status === 'pendente' || t.status === 'em_andamento')
      && t.prazo && t.prazo < hoje
    ).length,
  };

  return NextResponse.json({ tarefas, stats });
}

// POST /api/gestao-grupos/[grupo_id]/tarefas
// Body: { tipo, titulo, prioridade?, status?, prazo?, descricao?, responsavel_id?, reserva_id?, passageiro_id? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const body = await req.json();

  const tipo: TarefaTipo = TIPOS.includes(body.tipo) ? body.tipo : 'outros';
  const status: TarefaStatus = STATUS.includes(body.status) ? body.status : 'pendente';
  const prioridade: TarefaPrioridade = PRIORIDADES.includes(body.prioridade) ? body.prioridade : 'media';
  const titulo = String(body.titulo || TAREFA_TIPO_LABEL[tipo]).trim();

  const id = generateId();
  const data: TarefaData = {
    ...createTarefaData(titulo),
    descricao: body.descricao || '',
    reserva_id: body.reserva_id || '',
    passageiro_id: body.passageiro_id || '',
    responsavel_id: body.responsavel_id || '',
    responsavel_nome: body.responsavel_nome || '',
    prazo: body.prazo || '',
    observacoes: body.observacoes || '',
  };

  await pool.query(
    `INSERT INTO grupo_tarefas (id, grupo_id, tipo, status, prioridade, data, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [id, grupo_id, tipo, status, prioridade, JSON.stringify(data), tenantId],
  );

  await registrarEvento(pool, {
    grupo_id, tenant_id: tenantId, tipo: 'tarefa_criada',
    descricao: `Tarefa criada: ${titulo}`,
    entidade_id: id, entidade_label: titulo,
    reserva_id: data.reserva_id,
    passageiro_id: data.passageiro_id,
  });

  return NextResponse.json({ id, grupo_id, tipo, status, prioridade, ...data });
}
