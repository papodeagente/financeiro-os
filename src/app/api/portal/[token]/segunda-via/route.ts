import pool, { initDB } from '@/lib/db';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { porteiroDoPortal, respostaDoPortal, respostaLinkNaoAbre } from '@/lib/cobranca/portal-porteiro';
import { recusaModuloDaAgencia } from '@/lib/guarda-rota';
import { segundaViaPeloPortal } from '@/lib/cobranca/portal-segunda-via';
import { hojeEmBrasilia } from '@/lib/cobranca/servidor';
import { ErroCobranca, ErroProvedor } from '@/lib/cobranca/tipos';

/**
 * 2ª via pedida pelo próprio cliente no portal (E7): POST /api/portal/<token>/segunda-via { conta }.
 * Só para boleto vencido sem o link atualizado do provedor; valor com os juros e a multa da
 * política da agência até o próximo dia útil. Idempotente no dia; limite por link
 * (src/lib/cobranca/portal-segunda-via.ts). Exige corpo JSON (formulário de outro site não manda).
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
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
    const corpo = (await req.json().catch(() => null)) as { conta?: unknown } | null;
    const r = await segundaViaPeloPortal(exec, p.link, corpo?.conta, hojeEmBrasilia());
    return respostaDoPortal(r);
  } catch (e) {
    if (e instanceof ErroCobranca) {
      // "Nada sai" (mudança de sistema): frase para o cliente, sem o detalhe interno.
      const texto = e.codigo === 'NADA_SAI' ? 'A 2ª via não pode ser gerada agora. Fale com a agência.' : e.message;
      return respostaDoPortal({ error: texto, ...(e.codigo ? { codigo: e.codigo } : {}) }, e.status);
    }
    if (e instanceof ErroProvedor) {
      return respostaDoPortal({ error: 'O banco não respondeu agora. Tente de novo em alguns minutos ou fale com a agência.' }, 503);
    }
    console.error('[portal-segunda-via] falha:', e instanceof Error ? e.message : e);
    return respostaDoPortal({ error: 'Não foi possível gerar agora. Tente de novo em alguns minutos.' }, 500);
  }
}
