// Helper que monta o link publico da proposta. Quando o tenant tem
// custom_proposta_domain configurado em Agencia, o link usa esse
// dominio (ex.: https://proposta.agenciax.com.br/p/<slug>). Senao,
// cai no fallback baseado em variaveis de ambiente / origin.

import type { Agencia } from './crm-types';

// Normaliza dominio para URL completa com https://. Aceita
// "proposta.agenciax.com.br" OU "https://proposta.agenciax.com.br".
// Remove trailing slash.
function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Se ja vem com protocolo, usa como esta (sem trailing /)
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }
  // So host sem protocolo: assume https
  return `https://${trimmed.replace(/\/+$/, '')}`;
}

// Base server-side: pega de PUBLIC_APP_URL / COOLIFY_URL / COOLIFY_FQDN
// ou fallback "https://fin.enturos.com".
export function getDefaultPublicBase(): string {
  return (
    process.env.PUBLIC_APP_URL
    || process.env.COOLIFY_URL
    || (process.env.COOLIFY_FQDN ? `https://${process.env.COOLIFY_FQDN}` : '')
    || 'https://fin.enturos.com'
  ).replace(/\/+$/, '');
}

// Monta link publico da proposta. Prioriza dominio custom do tenant
// quando configurado em Agencia.custom_proposta_domain.
//   - propostaId: id da proposta (slug usado em /p/[slug])
//   - agencia: agencia do tenant (pode ser null/undefined)
//   - fallbackBase: opcional, base pra usar quando nao houver custom
//     domain (ex.: window.location.origin em client-side)
export function buildPropostaLink(
  propostaId: string,
  agencia: Agencia | null | undefined,
  fallbackBase?: string,
): string {
  const customDomain = agencia?.custom_proposta_domain
    ? normalizeDomain(agencia.custom_proposta_domain)
    : null;
  const base = customDomain || fallbackBase || getDefaultPublicBase();
  return `${base}/p/${propostaId}`;
}
