// Hotel data mapper — converts SearchAPI Google Hotels responses to system formats

import type { HtlInfo } from './types';
import type { SearchAPIHotelProperty } from './searchapi-hotels';

// Re-export as the canonical hotel type used across the system
export type HotelResult = SearchAPIHotelProperty;

// Legacy alias — components that imported GooglePlace now get SearchAPIHotelProperty
export type GooglePlace = SearchAPIHotelProperty;

const AMENITY_TRANSLATE: Record<string, string> = {
  'Free Wi‑Fi': 'Wi-Fi grátis',
  'Free Wi-Fi': 'Wi-Fi grátis',
  'Pool': 'Piscina',
  'Indoor pool': 'Piscina coberta',
  'Outdoor pool': 'Piscina externa',
  'Spa': 'Spa',
  'Fitness center': 'Academia',
  'Restaurant': 'Restaurante',
  'Bar': 'Bar',
  'Room service': 'Room service',
  'Air conditioning': 'Ar condicionado',
  'Parking ($)': 'Estacionamento (pago)',
  'Free parking': 'Estacionamento grátis',
  'Parking': 'Estacionamento',
  'Kitchen': 'Cozinha',
  'Washer': 'Lavadora',
  'Full‑service laundry': 'Lavanderia',
  'Full-service laundry': 'Lavanderia',
  'Business center': 'Business center',
  'Accessible': 'Acessível',
  'Kid-friendly': 'Ideal para crianças',
  'Smoke-free property': 'Proibido fumar',
  'Airport shuttle': 'Transfer aeroporto',
  'Breakfast': 'Café da manhã',
  'Beach access': 'Acesso à praia',
  'Pet-friendly': 'Aceita pets',
  'EV charger': 'Carregador EV',
};

export function formatAmenities(amenities: string[]): string[] {
  return amenities.map(a => AMENITY_TRANSLATE[a] || a);
}

function starString(rating: number): string {
  return `${rating}/5`;
}

function formatPrice(prop: SearchAPIHotelProperty): string {
  if (prop.price_per_night?.extracted_price_before_taxes) {
    return `R$ ${prop.price_per_night.extracted_price_before_taxes.toLocaleString('pt-BR')} /noite`;
  }
  return '';
}

/**
 * Format hotel for HtlTab info panel
 */
export function formatHotelForHtlInfo(hotel: SearchAPIHotelProperty): Partial<HtlInfo> {
  const result: Partial<HtlInfo> = {};

  if (hotel.check_in_time) result.check_in_hora = hotel.check_in_time;
  if (hotel.check_out_time) result.check_out_hora = hotel.check_out_time;

  const hasParking = hotel.amenities?.some(a => a.toLowerCase().includes('parking'));
  if (hasParking) {
    const free = hotel.amenities?.some(a => a.toLowerCase().includes('free parking'));
    result.estacionamento = free ? 'Gratuito' : 'Disponível (pago)';
  }

  const infoLines: string[] = [];
  if (hotel.name) infoLines.push(`Hotel: ${hotel.name}`);
  if (hotel.extracted_hotel_class) infoLines.push(`Classificação: ${hotel.extracted_hotel_class} estrelas`);
  if (hotel.rating) infoLines.push(`Avaliação Google: ${starString(hotel.rating)} (${hotel.reviews?.toLocaleString('pt-BR') || '0'} avaliações)`);
  if (hotel.description) infoLines.push(`Descrição: ${hotel.description}`);
  if (hotel.city) infoLines.push(`Cidade: ${hotel.city}, ${hotel.country || ''}`);
  const price = formatPrice(hotel);
  if (price) infoLines.push(`Preço: ${price}`);
  if (hotel.amenities && hotel.amenities.length > 0) infoLines.push(`Amenities: ${formatAmenities(hotel.amenities).join(', ')}`);
  if (hotel.link) infoLines.push(`Site: ${hotel.link}`);

  if (infoLines.length > 0) {
    result.info_adicional = `[Dados Google Hotels]\n${infoLines.join('\n')}`;
  }

  return result;
}

/**
 * Format hotel for Vendas
 */
export function formatHotelForVenda(hotel: SearchAPIHotelProperty): {
  hotel_nome: string;
  descricao: string;
} {
  const parts: string[] = [];

  if (hotel.extracted_hotel_class) parts.push(`${hotel.extracted_hotel_class}★`);
  if (hotel.rating) parts.push(`${starString(hotel.rating)} (${hotel.reviews?.toLocaleString('pt-BR') || '0'} avaliações)`);
  if (hotel.city) parts.push(`${hotel.city}, ${hotel.country || ''}`);
  const price = formatPrice(hotel);
  if (price) parts.push(price);
  if (hotel.amenities && hotel.amenities.length > 0) parts.push(formatAmenities(hotel.amenities.slice(0, 5)).join(', '));
  if (hotel.description) parts.push(hotel.description);

  return {
    hotel_nome: hotel.name || '',
    descricao: parts.join(' | '),
  };
}

