// Flight data mapper — converts SearchAPI Google Flights responses to system formats

import type { SearchAPIFlightGroup, SearchAPIFlightSegment } from './searchapi-flights';

// Normalized flight offer used throughout the system
export interface FlightOffer {
  id: string;
  flights: SearchAPIFlightSegment[];
  totalDuration: number; // minutes
  price: number;
  airlineLogo?: string;
  layovers?: Array<{ duration: number; name: string; id: string }>;
  departureToken?: string;
  // For round-trip: return leg
  returnFlights?: SearchAPIFlightSegment[];
  returnDuration?: number;
  returnLayovers?: Array<{ duration: number; name: string; id: string }>;
}

/**
 * Convert SearchAPI response groups into normalized FlightOffer[]
 */
export function mapSearchAPIToOffers(
  bestFlights: SearchAPIFlightGroup[] = [],
  otherFlights: SearchAPIFlightGroup[] = [],
): FlightOffer[] {
  const all = [...bestFlights, ...otherFlights];
  return all.map((group, i) => ({
    id: `sa-${i}`,
    flights: group.flights,
    totalDuration: group.total_duration,
    price: group.price,
    airlineLogo: group.airline_logo,
    layovers: group.layovers,
    departureToken: group.departure_token,
  }));
}

// --- Helper functions ---

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function extractTime(dateStr: string): string {
  // "2026-04-10 06:15" → "06:15"
  const parts = dateStr.split(' ');
  return parts[1]?.substring(0, 5) || '';
}

function extractDate(dateStr: string): string {
  // "2026-04-10 06:15" → "2026-04-10"
  return dateStr.split(' ')[0] || '';
}

function isDifferentDay(dep: string, arr: string): boolean {
  return extractDate(dep) !== extractDate(arr);
}

function extractCarrierCode(flightNumber: string): string {
  // "G3 1380" → "G3"
  return flightNumber.split(' ')[0] || '';
}

export function extractCarrierName(flightNumber: string): string {
  // Prefer the airline name from the segment directly
  return flightNumber;
}

function getBaggage(seg: SearchAPIFlightSegment): string {
  const exts = seg.extensions || [];
  for (const ext of exts) {
    const lower = ext.toLowerCase();
    if (lower.includes('bag') || lower.includes('mala') || lower.includes('checked') || lower.includes('despacha')) {
      return ext;
    }
  }
  return '';
}

function getCarbonFromExtensions(seg: SearchAPIFlightSegment): { kg?: number; ext?: string } {
  const exts = seg.extensions || [];
  for (const ext of exts) {
    const lower = ext.toLowerCase();
    if (lower.includes('co2') || lower.includes('carbon')) {
      // Try to parse "168 kg CO2" or similar
      const match = ext.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
      if (match) return { kg: Number(match[1].replace(',', '.')), ext };
      return { ext };
    }
  }
  return {};
}

function describeFlightGroup(flights: SearchAPIFlightSegment[], totalDuration: number, layovers?: Array<{ duration: number; name: string; id: string }>) {
  const firstSeg = flights[0];
  const lastSeg = flights[flights.length - 1];
  const stops = flights.length - 1;
  const stopNames = layovers?.map(l => l.id).join(', ') || flights.slice(0, -1).map(s => s.arrival_airport.id).join(', ');
  const carbon = getCarbonFromExtensions(firstSeg);

  return {
    airline: firstSeg.airline,
    airlineLogo: firstSeg.airline_logo,
    carrierCode: extractCarrierCode(firstSeg.flight_number),
    flightNumber: firstSeg.flight_number,
    origin: firstSeg.departure_airport.id,
    originName: firstSeg.departure_airport.name,
    destination: lastSeg.arrival_airport.id,
    destinationName: lastSeg.arrival_airport.name,
    depTime: extractTime(firstSeg.departure_airport.time || ''),
    arrTime: extractTime(lastSeg.arrival_airport.time || ''),
    depDate: extractDate(firstSeg.departure_airport.time || ''),
    arrDate: extractDate(lastSeg.arrival_airport.time || ''),
    duration: formatMinutes(totalDuration),
    durationMin: totalDuration,
    stops,
    stopAirports: stopNames,
    nextDay: isDifferentDay(firstSeg.departure_airport.time || '', lastSeg.arrival_airport.time || ''),
    baggage: getBaggage(firstSeg),
    aircraft: firstSeg.airplane,
    travelClass: firstSeg.travel_class,
    legroom: firstSeg.legroom,
    oftenDelayed: firstSeg.often_delayed_by_over_30_min,
    carbonKg: carbon.kg,
    layoversInfo: (layovers || []).map(l => ({ aeroporto: l.id, nome: l.name, duracao_min: l.duration })),
    segments: flights.map(s => ({
      companhia: s.airline,
      numero_voo: s.flight_number,
      origem: s.departure_airport.id,
      destino: s.arrival_airport.id,
      aeroporto_origem_nome: s.departure_airport.name,
      aeroporto_destino_nome: s.arrival_airport.name,
      horario_saida: extractTime(s.departure_airport.time || ''),
      horario_chegada: extractTime(s.arrival_airport.time || ''),
      duracao_min: s.duration,
      aeronave: s.airplane,
      classe: s.travel_class,
    })),
  };
}

