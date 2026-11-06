// Mudança de sistema (E4, 05/11/2026): desfazer. Só administrador.
//   POST { modo: 'previa' } → { apagar: [{ tipo_lista, quantidade }], ficam: [{ tipo_lista, descricao, motivo }], vinculos_soltos, assinatura }
//   POST { modo: 'gravar', assinatura } + Idempotency-Key → { lote, apagados, ficaram }
// Sai só o que o lote criou e ninguém mudou depois (inclusive os saldos de
// abertura, por um movimento de caixa explícito). O resto fica, com o motivo.
import { NextResponse } from 'next/server';
import { desfazerLote } from '@/lib/migracao/desfazer';
import { chaveDeIdempotencia, corpoJson, naRota } from '@/lib/migracao/rota';
import { ErroMudanca, guardarResposta, lerLote, respostaGuardada } from '@/lib/migracao/servidor';
import { loteParaTela, previaDoDesfazerParaTela } from '@/lib/migracao/telas';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    const corpo = await corpoJson(req);
    if (corpo.modo !== 'gravar') return NextResponse.json(previaDoDesfazerParaTela(await desfazerLote(tenantId, id, false)));
    if (typeof corpo.assinatura !== 'string' || !corpo.assinatura) {
      throw new ErroMudanca('Veja a prévia do que vai ser desfeito antes de confirmar.', 400, 'ASSINATURA_VENCIDA');
    }
    const chave = chaveDeIdempotencia(req);
    const guardada = await respostaGuardada(exec, tenantId, id, chave);
    if (guardada) return NextResponse.json(guardada);
    let r;
    try {
      r = await desfazerLote(tenantId, id, true, corpo.assinatura);
    } catch (e) {
      // Duplo clique: o primeiro já desfez e guardou a resposta.
      const depois = e instanceof ErroMudanca && e.codigo === 'ASSINATURA_VENCIDA' ? await respostaGuardada(exec, tenantId, id, chave) : null;
      if (depois) return NextResponse.json(depois);
      throw e;
    }
    const tela = previaDoDesfazerParaTela(r);
    const resposta = {
      lote: await loteParaTela(exec, tenantId, await lerLote(exec, tenantId, id)),
      apagados: Object.values(r.apagados).reduce((s, n) => s + n, 0) + r.saldos_estornados,
      apagados_por_lista: tela.apagar, ficaram: tela.ficam,
    };
    await guardarResposta(exec, tenantId, id, chave, resposta);
    return NextResponse.json(resposta);
  });
}
