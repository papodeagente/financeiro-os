'use client';

import { useState } from 'react';
import { Hotel, Search, Loader2, Star, MapPin, X, Check, CheckCircle2 } from 'lucide-react';
import type { GooglePlace } from '@/lib/hotel-data-mapper';
import { formatAmenities } from '@/lib/hotel-data-mapper';

interface HotelSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (place: GooglePlace) => void;
  defaultDestino?: string;
  defaultHotelName?: string;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-3 h-3 ${i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-gray-600'}`} />
      ))}
    </div>
  );
}

export function HotelSearchModal({
  open, onClose, onSelect,
  defaultDestino = '', defaultHotelName = '',
}: HotelSearchModalProps) {
  const [query, setQuery] = useState(defaultHotelName ? `${defaultHotelName} em ${defaultDestino}` : defaultDestino);
  const [results, setResults] = useState<GooglePlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const buscar = async () => {
    if (!query.trim()) { setError('Informe o destino ou nome do hotel'); return; }
    setError('');
    setSearching(true);
    setResults([]);
    try {
      const searchQuery = query.includes('hotel') || query.includes('Hotel') ? query : `hotéis em ${query}`;
      const res = await fetch('/api/hotels/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destino: query, query: searchQuery }),
      });
      const json = await res.json();
      if (json.error) { setError(json.error); setSearching(false); return; }
      setResults(json.data?.places || []);
    } catch { setError('Erro ao buscar hotéis'); }
    setSearching(false);
  };

  const handleSelect = (place: GooglePlace) => {
    onSelect(place);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-[var(--t-surface)] rounded-xl border border-[var(--t-border)] shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
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
          <div className="flex gap-3">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && buscar()}
              placeholder="Ex: Lisboa, Portugal ou nome do hotel"
              className="flex-1 px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
            />
            <button onClick={buscar} disabled={searching} className="flex items-center gap-2 px-4 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm font-medium">
              {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>
          </div>
          {error && <div className="text-red-400 text-xs mt-2">{error}</div>}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {searching && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--t-green)]" />
            </div>
          )}

          {results.length > 0 && (
            <div className="text-xs text-[var(--t-text-muted)] mb-2">{results.length} hotel(is) encontrado(s)</div>
          )}

          {results.map(hotel => {
            const amenities = formatAmenities(hotel.types || []);
            return (
              <div key={hotel.id} className="bg-[var(--t-bg)] rounded-lg border border-[var(--t-border)] p-3 hover:border-[var(--t-green)]/50 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--t-text)] truncate">
                      {hotel.displayName?.text || 'Hotel'}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      {hotel.rating && (
                        <div className="flex items-center gap-1">
                          <StarRating rating={hotel.rating} />
                          <span className="text-xs text-[var(--t-text)]">{hotel.rating}</span>
                          {hotel.userRatingCount && (
                            <span className="text-[10px] text-[var(--t-text-muted)]">({hotel.userRatingCount.toLocaleString('pt-BR')})</span>
                          )}
                        </div>
                      )}
                    </div>
                    {hotel.formattedAddress && (
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-[var(--t-text-secondary)]">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{hotel.formattedAddress}</span>
                      </div>
                    )}
                    {hotel.editorialSummary?.text && (
                      <p className="text-[10px] text-[var(--t-text-secondary)] mt-1 line-clamp-2">{hotel.editorialSummary.text}</p>
                    )}
                    {amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {amenities.map(a => (
                          <span key={a} className="flex items-center gap-0.5 text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded-full">
                            <CheckCircle2 className="w-2 h-2" /> {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleSelect(hotel)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[var(--t-green)]/10 text-[var(--t-green)] text-xs rounded hover:bg-[var(--t-green)]/20 font-medium shrink-0"
                  >
                    <Check className="w-3 h-3" /> Selecionar
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-[var(--t-border)] text-[10px] text-[var(--t-text-muted)]">
          Powered by Google
        </div>
      </div>
    </div>
  );
}
