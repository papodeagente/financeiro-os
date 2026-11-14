// Mudança de sistema (E4, 05/11/2026): andamento da aplicação. Só administrador.
//   GET → { situacao, feitos, total, etapas: [{ tipo_lista, feitos, total, situacao, erro }], atualizado_em, erro }
import { NextResponse } from 'next/server';
import { naRota } from '@/lib/migracao/rota';
import { lerLote } from '@/lib/migracao/servidor';
import { progressoParaTela } from '@/lib/migracao/telas';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    return NextResponse.json(await progressoParaTela(exec, tenantId, await lerLote(exec, tenantId, id)));
  });
}
