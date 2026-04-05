import { getCached, setCache } from './api-cache';

const SEARCHAPI_KEY = '3YERKNQB33FLb2fV6XAZAKcV';
const SEARCHAPI_BASE = 'https://www.searchapi.io/api/v1/search';
const TTL_FLIGHTS = 24 * 3600; // 24h

// --- SearchAPI Google Flights types ---

export interface SearchAPIAirport {
  name: string;
  id: string; // IATA code
  time?: string; // "2026-04-10 06:15"
}

export interface SearchAPIFlightSegment {
  departure_airport: SearchAPIAirport;
  arrival_airport: SearchAPIAirport;
  duration: number; // minutes
  airplane: string;
  airline: string;
  airline_logo: string;
  flight_number: string; // "G3 1380"
  travel_class: string;
  extensions?: string[];
  legroom?: string;
  often_delayed_by_over_30_min?: boolean;
}

export interface SearchAPIFlightGroup {
  flights: SearchAPIFlightSegment[];
  total_duration: number; // minutes
  price: number;
  type?: string;
  airline_logo?: string;
  carbon_emissions?: { this_flight: number; typical_for_this_route: number; difference_percent: number };
  departure_token?: string;
  layovers?: Array<{ duration: number; name: string; id: string }>;
}

export interface SearchAPIResponse {
  best_flights?: SearchAPIFlightGroup[];
  other_flights?: SearchAPIFlightGroup[];
  price_insights?: { lowest_price: number; typical_price_range: number[]; price_level: string };
  airports?: Array<{ departure: Array<{ airport: { id: string; name: string }; city: string }>; arrival: Array<{ airport: { id: string; name: string }; city: string }> }>;
  airlines?: Array<{ name: string; logo: string }>;
  search_metadata?: Record<string, unknown>;
}

const CLASS_MAP: Record<string, string> = {
  'economica': 'economy',
  'executiva': 'business',
  'primeira': 'first_class',
  'premium_economy': 'premium_economy',
};

export async function searchFlights(params: {
  origem: string;
  destino: string;
  data_ida: string;
  data_volta?: string;
  adultos: number;
  criancas: number;
  classe: string;
}): Promise<{ data: SearchAPIResponse; cached: boolean }> {
  const cacheKey = `searchapi_flights:${params.origem}:${params.destino}:${params.data_ida}:${params.data_volta || ''}:${params.adultos}:${params.criancas}:${params.classe}`;
  const cached = await getCached(cacheKey);
  if (cached) return { data: cached as SearchAPIResponse, cached: true };

  const queryParams = new URLSearchParams({
    engine: 'google_flights',
    departure_id: params.origem,
    arrival_id: params.destino,
    outbound_date: params.data_ida,
    type: params.data_volta ? '1' : '2', // 1=round trip, 2=one way
    travel_class: CLASS_MAP[params.classe] || 'economy',
    adults: String(params.adultos),
    children: String(params.criancas),
    currency: 'BRL',
    hl: 'pt-BR',
    gl: 'br',
    api_key: SEARCHAPI_KEY,
  });

  if (params.data_volta) {
    queryParams.set('return_date', params.data_volta);
  }

  const url = `${SEARCHAPI_BASE}?${queryParams.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`SearchAPI flight search failed: ${res.status} ${errText}`);
  }

  const data: SearchAPIResponse = await res.json();
  await setCache(cacheKey, data, 'SEARCHAPI', TTL_FLIGHTS);
  return { data, cached: false };
}
