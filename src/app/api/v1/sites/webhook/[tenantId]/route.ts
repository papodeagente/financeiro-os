import { NextRequest, NextResponse } from 'next/server';
import { configSites, lerEnvelopeSites, receberEventoSites, verificarAssinaturaSites } from '@/lib/sites-integration';
import { decifrar } from '@/lib/cofre';
import { origemDoWebhook, permitirWebhookSites } from '@/lib/sites-webhook-rate-limit';

const LIMITE = 131_072;

async function lerCorpoLimitado(req: NextRequest): Promise<string | null> {
  const declarado = Number(req.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > LIMITE) return null;
  if (!req.body) return '';
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > LIMITE) { await leitor.cancel(); return null; }
      partes.push(value);
    }
  } finally { leitor.releaseLock(); }
  return Buffer.concat(partes.map((parte) => Buffer.from(parte))).toString('utf8');
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(tenantId)) return NextResponse.json({ erro: 'Agência inválida' }, { status: 400 });
  if (!permitirWebhookSites(tenantId, origemDoWebhook(req.headers))) {
    return NextResponse.json(
      { erro: 'Muitas tentativas. Tente novamente em instantes' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }
  const corpo = await lerCorpoLimitado(req);
  if (corpo === null) return NextResponse.json({ erro: 'Evento grande demais' }, { status: 413 });
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
