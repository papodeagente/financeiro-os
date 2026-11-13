import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recalcularVagasPeriodo, registrarEvento, type ReservaData, type ReservaStatus } from '@/lib/gestao-grupos';

// PUT /api/gestao-grupos/[grupo_id]/reservas/[reserva_id]
// Atualiza campos editáveis da reserva. Quando status muda pra
// cancelado/confirmado/lista_espera/reservado, recalcula os contadores
// do período. Não permite alterar grupo_id, periodo_id, cliente_id aqui
// (regenerar reserva nova se mudar de período).
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; reserva_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, reserva_id } = await params;
  const body = await req.json();

  const { rows } = await pool.query(
    `SELECT id, periodo_id, status, data FROM grupo_reservas
     WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [reserva_id, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 });
  const reservaAtual = rows[0];
  const dataAtual = reservaAtual.data as ReservaData;

  const STATUS_VALIDOS: ReservaStatus[] = ['reservado', 'confirmado', 'cancelado', 'lista_espera'];
  const novoStatus: ReservaStatus = STATUS_VALIDOS.includes(body.status)
    ? (body.status as ReservaStatus)
    : (reservaAtual.status as ReservaStatus);

  const dataNova: ReservaData = {
    nome_passageiro: typeof body.nome_passageiro === 'string' ? body.nome_passageiro : dataAtual.nome_passageiro,
    tipo_acomodacao: typeof body.tipo_acomodacao === 'string' ? body.tipo_acomodacao.toUpperCase() : dataAtual.tipo_acomodacao,
    valor_cobrado: body.valor_cobrado !== undefined ? Number(body.valor_cobrado) || 0 : dataAtual.valor_cobrado,
    parcelas: body.parcelas !== undefined ? Math.max(1, Math.floor(Number(body.parcelas) || 1)) : dataAtual.parcelas,
    observacoes: typeof body.observacoes === 'string' ? body.observacoes : dataAtual.observacoes,
    documentos_ok: body.documentos_ok !== undefined ? !!body.documentos_ok : dataAtual.documentos_ok,
    passaporte_vencimento: typeof body.passaporte_vencimento === 'string' ? body.passaporte_vencimento : dataAtual.passaporte_vencimento,
    venda_id: dataAtual.venda_id, // preservado — só confirmar gera venda_id
    motivo_cancelamento: typeof body.motivo_cancelamento === 'string' ? body.motivo_cancelamento : dataAtual.motivo_cancelamento,
  };

  // Cancelamento exige motivo
  if (novoStatus === 'cancelado' && !dataNova.motivo_cancelamento?.trim()) {
    return NextResponse.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 });
  }

  await pool.query(
    `UPDATE grupo_reservas SET status = $1, data = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
    [novoStatus, JSON.stringify(dataNova), reserva_id, tenantId],
  );

  // Recalcula vagas do período se status mudou
  let periodoAtualizado = null;
  if (novoStatus !== reservaAtual.status) {
    periodoAtualizado = await recalcularVagasPeriodo(pool, reservaAtual.periodo_id, tenantId);
    if (novoStatus === 'cancelado') {
      await registrarEvento(pool, {
        grupo_id, tenant_id: tenantId, tipo: 'reserva_cancelada',
        descricao: `Reserva cancelada: ${dataNova.nome_passageiro || reserva_id}${dataNova.motivo_cancelamento ? ' — ' + dataNova.motivo_cancelamento : ''}`,
        reserva_id, entidade_id: reserva_id, entidade_label: dataNova.nome_passageiro,
      });
    } else {
      await registrarEvento(pool, {
        grupo_id, tenant_id: tenantId, tipo: 'reserva_status_alterado',
        descricao: `Status da reserva ${dataNova.nome_passageiro || reserva_id}: ${reservaAtual.status} → ${novoStatus}`,
        reserva_id, entidade_id: reserva_id,
        dados_anteriores: { status: reservaAtual.status },
        dados_novos: { status: novoStatus },
      });
    }
  }

  return NextResponse.json({
    id: reserva_id,
    grupo_id,
    periodo_id: reservaAtual.periodo_id,
    status: novoStatus,
    ...dataNova,
    periodo: periodoAtualizado,
  });
}

// DELETE /api/gestao-grupos/[grupo_id]/reservas/[reserva_id]
// Cancela a reserva (soft — muda status para cancelado). Exige motivo.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; reserva_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, reserva_id } = await params;
  const url = new URL(req.url);
  const motivo = url.searchParams.get('motivo') || '';

  if (!motivo.trim()) return NextResponse.json({ error: 'Motivo do cancelamento é obrigatório' }, { status: 400 });

  const { rows } = await pool.query(
    `SELECT periodo_id, data FROM grupo_reservas WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [reserva_id, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 });

  const data = rows[0].data as ReservaData;
  const dataNova: ReservaData = { ...data, motivo_cancelamento: motivo };
  await pool.query(
    `UPDATE grupo_reservas SET status = 'cancelado', data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(dataNova), reserva_id, tenantId],
  );

  await recalcularVagasPeriodo(pool, rows[0].periodo_id, tenantId);

  await registrarEvento(pool, {
    grupo_id, tenant_id: tenantId, tipo: 'reserva_cancelada',
    descricao: `Reserva cancelada: ${data.nome_passageiro || reserva_id} — ${motivo}`,
    reserva_id, entidade_id: reserva_id, entidade_label: data.nome_passageiro,
  });

  return NextResponse.json({ ok: true });
}
