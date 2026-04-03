// Flight data mapper — converts Amadeus API responses to system formats

export interface FlightSegment {
  departure: { iataCode: string; terminal?: string; at: string };
  arrival: { iataCode: string; terminal?: string; at: string };
  carrierCode: string;
  number: string;
  duration: string;
  numberOfStops: number;
}

export interface FlightOffer {
  id: string;
  itineraries: Array<{
    duration: string;
    segments: FlightSegment[];
  }>;
  price: { total: string; currency: string; grandTotal: string };
  travelerPricings: Array<{
    travelerType: string;
    price: { total: string };
    fareDetailsBySegment: Array<{
      cabin: string;
      includedCheckedBags?: { weight?: number; weightUnit?: string; quantity?: number };
    }>;
  }>;
}

const CARRIER_NAMES: Record<string, string> = {
  LA: 'LATAM', JJ: 'LATAM', G3: 'GOL', AD: 'AZUL',
  TP: 'TAP', IB: 'Iberia', AA: 'American', UA: 'United',
  DL: 'Delta', AF: 'Air France', LH: 'Lufthansa', BA: 'British Airways',
  KL: 'KLM', AZ: 'ITA Airways', EK: 'Emirates', QR: 'Qatar',
  TK: 'Turkish', ET: 'Ethiopian', AC: 'Air Canada', AV: 'Avianca',
  CM: 'Copa', AR: 'Aerolineas Argentinas', UX: 'Air Europa',
};

export function extractCarrierName(code: string): string {
  return CARRIER_NAMES[code] || code;
}

export function formatIsoDuration(iso: string): string {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return iso;
  const h = match[1] || '0';
  const m = match[2] || '0';
  return `${h}h${m.padStart(2, '0')}`;
}

function formatTime(dateStr: string): string {
  return dateStr.split('T')[1]?.substring(0, 5) || '';
}

function isDifferentDay(dep: string, arr: string): boolean {
  return dep.split('T')[0] !== arr.split('T')[0];
}

function getBaggage(offer: FlightOffer): string {
  const seg = offer.travelerPricings?.[0]?.fareDetailsBySegment?.[0];
  if (!seg?.includedCheckedBags) return '';
  if (seg.includedCheckedBags.weight) return `${seg.includedCheckedBags.weight}${seg.includedCheckedBags.weightUnit || 'kg'}`;
  if (seg.includedCheckedBags.quantity) return `${seg.includedCheckedBags.quantity} mala(s)`;
  return '';
}

function describeItinerary(itin: FlightOffer['itineraries'][0]): {
  carrier: string;
  carrierName: string;
  flightNumber: string;
  origin: string;
  destination: string;
  depTime: string;
  arrTime: string;
  duration: string;
  stops: number;
  stopAirports: string;
  nextDay: boolean;
} {
  const firstSeg = itin.segments[0];
  const lastSeg = itin.segments[itin.segments.length - 1];
  const stops = itin.segments.length - 1;
  const stopAirports = stops > 0
    ? itin.segments.slice(0, -1).map(s => s.arrival.iataCode).join(', ')
    : '';

  return {
    carrier: firstSeg.carrierCode,
    carrierName: extractCarrierName(firstSeg.carrierCode),
    flightNumber: `${firstSeg.carrierCode}${firstSeg.number}`,
    origin: firstSeg.departure.iataCode,
    destination: lastSeg.arrival.iataCode,
    depTime: formatTime(firstSeg.departure.at),
    arrTime: formatTime(lastSeg.arrival.at),
    duration: formatIsoDuration(itin.duration),
    stops,
    stopAirports,
    nextDay: isDifferentDay(firstSeg.departure.at, lastSeg.arrival.at),
  };
}

/**
 * Format flight for TktTab — returns fonte row data
 */
