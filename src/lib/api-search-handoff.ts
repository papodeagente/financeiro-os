// Handoff entre tabs do grupo e páginas dedicadas de busca (/hoteis, /voos).
// Substitui modais de popup (que tremiam por re-render de props) por
// navegação para tela inteira mais estável.
//
// Fluxo:
// 1. Tab origem chama initiateXxxSearch() — salva contexto no sessionStorage
//    e navega para /hoteis ou /voos com ?handoff=<key>&returnTo=<url>
// 2. Página de busca lê o handoff key, mostra botão "Selecionar"
// 3. Ao selecionar, salva resultado no sessionStorage e navega de volta
// 4. Tab origem (no remount) chama consumePendingXxxHandoff() — aplica
//    e limpa o sessionStorage.

import type { SearchAPIHotelProperty } from './searchapi-hotels';
import type { FlightOffer } from './flight-data-mapper';

export interface HotelHandoffContext {
  kind: 'hotel';
  grupoId: string;
  hIdx: number;
  createdAt: number;
}

export interface FlightHandoffContext {
  kind: 'flight';
  grupoId: string;
  tIdx: number;
  createdAt: number;
}

export interface PropostaHotelHandoffContext {
  kind: 'proposta-hotel';
  propostaId: string;
  blockId: string;
  createdAt: number;
}

export interface PropostaFlightHandoffContext {
  kind: 'proposta-flight';
  propostaId: string;
  blockId: string;
  createdAt: number;
}

const PENDING_KEY = 'api-search-handoff:pending';
const CTX_KEY = (k: string) => `api-search-handoff:ctx:${k}`;
const RESULT_KEY = (k: string) => `api-search-handoff:result:${k}`;

function uniqueKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// HOTEL
// ============================================================

