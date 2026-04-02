import { getCached, setCache } from './api-cache';

const TTL_HOTELS = 7 * 24 * 3600; // 7 days
const TTL_PHOTOS = 30 * 24 * 3600; // 30 days

interface GooglePlacesConfig {
  api_key: string;
}

export async function searchHotels(config: GooglePlacesConfig, params: {
  query: string;
  languageCode?: string;
}) {
  const cacheKey = `gp_hotel_search:${params.query.toLowerCase()}`;
  const cached = await getCached(cacheKey);
  if (cached) return { data: cached, cached: true };

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.api_key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.reviews,places.photos,places.priceLevel,places.websiteUri,places.internationalPhoneNumber,places.location,places.types,places.editorialSummary,places.googleMapsUri',
    },
    body: JSON.stringify({
      textQuery: params.query,
      languageCode: params.languageCode || 'pt-BR',
      includedType: 'hotel',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Places search failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  await setCache(cacheKey, data, 'GOOGLE_PLACES', TTL_HOTELS);
  return { data, cached: false };
}

export async function getPlaceDetails(config: GooglePlacesConfig, placeId: string) {
  const cacheKey = `gp_details:${placeId}`;
  const cached = await getCached(cacheKey);
  if (cached) return { data: cached, cached: true };

  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': config.api_key,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,rating,userRatingCount,reviews,photos,priceLevel,websiteUri,internationalPhoneNumber,location,editorialSummary,currentOpeningHours,googleMapsUri,types',
    },
  });

  if (!res.ok) throw new Error(`Google Places details failed: ${res.status}`);
  const data = await res.json();
  await setCache(cacheKey, data, 'GOOGLE_PLACES', TTL_HOTELS);
  return { data, cached: false };
}

export function getPhotoUrl(config: GooglePlacesConfig, photoName: string, maxWidth = 800) {
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${maxWidth}&key=${config.api_key}`;
}

export async function getPhotoProxied(config: GooglePlacesConfig, photoName: string, maxWidth = 800) {
  const cacheKey = `gp_photo:${photoName}:${maxWidth}`;
  const cached = await getCached(cacheKey);
  if (cached) return { url: cached as string, cached: true };

  const url = getPhotoUrl(config, photoName, maxWidth);
  // For photos, we just return the URL — the browser fetches directly
  await setCache(cacheKey, url, 'GOOGLE_PLACES', TTL_PHOTOS);
  return { url, cached: false };
}

export async function testConnection(config: GooglePlacesConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.api_key,
        'X-Goog-FieldMask': 'places.id,places.displayName',
      },
      body: JSON.stringify({ textQuery: 'hotel test', languageCode: 'en', maxResultCount: 1 }),
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha na conexão' };
  }
}
