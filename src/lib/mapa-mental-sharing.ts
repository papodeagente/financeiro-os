import type { MapaMentalData } from './mapa-mental';

export interface MapaMentalShareState {
  token?: string;
  publicUrl: string;
  copyUrl?: string;
  allowCopy: boolean;
  createdAt?: string;
}

export interface MapaMentalPublicPayload {
  mapa: MapaMentalData;
  allowCopy: boolean;
  publicUrl?: string;
  copyUrl?: string;
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    ? valor as Record<string, unknown>
    : null;
}

function idMapaSeguro(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const id = valor.trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return null;
  if (['.', '..', '__proto__', 'prototype', 'constructor'].includes(id.toLowerCase())) return null;
  return id;
}

export function urlCompartilhamento(valor: unknown, origin: string): string | null {
  if (
    typeof valor !== 'string'
    || !valor.trim()
    || valor.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(valor)
  ) return null;
  try {
    const url = new URL(valor, origin);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && !url.username
      && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function urlComCaminho(
  valor: unknown,
  origin: string,
  pattern: RegExp,
): string | null {
  const normalizada = urlCompartilhamento(valor, origin);
  if (!normalizada) return null;
  try {
    const url = new URL(normalizada);
    const origemEsperada = new URL(origin).origin;
    return url.origin === origemEsperada
      && pattern.test(url.pathname)
      && !url.search
      && !url.hash
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function normalizarShareState(
  valor: unknown,
  origin: string,
): MapaMentalShareState | null {
  const raw = objeto(valor);
  if (!raw) return null;

  const publicUrl = urlComCaminho(
    raw.publicUrl,
    origin,
    /^\/mapas-mentais\/publico\/[A-Za-z0-9_-]{43}$/,
  );
  if (!publicUrl) return null;

  const token = typeof raw.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(raw.token)
    ? raw.token
    : undefined;
  const allowCopy = raw.allowCopy === true;
  const copyRecebido = urlComCaminho(
    raw.copyUrl,
    origin,
    /^\/planejamento\/mapas-mentais\/importar\/[A-Za-z0-9_-]{43}$/,
  );
  const copyUrl = allowCopy
    ? copyRecebido ?? (token
      ? new URL(`/planejamento/mapas-mentais/importar/${encodeURIComponent(token)}`, origin).toString()
      : undefined)
    : undefined;

  return {
    token,
    publicUrl,
    copyUrl,
    allowCopy,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
  };
}

export function normalizarMapaPublico(
  valor: unknown,
  origin: string,
): MapaMentalPublicPayload | null {
  const raw = objeto(valor);
  const mapa = objeto(raw?.mapa);
  const nodes = objeto(mapa?.nodes);
  if (
    !raw || !mapa || !nodes
    || typeof mapa.id !== 'string'
    || typeof mapa.rootId !== 'string'
    || !objeto(nodes[mapa.rootId])
  ) return null;

  return {
    mapa: mapa as unknown as MapaMentalData,
    allowCopy: raw.allowCopy === true,
    publicUrl: urlComCaminho(
      raw.publicUrl,
      origin,
      /^\/mapas-mentais\/publico\/[A-Za-z0-9_-]{43}$/,
    ) ?? undefined,
    copyUrl: urlComCaminho(
      raw.copyUrl,
      origin,
      /^\/planejamento\/mapas-mentais\/importar\/[A-Za-z0-9_-]{43}$/,
    ) ?? undefined,
  };
}

/** Impede que um redirect retornado pela API leve o usuário para fora do app. */
export function redirectSeguroDaCopia(valor: unknown, id: unknown): string | null {
  if (
    typeof valor === 'string'
    && valor.startsWith('/')
    && !valor.startsWith('//')
    && !valor.includes('\\')
    && !/[\u0000-\u001f\u007f]/.test(valor)
  ) {
    try {
      const base = new URL('https://app.entur.invalid');
      const url = new URL(valor, base);
      if (
        url.origin === base.origin
        && /^\/planejamento\/mapas-mentais\/[^/]+$/.test(url.pathname)
      ) {
        const segmento = url.pathname.slice('/planejamento/mapas-mentais/'.length);
        const decodificado = decodeURIComponent(segmento);
        if (idMapaSeguro(decodificado)) return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch { /* usa o id autoritativo como fallback */ }
  }

  const fallbackId = idMapaSeguro(id);
  return fallbackId ? `/planejamento/mapas-mentais/${fallbackId}` : null;
}

export function nomeArquivoMapa(nome: string): string {
  const seguro = nome
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return `${seguro || 'mapa-mental'}.pdf`;
}
