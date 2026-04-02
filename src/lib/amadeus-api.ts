import { getCached, setCache } from './api-cache';

const TTL_FLIGHTS = 24 * 3600; // 24h
const TTL_AIRPORTS = 30 * 24 * 3600; // 30 days
const TTL_HOTELS = 7 * 24 * 3600; // 7 days

interface AmadeusConfig {
  api_key: string;
  api_secret: string;
  ambiente: 'test' | 'production';
}

async function getAccessToken(config: AmadeusConfig): Promise<string> {
  const baseUrl = config.ambiente === 'production'
    ? 'https://api.amadeus.com'
    : 'https://test.api.amadeus.com';

  const cacheKey = `amadeus_token:${config.ambiente}`;
  const cached = await getCached(cacheKey);
  if (cached && typeof cached === 'object' && 'access_token' in (cached as Record<string, unknown>)) {
    return (cached as Record<string, string>).access_token;
  }

  const res = await fetch(`${baseUrl}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(config.api_key)}&client_secret=${encodeURIComponent(config.api_secret)}`,
  });

  if (!res.ok) throw new Error(`Amadeus auth failed: ${res.status}`);
  const data = await res.json();
  await setCache(cacheKey, data, 'AMADEUS', (data.expires_in || 1799) - 60);
  return data.access_token;
}

function getBaseUrl(config: AmadeusConfig) {
  return config.ambiente === 'production'
    ? 'https://api.amadeus.com'
    : 'https://test.api.amadeus.com';
}

export async function searchFlights(config: AmadeusConfig, params: {
  origem: string;
  destino: string;
  data_ida: string;
  data_volta?: string;
  adultos: number;
  criancas: number;
  classe: string;
}) {
  const cacheKey = `flight_search:${params.origem}:${params.destino}:${params.data_ida}:${params.data_volta || ''}:${params.adultos}:${params.criancas}:${params.classe}`;
  const cached = await getCached(cacheKey);
  if (cached) return { data: cached, cached: true };

  const token = await getAccessToken(config);
  const baseUrl = getBaseUrl(config);

  const classMap: Record<string, string> = {
    'economica': 'ECONOMY',
    'executiva': 'BUSINESS',
    'primeira': 'FIRST',
    'premium_economy': 'PREMIUM_ECONOMY',
  };

  const travelers = [];
  for (let i = 0; i < params.adultos; i++) {
    travelers.push({ id: `${i + 1}`, travelerType: 'ADULT' });
  }
  for (let i = 0; i < params.criancas; i++) {
    travelers.push({ id: `${params.adultos + i + 1}`, travelerType: 'CHILD' });
  }

  const originDestinations = [
    { id: '1', originLocationCode: params.origem, destinationLocationCode: params.destino, departureDateTimeRange: { date: params.data_ida } },
  ];
  if (params.data_volta) {
    originDestinations.push(
      { id: '2', originLocationCode: params.destino, destinationLocationCode: params.origem, departureDateTimeRange: { date: params.data_volta } },
    );
  }

  const body = {
    currencyCode: 'BRL',
    originDestinations,
    travelers,
    sources: ['GDS'],
    searchCriteria: {
      maxFlightOffers: 15,
      flightFilters: {
        cabinRestrictions: [{
          cabin: classMap[params.classe] || 'ECONOMY',
          coverage: 'MOST_SEGMENTS',
          originDestinationIds: originDestinations.map(o => o.id),
        }],
      },
    },
  };

  const res = await fetch(`${baseUrl}/v2/shopping/flight-offers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Amadeus flight search failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  await setCache(cacheKey, data, 'AMADEUS', TTL_FLIGHTS);
  return { data, cached: false };
}

export async function searchAirports(config: AmadeusConfig, keyword: string) {
  const cacheKey = `airport_search:${keyword.toLowerCase()}`;
  const cached = await getCached(cacheKey);
  if (cached) return { data: cached, cached: true };

  const token = await getAccessToken(config);
  const baseUrl = getBaseUrl(config);

  const res = await fetch(
    `${baseUrl}/v1/reference-data/locations?subType=AIRPORT,CITY&keyword=${encodeURIComponent(keyword)}&page%5Blimit%5D=10`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) throw new Error(`Amadeus airport search failed: ${res.status}`);
  const data = await res.json();
  await setCache(cacheKey, data, 'AMADEUS', TTL_AIRPORTS);
  return { data, cached: false };
}

export async function searchHotels(config: AmadeusConfig, params: {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  adults?: number;
}) {
  const cacheKey = `hotel_search_amadeus:${params.cityCode}:${params.checkInDate}:${params.checkOutDate}:${params.adults || 2}`;
  const cached = await getCached(cacheKey);
  if (cached) return { data: cached, cached: true };

  const token = await getAccessToken(config);
  const baseUrl = getBaseUrl(config);

  // Step 1: Get hotel list by city
  const listRes = await fetch(
    `${baseUrl}/v1/reference-data/locations/hotels/by-city?cityCode=${params.cityCode}&radius=30&radiusUnit=KM&hotelSource=ALL`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!listRes.ok) throw new Error(`Amadeus hotel list failed: ${listRes.status}`);
  const listData = await listRes.json();
  const hotelIds = (listData.data || []).slice(0, 20).map((h: { hotelId: string }) => h.hotelId);

  if (hotelIds.length === 0) {
    await setCache(cacheKey, { data: [] }, 'AMADEUS', TTL_HOTELS);
    return { data: { data: [] }, cached: false };
  }

  // Step 2: Get offers for those hotels
  const offersRes = await fetch(
    `${baseUrl}/v3/shopping/hotel-offers?hotelIds=${hotelIds.join(',')}&adults=${params.adults || 2}&checkInDate=${params.checkInDate}&checkOutDate=${params.checkOutDate}&currency=BRL`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!offersRes.ok) {
    // Fallback: return list without prices
    const fallback = { data: listData.data || [] };
    await setCache(cacheKey, fallback, 'AMADEUS', TTL_HOTELS);
    return { data: fallback, cached: false };
  }

  const offersData = await offersRes.json();
  await setCache(cacheKey, offersData, 'AMADEUS', TTL_HOTELS);
  return { data: offersData, cached: false };
}

export async function testConnection(config: AmadeusConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await getAccessToken(config);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha na conexão' };
  }
}
