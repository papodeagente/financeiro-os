// Mudança de sistema (E4, 05/11/2026): um lote. Só administrador.
//   GET   → Lote
//   PATCH { data_corte?, nome?, opcoes?: { papel_padrao?, empresas? } } → Lote (só antes de aplicar; invalida o ensaio)
import { NextResponse } from 'next/server';
import { emTransacao } from '@/lib/caixa-atomico';
import { corpoJson, naRota } from '@/lib/migracao/rota';
import { atualizarLote, lerLote } from '@/lib/migracao/servidor';
import { loteParaTela } from '@/lib/migracao/telas';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    return NextResponse.json(await loteParaTela(exec, tenantId, await lerLote(exec, tenantId, id)));
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ tenantId }) => {
    const { id } = await params;
    const corpo = await corpoJson(req);
    return NextResponse.json(await emTransacao(async exec => loteParaTela(exec, tenantId, await atualizarLote(exec, tenantId, id, corpo))));
  });
}
