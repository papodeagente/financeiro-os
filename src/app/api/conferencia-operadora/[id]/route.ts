import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { pode } from '@/lib/permissoes-servidor';
import { registrarEventoAuditoria } from '@/lib/audit';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import {
  acaoNaLinha, detalheDaConferencia, ErroConferencia, fecharConferencia, reabrirConferencia, recasarConferencia,
} from '@/lib/conferencia-operadora-servidor';

/**
 * Uma conferência de extrato de operadora (E6, 05/11/2026).
 *
 * GET  → a conferência, as linhas (Válido, situação, diferença explicada,
 *        proposta de cancelamento), se dá para fechar e a comissão.
 * POST { acao, linha_id?, motivo?, item_id? }
 *   aceitar | desfazer_aceite | ligar | descartar_proposta  (numa linha)
 *   recasar   casa de novo com as vendas de agora
 *   fechar    trava o período (direito "Fechar caixa")
 *   reabrir   com motivo (direito "Reabrir caixa")
 * Nenhuma ação mexe em venda, conta ou saldo: cancelamento é só proposta.
 */
export const dynamic = 'force-dynamic';

function erro(e: unknown) {
  if (e instanceof ErroConferencia) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error('[conferencia-operadora]', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível concluir. Nada foi gravado.' }, { status: 500 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('conciliar');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    const d = await detalheDaConferencia(pool as unknown as ExecutorSQL, tenantId, id);
    const verComissao = await pode(await getSession(), 'ver_colunas_comissao');
    return NextResponse.json(verComissao ? d : { ...d, comissao: null });
  } catch (e) {
    return erro(e);
  }
}

const ACOES_DA_LINHA = new Set(['aceitar', 'desfazer_aceite', 'ligar', 'descartar_proposta']);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('extrato');
  if (semModulo) return semModulo;
  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const acao = String(corpo?.acao ?? '');
  const recusa = await recusaAcao(acao === 'fechar' ? 'fechar_periodo' : acao === 'reabrir' ? 'reabrir_periodo' : 'conciliar');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
  try {
    const { id } = await params;
    const sessao = await getSession();
    const tenantId = await getTenantId();
    const quem = { usuarioId: sessao?.userId, usuarioNome: sessao?.nome };

    if (ACOES_DA_LINHA.has(acao)) {
      await emTransacao(x => acaoNaLinha(x, tenantId, id, String(corpo?.linha_id ?? ''), acao as Parameters<typeof acaoNaLinha>[4], {
        motivo: corpo?.motivo ? String(corpo.motivo) : undefined,
        item_id: corpo?.item_id ? String(corpo.item_id) : undefined,
      }, quem));
      return NextResponse.json({ ok: true });
    }
    if (acao === 'recasar') {
      return NextResponse.json(await emTransacao(x => recasarConferencia(x, tenantId, id)));
    }
    if (acao === 'fechar' || acao === 'reabrir') {
      if (acao === 'fechar') await emTransacao(x => fecharConferencia(x, tenantId, id, quem));
      else await emTransacao(x => reabrirConferencia(x, tenantId, id, String(corpo?.motivo ?? ''), quem));
      await registrarEventoAuditoria({
        tenantId, acao: 'EDITAR', modulo: 'Financeiro', entidade: 'conferencias_operadora', entidadeId: id,
        descricao: acao === 'fechar' ? 'Fechou a conferência do extrato da operadora.' : `Reabriu a conferência do extrato da operadora: ${String(corpo?.motivo ?? '').slice(0, 200)}`,
      }).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (e) {
    return erro(e);
  }
}