/**
 * Format flight for TktTab — returns fonte row data
 */
export function formatFlightForTkt(offer: FlightOffer, legIndex = 0): {
  nome: string;
  partida_chegada: string;
  valor_adt: number;
} {
  const flights = legIndex === 0 ? offer.flights : (offer.returnFlights || offer.flights);
  const duration = legIndex === 0 ? offer.totalDuration : (offer.returnDuration || offer.totalDuration);
  const layovers = legIndex === 0 ? offer.layovers : offer.returnLayovers;

  const info = describeFlightGroup(flights, duration, layovers);
  const nextDayStr = info.nextDay ? ' (+1)' : '';
  const stopsStr = info.stops === 0 ? 'Direto' : `${info.stops} escala${info.stops > 1 ? 's' : ''} (${info.stopAirports})`;
  const bagStr = info.baggage ? ` | ${info.baggage}` : '';

  return {
    nome: 'Google Flights',
    partida_chegada: `${info.airline} ${info.flightNumber} | ${info.origin} ${info.depTime} → ${info.destination} ${info.arrTime}${nextDayStr} | ${info.duration} | ${stopsStr}${bagStr}`,
    valor_adt: offer.price,
  };
}

/**
 * Format flight for Vendas — returns ProdutoVenda partial
 */
export function formatFlightForVenda(offer: FlightOffer): {
  cia_aerea: string;
  trecho: string;
  descricao: string;
} {
  const info = describeFlightGroup(offer.flights, offer.totalDuration, offer.layovers);
  const stopsStr = info.stops === 0 ? 'Direto' : `${info.stops} escala(s)`;
  const bagStr = info.baggage ? ` | ${info.baggage}` : '';

  let descricao = `${info.flightNumber} ${info.origin} ${info.depTime} → ${info.destination} ${info.arrTime} | ${stopsStr} | ${info.duration}${bagStr}`;

  if (offer.returnFlights && offer.returnFlights.length > 0) {
    const volta = describeFlightGroup(offer.returnFlights, offer.returnDuration || 0, offer.returnLayovers);
    const voltaStops = volta.stops === 0 ? 'Direto' : `${volta.stops} escala(s)`;
    descricao += ` // Volta: ${volta.flightNumber} ${volta.origin} ${volta.depTime} → ${volta.destination} ${volta.arrTime} | ${voltaStops} | ${volta.duration}`;
  }

  return {
    cia_aerea: info.airline,
    trecho: `${info.origin}-${info.destination}`,
    descricao,
  };
}

/**
 * Format flight for Propostas — returns SERVICO block conteudo
 */
