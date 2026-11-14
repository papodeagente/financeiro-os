import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { permitirChamada } from '@/lib/limite-publico';
import { CABECALHOS_DO_PORTAL, porteiroDoPortal, respostaDoPortal, respostaLinkNaoAbre } from '@/lib/cobranca/portal-porteiro';
import { recusaModuloDaAgencia } from '@/lib/guarda-rota';
import { notaDoPortal } from '@/lib/cobranca/portal-servidor';
import { carregarConfigFiscal } from '@/lib/nfse-servico';
import { emissorDaConfig, ErroFiscal } from '@/lib/nfse-emissor';
import { cabecalhoDeDownload, decidirArquivo, ehTipoDeArquivo, type NotaParaArquivo } from '@/lib/nota-arquivo';

/**
 * PDF ou XML da nota fiscal pelo portal do cliente (E7): GET /api/portal/<token>/nota/<id>?tipo=pdf|xml.
 * Só nota AUTORIZADA, do MESMO cliente e da MESMA agência do link, emitida para ele. O servidor
 * busca o arquivo no emissor com a chave da agência (o link do emissor não abre sem ela) e
 * entrega os bytes; a chave nunca chega ao navegador. Até 30 arquivos por link por hora.
 */
export const dynamic = 'force-dynamic';

const ARQUIVOS_POR_LINK_POR_HORA = 30;

export async function GET(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await params;
    const tipo = new URL(req.url).searchParams.get('tipo') ?? 'pdf';
    if (!ehTipoDeArquivo(tipo)) return respostaDoPortal({ error: 'Só existe PDF e XML.' }, 400);
    await initDB();
    if (!pool) return respostaDoPortal({ error: 'Serviço indisponível. Tente em alguns minutos.' }, 503);
    const exec = pool as unknown as ExecutorSQL;
    const p = await porteiroDoPortal(req, exec, token);
    if ('resposta' in p) return p.resposta;
    const semModulo = await recusaModuloDaAgencia(p.link.tenant_id, 'cobranca', respostaLinkNaoAbre);
    if (semModulo) return semModulo;
    if (!permitirChamada(`portal-nota:${p.link.id}`, ARQUIVOS_POR_LINK_POR_HORA, 3600_000)) {
      return respostaDoPortal({ error: 'Muitos arquivos baixados em pouco tempo. Tente de novo mais tarde.' }, 429);
    }
    const nota = await notaDoPortal(exec, p.link, id);
    if (!nota) return respostaDoPortal({ error: 'Nota não encontrada.' }, 404);
    const decisao = decidirArquivo(nota as NotaParaArquivo, tipo);
    if (!decisao.pode) return respostaDoPortal({ error: 'O arquivo desta nota não está disponível aqui. Peça à agência.' }, 409);
    const config = await carregarConfigFiscal(p.link.tenant_id, String(nota.empresa_id ?? ''));
    const arquivo = await emissorDaConfig(config).baixarArquivo(decisao.url, decisao.tipo_conteudo, config);
    return new NextResponse(new Uint8Array(arquivo.bytes), {
      headers: {
        ...CABECALHOS_DO_PORTAL,
        'Content-Type': arquivo.tipo_conteudo,
        'Content-Disposition': cabecalhoDeDownload(decisao.nome_arquivo),
        'Content-Length': String(arquivo.bytes.byteLength),
      },
    });
  } catch (e) {
    if (e instanceof ErroFiscal) return respostaDoPortal({ error: 'O emissor da nota não respondeu agora. Tente de novo em alguns minutos.' }, 502);
    console.error('[portal-nota] falha:', e instanceof Error ? e.message : e);
    return respostaDoPortal({ error: 'Não foi possível baixar agora. Tente de novo em alguns minutos.' }, 500);
  }
}