export function initiateHotelSearch(args: {
  grupoId: string;
  hIdx: number;
  destino?: string;
  hotelNome?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  returnTo: string;
}): void {
  const key = uniqueKey('htl');
  const ctx: HotelHandoffContext = {
    kind: 'hotel',
    grupoId: args.grupoId,
    hIdx: args.hIdx,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(CTX_KEY(key), JSON.stringify(ctx));
  sessionStorage.setItem(PENDING_KEY, key);

  const params = new URLSearchParams();
  params.set('handoff', key);
  params.set('returnTo', args.returnTo);
  if (args.destino) params.set('destino', args.destino);
  if (args.hotelNome) params.set('hotel', args.hotelNome);
  if (args.checkIn) params.set('checkin', args.checkIn);
  if (args.checkOut) params.set('checkout', args.checkOut);
  if (args.adults) params.set('adults', String(args.adults));

  window.location.assign(`/hoteis?${params.toString()}`);
}

export function completeHotelHandoff(handoffKey: string, hotel: SearchAPIHotelProperty, returnTo: string): void {
  sessionStorage.setItem(RESULT_KEY(handoffKey), JSON.stringify(hotel));
  window.location.assign(returnTo);
}

// Chamado pelo HtlTab no mount. Retorna o handoff resultado pendente
// (se houver) e o limpa. Tab pai é responsável por aplicar o hotel.
export function consumePendingHotelHandoff(grupoId: string): { ctx: HotelHandoffContext; hotel: SearchAPIHotelProperty } | null {
  const key = sessionStorage.getItem(PENDING_KEY);
  if (!key) return null;
  const ctxRaw = sessionStorage.getItem(CTX_KEY(key));
  const resultRaw = sessionStorage.getItem(RESULT_KEY(key));
  if (!ctxRaw || !resultRaw) return null;
  try {
    const ctx = JSON.parse(ctxRaw) as HotelHandoffContext;
    if (ctx.kind !== 'hotel' || ctx.grupoId !== grupoId) return null;
    const hotel = JSON.parse(resultRaw) as SearchAPIHotelProperty;
    // Limpa tudo
    sessionStorage.removeItem(CTX_KEY(key));
    sessionStorage.removeItem(RESULT_KEY(key));
    sessionStorage.removeItem(PENDING_KEY);
    return { ctx, hotel };
  } catch {
    return null;
  }
}

// ============================================================
// FLIGHT
// ============================================================

export function initiateFlightSearch(args: {
  grupoId: string;
  tIdx: number;
  origem?: string;
  destino?: string;
  dataIda?: string;
  dataVolta?: string;
  adultos?: number;
  criancas?: number;
  classe?: string;
  returnTo: string;
}): void {
  const key = uniqueKey('flt');
  const ctx: FlightHandoffContext = {
    kind: 'flight',
    grupoId: args.grupoId,
    tIdx: args.tIdx,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(CTX_KEY(key), JSON.stringify(ctx));
  sessionStorage.setItem(PENDING_KEY, key);

  const params = new URLSearchParams();
  params.set('handoff', key);
  params.set('returnTo', args.returnTo);
  if (args.origem) params.set('origem', args.origem);
  if (args.destino) params.set('destino', args.destino);
  if (args.dataIda) params.set('ida', args.dataIda);
  if (args.dataVolta) params.set('volta', args.dataVolta);
  if (args.adultos) params.set('adultos', String(args.adultos));
  if (args.criancas) params.set('criancas', String(args.criancas));
  if (args.classe) params.set('classe', args.classe);

  window.location.assign(`/voos?${params.toString()}`);
}

export function completeFlightHandoff(handoffKey: string, flight: FlightOffer, returnTo: string): void {
  sessionStorage.setItem(RESULT_KEY(handoffKey), JSON.stringify(flight));
  window.location.assign(returnTo);
}

export function consumePendingFlightHandoff(grupoId: string): { ctx: FlightHandoffContext; flight: FlightOffer } | null {
  const key = sessionStorage.getItem(PENDING_KEY);
  if (!key) return null;
  const ctxRaw = sessionStorage.getItem(CTX_KEY(key));
  const resultRaw = sessionStorage.getItem(RESULT_KEY(key));
  if (!ctxRaw || !resultRaw) return null;
  try {
    const ctx = JSON.parse(ctxRaw) as FlightHandoffContext;
    if (ctx.kind !== 'flight' || ctx.grupoId !== grupoId) return null;
    const flight = JSON.parse(resultRaw) as FlightOffer;
    sessionStorage.removeItem(CTX_KEY(key));
    sessionStorage.removeItem(RESULT_KEY(key));
    sessionStorage.removeItem(PENDING_KEY);
    return { ctx, flight };
  } catch {
    return null;
  }
}

// Permite saber se há handoff pendente do tipo específico — usado pelas
// páginas /hoteis e /voos pra mostrar UI de "selecionar" e o returnTo.
export function getActiveHandoffInfo(): { key: string; returnTo: string | null } | null {
  if (typeof window === 'undefined') return null;
  const sp = new URLSearchParams(window.location.search);
  const key = sp.get('handoff');
  const returnTo = sp.get('returnTo');
  if (!key) return null;
  return { key, returnTo };
}

// ============================================================
// PROPOSTA HOTEL (bloco ALOJAMENTO)
// ============================================================

export function initiateProposalHotelSearch(args: {
  propostaId: string;
  blockId: string;
  destino?: string;
  hotelNome?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  returnTo: string;
}): void {
  const key = uniqueKey('phtl');
  const ctx: PropostaHotelHandoffContext = {
    kind: 'proposta-hotel',
    propostaId: args.propostaId,
    blockId: args.blockId,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(CTX_KEY(key), JSON.stringify(ctx));
  sessionStorage.setItem(PENDING_KEY, key);

  const params = new URLSearchParams();
  params.set('handoff', key);
  params.set('returnTo', args.returnTo);
  if (args.destino) params.set('destino', args.destino);
  if (args.hotelNome) params.set('hotel', args.hotelNome);
  if (args.checkIn) params.set('checkin', args.checkIn);
  if (args.checkOut) params.set('checkout', args.checkOut);
  if (args.adults) params.set('adults', String(args.adults));

  window.location.assign(`/hoteis?${params.toString()}`);
}

export function consumePendingPropostaHotelHandoff(propostaId: string): { ctx: PropostaHotelHandoffContext; hotel: SearchAPIHotelProperty } | null {
  const key = sessionStorage.getItem(PENDING_KEY);
  if (!key) return null;
  const ctxRaw = sessionStorage.getItem(CTX_KEY(key));
  const resultRaw = sessionStorage.getItem(RESULT_KEY(key));
  if (!ctxRaw || !resultRaw) return null;
  try {
    const ctx = JSON.parse(ctxRaw) as PropostaHotelHandoffContext;
    if (ctx.kind !== 'proposta-hotel' || ctx.propostaId !== propostaId) return null;
    const hotel = JSON.parse(resultRaw) as SearchAPIHotelProperty;
    sessionStorage.removeItem(CTX_KEY(key));
    sessionStorage.removeItem(RESULT_KEY(key));
    sessionStorage.removeItem(PENDING_KEY);
    return { ctx, hotel };
  } catch {
    return null;
  }
}

// ============================================================
// PROPOSTA FLIGHT (bloco TRANSPORTE)
// ============================================================

export function initiateProposalFlightSearch(args: {
  propostaId: string;
  blockId: string;
  origem?: string;
  destino?: string;
  dataIda?: string;
  dataVolta?: string;
  adultos?: number;
  criancas?: number;
  classe?: string;
  returnTo: string;
}): void {
  const key = uniqueKey('pflt');
  const ctx: PropostaFlightHandoffContext = {
    kind: 'proposta-flight',
    propostaId: args.propostaId,
    blockId: args.blockId,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(CTX_KEY(key), JSON.stringify(ctx));
  sessionStorage.setItem(PENDING_KEY, key);

  const params = new URLSearchParams();
  params.set('handoff', key);
  params.set('returnTo', args.returnTo);
  if (args.origem) params.set('origem', args.origem);
  if (args.destino) params.set('destino', args.destino);
  if (args.dataIda) params.set('ida', args.dataIda);
  if (args.dataVolta) params.set('volta', args.dataVolta);
  if (args.adultos) params.set('adultos', String(args.adultos));
  if (args.criancas) params.set('criancas', String(args.criancas));
  if (args.classe) params.set('classe', args.classe);

  window.location.assign(`/voos?${params.toString()}`);
}

export function consumePendingPropostaFlightHandoff(propostaId: string): { ctx: PropostaFlightHandoffContext; flight: FlightOffer } | null {
  const key = sessionStorage.getItem(PENDING_KEY);
  if (!key) return null;
  const ctxRaw = sessionStorage.getItem(CTX_KEY(key));
  const resultRaw = sessionStorage.getItem(RESULT_KEY(key));
  if (!ctxRaw || !resultRaw) return null;
  try {
    const ctx = JSON.parse(ctxRaw) as PropostaFlightHandoffContext;
    if (ctx.kind !== 'proposta-flight' || ctx.propostaId !== propostaId) return null;
    const flight = JSON.parse(resultRaw) as FlightOffer;
    sessionStorage.removeItem(CTX_KEY(key));
    sessionStorage.removeItem(RESULT_KEY(key));
    sessionStorage.removeItem(PENDING_KEY);
    return { ctx, flight };
  } catch {
    return null;
  }
}

// Nota: completeHotelHandoff/completeFlightHandoff existentes já são genéricos
// (salvam resultado pela chave sem se importar com o tipo de contexto).
// Servem tanto para grupo quanto para proposta.
