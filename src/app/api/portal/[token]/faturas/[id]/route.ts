import pool, { initDB } from '@/lib/db';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { porteiroDoPortal, respostaDoPortal, respostaLinkNaoAbre } from '@/lib/cobranca/portal-porteiro';
import { recusaModuloDaAgencia } from '@/lib/guarda-rota';
import { aprovarNoPortal, contestarNoPortal, ErroFatura, faturasDoPortal } from '@/lib/fatura-servidor';
import { documentoDaFaturaNoPortal } from '@/lib/cobranca/portal-fatura';

/**
 * O cliente responde a fatura no portal (E5, parte B), sem login, pelo link pessoal:
 *   POST /api/portal/<token>/faturas/<id>  { acao: 'aprovar', nome? }
 *                                          { acao: 'contestar', itens: [{ conta_id, motivo }], nome? }
 * Só faturas FECHADAS do cliente do link. A contestação avisa a agência no sino e fica no histórico da fatura.
 * Exige corpo JSON (um formulário de outro site não consegue mandar).
 */
export const dynamic = 'force-dynamic';

/**
 * O documento da fatura para o cliente ler e salvar em PDF (E7): GET /api/portal/<token>/faturas/<id>.
 * Só fatura FECHADA do cliente do link; o recorte é o da folha impressa (src/lib/cobranca/portal-fatura.ts).
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await params;
    await initDB();
    if (!pool) return respostaDoPortal({ error: 'Serviço indisponível. Tente em alguns minutos.' }, 503);
    const exec = pool as unknown as ExecutorSQL;
    const p = await porteiroDoPortal(req, exec, token);
    if ('resposta' in p) return p.resposta;
    const semModulo = await recusaModuloDaAgencia(p.link.tenant_id, 'cobranca', respostaLinkNaoAbre);
    if (semModulo) return semModulo;
    const doc = await documentoDaFaturaNoPortal(exec, p.link, id);
    if (!doc) return respostaDoPortal({ error: 'Fatura não encontrada.' }, 404);
    return respostaDoPortal(doc);
  } catch (e) {
    console.error('[portal-fatura] falha:', e instanceof Error ? e.message : e);
    return respostaDoPortal({ error: 'Não foi possível abrir agora. Tente de novo em alguns minutos.' }, 500);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await params;
    if (!(req.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      return respostaDoPortal({ error: 'Pedido inválido.' }, 415);
    }
    await initDB();
    if (!pool) return respostaDoPortal({ error: 'Serviço indisponível. Tente em alguns minutos.' }, 503);
    const exec = pool as unknown as ExecutorSQL;
    const p = await porteiroDoPortal(req, exec, token);
    if ('resposta' in p) return p.resposta;
    const semModulo = await recusaModuloDaAgencia(p.link.tenant_id, 'cobranca', respostaLinkNaoAbre);
    if (semModulo) return semModulo;
    const corpo = (await req.json().catch(() => null)) as { acao?: string; itens?: Array<{ conta_id: string; motivo: string }>; nome?: string } | null;
    const quem = String(corpo?.nome ?? '').trim().slice(0, 120);
    if (corpo?.acao === 'aprovar') await emTransacao(e => aprovarNoPortal(e, p.link, id, quem));
    else if (corpo?.acao === 'contestar') await emTransacao(e => contestarNoPortal(e, p.link, id, corpo.itens ?? [], quem));
    else return respostaDoPortal({ error: 'Diga se aprova ou contesta a fatura.' }, 400);
    const fatura = (await faturasDoPortal(exec, p.link, hojeISO())).find(f => f.id === id) ?? null;
    return respostaDoPortal({ fatura });
  } catch (e) {
    if (e instanceof ErroFatura) return respostaDoPortal({ error: e.message, codigo: e.codigo }, e.status);
    console.error('[portal-faturas] falha:', e instanceof Error ? e.message : e);
    return respostaDoPortal({ error: 'Não foi possível registrar agora. Tente de novo em alguns minutos.' }, 500);
  }
}
