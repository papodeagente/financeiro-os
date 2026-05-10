import { NextRequest, NextResponse } from 'next/server';
import { processarEventoCRM, verificarAssinaturaCRM } from '@/lib/crm-integration';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await ctx.params;
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId ausente no path' }, { status: 400 });
    }

    const bodyText = await req.text();
    const signature = req.headers.get('x-crm-signature') || '';

    const valid = await verificarAssinaturaCRM(bodyText, signature, tenantId);
    if (!valid) {
      return NextResponse.json({ error: 'Assinatura invalida' }, { status: 401 });
    }

    const body = JSON.parse(bodyText);
    const { id, tipo, payload } = body;

    if (!id || !tipo || !payload) {
      return NextResponse.json({ error: 'Campos obrigatorios: id, tipo, payload' }, { status: 400 });
    }

    const resultado = await processarEventoCRM(tipo, payload, id, tenantId);

    return NextResponse.json({
      recebido: true,
      processado: resultado.processado,
      evento_id: id,
      acao: resultado.acao,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ recebido: false, error: msg }, { status: 500 });
  }
}
