// Mudança de sistema (E4, 05/11/2026): "Concluir mudança". Só administrador.
//   POST { modo: 'previa' } → { liga: string[], avisos: string[], assinatura }
//   POST { modo: 'gravar', assinatura } + Idempotency-Key → Lote
// Depois de concluir, régua de cobrança, avisos de vencimento e emissão de
// cobranças voltam a sair para esta agência.
import { NextResponse } from 'next/server';
import { emTransacao } from '@/lib/caixa-atomico';
import { chaveDeIdempotencia, corpoJson, naRota } from '@/lib/migracao/rota';
import { concluirLote, ErroMudanca, guardarResposta, lerLote, respostaGuardada } from '@/lib/migracao/servidor';
import { assinaturaDoConcluir, loteParaTela, previaDoConcluir } from '@/lib/migracao/telas';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    const corpo = await corpoJson(req);
    if (corpo.modo !== 'gravar') return NextResponse.json(await previaDoConcluir(exec, tenantId, await lerLote(exec, tenantId, id)));
    const chave = chaveDeIdempotencia(req);
    const guardada = await respostaGuardada(exec, tenantId, id, chave);
    if (guardada) return NextResponse.json(await loteParaTela(exec, tenantId, await lerLote(exec, tenantId, id)));
    await emTransacao(async tx => {
      const lote = await lerLote(tx, tenantId, id, true);
      if (lote.status !== 'concluido' && corpo.assinatura !== assinaturaDoConcluir(lote)) {
        throw new ErroMudanca('A mudança mudou desde a prévia. Veja de novo antes de concluir.', 409, 'ASSINATURA_VENCIDA');
      }
      await concluirLote(tx, tenantId, id);
      await guardarResposta(tx, tenantId, id, chave, { concluir: true });
    });
    return NextResponse.json(await loteParaTela(exec, tenantId, await lerLote(exec, tenantId, id)));
  });
}
