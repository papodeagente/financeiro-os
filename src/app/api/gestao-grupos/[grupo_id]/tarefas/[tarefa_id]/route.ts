import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import {
  registrarEvento,
  TAREFA_TIPO_LABEL, TAREFA_STATUS_LABEL, TAREFA_PRIORIDADE_LABEL,
  type TarefaData, type TarefaTipo, type TarefaStatus, type TarefaPrioridade,
} from '@/lib/gestao-grupos';

const TIPOS: TarefaTipo[] = Object.keys(TAREFA_TIPO_LABEL) as TarefaTipo[];
const STATUS: TarefaStatus[] = Object.keys(TAREFA_STATUS_LABEL) as TarefaStatus[];
const PRIORIDADES: TarefaPrioridade[] = Object.keys(TAREFA_PRIORIDADE_LABEL) as TarefaPrioridade[];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; tarefa_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, tarefa_id } = await params;
  const body = await req.json();

  const { rows } = await pool.query(
    `SELECT id, tipo, status, prioridade, data
       FROM grupo_tarefas WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [tarefa_id, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Tarefa não encontrada' }, { status: 404 });
  const atual = rows[0];
  const dataAtual = atual.data as TarefaData;

  const tipo: TarefaTipo = TIPOS.includes(body.tipo) ? body.tipo : atual.tipo;
  const statusNovo: TarefaStatus = STATUS.includes(body.status) ? body.status : atual.status;
  const prioridade: TarefaPrioridade = PRIORIDADES.includes(body.prioridade) ? body.prioridade : atual.prioridade;

  // Quando muda pra concluida, registra data_conclusao
  const dataConclusao = statusNovo === 'concluida' && atual.status !== 'concluida'
    ? new Date().toISOString()
    : dataAtual.data_conclusao;

  const dataNova: TarefaData = {
    ...dataAtual,
    titulo: body.titulo ?? dataAtual.titulo,
    descricao: body.descricao ?? dataAtual.descricao,
    reserva_id: body.reserva_id ?? dataAtual.reserva_id,
    passageiro_id: body.passageiro_id ?? dataAtual.passageiro_id,
    responsavel_id: body.responsavel_id ?? dataAtual.responsavel_id,
    responsavel_nome: body.responsavel_nome ?? dataAtual.responsavel_nome,
    prazo: body.prazo ?? dataAtual.prazo,
    observacoes: body.observacoes ?? dataAtual.observacoes,
    data_conclusao: dataConclusao,
  };

  await pool.query(
    `UPDATE grupo_tarefas SET tipo = $1, status = $2, prioridade = $3, data = $4, updated_at = NOW()
      WHERE id = $5 AND tenant_id = $6`,
    [tipo, statusNovo, prioridade, JSON.stringify(dataNova), tarefa_id, tenantId],
  );

  // Eventos importantes: conclusão, cancelamento
  if (statusNovo === 'concluida' && atual.status !== 'concluida') {
    await registrarEvento(pool, {
      grupo_id, tenant_id: tenantId, tipo: 'tarefa_concluida',
      descricao: `Tarefa concluída: ${dataNova.titulo}`,
      entidade_id: tarefa_id, entidade_label: dataNova.titulo,
    });
  } else if (statusNovo === 'cancelada' && atual.status !== 'cancelada') {
    await registrarEvento(pool, {
      grupo_id, tenant_id: tenantId, tipo: 'tarefa_cancelada',
      descricao: `Tarefa cancelada: ${dataNova.titulo}`,
      entidade_id: tarefa_id, entidade_label: dataNova.titulo,
    });
  }

  return NextResponse.json({ id: tarefa_id, grupo_id, tipo, status: statusNovo, prioridade, ...dataNova });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; tarefa_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, tarefa_id } = await params;

  await pool.query(
    `DELETE FROM grupo_tarefas WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [tarefa_id, grupo_id, tenantId],
  );
  return NextResponse.json({ ok: true });
}
