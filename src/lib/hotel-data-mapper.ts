// Hotel data mapper — converts Google Places API responses to system formats

import type { HtlInfo } from './types';

export interface GooglePlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  reviews?: Array<{
    authorAttribution?: { displayName: string; uri: string };
    rating: number;
    text?: { text: string };
    relativePublishTimeDescription?: string;
  }>;
  photos?: Array<{
    name: string;
    widthPx: number;
    heightPx: number;
    authorAttributions?: Array<{ displayName: string }>;
  }>;
  priceLevel?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  location?: { latitude: number; longitude: number };
  editorialSummary?: { text: string };
  googleMapsUri?: string;
  types?: string[];
}

const AMENITY_MAP: Record<string, string> = {
  spa: 'Spa',
  restaurant: 'Restaurante',
  bar: 'Bar',
  gym: 'Academia',
  swimming_pool: 'Piscina',
  parking: 'Estacionamento',
  airport_shuttle: 'Transfer aeroporto',
  room_service: 'Room service',
  laundry_service: 'Lavanderia',
  business_center: 'Business center',
  meeting_room: 'Sala de reunião',
  resort_hotel: 'Resort',
};

export function formatAmenities(types: string[]): string[] {
  return types
    .map(t => AMENITY_MAP[t])
    .filter((a): a is string => !!a);
}

export function getFirstPhotoUrl(place: GooglePlace): string {
  // Returns photo reference name — the actual URL needs the API key,
  // which is added server-side via /api/hotels/photos
  if (!place.photos || place.photos.length === 0) return '';
  return place.photos[0].name;
}

function starString(rating: number): string {
  return `${rating}/5`;
}

/**
 * Format hotel for HtlTab info panel — fills empty fields only
 */
export function formatHotelForHtlInfo(place: GooglePlace): Partial<HtlInfo> {
  const result: Partial<HtlInfo> = {};
  const amenities = formatAmenities(place.types || []);

  // Estacionamento
  if (place.types?.includes('parking') || amenities.includes('Estacionamento')) {
    result.estacionamento = 'Disponível (Google Places)';
  }

  // Info adicional — always build (will be appended, not replaced)
  const infoLines: string[] = [];
  if (place.displayName?.text) infoLines.push(`Hotel: ${place.displayName.text}`);
  if (place.rating) infoLines.push(`Avaliação Google: ${starString(place.rating)} (${place.userRatingCount?.toLocaleString('pt-BR') || '0'} avaliações)`);
  if (place.formattedAddress) infoLines.push(`Endereço: ${place.formattedAddress}`);
  if (place.editorialSummary?.text) infoLines.push(`Descrição: ${place.editorialSummary.text}`);
  if (amenities.length > 0) infoLines.push(`Amenities: ${amenities.join(', ')}`);
  if (place.websiteUri) infoLines.push(`Site: ${place.websiteUri}`);
  if (place.internationalPhoneNumber) infoLines.push(`Telefone: ${place.internationalPhoneNumber}`);
  if (place.googleMapsUri) infoLines.push(`Google Maps: ${place.googleMapsUri}`);

  if (infoLines.length > 0) {
    result.info_adicional = `[Dados Google Places]\n${infoLines.join('\n')}`;
  }

  return result;
}

/**
 * Format hotel for Vendas — returns ProdutoVenda partial
 */
export function formatHotelForVenda(place: GooglePlace): {
  hotel_nome: string;
  descricao: string;
} {
  const nome = place.displayName?.text || '';
  const parts: string[] = [];

  if (place.rating) parts.push(`${starString(place.rating)} (${place.userRatingCount?.toLocaleString('pt-BR') || '0'} avaliações)`);
  if (place.formattedAddress) parts.push(place.formattedAddress);

  const amenities = formatAmenities(place.types || []);
  if (amenities.length > 0) parts.push(amenities.join(', '));
  if (place.editorialSummary?.text) parts.push(place.editorialSummary.text);

  return {
    hotel_nome: nome,
    descricao: parts.join(' | '),
  };
}

/**
 * Format hotel for Propostas — returns SERVICO block conteudo
 */
export function formatHotelForProposta(place: GooglePlace): Record<string, unknown> {
  const nome = place.displayName?.text || 'Hotel';
  const amenities = formatAmenities(place.types || []);
  const photoRef = getFirstPhotoUrl(place);

  const detalhes: string[] = [];
  if (place.formattedAddress) detalhes.push(`Endereço: ${place.formattedAddress}`);
  if (place.rating) detalhes.push(`Avaliação: ${starString(place.rating)} (${place.userRatingCount?.toLocaleString('pt-BR') || '0'} avaliações)`);
  if (amenities.length > 0) detalhes.push(`Amenities: ${amenities.join(', ')}`);
  if (place.internationalPhoneNumber) detalhes.push(`Telefone: ${place.internationalPhoneNumber}`);
  if (place.websiteUri) detalhes.push(`Site: ${place.websiteUri}`);

  // Add top reviews
  if (place.reviews && place.reviews.length > 0) {
    detalhes.push('---');
    place.reviews.slice(0, 2).forEach(r => {
      const author = r.authorAttribution?.displayName || 'Anônimo';
      const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
      const text = r.text?.text ? ` "${r.text.text.substring(0, 100)}${r.text.text.length > 100 ? '...' : ''}"` : '';
      detalhes.push(`${stars} ${author}${text}`);
    });
  }

  return {
    icone: '🏨',
    titulo: nome,
    descricao: place.editorialSummary?.text || `${nome} — ${place.formattedAddress || ''}`,
    detalhes,
    imagem: photoRef,
    valor: 0,
    exibir_valor: false,
  };
}
