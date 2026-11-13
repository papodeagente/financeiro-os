import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { carregarConfigFiscal } from '@/lib/nfse-servico';
import { emissorDaConfig, ErroFiscal } from '@/lib/nfse-emissor';
import { cabecalhoDeDownload, decidirArquivo, ehTipoDeArquivo } from '@/lib/nota-arquivo';
import type { NotaFiscal } from '@/lib/nfse-tipos';

/**
 * Entrega o PDF ou o XML da nota fiscal.
 *
 * Esta rota existe porque o link do emissor NÃO abre no navegador: a PlugNotas
 * exige `x-api-key` e a AceleraAPI exige `Bearer` em todo acesso ao arquivo.
 * Um <a href> apontando para o link cru dá erro de autenticação em vez do
 * documento. Então quem busca é o servidor, com a chave da agência, e o
 * navegador recebe só os bytes.
 *
 * A chave nunca chega ao navegador — é o ponto da rota.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });

    const tipo = new URL(req.url).searchParams.get('tipo') ?? 'pdf';
    if (!ehTipoDeArquivo(tipo)) {
      return NextResponse.json({ error: 'Só existe pdf e xml.' }, { status: 400 });
    }

    const { id } = await ctx.params;
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });

    // tenant_id na cláusula: é a única coisa que separa as agências aqui.
    const { rows } = await pool.query(
      `SELECT data FROM notas_fiscais WHERE id = $1 AND tenant_id = $2`,
      [id, await getTenantId()],
    );
    const nota = (rows[0]?.data ?? null) as NotaFiscal | null;
    if (!nota) return NextResponse.json({ error: 'Nota não encontrada.' }, { status: 404 });

    const decisao = decidirArquivo(nota, tipo);
    if (!decisao.pode) {
      return NextResponse.json({ error: decisao.mensagem }, { status: 409 });
    }

    const config = await carregarConfigFiscal(await getTenantId());
    const arquivo = await emissorDaConfig(config).baixarArquivo(
      decisao.url,
      decisao.tipo_conteudo,
      config,
    );

    return new NextResponse(new Uint8Array(arquivo.bytes), {
      headers: {
        'Content-Type': arquivo.tipo_conteudo,
        'Content-Disposition': cabecalhoDeDownload(decisao.nome_arquivo),
        'Content-Length': String(arquivo.bytes.byteLength),
        // Documento fiscal de um cliente: nunca num cache compartilhado.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    if (e instanceof ErroFiscal) {
      return NextResponse.json({ error: e.message, detalhe: e.detalhe }, { status: 502 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao baixar a nota.' },
      { status: 500 },
    );
  }
}
