import { NextResponse } from 'next/server';

import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { formatarDocumento } from '@/lib/cliente-documento';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { hojeISO } from '@/lib/money';
import { contasPermitidas } from '@/lib/permissoes-servidor';
import { contaReceberDoTenant, lerRecibo } from '@/lib/cobranca/recibo-servidor';

/**
 * Recibo de uma conta a receber (05/11/2026), para a página de imprimir.
 *
 *   GET /api/recibos/<conta>            recibo da conta inteira (precisa estar recebida)
 *   GET /api/recibos/<conta>?baixa=<id> recibo de um recebimento
 *
 * Só leitura. A conta baixada numa conta bancária que a pessoa não enxerga
 * some, como nas listas (regra das contas liberadas).
 */
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request, { params }: { params: Promise<{ conta: string }> }) {
  try {
    const recusa = await recusaFinanceira('ler');
    if (recusa) return recusa;
    const sessao = await getSession();
    const tenant = sessao?.impersonatingTenantId || sessao?.tenantId;
    if (!tenant) return NextResponse.json({ error: 'Agência não identificada.' }, { status: 403, headers: HEADERS });
    const { conta: contaId } = await params;
    const baixaId = new URL(req.url).searchParams.get('baixa');
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503, headers: HEADERS });
    const exec = pool as unknown as ExecutorSQL;
    const conta = await contaReceberDoTenant(exec, tenant, contaId);
    if (!conta) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404, headers: HEADERS });
    const liberadas = await contasPermitidas(sessao);
    const banco = String(conta.data.conta_bancaria_id ?? '');
    if (liberadas !== null && banco && !liberadas.includes(banco)) {
      return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404, headers: HEADERS });
    }
    const r = await lerRecibo(exec, tenant, conta, { baixaId, hoje: hojeISO(), documento: formatarDocumento });
    if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: 422, headers: HEADERS });
    return NextResponse.json(r.recibo, { headers: HEADERS });
  } catch (e) {
    console.error('[recibos] falha:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível montar o recibo. Tente de novo.' }, { status: 500, headers: HEADERS });
  }
}