export function formatFlightForTkt(offer: FlightOffer, itineraryIndex = 0): {
  nome: string;
  partida_chegada: string;
} {
  const itin = offer.itineraries[itineraryIndex];
  if (!itin) return { nome: 'API Amadeus', partida_chegada: '' };

  const info = describeItinerary(itin);
  const nextDayStr = info.nextDay ? ' (+1)' : '';
  const stopsStr = info.stops === 0 ? 'Direto' : `${info.stops} escala${info.stops > 1 ? 's' : ''} (${info.stopAirports})`;
  const bag = getBaggage(offer);
  const bagStr = bag ? ` | Bag: ${bag}` : '';

  return {
    nome: 'API Amadeus',
    partida_chegada: `${info.carrierName} ${info.flightNumber} | ${info.origin} ${info.depTime} → ${info.destination} ${info.arrTime}${nextDayStr} | ${info.duration} | ${stopsStr}${bagStr}`,
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
  const ida = offer.itineraries[0];
  if (!ida) return { cia_aerea: '', trecho: '', descricao: '' };

  const info = describeItinerary(ida);
  const stopsStr = info.stops === 0 ? 'Direto' : `${info.stops} escala(s)`;
  const bag = getBaggage(offer);
  const bagStr = bag ? ` | Bag: ${bag}` : '';

  let descricao = `${info.flightNumber} ${info.origin} ${info.depTime} → ${info.destination} ${info.arrTime} | ${stopsStr} | ${info.duration}${bagStr}`;

  // Add return flight info if exists
  if (offer.itineraries[1]) {
    const volta = describeItinerary(offer.itineraries[1]);
    const voltaStops = volta.stops === 0 ? 'Direto' : `${volta.stops} escala(s)`;
    descricao += ` // Volta: ${volta.flightNumber} ${volta.origin} ${volta.depTime} → ${volta.destination} ${volta.arrTime} | ${voltaStops} | ${volta.duration}`;
  }

  return {
    cia_aerea: info.carrierName,
    trecho: `${info.origin}-${info.destination}`,
    descricao,
  };
}

/**
 * Format flight for Propostas — returns SERVICO block conteudo
 */
export function formatFlightForProposta(offer: FlightOffer): Record<string, unknown> {
  const ida = offer.itineraries[0];
  if (!ida) return { icone: '✈️', titulo: '', descricao: '', detalhes: [], imagem: '', valor: 0, exibir_valor: false };

  const info = describeItinerary(ida);
  const bag = getBaggage(offer);
  const detalhes: string[] = [
    `Cia: ${info.carrierName} (${info.flightNumber})`,
    `Partida: ${info.origin} ${info.depTime}`,
    `Chegada: ${info.destination} ${info.arrTime}${info.nextDay ? ' (+1 dia)' : ''}`,
    `Duração: ${info.duration}`,
    info.stops === 0 ? 'Voo direto' : `Escalas: ${info.stops} (${info.stopAirports})`,
  ];
  if (bag) detalhes.push(`Bagagem: ${bag}`);

  if (offer.itineraries[1]) {
    const volta = describeItinerary(offer.itineraries[1]);
    detalhes.push('---');
    detalhes.push(`Volta: ${volta.carrierName} (${volta.flightNumber})`);
    detalhes.push(`Partida: ${volta.origin} ${volta.depTime}`);
    detalhes.push(`Chegada: ${volta.destination} ${volta.arrTime}${volta.nextDay ? ' (+1 dia)' : ''}`);
    detalhes.push(`Duração: ${volta.duration}`);
    detalhes.push(volta.stops === 0 ? 'Voo direto' : `Escalas: ${volta.stops} (${volta.stopAirports})`);
  }

  return {
    icone: '✈️',
    titulo: `Voo ${info.origin} → ${info.destination}`,
    descricao: `${info.carrierName} ${info.flightNumber} — ${info.duration} — ${info.stops === 0 ? 'Direto' : `${info.stops} escala(s)`}`,
    detalhes,
    imagem: '',
    valor: 0,
    exibir_valor: false,
  };
}

/**
 * Format flight for Propostas Discovery — returns TRANSPORTE block conteudo
 */
export function formatFlightForTransporte(offer: FlightOffer): Record<string, unknown>[] {
  return offer.itineraries.map(itin => {
    const info = describeItinerary(itin);
    const firstSeg = itin.segments[0];
    return {
      id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
      tipo: 'VOO',
      data: firstSeg.departure.at.split('T')[0] || '',
      origem: info.origin,
      destino: info.destination,
      companhia: info.carrierName,
      numero_voo: info.flightNumber,
      horario_saida: info.depTime,
      horario_chegada: info.arrTime,
      distancia_km: 0,
      tempo_estimado: info.duration,
      detalhes: info.stops === 0 ? 'Voo direto' : `${info.stops} escala(s): ${info.stopAirports}`,
    };
  });
}
