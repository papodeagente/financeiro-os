'use client';

import { useState } from 'react';
import {
  Hotel, Search, Loader2, Star, MapPin, Phone, Globe,
  CheckCircle2, AlertCircle, ExternalLink, ChevronDown, ChevronUp,
  Image as ImageIcon,
} from 'lucide-react';

interface GooglePlace {
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
  photos?: Array<{ name: string; widthPx: number; heightPx: number; authorAttributions?: Array<{ displayName: string }> }>;
  priceLevel?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  location?: { latitude: number; longitude: number };
  editorialSummary?: { text: string };
  googleMapsUri?: string;
  types?: string[];
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-gray-600'}`}
        />
      ))}
    </div>
  );
}

const AMENITY_MAP: Record<string, string> = {
  'lodging': 'Hospedagem',
  'spa': 'Spa',
  'restaurant': 'Restaurante',
  'bar': 'Bar',
  'gym': 'Academia',
  'swimming_pool': 'Piscina',
  'parking': 'Estacionamento',
  'airport_shuttle': 'Transfer aeroporto',
  'room_service': 'Room service',
  'laundry_service': 'Lavanderia',
  'business_center': 'Business center',
  'meeting_room': 'Sala de reunião',
  'resort_hotel': 'Resort',
  'hotel': 'Hotel',
};

function formatAmenities(types: string[]) {
  return types
    .map(t => AMENITY_MAP[t])
    .filter(Boolean)
    .filter(a => a !== 'Hotel' && a !== 'Hospedagem');
}

function PriceLevel({ level }: { level?: string }) {
  if (!level) return null;
  const map: Record<string, string> = {
    'PRICE_LEVEL_FREE': 'Grátis',
    'PRICE_LEVEL_INEXPENSIVE': '$',
    'PRICE_LEVEL_MODERATE': '$$',
    'PRICE_LEVEL_EXPENSIVE': '$$$',
    'PRICE_LEVEL_VERY_EXPENSIVE': '$$$$',
  };
  return <span className="text-xs text-amber-400 font-medium">{map[level] || level}</span>;
}