export function formatFlightForProposta(offer: FlightOffer): Record<string, unknown> {
  const info = describeFlightGroup(offer.flights, offer.totalDuration, offer.layovers);
  const detalhes: string[] = [
    `Cia: ${info.airline} (${info.flightNumber})`,
    `Partida: ${info.origin} ${info.depTime}`,
    `Chegada: ${info.destination} ${info.arrTime}${info.nextDay ? ' (+1 dia)' : ''}`,
    `Duração: ${info.duration}`,
    info.stops === 0 ? 'Voo direto' : `Escalas: ${info.stops} (${info.stopAirports})`,
  ];
  if (info.baggage) detalhes.push(`Bagagem: ${info.baggage}`);

  if (offer.returnFlights && offer.returnFlights.length > 0) {
    const volta = describeFlightGroup(offer.returnFlights, offer.returnDuration || 0, offer.returnLayovers);
    detalhes.push('---');
    detalhes.push(`Volta: ${volta.airline} (${volta.flightNumber})`);
    detalhes.push(`Partida: ${volta.origin} ${volta.depTime}`);
    detalhes.push(`Chegada: ${volta.destination} ${volta.arrTime}${volta.nextDay ? ' (+1 dia)' : ''}`);
    detalhes.push(`Duração: ${volta.duration}`);
    detalhes.push(volta.stops === 0 ? 'Voo direto' : `Escalas: ${volta.stops} (${volta.stopAirports})`);
  }

  return {
    icone: '✈️',
    titulo: `Voo ${info.origin} → ${info.destination}`,
    descricao: `${info.airline} ${info.flightNumber} — ${info.duration} — ${info.stops === 0 ? 'Direto' : `${info.stops} escala(s)`}`,
    detalhes,
    imagem: offer.airlineLogo || '',
    valor: 0,
    exibir_valor: false,
  };
}

/**
 * Format flight for Propostas Discovery — returns TRANSPORTE block conteudo
 * Populates rich fields from SearchAPI: aeronave, classe, bagagem, emissão CO2, escalas, etc.
 */
export function formatFlightForTransporte(offer: FlightOffer): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const hasReturn = !!(offer.returnFlights && offer.returnFlights.length > 0);
  const idaPrice = hasReturn ? Math.round(offer.price / 2) : offer.price;
  const voltaPrice = hasReturn ? offer.price - idaPrice : 0;

  const info = describeFlightGroup(offer.flights, offer.totalDuration, offer.layovers);
  results.push({
    id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
    tipo: 'VOO',
    data: info.depDate,
    data_chegada: info.arrDate,
    origem: info.origin,
    destino: info.destination,
    aeroporto_origem_nome: info.originName,
    aeroporto_destino_nome: info.destinationName,
    companhia: info.airline,
    companhia_logo: info.airlineLogo || offer.airlineLogo || '',
    numero_voo: info.flightNumber,
    horario_saida: info.depTime,
    horario_chegada: info.arrTime,
    distancia_km: 0,
    tempo_estimado: info.duration,
    valor: idaPrice,
    aeronave: info.aircraft,
    classe: info.travelClass,
    bagagem: info.baggage,
    legroom: info.legroom,
    emissao_carbono_kg: info.carbonKg,
    escalas: info.stops,
    escalas_info: info.layoversInfo,
    segmentos: info.segments,
    muitas_vezes_atrasado: info.oftenDelayed,
    detalhes: info.stops === 0 ? 'Voo direto' : `${info.stops} escala(s): ${info.stopAirports}`,
  });

  if (hasReturn) {
    const volta = describeFlightGroup(offer.returnFlights!, offer.returnDuration || 0, offer.returnLayovers);
    results.push({
      id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
      tipo: 'VOO',
      data: volta.depDate,
      data_chegada: volta.arrDate,
      origem: volta.origin,
      destino: volta.destination,
      aeroporto_origem_nome: volta.originName,
      aeroporto_destino_nome: volta.destinationName,
      companhia: volta.airline,
      companhia_logo: volta.airlineLogo || offer.airlineLogo || '',
      numero_voo: volta.flightNumber,
      horario_saida: volta.depTime,
      horario_chegada: volta.arrTime,
      distancia_km: 0,
      tempo_estimado: volta.duration,
      valor: voltaPrice,
      aeronave: volta.aircraft,
      classe: volta.travelClass,
      bagagem: volta.baggage,
      legroom: volta.legroom,
      emissao_carbono_kg: volta.carbonKg,
      escalas: volta.stops,
      escalas_info: volta.layoversInfo,
      segmentos: volta.segments,
      muitas_vezes_atrasado: volta.oftenDelayed,
      detalhes: 'VOLTA | ' + (volta.stops === 0 ? 'Voo direto' : `${volta.stops} escala(s): ${volta.stopAirports}`),
    });
  }

  return results;
}

// Legacy compatibility — formatIsoDuration still exported for any remaining references
export function formatIsoDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return iso;
  const h = match[1] || '0';
  const m = match[2] || '0';
  return `${h}h${m.padStart(2, '0')}`;
}
