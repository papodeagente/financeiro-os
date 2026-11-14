import pool, { initDB } from '@/lib/db';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { porteiroDoPortal, respostaDoPortal } from '@/lib/cobranca/portal-porteiro';
import { lerPortal, marcarAcesso } from '@/lib/cobranca/portal-servidor';

/**
 * Portal do cliente, leitura pública (05/11/2026): GET /api/portal/<token>.
 * Sem login. O token é o link pessoal que a agência mandou; ele abre só as
 * contas daquele cliente naquela agência (src/lib/cobranca/portal-*.ts).
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
    const portal = await lerPortal(exec, p.link, hojeISO());
    await marcarAcesso(exec, p.link);
    return respostaDoPortal(portal);
  } catch (e) {
    console.error('[portal] falha:', e instanceof Error ? e.message : e);
    return respostaDoPortal({ error: 'Não foi possível abrir agora. Tente de novo em alguns minutos.' }, 500);
  }
}
