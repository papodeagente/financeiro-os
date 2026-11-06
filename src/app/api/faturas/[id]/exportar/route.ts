import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { detalheDaFatura } from '@/lib/fatura-servidor';
import { csvDe, linhasDaExportacao } from '@/lib/fatura-documento';
import { respostaDeErroDaFatura } from '@/lib/fatura-rota';

// Exportar a fatura para o sistema do cliente: GET ?formato=csv|xlsx (direito exportar).
// Um item por linha, depois as notas, as retenções e o total a pagar.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaAcao('exportar');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const formato = new URL(req.url).searchParams.get('formato') === 'xlsx' ? 'xlsx' : 'csv';
  try {
    const d = await detalheDaFatura(pool as unknown as ExecutorSQL, await getTenantId(), id);
    if (!d) return NextResponse.json({ error: 'Fatura não encontrada.', codigo: 'NAO_ACHOU' }, { status: 404 });
    const linhas = linhasDaExportacao({
      numero: d.fatura.numero, pessoa_nome: d.fatura.pessoa_nome, vencimento: d.fatura.vencimento, emissao: d.fatura.emissao,
      itens: d.itens, notas: d.notas, totais: d.totais,
    });
    const nome = `fatura-${d.fatura.numero}`;
    if (formato === 'csv') {
      return new NextResponse(csvDe(linhas), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${nome}.csv"`, 'Cache-Control': 'no-store' },
      });
    }
    const planilha = XLSX.utils.aoa_to_sheet(linhas);
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, `Fatura ${d.fatura.numero}`.slice(0, 31));
    const bytes = XLSX.write(livro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nome}.xlsx"`, 'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
