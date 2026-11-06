// Mês em paralelo (E7, 06/11/2026): compara as listas do mês do sistema
// anterior com o que foi lançado aqui. Só administrador. Só LÊ.
//   GET → RelatorioDoMes (em reais): o que bate, só lá, só aqui, valor e data
//         diferentes; por conta, por pessoa e por categoria.
import { NextResponse } from 'next/server';
import { compararMesEmParalelo, relatorioParaTela } from '@/lib/migracao/paralelo';
import { naRota } from '@/lib/migracao/rota';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    return NextResponse.json(relatorioParaTela(await compararMesEmParalelo(exec, tenantId, id)));
  });
}
