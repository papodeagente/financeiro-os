import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { aprovarReembolso, cancelarReembolso, converterEmCredito, lerReembolso } from '@/lib/reembolsos-servidor';
import { lerJson, respostaDeErroDaParteD } from '@/lib/parte-d-rota';

// Um reembolso: ler e mudar de situação (E5, parte D). Contrato em src/lib/parte-d-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const r = await lerReembolso(pool as unknown as ExecutorSQL, await getTenantId(), id);
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(r);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaAcao('cuidar_reembolsos');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const tenantId = await getTenantId();
  const sessao = await getSession();
  const quem = sessao?.nome || sessao?.userId || '';
  const c = await lerJson<{ acao?: string; prazo?: string; motivo?: string; validade?: string }>(req);
  try {
    if (c?.acao === 'aprovar') return NextResponse.json(await emTransacao(e => aprovarReembolso(e, tenantId, id, quem, { prazo: c.prazo })));
    if (c?.acao === 'cancelar') return NextResponse.json(await emTransacao(e => cancelarReembolso(e, tenantId, id, String(c.motivo ?? ''), quem)));
    if (c?.acao === 'converter_em_credito') {
      const credito = await recusaAcao('usar_credito_cliente');
      if (credito) return credito;
      return NextResponse.json(await emTransacao(e => converterEmCredito(e, tenantId, id, quem, { validade: c.validade || undefined })));
    }
    return NextResponse.json({ error: 'Ação desconhecida.', codigo: 'ACAO' }, { status: 400 });
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}
