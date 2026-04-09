import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { generateId } from '@/lib/utils';
import { simularFunil } from '@/lib/funil-engine';
import type { FunilData, CenarioComparativo } from '@/lib/funil-types';

interface SimularBody {
  cenario_id?: CenarioComparativo['id'];
}

/**
 * POST /api/funis/[id]/simular
 *
 * Carrega o funil, executa o motor usando os dados reais do tenant (quando
 * o flag estiver ativo no próprio funil) e persiste a simulação em
 * `funis_simulacoes`. Devolve nodes com resultado preenchido + KPIs.
 *
 * Leitura dos dados reais usa a mesma função de /api/funis/dados-reais para
 * evitar duplicação.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const tenantId = await getTenantId();

    const { rows } = await pool.query(
      `SELECT data FROM funis WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 });

    const funilRecord = rows[0].data as { id: string; nome: string; status: string; data: FunilData };
    const funilData = funilRecord.data;
    const body = (await req.json().catch(() => ({}))) as SimularBody;
    const cenario = funilData.cenarios?.find(c => c.id === (body.cenario_id ?? 'baseline'))
      ?? funilData.cenarios?.[0];

    // Carrega dados reais se flag ativa (importação dinâmica para não criar dep circular).
    let dadosReais;
    if (funilData.config?.usar_dados_reais) {
      const { getDadosReaisAgencia } = await import('@/lib/funil-dados-reais');
      dadosReais = await getDadosReaisAgencia(tenantId);
    }

    const { nodes, kpis } = simularFunil(
      funilData.nodes,
      funilData.edges,
      cenario,
      dadosReais,
      funilData.config?.usar_dados_reais ?? false,
    );

    // Persistir registro da simulação
    const simId = generateId();
    const executadoEm = new Date().toISOString();
    const simulacaoPayload = {
      id: simId,
      funil_id: id,
      data: {
        cenario_id: cenario?.id ?? 'baseline',
        kpis,
        nodes_resultado: nodes.map(n => ({ id: n.id, resultado: n.data.resultado ?? null })),
        executada_em: executadoEm,
      },
    };
    await pool.query(
      `INSERT INTO funis_simulacoes (id, funil_id, tenant_id, data, created_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())`,
      [simId, id, tenantId, JSON.stringify(simulacaoPayload)],
    );

    // Atualiza funil com ultimo_simulado_at e nodes atualizados + status
    const novoStatus = funilRecord.status === 'rascunho' ? 'simulado' : funilRecord.status;
    const novoFunil = {
      ...funilRecord,
      status: novoStatus,
      data: {
        ...funilData,
        nodes,
        ultimo_simulado_at: executadoEm,
      },
    };
    await pool.query(
      `UPDATE funis SET data = $1::jsonb, status = $2, updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [JSON.stringify(novoFunil), novoStatus, id, tenantId],
    );

    return NextResponse.json({ nodes, kpis, simulacao_id: simId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
