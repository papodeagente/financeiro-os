import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { montarPrevia, type OpcoesDaNota } from '@/lib/nfse-servico';

/**
 * Prévia da nota: os números que sairiam, as pendências que impedem e os
 * avisos a ler antes de emitir.
 *
 * É POST porque recebe as escolhas de quem está emitindo (regime, alíquota,
 * discriminação) e recalcula. Não grava nada.
 */
export async function POST(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();

    const corpo = await req.json();
    const contaId = String(corpo?.conta_receber_id ?? '').trim();
    if (!contaId) {
      return NextResponse.json({ error: 'Informe a conta a receber.' }, { status: 400 });
    }

    const opcoes: OpcoesDaNota = {
      regime: corpo?.regime,
      forma_base: corpo?.forma_base,
      discriminacao: typeof corpo?.discriminacao === 'string' ? corpo.discriminacao : undefined,
      aliquota_iss: corpo?.aliquota_iss,
      iss_retido: corpo?.iss_retido,
      deducao_manual: corpo?.deducao_manual ?? null,
      desconto_incondicionado: corpo?.desconto_incondicionado ?? 0,
      intermediario: corpo?.intermediario ?? undefined,
    };

    const previa = await montarPrevia(tenantId, contaId, opcoes);
    if (!previa) return NextResponse.json({ error: 'Conta a receber não encontrada' }, { status: 404 });
    return NextResponse.json(previa);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
