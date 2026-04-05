'use client';

import { useState, useEffect } from 'react';
import { Hotel, Search, Loader2, Star, MapPin, X, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { SearchAPIHotelProperty } from '@/lib/searchapi-hotels';
import { formatAmenities } from '@/lib/hotel-data-mapper';

interface HotelSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (hotel: SearchAPIHotelProperty) => void;
  defaultDestino?: string;
  defaultHotelName?: string;
  defaultCheckIn?: string;
  defaultCheckOut?: string;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-[var(--t-text-muted)]'}`} />
      ))}
    </div>
  );
}

function HotelClassBadge({ stars }: { stars?: number }) {
  if (!stars) return null;
  return (
    <span className="text-[10px] bg-amber-400/15 text-amber-400 px-1.5 py-0.5 rounded font-medium">
      {'★'.repeat(stars)} {stars} estrelas
    </span>
  );
}

export function HotelSearchModal({
  open, onClose, onSelect,
  defaultDestino = '', defaultHotelName = '',
  defaultCheckIn = '', defaultCheckOut = '',
}: HotelSearchModalProps) {
  const [query, setQuery] = useState(defaultHotelName ? `${defaultHotelName} em ${defaultDestino}` : defaultDestino);
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);
  const [adults, setAdults] = useState(2);
  const [results, setResults] = useState<SearchAPIHotelProperty[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Re-sync state when modal reopens with new defaults
  useEffect(() => {
    if (open) {
      setQuery(defaultHotelName ? `${defaultHotelName} em ${defaultDestino}` : defaultDestino);
      if (defaultCheckIn) setCheckIn(defaultCheckIn);
      if (defaultCheckOut) setCheckOut(defaultCheckOut);
      setResults([]);
      setError('');
      setExpandedId(null);
    }
  }, [open, defaultDestino, defaultHotelName, defaultCheckIn, defaultCheckOut]);

  if (!open) return null;

  const buscar = async () => {
    if (!query.trim()) { setError('Informe o destino ou nome do hotel'); return; }
    setError('');
    setSearching(true);
    setResults([]);
    try {
      const searchQuery = query.toLowerCase().includes('hotel') ? query : `hotéis em ${query}`;
      const res = await fetch('/api/hotels/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          check_in: checkIn || undefined,
          check_out: checkOut || undefined,
          adults,
        }),
      });
      const json = await res.json();
      if (json.error) { setError(json.error); setSearching(false); return; }
      const properties = json.data?.properties || [];
      setResults(properties);
      if (properties.length === 0) setError('Nenhum hotel encontrado');
    } catch { setError('Erro ao buscar hotéis'); }
    setSearching(false);
  };

  const handleSelect = (hotel: SearchAPIHotelProperty) => {
    onSelect(hotel);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-[var(--t-surface)] rounded-xl shadow-[var(--t-card-shadow)] shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--t-border)]">
          <h2 className="text-lg font-semibold text-[var(--t-text)] flex items-center gap-2">
            <Hotel className="w-5 h-5 text-[var(--t-green)]" />
            Buscar Hotéis
          </h2>
          <button onClick={onClose} className="text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search form */}
        <div className="px-5 py-4 border-b border-[var(--t-border)]">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Destino / Hotel</label>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && buscar()}
                placeholder="Ex: Lisboa, Portugal"
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Check-in</label>
              <input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Check-out</label>
              <input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
            </div>
            <div className="flex items-end">
              <button onClick={buscar} disabled={searching}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm font-medium">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar
              </button>
            </div>
          </div>
          {error && <div className="text-red-400 text-xs mt-2">{error}</div>}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {searching && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--t-green)]" />
            </div>
          )}

          {results.length > 0 && (
            <div className="text-xs text-[var(--t-text-muted)] mb-2">{results.length} hotel(is) encontrado(s)</div>
          )}

          {results.map(hotel => {
            const expanded = expandedId === hotel.property_token;
            const amenities = formatAmenities(hotel.amenities || []);
            const hasImages = hotel.images && hotel.images.length > 0;

            return (
              <div key={hotel.property_token} className="bg-[var(--t-bg)] rounded-xl shadow-[var(--t-card-shadow)] overflow-hidden">
                <div className="flex">
                  {/* Image */}
                  <div className="w-44 shrink-0 relative">
                    {hasImages ? (
                      <img
                        src={`/api/img-proxy?url=${encodeURIComponent(hotel.images![0].thumbnail || hotel.images![0].original)}`}
                        alt={hotel.name}
                        className="w-full h-full object-cover min-h-[140px]"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-full h-full min-h-[140px] bg-[var(--t-surface)] flex items-center justify-center">
                        <Hotel className="w-8 h-8 text-[var(--t-text-muted)]" />
                      </div>
                    )}
                    {hasImages && hotel.images!.length > 1 && (
                      <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded">
                        {hotel.images!.length} fotos
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 p-3 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-[var(--t-text)] truncate">{hotel.name}</h3>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <HotelClassBadge stars={hotel.extracted_hotel_class} />
                          {hotel.rating && (
                            <div className="flex items-center gap-1">
                              <StarRating rating={hotel.rating} />
                              <span className="text-xs font-medium text-[var(--t-text)]">{hotel.rating}</span>
                              {hotel.reviews && (
                                <span className="text-[10px] text-[var(--t-text-muted)]">({hotel.reviews.toLocaleString('pt-BR')})</span>
                              )}
                            </div>
                          )}
                          {hotel.eco_certified && (
                            <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded">Eco</span>
                          )}
                        </div>
                      </div>

                      {/* Price */}
                      <div className="text-right shrink-0">
                        {hotel.price_per_night?.extracted_price_before_taxes && (
                          <>
                            <div className="text-sm font-bold text-[var(--t-green)]">
                              R$ {hotel.price_per_night.extracted_price_before_taxes.toLocaleString('pt-BR')}
                            </div>
                            <div className="text-[9px] text-[var(--t-text-muted)]">/noite</div>
                          </>
                        )}
                        {hotel.total_price?.extracted_price_before_taxes && (
                          <div className="text-[10px] text-[var(--t-text-secondary)] mt-0.5">
                            Total: R$ {hotel.total_price.extracted_price_before_taxes.toLocaleString('pt-BR')}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Location */}
                    {hotel.city && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-[var(--t-text-secondary)]">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span>{hotel.city}, {hotel.country}</span>
                        {hotel.nearby_places?.[0] && (
                          <span className="text-[var(--t-text-muted)]">
                            — {hotel.nearby_places[0].name} ({hotel.nearby_places[0].transportations[0]?.duration})
                          </span>
                        )}
                      </div>
                    )}

                    {/* Description */}
                    {hotel.description && (
                      <p className="text-[10px] text-[var(--t-text-secondary)] mt-1 line-clamp-2">{hotel.description}</p>
                    )}

                    {/* Amenities */}
                    {amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {amenities.slice(0, 6).map(a => (
                          <span key={a} className="text-[9px] bg-[var(--t-surface)] text-[var(--t-text-secondary)] px-1.5 py-0.5 rounded">
                            {a}
                          </span>
                        ))}
                        {amenities.length > 6 && (
                          <span className="text-[9px] text-[var(--t-text-muted)]">+{amenities.length - 6}</span>
                        )}
                      </div>
                    )}

                    {/* Actions row */}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--t-border)]">
                      <button onClick={() => setExpandedId(expanded ? null : hotel.property_token)}
                        className="flex items-center gap-1 text-[10px] text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {expanded ? 'Menos' : 'Fotos e detalhes'}
                      </button>
                      <button onClick={() => handleSelect(hotel)}
                        className="flex items-center gap-1 px-3 py-1 bg-[var(--t-green)]/10 text-[var(--t-green)] text-xs rounded hover:bg-[var(--t-green)]/20 font-medium">
                        <Check className="w-3 h-3" /> Selecionar
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded: gallery + reviews + nearby */}
                {expanded && (
                  <div className="border-t border-[var(--t-border)] p-3 space-y-3">
                    {/* Image gallery */}
                    {hasImages && hotel.images!.length > 1 && (
                      <div>
                        <div className="text-[10px] font-medium text-[var(--t-text)] mb-1.5">Fotos</div>
                        <div className="flex gap-1.5 overflow-x-auto pb-1">
                          {hotel.images!.slice(0, 10).map((img, i) => (
                            <img
                              key={i}
                              src={`/api/img-proxy?url=${encodeURIComponent(img.thumbnail || img.original)}`}
                              alt={`${hotel.name} foto ${i + 1}`}
                              className="w-24 h-16 object-cover rounded-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => window.open(img.original || img.thumbnail, '_blank')}
                              loading="lazy"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Ratings breakdown */}
                    {hotel.reviews_breakdown && hotel.reviews_breakdown.length > 0 && (
                      <div>
                        <div className="text-[10px] font-medium text-[var(--t-text)] mb-1.5">Avaliações por categoria</div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {hotel.reviews_breakdown.map(rb => {
                            const pct = rb.total > 0 ? Math.round((rb.positive / rb.total) * 100) : 0;
                            return (
                              <div key={rb.name} className="bg-[var(--t-surface)] rounded-lg px-2 py-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-[var(--t-text)]">{rb.name}</span>
                                  <span className={`text-[10px] font-medium ${pct >= 60 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                                    {pct}%
                                  </span>
                                </div>
                                <div className="w-full h-1 bg-[var(--t-border)] rounded-full mt-1">
                                  <div
                                    className={`h-full rounded-full ${pct >= 60 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Reviews histogram */}
                    {hotel.reviews_histogram && (
                      <div>
                        <div className="text-[10px] font-medium text-[var(--t-text)] mb-1.5">Distribuição de notas</div>
                        <div className="space-y-0.5">
                          {[5, 4, 3, 2, 1].map(n => {
                            const count = hotel.reviews_histogram![String(n)] || 0;
                            const total = Object.values(hotel.reviews_histogram!).reduce((a, b) => a + b, 0);
                            const pct = total > 0 ? (count / total) * 100 : 0;
                            return (
                              <div key={n} className="flex items-center gap-2">
                                <span className="text-[10px] text-[var(--t-text-muted)] w-3">{n}</span>
                                <div className="flex-1 h-1.5 bg-[var(--t-border)] rounded-full">
                                  <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-[9px] text-[var(--t-text-muted)] w-10 text-right">{count}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Nearby places */}
                    {hotel.nearby_places && hotel.nearby_places.length > 0 && (
                      <div>
                        <div className="text-[10px] font-medium text-[var(--t-text)] mb-1.5">Proximidades</div>
                        <div className="grid grid-cols-2 gap-1">
                          {hotel.nearby_places.map((np, i) => (
                            <div key={i} className="flex items-center gap-1 text-[10px] text-[var(--t-text-secondary)]">
                              <MapPin className="w-2.5 h-2.5 shrink-0 text-[var(--t-text-muted)]" />
                              <span className="truncate">{np.name}</span>
                              <span className="text-[var(--t-text-muted)] shrink-0">
                                {np.transportations[0]?.duration}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Excluded amenities */}
                    {hotel.excluded_amenities && hotel.excluded_amenities.length > 0 && (
                      <div className="text-[10px] text-red-400/70">
                        {hotel.excluded_amenities.join(' · ')}
                      </div>
                    )}

                    {/* Map link */}
                    {hotel.gps_coordinates && (
                      <a
                        href={`https://www.google.com/maps?q=${hotel.gps_coordinates.latitude},${hotel.gps_coordinates.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-blue-400 hover:underline"
                      >
                        <MapPin className="w-3 h-3" /> Ver no Google Maps
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-[var(--t-border)] text-[10px] text-[var(--t-text-muted)]">
          Dados fornecidos por Google Hotels via SearchAPI
        </div>
      </div>
    </div>
  );
}
