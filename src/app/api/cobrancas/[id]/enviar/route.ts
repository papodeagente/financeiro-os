import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao } from '@/lib/guarda-rota';
import { enviarCobranca } from '@/lib/cobranca/servidor';
import { chaveDe, lerCorpo, quemEsta, respostaDeErroDaCobranca } from '@/lib/cobranca/rota';
import type { CanalCobranca } from '@/lib/cobranca/config';

// Pede ao CRM para mandar a cobrança ao cliente (E3, 05/11/2026).
//   POST { canal: 'email' | 'whatsapp' } (cabeçalho Idempotency-Key) → { ok: true, enviado: true, canal }. O CRM manda por e-mail ou por
//   modelo aprovado de WhatsApp (evento COBRANCA_ENVIAR). Sem CRM ligado: 409 com a frase para a tela.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const corpo = await lerCorpo<{ canal?: CanalCobranca }>(req);
  try {
    const r = await enviarCobranca(await getTenantId(), id, corpo?.canal as CanalCobranca, { quem: await quemEsta(), idempotencia: chaveDe(req) });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'enviar');
  }
}
