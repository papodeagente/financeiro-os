import { getCached, setCache } from './api-cache';

const SEARCHAPI_KEY = '3YERKNQB33FLb2fV6XAZAKcV';
const SEARCHAPI_BASE = 'https://www.searchapi.io/api/v1/search';
const TTL_HOTELS = 7 * 24 * 3600; // 7 days

// --- SearchAPI Google Hotels types ---

export interface SearchAPIHotelImage {
  thumbnail: string;
  original: string;
}

export interface SearchAPIHotelNearby {
  name: string;
  transportations: Array<{ type: string; duration: string }>;
}

export interface SearchAPIHotelOffer {
  source: string;
  logo?: string;
  num_guests?: number;
  price_per_night?: { price_before_taxes: string; extracted_price_before_taxes: number };
}

export interface SearchAPIHotelReviewBreakdown {
  name: string;
  description: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
}

export interface SearchAPIHotelProperty {
  type: string; // "hotel" | "vacation_rental"
  property_token: string;
  data_id?: string;
  name: string;
  link?: string;
  description?: string;
  gps_coordinates?: { latitude: number; longitude: number };
  city?: string;
  country?: string;
  check_in_time?: string;
  check_out_time?: string;
  price_per_night?: { price_before_taxes: string; extracted_price_before_taxes: number };
  total_price?: { price_before_taxes: string; extracted_price_before_taxes: number };
  nearby_places?: SearchAPIHotelNearby[];
  hotel_class?: string; // "Hotel 5 estrelas"
  extracted_hotel_class?: number; // 5
  rating?: number;
  reviews?: number;
  reviews_histogram?: Record<string, number>;
  location_rating?: number;
  proximity_to_things_to_do_rating?: number;
  proximity_to_transit_rating?: number;
  airport_access_rating?: number;
  reviews_breakdown?: SearchAPIHotelReviewBreakdown[];
  eco_certified?: boolean;
  amenities?: string[];
  excluded_amenities?: string[];
  essential_info?: string[];
  images?: SearchAPIHotelImage[];
  offers?: SearchAPIHotelOffer[];
}

export interface SearchAPIHotelsResponse {
  properties?: SearchAPIHotelProperty[];
  search_information?: { total_results: number };
  search_parameters?: Record<string, unknown>;
}

export async function searchHotels(params: {
  query: string;
  check_in?: string;
  check_out?: string;
  adults?: number;
  children?: number;
}): Promise<{ data: SearchAPIHotelsResponse; cached: boolean }> {
  const cacheKey = `searchapi_hotels:${params.query}:${params.check_in || ''}:${params.check_out || ''}:${params.adults || 2}:${params.children || 0}`;
  const cached = await getCached(cacheKey);
  if (cached) return { data: cached as SearchAPIHotelsResponse, cached: true };

  const queryParams = new URLSearchParams({
    engine: 'google_hotels',
    q: params.query,
    adults: String(params.adults || 2),
    currency: 'BRL',
    hl: 'pt-BR',
    gl: 'br',
    api_key: SEARCHAPI_KEY,
  });

  if (params.check_in) queryParams.set('check_in_date', params.check_in);
  if (params.check_out) queryParams.set('check_out_date', params.check_out);
  if (params.children) queryParams.set('children', String(params.children));

  const url = `${SEARCHAPI_BASE}?${queryParams.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`SearchAPI hotel search failed: ${res.status} ${errText}`);
  }

  const data: SearchAPIHotelsResponse = await res.json();
  await setCache(cacheKey, data, 'SEARCHAPI', TTL_HOTELS);
  return { data, cached: false };
}