/**
 * Format hotel for Propostas — returns SERVICO block conteudo
 */
export function formatHotelForProposta(hotel: SearchAPIHotelProperty): Record<string, unknown> {
  const detalhes: string[] = [];

  if (hotel.extracted_hotel_class) detalhes.push(`Classificação: ${hotel.extracted_hotel_class} estrelas`);
  if (hotel.city) detalhes.push(`Localização: ${hotel.city}, ${hotel.country || ''}`);
  if (hotel.rating) detalhes.push(`Avaliação: ${starString(hotel.rating)} (${hotel.reviews?.toLocaleString('pt-BR') || '0'} avaliações)`);
  const price = formatPrice(hotel);
  if (price) detalhes.push(`Preço: ${price}`);
  if (hotel.amenities && hotel.amenities.length > 0) detalhes.push(`Amenities: ${formatAmenities(hotel.amenities).join(', ')}`);
  if (hotel.check_in_time) detalhes.push(`Check-in: ${hotel.check_in_time}`);
  if (hotel.check_out_time) detalhes.push(`Check-out: ${hotel.check_out_time}`);
  if (hotel.link) detalhes.push(`Site: ${hotel.link}`);

  // Nearby places
  if (hotel.nearby_places && hotel.nearby_places.length > 0) {
    detalhes.push('---');
    detalhes.push('Proximidades:');
    hotel.nearby_places.forEach(np => {
      const transps = np.transportations.map(t => `${t.type} ${t.duration}`).join(' / ');
      detalhes.push(`  • ${np.name} — ${transps}`);
    });
  }

  // Reviews breakdown
  if (hotel.reviews_breakdown && hotel.reviews_breakdown.length > 0) {
    detalhes.push('---');
    hotel.reviews_breakdown.slice(0, 4).forEach(rb => {
      const pct = rb.total > 0 ? Math.round((rb.positive / rb.total) * 100) : 0;
      detalhes.push(`${rb.name}: ${pct}% positivo (${rb.total} menções)`);
    });
  }

  const firstImage = hotel.images?.[0]?.original || '';

  return {
    icone: '🏨',
    titulo: hotel.name || 'Hotel',
    descricao: hotel.description || `${hotel.name} — ${hotel.city || ''}`,
    detalhes,
    imagem: firstImage,
    valor: 0,
    exibir_valor: false,
  };
}

/**
 * Format hotel for Propostas Discovery — returns ALOJAMENTO block conteudo
 */
export function formatHotelForAlojamento(hotel: SearchAPIHotelProperty): Record<string, unknown> {
  const firstImage = hotel.images?.[0]?.original || '';
  const gallery = (hotel.images || []).slice(0, 8).map(img => img.original);
  const estrelas = hotel.extracted_hotel_class || (hotel.rating ? Math.round(hotel.rating) : 0);

  // Build description with amenities + reviews
  const descParts: string[] = [];
  if (hotel.description) descParts.push(hotel.description);
  if (hotel.amenities && hotel.amenities.length > 0) {
    descParts.push(`Amenities: ${formatAmenities(hotel.amenities).join(', ')}`);
  }
  if (hotel.reviews_breakdown && hotel.reviews_breakdown.length > 0) {
    const topPositive = hotel.reviews_breakdown
      .filter(rb => rb.total > 0)
      .sort((a, b) => (b.positive / b.total) - (a.positive / a.total))
      .slice(0, 3)
      .map(rb => `${rb.name} (${Math.round((rb.positive / rb.total) * 100)}% positivo)`);
    if (topPositive.length > 0) descParts.push(`Destaques: ${topPositive.join(', ')}`);
  }

  return {
    id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
    destino_nome: hotel.city || '',
    hotel_nome: hotel.name || 'Hotel',
    hotel_estrelas: Math.min(estrelas, 5),
    hotel_imagem: firstImage,
    hotel_galeria: gallery,
    hotel_descricao: descParts.join('\n'),
    hotel_link: hotel.link || '',
    check_in: '',
    check_out: '',
    noites: 0,
    regime: 'BB',
    quarto_tipo: '',
    bebidas: '',
    viagem_noturna: false,
    lat: hotel.gps_coordinates?.latitude,
    lng: hotel.gps_coordinates?.longitude,
    preco_noite: hotel.price_per_night?.extracted_price_before_taxes || null,
    preco_total: hotel.total_price?.extracted_price_before_taxes || null,
    rating: hotel.rating,
    reviews_count: hotel.reviews,
    amenities: hotel.amenities || [],
  };
}

/**
 * Get first image URL
 */
export function getFirstPhotoUrl(hotel: SearchAPIHotelProperty): string {
  return hotel.images?.[0]?.original || '';
}
