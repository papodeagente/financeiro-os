// Mudança de sistema (E4, 05/11/2026): um arquivo do lote. Só administrador.
//   PATCH  { tipo_lista?, movimento?: 'pagar'|'receber'|null } → ArquivoDoLote
//   DELETE → Lote
import { NextResponse } from 'next/server';
import { emTransacao } from '@/lib/caixa-atomico';
import { corpoJson, naRota } from '@/lib/migracao/rota';
import { atualizarArquivo, lerLote, removerArquivo } from '@/lib/migracao/servidor';
import { arquivoParaTela, loteParaTela } from '@/lib/migracao/telas';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; arquivoId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ tenantId }) => {
    const { id, arquivoId } = await params;
    const corpo = await corpoJson(req);
    const a = await emTransacao(exec => atualizarArquivo(exec, tenantId, id, arquivoId, {
      lista: corpo.tipo_lista ?? corpo.lista,
      ...(corpo.movimento !== undefined ? { opcoes: { movimento: corpo.movimento } } : {}),
    }));
    return NextResponse.json(arquivoParaTela(a));
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ tenantId }) => {
    const { id, arquivoId } = await params;
    return NextResponse.json(await emTransacao(async exec => {
      await removerArquivo(exec, tenantId, id, arquivoId);
      return loteParaTela(exec, tenantId, await lerLote(exec, tenantId, id));
    }));
  });
}
