import { NextRequest, NextResponse } from 'next/server';
import { configSites, lerEnvelopeSites, receberEventoSites, verificarAssinaturaSites } from '@/lib/sites-integration';
import { decifrar } from '@/lib/cofre';

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  if (!tenantId || tenantId.length > 100) return NextResponse.json({ erro: 'Agência inválida' }, { status: 400 });
  const corpo = await req.text();
  if (Buffer.byteLength(corpo, 'utf8') > 131_072) return NextResponse.json({ erro: 'Evento grande demais' }, { status: 413 });
  try {
    const cfg = await configSites(tenantId);
    if (!cfg?.ativo || !verificarAssinaturaSites(corpo, req.headers.get('x-enturos-signature') ?? '', decifrar(cfg.segredo))) {
      return NextResponse.json({ erro: 'Assinatura inválida' }, { status: 401 });
    }
    let valor: unknown;
    try { valor = JSON.parse(corpo); } catch { return NextResponse.json({ erro: 'JSON inválido' }, { status: 400 }); }
    const evento = lerEnvelopeSites(valor, cfg.company_id);
    if (!evento) return NextResponse.json({ erro: 'Evento inválido ou não aceito' }, { status: 422 });
    const resultado = await receberEventoSites(tenantId, evento, corpo);
    return NextResponse.json({ recebido: true, id: evento.id, duplicado: resultado.duplicado });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('ID de evento reutilizado')) {
      return NextResponse.json({ erro: e.message }, { status: 409 });
    }
    console.error('[sites-webhook]', e);
    return NextResponse.json({ erro: 'Falha ao registrar evento' }, { status: 500 });
  }
}
