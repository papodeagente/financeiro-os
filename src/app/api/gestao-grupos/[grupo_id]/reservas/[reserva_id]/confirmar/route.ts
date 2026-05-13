import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import { emitirEventoCRM } from '@/lib/crm-integration';
import { recalcularVagasPeriodo, type ReservaData, type PeriodoVagasData } from '@/lib/gestao-grupos';
import type { GrupoViagem } from '@/lib/types';

// POST /api/gestao-grupos/[grupo_id]/reservas/[reserva_id]/confirmar
// Converte uma reserva em venda:
// 1. Cria venda em vendas_crm (status=vendido, tipo=GRUPO)
// 2. Atualiza reserva.status = 'confirmado', salva venda_id
// 3. Recalcula contadores do período (reservadas -1, confirmadas +1)
// 4. Emite evento CRM VENDA_CRIADA
//
// Não gera contas financeiras automaticamente — quando o usuário confirma
// múltiplas reservas, ele pode preferir consolidar contas depois. A venda
// fica criada sem itens; gerar contas é fluxo separado em /vendas/[id].
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; reserva_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, reserva_id } = await params;

  // Carrega reserva + período + grupo + cliente
  const { rows: rRows } = await pool.query(
    `SELECT r.id, r.periodo_id, r.cliente_id, r.status, r.data,
            c.data AS cliente_data
       FROM grupo_reservas r
       LEFT JOIN clientes c ON c.id = r.cliente_id AND c.tenant_id = r.tenant_id
      WHERE r.id = $1 AND r.grupo_id = $2 AND r.tenant_id = $3`,
    [reserva_id, grupo_id, tenantId],
  );
  if (rRows.length === 0) return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 });
  const reserva = rRows[0];
  const reservaData = reserva.data as ReservaData;

  if (reserva.status === 'confirmado' && reservaData.venda_id) {
    return NextResponse.json({ error: 'Reserva já confirmada', venda_id: reservaData.venda_id }, { status: 400 });
  }
  if (reserva.status === 'cancelado') {
    return NextResponse.json({ error: 'Reserva cancelada não pode ser confirmada' }, { status: 400 });
  }

  type Cliente = { nome_completo?: string; nome_fantasia?: string; razao_social?: string; tipo?: string };
  const c = (reserva.cliente_data || {}) as Cliente;
  const clienteNome = c.tipo === 'PJ'
    ? (c.nome_fantasia || c.razao_social || '')
    : (c.nome_completo || '');

  const { rows: gRows } = await pool.query(`SELECT data FROM grupos WHERE id = $1 AND tenant_id = $2`, [grupo_id, tenantId]);
  const grupo = gRows[0]?.data as GrupoViagem | undefined;

  const { rows: pRows } = await pool.query(
    `SELECT data FROM grupo_periodos_vagas WHERE id = $1 AND tenant_id = $2`,
    [reserva.periodo_id, tenantId],
  );
  const periodoData = pRows[0]?.data as PeriodoVagasData | undefined;

  // Monta venda
  const { rows: countRows } = await pool.query(`SELECT COUNT(*) as c FROM vendas_crm WHERE tenant_id = $1`, [tenantId]);
  const numero = `VEN-${String(parseInt(countRows[0].c) + 1).padStart(4, '0')}`;
  const vendaId = generateId();
  const valor = reservaData.valor_cobrado || 0;

  const venda = {
    id: vendaId,
    numero,
    data_venda: new Date().toISOString().split('T')[0],
    tipo: 'GRUPO',
    grupo_id,
    cliente_id: reserva.cliente_id,
    cliente_nome: clienteNome,
    vendedor_id: '',
    vendedor_nome: '',
    passageiros: [{
      nome: reservaData.nome_passageiro || clienteNome,
      tipo: 'ADT',
      documento: '',
      data_nascimento: '',
      telefone: '',
      email: '',
    }],
    pagantes: [],
    produtos: [],
    valor_total_custo: 0,
    valor_total_venda: valor,
    markup_realizado: 0,
    desconto: 0,
    valor_final: valor,
    forma_pagamento: 'CARTAO',
    parcelas: reservaData.parcelas || 1,
    pagamento_detalhado: [],
    status: 'vendido',
    observacoes: reservaData.observacoes || '',
    // Referências cruzadas — origem da venda
    reserva_id,
    periodo_id: reserva.periodo_id,
    periodo_label: periodoData?.label || '',
    tipo_acomodacao: reservaData.tipo_acomodacao,
    origem_destino: grupo?.origem_destino || '',
  };

  // Upsert da venda (mesmo padrão do POST /api/vendas-crm legado)
  await pool.query(
    `INSERT INTO vendas_crm (id, tenant_id, data, cliente_id, vendedor_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '', 'vendido', NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET data = $3, updated_at = NOW()`,
    [vendaId, tenantId, JSON.stringify(venda), reserva.cliente_id],
  );

  // Atualiza reserva: status confirmado + venda_id
  const dataAtualizada: ReservaData = { ...reservaData, venda_id: vendaId };
  await pool.query(
    `UPDATE grupo_reservas SET status = 'confirmado', data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(dataAtualizada), reserva_id, tenantId],
  );

  // Recalcula contadores
  const periodoAtualizado = await recalcularVagasPeriodo(pool, reserva.periodo_id, tenantId);

  // CRM
  try {
    emitirEventoCRM('VENDA_CRIADA', {
      venda_id: vendaId,
      cliente_id: reserva.cliente_id,
      vendedor_id: '',
      grupo_id,
      proposta_id: '',
      valor_total: valor,
    }, { tenantId });
  } catch (e) {
    console.error('[VENDA_CRIADA] falha ao emitir', e);
  }

  return NextResponse.json({
    reserva: { id: reserva_id, status: 'confirmado', ...dataAtualizada },
    venda: { id: vendaId, numero, valor_final: valor },
    periodo: periodoAtualizado,
  });
}
