import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { pdfDoCarne } from '@/lib/cobranca/servidor';
import { respostaDeErroDaCobranca } from '@/lib/cobranca/rota';

// PDF do carnê a que esta cobrança pertence (E3, 05/11/2026), direto do provedor.
//   GET → application/pdf
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  const { id } = await params;
  try {
    const pdf = await pdfDoCarne(await getTenantId(), id);
    return new NextResponse(pdf.conteudo, {
      headers: {
        'Content-Type': pdf.tipo || 'application/pdf',
        'Content-Disposition': `inline; filename="carne-${id}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'PDF do carnê');
  }
}
