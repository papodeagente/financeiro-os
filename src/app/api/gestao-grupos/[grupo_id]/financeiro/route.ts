import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { ContaReceber, ContaPagar } from '@/lib/crm-types';

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

  // Agregados — receita
  const hoje = new Date().toISOString().split('T')[0];
  let recPrevisto = 0, recRecebido = 0, recVencido = 0;
  for (const r of receitas) {
    if (r.status === 'CANCELADO') continue;
    const valor = r.valor_final || 0;
    recPrevisto += valor;
    if (r.status === 'RECEBIDO' || (r.valor_recebido && r.valor_recebido >= valor)) {
      recRecebido += r.valor_recebido || valor;
    } else if (r.data_vencimento && r.data_vencimento < hoje) {
      recVencido += valor;
    }
  }
  const recEmAberto = Math.max(recPrevisto - recRecebido, 0);

  // Agregados — despesa
  let despPrevisto = 0, despPago = 0, despVencido = 0;
  for (const d of despesas) {
    if (d.status === 'CANCELADO') continue;
    const valor = d.valor_final || 0;
    despPrevisto += valor;
    if (d.status === 'PAGO' || (d.valor_pago && d.valor_pago >= valor)) {
      despPago += d.valor_pago || valor;
    } else if (d.data_vencimento && d.data_vencimento < hoje) {
      despVencido += valor;
    }
  }
  const despEmAberto = Math.max(despPrevisto - despPago, 0);

  // Lucros + margens
  const lucroPrevisto = recPrevisto - despPrevisto;
  const lucroRealizado = recRecebido - despPago;
  const margemPrevista = recPrevisto > 0 ? (lucroPrevisto / recPrevisto) * 100 : 0;
  const margemRealizada = recRecebido > 0 ? (lucroRealizado / recRecebido) * 100 : 0;

  // Lucro por pax (com base em confirmados)
  const lucroPorPax = qtdPaxConfirmados > 0 ? lucroPrevisto / qtdPaxConfirmados : 0;

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
