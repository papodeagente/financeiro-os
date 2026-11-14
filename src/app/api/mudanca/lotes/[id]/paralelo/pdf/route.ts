// Mês em paralelo (E7, 06/11/2026): o relatório em PDF. Só administrador. Só LÊ.
//   GET → application/pdf
import { NextResponse } from 'next/server';
import { agenciaDoTenant } from '@/lib/cobranca/recibo-servidor';
import { compararMesEmParalelo } from '@/lib/migracao/paralelo';
import { pdfDoMesEmParalelo } from '@/lib/migracao/pdf';
import { naRota } from '@/lib/migracao/rota';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    const r = await compararMesEmParalelo(exec, tenantId, id);
    const ag = await agenciaDoTenant(exec, tenantId);
    const bytes = await pdfDoMesEmParalelo(r, ag?.nome_fantasia || ag?.nome || ag?.razao_social || '');
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="mes-em-paralelo-${r.mes}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
