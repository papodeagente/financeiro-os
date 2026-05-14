import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import { emitirEventoCRM } from '@/lib/crm-integration';
import {
  recalcularVagasPeriodo,
  registrarEvento,
  type ReservaData,
  type PeriodoVagasData,
  type GestaoGrupoData,
  type KanbanStage,
} from '@/lib/gestao-grupos';
import type { GrupoViagem } from '@/lib/types';
import type { Proposta } from '@/lib/crm-types';

// POST /api/gestao-grupos/[grupo_id]/reservas/[reserva_id]/confirmar
//
// Converte uma reserva em venda e CONECTA com o resto do sistema financeiro.
// Sequência:
//   1. Cria venda em vendas_crm (status=vendido, tipo=GRUPO)
//   2. Gera N contas_receber (uma por parcela) → alimenta DRE / fluxo / receber
//   3. Atualiza reserva: status=confirmado, venda_id
//   4. Recalcula vagas do período (reservadas-1, confirmadas+1)
//   5. Avança grupo.status_pipeline para 'VENDA' (e venda_crm_id)
//   6. Avança kanban_stage para 'vendas' (auto, se ainda estiver em
//      estágios iniciais — preserva manualmente movimentado pra adiante)
//   7. Se houver proposta vinculada, marca venda_id + data_conversao
//   8. Emite evento CRM VENDA_CRIADA
//
// Idempotente em parte: rejeita se reserva já está confirmada.

const PARCELA_PRIMEIRA_OFFSET_DIAS = 7;
const PARCELA_INTERVALO_DIAS = 30;

function addDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; reserva_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, reserva_id } = await params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // -------- 1. Carrega reserva + cliente + grupo + período + gestao
    const { rows: rRows } = await client.query(
      `SELECT r.id, r.periodo_id, r.cliente_id, r.status, r.data,
              c.data AS cliente_data
         FROM grupo_reservas r
         LEFT JOIN clientes c ON c.id = r.cliente_id AND c.tenant_id = r.tenant_id
        WHERE r.id = $1 AND r.grupo_id = $2 AND r.tenant_id = $3
        FOR UPDATE`,
      [reserva_id, grupo_id, tenantId],
    );
    if (rRows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Reserva não encontrada' }, { status: 404 });
    }
    const reserva = rRows[0];
    const reservaData = reserva.data as ReservaData;

    if (reserva.status === 'confirmado' && reservaData.venda_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Reserva já confirmada', venda_id: reservaData.venda_id }, { status: 400 });
    }
    if (reserva.status === 'cancelado') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Reserva cancelada não pode ser confirmada' }, { status: 400 });
    }

    type Cliente = { nome_completo?: string; nome_fantasia?: string; razao_social?: string; tipo?: string };
    const c = (reserva.cliente_data || {}) as Cliente;
    const clienteNome = c.tipo === 'PJ'
      ? (c.nome_fantasia || c.razao_social || '')
      : (c.nome_completo || '');

    const { rows: gRows } = await client.query(
      `SELECT data FROM grupos WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [grupo_id, tenantId],
    );
    const grupo = gRows[0]?.data as GrupoViagem | undefined;

    const { rows: pRows } = await client.query(
      `SELECT data FROM grupo_periodos_vagas WHERE id = $1 AND tenant_id = $2`,
      [reserva.periodo_id, tenantId],
    );
    const periodoData = pRows[0]?.data as PeriodoVagasData | undefined;

    const { rows: ggRows } = await client.query(
      `SELECT id, data FROM gestao_grupos WHERE grupo_id = $1 AND tenant_id = $2 FOR UPDATE`,
      [grupo_id, tenantId],
    );
    const gestaoRow = ggRows[0];
    const gestaoData = gestaoRow?.data as GestaoGrupoData | undefined;

    // -------- 2. Monta venda
    const dataVenda = new Date().toISOString().split('T')[0];
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) as c FROM vendas_crm WHERE tenant_id = $1`,
      [tenantId],
    );
    const numero = `VEN-${String(parseInt(countRows[0].c) + 1).padStart(4, '0')}`;
    const vendaId = generateId();
    const valor = reservaData.valor_cobrado || 0;
    const parcelas = Math.max(1, reservaData.parcelas || 1);

    const venda = {
      id: vendaId,
      numero,
      data_venda: dataVenda,
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
      parcelas,
      pagamento_detalhado: [],
      status: 'vendido',
      observacoes: reservaData.observacoes || '',
      // Referências cruzadas — origem da venda
      reserva_id,
      periodo_id: reserva.periodo_id,
      periodo_label: periodoData?.label || '',
      tipo_acomodacao: reservaData.tipo_acomodacao,
      origem_destino: grupo?.origem_destino || '',
      contas_geradas: true,
      contas_geradas_em: new Date().toISOString(),
    };

    await client.query(
      `INSERT INTO vendas_crm (id, tenant_id, data, cliente_id, vendedor_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '', 'vendido', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET data = $3, updated_at = NOW()`,
      [vendaId, tenantId, JSON.stringify(venda), reserva.cliente_id],
    );

    // -------- 3. Gera N contas_receber (1 por parcela) — alimenta DRE/fluxo
    const valorParcela = Math.round((valor / parcelas) * 100) / 100;
    // Última parcela compensa centavos de arredondamento
    const contasIds: string[] = [];
    for (let i = 1; i <= parcelas; i++) {
      const isUltima = i === parcelas;
      const valorReceber = isUltima
        ? Math.round((valor - valorParcela * (parcelas - 1)) * 100) / 100
        : valorParcela;
      const vencimento = i === 1
        ? addDias(dataVenda, PARCELA_PRIMEIRA_OFFSET_DIAS)
        : addDias(dataVenda, PARCELA_PRIMEIRA_OFFSET_DIAS + PARCELA_INTERVALO_DIAS * (i - 1));

      const crId = generateId();
      contasIds.push(crId);
      const cr = {
        id: crId,
        origem: 'VENDA',
        venda_id: vendaId,
        grupo_id,
        cliente_id: reserva.cliente_id,
        cliente_nome: clienteNome,
        descricao: `${grupo?.origem_destino || 'Viagem'} — ${reservaData.nome_passageiro || clienteNome}${parcelas > 1 ? ` (${i}/${parcelas})` : ''}`,
        categoria_id: '',
        centro_custo: '',
        valor_original: valorReceber,
        juros: 0,
        multa: 0,
        desconto: 0,
        valor_final: valorReceber,
        data_emissao: dataVenda,
        data_vencimento: vencimento,
        data_recebimento: null,
        valor_recebido: null,
        conta_bancaria_id: null,
        forma_recebimento: '',
        parcela_numero: i,
        total_parcelas: parcelas,
        boleto_emitido: false,
        boleto_codigo: '',
        boleto_url: '',
        status: 'PENDENTE',
        rateio: [],
        anexos: [],
        observacoes: reservaData.observacoes || '',
        origem_venda_id: vendaId,
        auto_gerado: true,
      };
      await client.query(
        `INSERT INTO contas_receber (id, tenant_id, venda_id, cliente_id, grupo_id, status, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDENTE', $6::jsonb, NOW(), NOW())`,
        [crId, tenantId, vendaId, reserva.cliente_id, grupo_id, JSON.stringify(cr)],
      );
    }

    // -------- 4. Atualiza reserva: status confirmado + venda_id
    const dataAtualizada: ReservaData = { ...reservaData, venda_id: vendaId };
    await client.query(
      `UPDATE grupo_reservas SET status = 'confirmado', data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [JSON.stringify(dataAtualizada), reserva_id, tenantId],
    );

    // -------- 5. Avança grupo.status_pipeline → 'VENDA' (se ainda em estágios anteriores)
    let grupoAtualizado = false;
    if (grupo) {
      const estagiosAnteriores: GrupoViagem['status_pipeline'][] = ['PRODUTO', 'PROPOSTA', 'ORCAMENTO', 'RESERVA'];
      const precisaAvancar = estagiosAnteriores.includes(grupo.status_pipeline);
      if (precisaAvancar || !grupo.venda_crm_id) {
        const novoGrupo: GrupoViagem = {
          ...grupo,
          status_pipeline: precisaAvancar ? 'VENDA' : grupo.status_pipeline,
          venda_crm_id: grupo.venda_crm_id || vendaId,
        };
        await client.query(
          `UPDATE grupos SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          [JSON.stringify(novoGrupo), grupo_id, tenantId],
        );
        grupoAtualizado = true;
      }
    }

    // -------- 6. Avança kanban_stage → 'vendas' (se ainda em 'novo' ou 'formalizacao')
    let novoKanbanStage: KanbanStage | null = null;
    if (gestaoRow && gestaoData) {
      const stageAtual = gestaoData.kanban_stage || 'novo';
      const stagesAuto: KanbanStage[] = ['novo', 'formalizacao'];
      if (stagesAuto.includes(stageAtual)) {
        novoKanbanStage = 'vendas';
        const gestaoAtualizada: GestaoGrupoData = { ...gestaoData, kanban_stage: 'vendas' };
        await client.query(
          `UPDATE gestao_grupos SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
          [JSON.stringify(gestaoAtualizada), gestaoRow.id, tenantId],
        );
      }
    }

    // -------- 7. Atualiza proposta vinculada (venda_id + data_conversao)
    let propostaAtualizada = false;
    if (grupo?.proposta_id) {
      const { rows: propRows } = await client.query(
        `SELECT data FROM propostas WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [grupo.proposta_id, tenantId],
      );
      if (propRows[0]?.data) {
        const proposta = propRows[0].data as Proposta;
        if (!proposta.venda_id || !proposta.data_conversao) {
          const propAtualizada: Proposta = {
            ...proposta,
            venda_id: proposta.venda_id || vendaId,
            data_conversao: proposta.data_conversao || new Date().toISOString(),
            status: proposta.status === 'ACEITO' ? proposta.status : 'ACEITO',
            atualizado_em: new Date().toISOString(),
          };
          await client.query(
            `UPDATE propostas SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
            [JSON.stringify(propAtualizada), grupo.proposta_id, tenantId],
          );
          propostaAtualizada = true;
        }
      }
    }

    await client.query('COMMIT');

    // Recalcula vagas após COMMIT (função usa pool fora da transação)
    const periodoAtualizado = await recalcularVagasPeriodo(pool, reserva.periodo_id, tenantId);

    // -------- 7.5 Histórico (Fase F) — fora da tx pra não bloquear
    await registrarEvento(pool, {
      grupo_id, tenant_id: tenantId, tipo: 'reserva_confirmada',
      descricao: `Reserva confirmada: ${reservaData.nome_passageiro || reserva_id} — ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
      reserva_id, entidade_id: reserva_id, entidade_label: reservaData.nome_passageiro,
    });
    await registrarEvento(pool, {
      grupo_id, tenant_id: tenantId, tipo: 'venda_gerada',
      descricao: `Venda ${numero} gerada para ${clienteNome} — ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em ${parcelas}x`,
      reserva_id, entidade_id: vendaId, entidade_label: numero,
      dados_novos: { valor, parcelas, cliente_id: reserva.cliente_id },
    });
    if (novoKanbanStage) {
      await registrarEvento(pool, {
        grupo_id, tenant_id: tenantId, tipo: 'kanban_stage_alterado',
        descricao: `Kanban movido automaticamente para ${novoKanbanStage}`,
        entidade_label: novoKanbanStage,
        dados_novos: { kanban_stage: novoKanbanStage },
      });
    }

    // -------- 8. CRM event
    try {
      emitirEventoCRM('VENDA_CRIADA', {
        venda_id: vendaId,
        cliente_id: reserva.cliente_id,
        vendedor_id: '',
        grupo_id,
        proposta_id: grupo?.proposta_id || '',
        valor_total: valor,
      }, { tenantId });
    } catch (e) {
      console.error('[VENDA_CRIADA] falha ao emitir', e);
    }

    return NextResponse.json({
      reserva: { id: reserva_id, status: 'confirmado', ...dataAtualizada },
      venda: { id: vendaId, numero, valor_final: valor },
      periodo: periodoAtualizado,
      contas_receber: contasIds,
      grupo_pipeline_atualizado: grupoAtualizado,
      kanban_stage: novoKanbanStage,
      proposta_atualizada: propostaAtualizada,
    });
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    console.error('[confirmar reserva] falha', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
