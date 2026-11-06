import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao } from '@/lib/guarda-rota';
import { enviarFatura } from '@/lib/cobranca/envio-fatura';
import { chaveDe, lerCorpo, quemEsta, respostaDeErroDaCobranca } from '@/lib/cobranca/rota';

// "Enviar por e-mail" da ficha da fatura (E7, 06/11/2026).
//   POST { documentos: 'boleto' | 'fatura' | 'boleto_e_fatura', copia_para?, assunto?, mensagem? }
//   (cabeçalho Idempotency-Key) → { ok, enviado, com_boleto, na_fila?, motivo? }.
//   Com boleto em aberto: é o envio da cobrança, com a escolha. Sem boleto: só a fatura (o documento,
//   pelo link do portal do cliente). Fatura aberta: 409. Sai pelo e-mail do CRM (src/lib/cobranca/envio-fatura.ts).
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const corpo = await lerCorpo<Record<string, unknown>>(req);
  try {
    const r = await enviarFatura(await getTenantId(), id, corpo ?? null, { quem: await quemEsta(), idempotencia: chaveDe(req) });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'enviar fatura');
  }
}
