import pool, { initDB } from '@/lib/db';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { porteiroDoPortal, respostaDoPortal } from '@/lib/cobranca/portal-porteiro';
import { lerReciboDoPortal } from '@/lib/cobranca/portal-servidor';

/**
 * Recibo de uma conta paga, pelo portal do cliente (05/11/2026):
 * GET /api/portal/<token>/recibo/<conta>. A conta precisa ser do mesmo
 * cliente e da mesma agência do link; senão, 404 igual ao de link inválido.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string; conta: string }> }) {
  try {
    const { token, conta } = await params;
    await initDB();
    if (!pool) return respostaDoPortal({ error: 'Serviço indisponível. Tente em alguns minutos.' }, 503);
    const exec = pool as unknown as ExecutorSQL;
    const p = await porteiroDoPortal(req, exec, token);
    if ('resposta' in p) return p.resposta;
    const r = await lerReciboDoPortal(exec, p.link, conta, hojeISO());
    if (!r) return respostaDoPortal({ error: 'Recibo não encontrado.' }, 404);
    if (!r.ok) return respostaDoPortal({ error: r.motivo }, 422);
    return respostaDoPortal(r.recibo);
  } catch (e) {
    console.error('[portal/recibo] falha:', e instanceof Error ? e.message : e);
    return respostaDoPortal({ error: 'Não foi possível abrir o recibo agora.' }, 500);
  }
}
