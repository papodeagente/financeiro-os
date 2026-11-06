/**
 * Porteiro das rotas públicas do portal do cliente (05/11/2026): limite por
 * IP, limite de tokens errados por IP (barra antes de ir ao banco), limite
 * por link, e a mesma resposta 404 para token inexistente, revogado ou de
 * formato errado. Cabeçalhos: sem cache, sem Referer, sem indexação.
 */
import { NextResponse } from 'next/server';

import type { ExecutorSQL } from '../caixa-atomico';
import { estaNoLimite, ipDaRequisicao, permitirChamada } from '../limite-publico';
import { LIMITES_DO_PORTAL } from './portal-regras';
import { acharLink, type LinkAtivo } from './portal-servidor';

export const CABECALHOS_DO_PORTAL = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
} as const;

export function respostaDoPortal(corpo: unknown, status = 200): NextResponse {
  return NextResponse.json(corpo, { status, headers: CABECALHOS_DO_PORTAL });
}

const NAO_ACHOU = 'Este link não abre mais. Peça um link novo à agência.';
const DEVAGAR = 'Muitas tentativas em pouco tempo. Espere alguns minutos e abra o link de novo.';

export async function porteiroDoPortal(
  req: Request, exec: ExecutorSQL, token: string,
): Promise<{ link: LinkAtivo } | { resposta: NextResponse }> {
  const ip = ipDaRequisicao(req);
  const L = LIMITES_DO_PORTAL;
  if (estaNoLimite(`portal-falha:${ip}`, L.falhasPorIp.maximo)) {
    return { resposta: respostaDoPortal({ error: DEVAGAR }, 429) };
  }
  if (!permitirChamada(`portal-ip:${ip}`, L.leiturasPorIp.maximo, L.leiturasPorIp.janelaMs)) {
    return { resposta: respostaDoPortal({ error: DEVAGAR }, 429) };
  }
  const link = await acharLink(exec, token);
  if (!link) {
    permitirChamada(`portal-falha:${ip}`, L.falhasPorIp.maximo, L.falhasPorIp.janelaMs);
    return { resposta: respostaDoPortal({ error: NAO_ACHOU }, 404) };
  }
  if (!permitirChamada(`portal-link:${link.id}`, L.leiturasPorLink.maximo, L.leiturasPorLink.janelaMs)) {
    return { resposta: respostaDoPortal({ error: DEVAGAR }, 429) };
  }
  return { link };
}