export default function HoteisPage() {
  const [destino, setDestino] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [results, setResults] = useState<GooglePlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [cached, setCached] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const buscar = async () => {
    if (!destino) { setError('Informe o destino'); return; }
    setError('');
    setSearching(true);
    setResults([]);
    try {
      let query = `hotéis em ${destino}`;
      if (checkIn) query += ` check-in ${checkIn}`;
      const res = await fetch('/api/hotels/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino, query }),
      });
      const json = await res.json();
      if (json.error) { setError(json.error); setSearching(false); return; }
      const places = json.data?.places || [];
      setResults(places);
      setCached(json.cached || false);
    } catch {
      setError('Erro ao buscar hotéis');
    }
    setSearching(false);
  };

  const noites = checkIn && checkOut
    ? Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000))
    : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-text)] flex items-center gap-2">
            <Hotel className="w-6 h-6 text-[var(--t-green)]" />
            Buscar Hotéis
          </h1>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">
            Busque hotéis com avaliações, fotos e amenities via Google Places
          </p>
        </div>

        {/* Search form */}
        <div className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] p-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Destino</label>
              <input
                value={destino}
                onChange={e => setDestino(e.target.value)}
                placeholder="Ex: Lisboa, Portugal"
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Check-in</label>
              <input
                type="date"
                value={checkIn}
                onChange={e => setCheckIn(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Check-out</label>
              <input
                type="date"
                value={checkOut}
                onChange={e => setCheckOut(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              />
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            {noites && (
              <span className="text-xs text-[var(--t-text-muted)]">{noites} noite{noites !== 1 ? 's' : ''}</span>
            )}
            <button
              onClick={buscar}
              disabled={searching}
              className="flex items-center gap-2 px-5 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 font-medium ml-auto"
            >
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar hotéis
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 px-4 py-3 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-4">
            <div className="text-sm text-[var(--t-text-secondary)]">
              {results.length} hotel{results.length !== 1 ? 'is' : ''} encontrado{results.length !== 1 ? 's' : ''}
              {cached && <span className="ml-2 text-xs text-amber-400">(cache)</span>}
            </div>

            {results.map(hotel => {
              const expanded = expandedId === hotel.id;
              const amenities = formatAmenities(hotel.types || []);
              const hasPhotos = hotel.photos && hotel.photos.length > 0;

              return (
                <div key={hotel.id} className="bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] overflow-hidden">
                  <div className="p-5">
                    <div className="flex gap-4">
                      {/* Photo placeholder */}
                      <div className="w-32 h-24 rounded-lg bg-[var(--t-bg)] flex items-center justify-center shrink-0 overflow-hidden">
                        {hasPhotos ? (
                          <ImageIcon className="w-8 h-8 text-[var(--t-text-muted)]" />
                        ) : (
                          <Hotel className="w-8 h-8 text-[var(--t-text-muted)]" />
                        )}
                        {hasPhotos && (
                          <span className="absolute text-[10px] text-[var(--t-text-muted)]">
                            {hotel.photos!.length} fotos
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-[var(--t-text)] truncate">
                          {hotel.displayName?.text || 'Hotel'}
                        </h3>

                        <div className="flex items-center gap-3 mt-1">
                          {hotel.rating && (
                            <div className="flex items-center gap-1.5">
                              <StarRating rating={hotel.rating} />
                              <span className="text-sm font-medium text-[var(--t-text)]">{hotel.rating}</span>
                              {hotel.userRatingCount && (
                                <span className="text-xs text-[var(--t-text-muted)]">({hotel.userRatingCount.toLocaleString('pt-BR')} avaliações)</span>
                              )}
                            </div>
                          )}
                          <PriceLevel level={hotel.priceLevel} />
                        </div>

                        {hotel.formattedAddress && (
                          <div className="flex items-center gap-1 mt-1.5 text-xs text-[var(--t-text-secondary)]">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span className="truncate">{hotel.formattedAddress}</span>
                          </div>
                        )}

                        {hotel.editorialSummary?.text && (
                          <p className="text-xs text-[var(--t-text-secondary)] mt-2 line-clamp-2">
                            {hotel.editorialSummary.text}
                          </p>
                        )}

                        {/* Amenities */}
                        {amenities.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {amenities.map(a => (
                              <span key={a} className="flex items-center gap-1 text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">
                                <CheckCircle2 className="w-2.5 h-2.5" /> {a}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--t-border)]">
                      <div className="flex items-center gap-2">
                        {hotel.googleMapsUri && (
                          <a
                            href={hotel.googleMapsUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                          >
                            <MapPin className="w-3 h-3" /> Ver no Google Maps
                          </a>
                        )}
                        {hotel.websiteUri && (
                          <a
                            href={hotel.websiteUri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
                          >
                            <Globe className="w-3 h-3" /> Site
                          </a>
                        )}
                        {hotel.internationalPhoneNumber && (
                          <span className="flex items-center gap-1 text-xs text-[var(--t-text-muted)]">
                            <Phone className="w-3 h-3" /> {hotel.internationalPhoneNumber}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setExpandedId(expanded ? null : hotel.id)}
                        className="flex items-center gap-1 text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
                      >
                        {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Menos</> : <><ChevronDown className="w-3.5 h-3.5" /> Avaliações</>}
                      </button>
                    </div>

                    {/* Expanded reviews */}
                    {expanded && hotel.reviews && hotel.reviews.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="text-xs font-medium text-[var(--t-text)] mb-2">Avaliações recentes:</div>
                        {hotel.reviews.slice(0, 5).map((review, rIdx) => (
                          <div key={rIdx} className="bg-[var(--t-bg)] rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <StarRating rating={review.rating} />
                                {review.authorAttribution?.uri ? (
                                  <a
                                    href={review.authorAttribution.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-medium text-blue-400 hover:underline flex items-center gap-0.5"
                                  >
                                    {review.authorAttribution.displayName} <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                ) : (
                                  <span className="text-xs font-medium text-[var(--t-text)]">
                                    {review.authorAttribution?.displayName || 'Anônimo'}
                                  </span>
                                )}
                              </div>
                              {review.relativePublishTimeDescription && (
                                <span className="text-[10px] text-[var(--t-text-muted)]">
                                  {review.relativePublishTimeDescription}
                                </span>
                              )}
                            </div>
                            {review.text?.text && (
                              <p className="text-xs text-[var(--t-text-secondary)] line-clamp-3">{review.text.text}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Attribution */}
            <div className="text-center py-2">
              <span className="text-[10px] text-[var(--t-text-muted)]">Powered by Google</span>
            </div>
          </div>
        )}

        {searching && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--t-green)]" />
            <span className="text-sm text-[var(--t-text-secondary)]">Buscando hotéis...</span>
          </div>
        )}
      </div>
    </div>
  );
}
