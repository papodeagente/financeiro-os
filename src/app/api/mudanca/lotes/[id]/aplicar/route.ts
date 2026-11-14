// Mudança de sistema (E4, 05/11/2026): aplicar o ensaio. Só administrador.
//   POST { assinatura } + Idempotency-Key → Lote
// Confere a assinatura do ensaio visto, põe o lote na fila do agendador e
// já grava os primeiros blocos aqui mesmo (mudança pequena termina na hora;
// o resto segue pela fila). Tudo dentro de "nada sai".
import { NextResponse } from 'next/server';
import { emTransacao } from '@/lib/caixa-atomico';
import { chaveDeIdempotencia, corpoJson, naRota } from '@/lib/migracao/rota';
import { avancarAplicacao, guardarResposta, iniciarAplicacao, lerLote, respostaGuardada } from '@/lib/migracao/servidor';
import { loteParaTela } from '@/lib/migracao/telas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    const corpo = await corpoJson(req);
    const chave = chaveDeIdempotencia(req);
    if (!(await respostaGuardada(exec, tenantId, id, chave))) {
      await emTransacao(async tx => {
        await iniciarAplicacao(tx, tenantId, id, corpo.assinatura);
        await guardarResposta(tx, tenantId, id, chave, { aplicar: true });
      });
      try {
        await avancarAplicacao(tenantId, id, 8_000);
      } catch (e) {
        // O que não coube (ou falhou) segue pela fila.
        console.error('[mudanca] aplicar na requisição:', e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json(await loteParaTela(exec, tenantId, await lerLote(exec, tenantId, id)));
  });
}
