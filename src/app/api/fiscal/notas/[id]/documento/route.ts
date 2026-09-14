import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { carregarConfigFiscal } from '@/lib/nfse-servico';
import { ErroFiscal } from '@/lib/nfse-emissor';
import { baixarDocumentoNota } from '@/lib/nfse-acelera';
import type { NotaFiscal } from '@/lib/nfse-tipos';

/**
 * Entrega o PDF ou o XML da nota para download.
 *
 * O servidor busca no emissor com a credencial da agência e devolve o arquivo.
 * Um link direto para a URL do emissor não funciona: ela exige o token no
 * cabeçalho, e pôr o token na URL para contornar isso seria deixar a
 * credencial de emissão de notas no histórico do navegador.
 *
 * A nota é carregada pelo tenant da sessão antes de qualquer coisa: sem isso,
 * trocar o id na URL baixaria a nota de outra agência.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const tenantId = await getTenantId();
    const { id } = await params;

    const tipo = new URL(req.url).searchParams.get('tipo') === 'xml' ? 'xml' : 'pdf';

    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 500 });
    const { rows } = await pool.query(
      `SELECT data FROM notas_fiscais WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const nota = (rows[0]?.data ?? null) as NotaFiscal | null;
    if (!nota) return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    if (nota.status !== 'AUTORIZADA' && nota.status !== 'CANCELADA') {
      return NextResponse.json(
        { error: 'Esta nota ainda não foi autorizada, então não tem documento para baixar.' },
        { status: 400 },
      );
    }

    const config = await carregarConfigFiscal(tenantId);
    const doc = await baixarDocumentoNota(nota.protocolo || nota.id, tipo, config);

    // Nome que a pessoa reconhece na pasta de downloads.
    const nome = `NFSe-${(nota.numero || nota.id).replace(/[^A-Za-z0-9-]/g, '')}.${doc.extensao}`;

    return new NextResponse(Buffer.from(doc.bytes), {
      status: 200,
      headers: {
        'Content-Type': doc.tipo,
        'Content-Disposition': `attachment; filename="${nome}"`,
        'Content-Length': String(doc.bytes.byteLength),
        // Documento fiscal não é para ficar em cache de proxy.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao baixar o documento.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
