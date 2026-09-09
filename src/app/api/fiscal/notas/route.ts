import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { emitirNota, listarNotas } from '@/lib/nfse-servico';
import { ErroFiscal } from '@/lib/nfse-emissor';
import type { OpcoesDaNota } from '@/lib/nfse-servico';

export async function GET() {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    return NextResponse.json(await listarNotas(await getTenantId()));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Emite a nota de uma conta a receber já recebida. */
export async function POST(req: Request) {
  try {
    await initDB();
    const sessao = await getSession();
    const bloqueio = bloqueioFinanceiro(sessao, 'escrever');
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

    const nota = await emitirNota(tenantId, contaId, opcoes, {
      id: sessao?.userId ?? '',
      nome: sessao?.nome ?? '',
    });
    return NextResponse.json(nota);
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao emitir a nota.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
