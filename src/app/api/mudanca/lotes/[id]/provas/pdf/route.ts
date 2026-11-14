// Mudança de sistema (E4, 05/11/2026): PDF "Prova da mudança", para o
// contador. Só administrador.
//   GET → application/pdf
import { NextResponse } from 'next/server';
import { agenciaDoTenant } from '@/lib/cobranca/recibo-servidor';
import { pdfDaProva } from '@/lib/migracao/pdf';
import { provasDoLote } from '@/lib/migracao/provas';
import { naRota } from '@/lib/migracao/rota';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    const prova = await provasDoLote(exec, tenantId, id);
    const ag = await agenciaDoTenant(exec, tenantId);
    const bytes = await pdfDaProva(prova, ag?.nome_fantasia || ag?.nome || ag?.razao_social || '');
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="prova-da-mudanca-${prova.data_corte ?? id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
