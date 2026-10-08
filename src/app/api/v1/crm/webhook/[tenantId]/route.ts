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

    // JSON quebrado não melhora com nova tentativa: 400, e não 500.
    let body: { id?: string; tipo?: string; payload?: Record<string, unknown> };
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: 'Corpo nao e JSON valido' }, { status: 400 });
    }
    const { id, tipo, payload } = body ?? {};

    if (!id || !tipo || !payload) {
      return NextResponse.json({ error: 'Campos obrigatorios: id, tipo, payload' }, { status: 400 });
    }

    const resultado = await processarEventoCRM(tipo, payload, id, tenantId);

    // Evento que FALHOU responde 5xx: é o que faz o CRM tentar de novo com o
    // backoff dele. Antes a falha voltava 200, o CRM dava o evento por
    // entregue e a venda nunca entrava. Duplicata e tipo ignorado continuam
    // 200 (processado=true). O reprocessamento é seguro: o evento com ERRO é
    // refeito pelo mesmo caminho idempotente.
    return NextResponse.json({
      recebido: true,
      processado: resultado.processado,
      evento_id: id,
      acao: resultado.acao,
      ...(resultado.processado ? {} : { erro: resultado.erro ?? resultado.acao }),
    }, { status: resultado.processado ? 200 : 500 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ recebido: false, error: msg }, { status: 500 });
  }
}
