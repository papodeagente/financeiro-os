// Mudança de sistema (E4, 05/11/2026): lotes da agência. Só administrador.
//   GET  → { lotes: Lote[] } (o mais recente primeiro)
//   POST { data_corte, nome?, opcoes? } + Idempotency-Key → Lote (409 LOTE_ABERTO se já há um em andamento)
import { NextResponse } from 'next/server';
import { emTransacao } from '@/lib/caixa-atomico';
import { chaveDeIdempotencia, corpoJson, naRota } from '@/lib/migracao/rota';
import { criarLote, listarLotes } from '@/lib/migracao/servidor';
import { loteParaTela } from '@/lib/migracao/telas';

export const dynamic = 'force-dynamic';

export async function GET() {
  return naRota(async ({ exec, tenantId }) => {
    const lotes = await listarLotes(exec, tenantId);
    const out = [];
    for (const l of lotes) out.push(await loteParaTela(exec, tenantId, l));
    return NextResponse.json({ lotes: out });
  });
}

export async function POST(req: Request) {
  return naRota(async ({ tenantId, quem }) => {
    const corpo = await corpoJson(req);
    const chave = chaveDeIdempotencia(req);
    const lote = await emTransacao(async exec => loteParaTela(exec, tenantId, await criarLote(exec, tenantId, corpo, quem, chave)));
    return NextResponse.json(lote);
  });
}
