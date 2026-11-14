import pool, { initDB } from '@/lib/db';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { porteiroDoPortal, respostaDoPortal, respostaLinkNaoAbre } from '@/lib/cobranca/portal-porteiro';
import { recusaModuloDaAgencia } from '@/lib/guarda-rota';
import { faturasDoPortal } from '@/lib/fatura-servidor';

/**
 * Faturas para o cliente conferir no portal (E5, parte B): GET /api/portal/<token>/faturas.
 * Só as faturas FECHADAS do cliente do link, naquela agência (até 18 meses), com os itens
 * (passageiro, localizador, centro de custo), as notas e a situação da conferência.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    await initDB();
    if (!pool) return respostaDoPortal({ error: 'Serviço indisponível. Tente em alguns minutos.' }, 503);
    const exec = pool as unknown as ExecutorSQL;
    const p = await porteiroDoPortal(req, exec, token);
    if ('resposta' in p) return p.resposta;
    const semModulo = await recusaModuloDaAgencia(p.link.tenant_id, 'cobranca', respostaLinkNaoAbre);
    if (semModulo) return semModulo;
    return respostaDoPortal({ faturas: await faturasDoPortal(exec, p.link, hojeISO()) });
  } catch (e) {
    console.error('[portal-faturas] falha:', e instanceof Error ? e.message : e);
    return respostaDoPortal({ error: 'Não foi possível abrir agora. Tente de novo em alguns minutos.' }, 500);
  }
}
