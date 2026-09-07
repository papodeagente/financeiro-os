import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { ContaReceber, ContaPagar } from '@/lib/crm-types';
import { round2, divSegura, hojeISO } from '@/lib/money';
import {
  calcularResultado,
  type ContaReceberMin,
  type ContaPagarMin,
} from '@/lib/resultado-financeiro';

// GET /api/gestao-grupos/[grupo_id]/financeiro
//
// Visão financeira consolidada do grupo. Lê das tabelas existentes
// (contas_receber + contas_pagar) sem criar nada paralelo. Cada chamada
// recalcula tudo a partir das fontes oficiais.
//
// Retorna:
//   - resumo: { receita: {previsto, recebido, em_aberto, vencido},
//               despesa: {previsto, pago, em_aberto, vencido},
//               lucro_previsto, lucro_realizado,
//               margem_prevista, margem_realizada,
//               qtd_pax_confirmados, lucro_por_pax,
//               ponto_equilibrio_pax }
//   - receitas: ContaReceber[] (do grupo)
//   - despesas: ContaPagar[]    (do grupo)
//   - contagem_passageiros: { adt, chd, inf, total }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;

  // Verifica que o grupo existe e pertence ao tenant
  const { rows: gRows } = await pool.query(
    `SELECT id, data FROM grupos WHERE id = $1 AND tenant_id = $2`,
    [grupo_id, tenantId],
  );
  if (gRows.length === 0) {
    return NextResponse.json({ error: 'Grupo não encontrado' }, { status: 404 });
  }

  // Contas a receber + contas a pagar + contagem de passageiros confirmados
  // em paralelo — todas filtradas por grupo_id e tenant.
  const [crRes, cpRes, paxConfirmadosRes] = await Promise.all([
    pool.query(
      `SELECT id, data FROM contas_receber
        WHERE grupo_id = $1 AND tenant_id = $2
        ORDER BY (data->>'data_vencimento') ASC`,
      [grupo_id, tenantId],
    ),
    pool.query(
      `SELECT id, data FROM contas_pagar
        WHERE grupo_id = $1 AND tenant_id = $2
        ORDER BY (data->>'data_vencimento') ASC`,
      [grupo_id, tenantId],
    ),
    // Passageiros das reservas confirmadas — usados pra calcular lucro/pax
    pool.query(
      `SELECT COUNT(DISTINCT p.id)::int AS total,
              COUNT(DISTINCT CASE WHEN (p.data->>'tipo') = 'ADT' THEN p.id END)::int AS adt,
              COUNT(DISTINCT CASE WHEN (p.data->>'tipo') = 'CHD' THEN p.id END)::int AS chd,
              COUNT(DISTINCT CASE WHEN (p.data->>'tipo') = 'INF' THEN p.id END)::int AS inf
         FROM grupo_passageiros p
         INNER JOIN grupo_reservas r
           ON r.id = p.reserva_id AND r.tenant_id = p.tenant_id
        WHERE p.grupo_id = $1 AND p.tenant_id = $2
          AND r.status = 'confirmado'`,
      [grupo_id, tenantId],
    ),
  ]);

  const receitas: ContaReceber[] = crRes.rows.map(r => ({ ...(r.data as ContaReceber), id: r.id }));
  const despesas: ContaPagar[] = cpRes.rows.map(r => ({ ...(r.data as ContaPagar), id: r.id }));
  const paxRow = paxConfirmadosRes.rows[0] || { total: 0, adt: 0, chd: 0, inf: 0 };

  // Quando o grupo ainda não tem passageiros detalhados (legado), usa a
  // contagem de reservas confirmadas como fallback.
  let qtdPaxConfirmados = paxRow.total as number;
  if (qtdPaxConfirmados === 0) {
    const { rows: cRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM grupo_reservas
        WHERE grupo_id = $1 AND tenant_id = $2 AND status = 'confirmado'`,
      [grupo_id, tenantId],
    );
    qtdPaxConfirmados = cRows[0]?.n || 0;
  }

  // Agregados pela FONTE ÚNICA DA VERDADE.
  //
  // A versão anterior tinha três defeitos que se somavam num único número
  // errado na tela do grupo:
  //  1. `new Date().toISOString()` dá a data em UTC. Em produção (UTC), das
  //     21h à meia-noite no Brasil o "hoje" era amanhã, e contas que vencem
  //     hoje apareciam como vencidas.
  //  2. Um `else if` mandava a conta PARCIAL para o ramo do vencido pelo
  //     valor CHEIO: quem pagou R$ 6.000 de R$ 8.000 aparecia devendo
  //     R$ 8.000 e o recebido ficava zero.
  //  3. `+=` cru acumulava erro de centavo.
  const hoje = hojeISO();
  const resultado = calcularResultado({
    contas_receber: receitas as ContaReceberMin[],
    contas_pagar: despesas as ContaPagarMin[],
    hoje,
  });

  const recPrevisto = round2(resultado.volume_liquido + resultado.comissoes_a_receber);
  const recRecebido = resultado.recebido;
  const recVencido = resultado.vencido_a_receber;
  const recEmAberto = resultado.a_receber;

  const despPrevisto = resultado.custo_previsto;
  const despPago = resultado.custo_pago;
  const despVencido = resultado.vencido_a_pagar;
  const despEmAberto = resultado.custo_pendente;

  // Lucros + margens
  const lucroPrevisto = resultado.margem_prevista;
  const lucroRealizado = resultado.margem_realizada;
  const margemPrevista = resultado.margem_percentual;
  const margemRealizada = round2(divSegura(lucroRealizado, recRecebido) * 100);

  // Lucro por pax (com base em confirmados)
  const lucroPorPax = round2(divSegura(lucroPrevisto, qtdPaxConfirmados));

  // Ponto de equilíbrio em PAX — quantos pax mínimos pra pagar despesas
  // assumindo o ticket médio atual (receita_prevista / qtdPax). Quando
  // não há base, retorna 0 (indeterminado).
  let pontoEquilibrioPax = 0;
  if (qtdPaxConfirmados > 0 && recPrevisto > 0) {
    const ticketMedio = recPrevisto / qtdPaxConfirmados;
    if (ticketMedio > 0) {
      pontoEquilibrioPax = Math.ceil(despPrevisto / ticketMedio);
    }
  }

  return NextResponse.json({
    resumo: {
      receita: {
        previsto: recPrevisto,
        recebido: recRecebido,
        em_aberto: recEmAberto,
        vencido: recVencido,
      },
      despesa: {
        previsto: despPrevisto,
        pago: despPago,
        em_aberto: despEmAberto,
        vencido: despVencido,
      },
      lucro_previsto: lucroPrevisto,
      lucro_realizado: lucroRealizado,
      margem_prevista: margemPrevista,
      margem_realizada: margemRealizada,
      qtd_pax_confirmados: qtdPaxConfirmados,
      lucro_por_pax: lucroPorPax,
      ponto_equilibrio_pax: pontoEquilibrioPax,
    },
    receitas,
    despesas,
    contagem_passageiros: {
      total: paxRow.total as number,
      adt: paxRow.adt as number,
      chd: paxRow.chd as number,
      inf: paxRow.inf as number,
    },
  });
}
