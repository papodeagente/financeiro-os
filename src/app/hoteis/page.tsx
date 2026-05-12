'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Hotel, Search, Loader2, Star, MapPin, Phone, Globe,
  AlertCircle, ChevronDown, ChevronUp, Check, ArrowLeft,
} from 'lucide-react';
import type { SearchAPIHotelProperty } from '@/lib/searchapi-hotels';
import { formatAmenities, importHotelImages } from '@/lib/hotel-data-mapper';
import { completeHotelHandoff, getActiveHandoffInfo } from '@/lib/api-search-handoff';

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`w-3.5 h-3.5 ${i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-[var(--t-text-muted)]'}`} />
      ))}
    </div>
  );
}

export default function HoteisPage() {
  const searchParams = useSearchParams();
  const [destino, setDestino] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [adults, setAdults] = useState(2);
  const [results, setResults] = useState<SearchAPIHotelProperty[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [cached, setCached] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

  // Modo handoff: vindo do botão "Buscar via API" de uma tab do grupo
  const handoff = getActiveHandoffInfo();
  const isHandoff = !!handoff && !!handoff.returnTo;
  const autoRanRef = useRef(false);

  // Prefill via query params + auto-search uma vez
  useEffect(() => {
    const d = searchParams.get('destino') || '';
    const h = searchParams.get('hotel') || '';
    const ci = searchParams.get('checkin') || '';
    const co = searchParams.get('checkout') || '';
    const ad = searchParams.get('adults');
    if (d || h) setDestino(h ? `${h} ${d}`.trim() : d);
    if (ci) setCheckIn(ci);
    if (co) setCheckOut(co);
    if (ad) setAdults(Math.max(1, parseInt(ad) || 2));
    if ((d || h) && !autoRanRef.current) {
      autoRanRef.current = true;
      // Pequeno delay garante que o state acima foi aplicado antes da busca
      setTimeout(() => buscarComQuery(h ? `${h} ${d}`.trim() : d, ci, co, parseInt(ad || '2')), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buscarComQuery = async (destinoArg: string, ciArg: string, coArg: string, adArg: number) => {
    if (!destinoArg) { setError('Informe o destino'); return; }
    setError('');
    setSearching(true);
    setResults([]);
    try {
      const query = destinoArg.toLowerCase().includes('hotel') ? destinoArg : `hotéis em ${destinoArg}`;
      const res = await fetch('/api/hotels/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, check_in: ciArg || undefined, check_out: coArg || undefined, adults: adArg }),
      });
      const json = await res.json();
      if (json.error) { setError(json.error); setSearching(false); return; }
      const properties = json.data?.properties || [];
      setResults(properties);
      setCached(json.cached || false);
      if (properties.length === 0) setError('Nenhum hotel encontrado');
    } catch {
      setError('Erro ao buscar hotéis');
    }
    setSearching(false);
  };

  const buscar = () => buscarComQuery(destino, checkIn, checkOut, adults);

  const selecionarHotel = async (hotel: SearchAPIHotelProperty) => {
    if (!handoff?.key || !handoff?.returnTo) return;
    setSelecting(hotel.property_token);
    try {
      // Baixa as imagens para storage local (proposta mantém após URLs do CDN expirarem)
      const withLocalImages = await importHotelImages(hotel);
      completeHotelHandoff(handoff.key, withLocalImages, handoff.returnTo);
    } finally {
      setSelecting(null);
    }
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
            Busque hotéis com fotos, preços e avaliações via Google Hotels
          </p>
        </div>

        {/* Faixa de handoff — só aparece quando vindo de um grupo */}
        {isHandoff && handoff?.returnTo && (
          <div className="flex items-center justify-between gap-3 bg-[var(--t-green-bg)] border border-[var(--t-green)]/30 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-[var(--t-green)]">
              <Hotel className="w-4 h-4 shrink-0" />
              <span>Selecione um hotel para inserir no grupo. Ele ficará salvo com fotos, avaliações e localização.</span>
            </div>
            <a
              href={handoff.returnTo}
              className="flex items-center gap-1 text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-text)] shrink-0"
            >
              <ArrowLeft className="w-3 h-3" /> Voltar sem selecionar
            </a>
          </div>
        )}

        {/* Search form */}
        <div className="bg-[var(--t-surface)] rounded-xl shadow-[var(--t-card-shadow)] p-5">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-2">
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Destino</label>
              <input value={destino} onChange={e => setDestino(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && buscar()}
                placeholder="Ex: Lisboa, Portugal"
                className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]" />
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
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 font-medium">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Buscar
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--t-text-secondary)]">Hóspedes:</label>
              <input type="number" min={1} max={10} value={adults} onChange={e => setAdults(+e.target.value)}
                className="w-16 px-2 py-1 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded text-sm text-[var(--t-text)]" />
            </div>
            {noites && <span className="text-xs text-[var(--t-text-muted)]">{noites} noite{noites !== 1 ? 's' : ''}</span>}
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
              const expanded = expandedId === hotel.property_token;
              const amenities = formatAmenities(hotel.amenities || []);
              const hasImages = hotel.images && hotel.images.length > 0;

              return (
                <div key={hotel.property_token} className="bg-[var(--t-surface)] rounded-xl shadow-[var(--t-card-shadow)] overflow-hidden">
                  <div className="flex">
                    {/* Image */}
                    <div className="w-48 shrink-0 relative">
                      {hasImages ? (
                        <img src={hotel.images![0].original} alt={hotel.name}
                          className="w-full h-full object-cover min-h-[180px]" loading="lazy" />
                      ) : (
                        <div className="w-full h-full min-h-[180px] bg-[var(--t-bg)] flex items-center justify-center">
                          <Hotel className="w-10 h-10 text-[var(--t-text-muted)]" />
                        </div>
                      )}
                      {hasImages && hotel.images!.length > 1 && (
                        <span className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded">
                          {hotel.images!.length} fotos
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 p-4 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-lg font-semibold text-[var(--t-text)] truncate">{hotel.name}</h3>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {hotel.extracted_hotel_class && (
                              <span className="text-[10px] bg-amber-400/15 text-amber-400 px-1.5 py-0.5 rounded font-medium">
                                {'★'.repeat(hotel.extracted_hotel_class)} {hotel.extracted_hotel_class} estrelas
                              </span>
                            )}
                            {hotel.rating && (
                              <div className="flex items-center gap-1">
                                <StarRating rating={hotel.rating} />
                                <span className="text-sm font-medium text-[var(--t-text)]">{hotel.rating}</span>
                                {hotel.reviews && (
                                  <span className="text-xs text-[var(--t-text-muted)]">({hotel.reviews.toLocaleString('pt-BR')})</span>
                                )}
                              </div>
                            )}
                            {hotel.eco_certified && (
                              <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded">Eco-certificado</span>
                            )}
                          </div>
                        </div>

                        {/* Price */}
                        <div className="text-right shrink-0">
                          {hotel.price_per_night?.extracted_price_before_taxes && (
                            <>
                              <div className="text-lg font-bold text-[var(--t-green)]">
                                R$ {hotel.price_per_night.extracted_price_before_taxes.toLocaleString('pt-BR')}
                              </div>
                              <div className="text-[10px] text-[var(--t-text-muted)]">/noite</div>
                            </>
                          )}
                          {hotel.total_price?.extracted_price_before_taxes && (
                            <div className="text-xs text-[var(--t-text-secondary)] mt-0.5">
                              Total: R$ {hotel.total_price.extracted_price_before_taxes.toLocaleString('pt-BR')}
                            </div>
                          )}
                        </div>
                      </div>

                      {hotel.city && (
                        <div className="flex items-center gap-1 mt-1.5 text-xs text-[var(--t-text-secondary)]">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span>{hotel.city}, {hotel.country}</span>
                        </div>
                      )}

                      {hotel.description && (
                        <p className="text-xs text-[var(--t-text-secondary)] mt-2 line-clamp-2">{hotel.description}</p>
                      )}

                      {/* Amenities */}
                      {amenities.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {amenities.slice(0, 8).map(a => (
                            <span key={a} className="text-[10px] bg-[var(--t-bg)] text-[var(--t-text-secondary)] px-2 py-0.5 rounded-full">
                              {a}
                            </span>
                          ))}
                          {amenities.length > 8 && (
                            <span className="text-[10px] text-[var(--t-text-muted)]">+{amenities.length - 8}</span>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--t-border)]">
                        <div className="flex items-center gap-3">
                          {hotel.gps_coordinates && (
                            <a href={`https://www.google.com/maps?q=${hotel.gps_coordinates.latitude},${hotel.gps_coordinates.longitude}`}
                              target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                              <MapPin className="w-3 h-3" /> Google Maps
                            </a>
                          )}
                          {hotel.link && (
                            <a href={hotel.link} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                              <Globe className="w-3 h-3" /> Site
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {isHandoff && (
                            <button
                              onClick={() => selecionarHotel(hotel)}
                              disabled={selecting !== null}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                            >
                              {selecting === hotel.property_token ? (
                                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Selecionando...</>
                              ) : (
                                <><Check className="w-3.5 h-3.5" /> Selecionar este hotel</>
                              )}
                            </button>
                          )}
                          <button onClick={() => setExpandedId(expanded ? null : hotel.property_token)}
                            className="flex items-center gap-1 text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                            {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Menos</> : <><ChevronDown className="w-3.5 h-3.5" /> Fotos e avaliações</>}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded */}
                  {expanded && (
                    <div className="border-t border-[var(--t-border)] p-4 space-y-4">
                      {/* Gallery */}
                      {hasImages && hotel.images!.length > 1 && (
                        <div>
                          <div className="text-xs font-medium text-[var(--t-text)] mb-2">Fotos</div>
                          <div className="flex gap-2 overflow-x-auto pb-2">
                            {hotel.images!.slice(0, 12).map((img, i) => (
                              <img key={i} src={img.thumbnail} alt={`${hotel.name} ${i + 1}`}
                                className="w-32 h-20 object-cover rounded-lg shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => window.open(img.original, '_blank')} loading="lazy" />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Reviews breakdown */}
                      {hotel.reviews_breakdown && hotel.reviews_breakdown.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-[var(--t-text)] mb-2">Avaliações por categoria</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {hotel.reviews_breakdown.map(rb => {
                              const pct = rb.total > 0 ? Math.round((rb.positive / rb.total) * 100) : 0;
                              return (
                                <div key={rb.name} className="bg-[var(--t-bg)] rounded-lg px-3 py-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-[var(--t-text)]">{rb.name}</span>
                                    <span className={`text-xs font-medium ${pct >= 60 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                                      {pct}%
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 bg-[var(--t-border)] rounded-full mt-1.5">
                                    <div className={`h-full rounded-full ${pct >= 60 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                                      style={{ width: `${pct}%` }} />
                                  </div>
                                  <div className="text-[9px] text-[var(--t-text-muted)] mt-0.5">{rb.total} menções</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Reviews histogram */}
                      {hotel.reviews_histogram && (
                        <div>
                          <div className="text-xs font-medium text-[var(--t-text)] mb-2">Distribuição de notas</div>
                          <div className="space-y-1 max-w-xs">
                            {[5, 4, 3, 2, 1].map(n => {
                              const count = hotel.reviews_histogram![String(n)] || 0;
                              const total = Object.values(hotel.reviews_histogram!).reduce((a, b) => a + b, 0);
                              const pct = total > 0 ? (count / total) * 100 : 0;
                              return (
                                <div key={n} className="flex items-center gap-2">
                                  <span className="text-xs text-[var(--t-text-muted)] w-3">{n}</span>
                                  <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                                  <div className="flex-1 h-2 bg-[var(--t-border)] rounded-full">
                                    <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-[10px] text-[var(--t-text-muted)] w-12 text-right">{count.toLocaleString('pt-BR')}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Nearby */}
                      {hotel.nearby_places && hotel.nearby_places.length > 0 && (
                        <div>
                          <div className="text-xs font-medium text-[var(--t-text)] mb-2">Proximidades</div>
                          <div className="grid grid-cols-2 gap-2">
                            {hotel.nearby_places.map((np, i) => (
                              <div key={i} className="flex items-start gap-1.5 text-xs text-[var(--t-text-secondary)]">
                                <MapPin className="w-3 h-3 shrink-0 mt-0.5 text-[var(--t-text-muted)]" />
                                <div>
                                  <div>{np.name}</div>
                                  <div className="text-[10px] text-[var(--t-text-muted)]">
                                    {np.transportations.map(t => `${t.type}: ${t.duration}`).join(' · ')}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Excluded amenities */}
                      {hotel.excluded_amenities && hotel.excluded_amenities.length > 0 && (
                        <div className="text-xs text-red-400/70">
                          <span className="font-medium">Não inclui: </span>{hotel.excluded_amenities.join(' · ')}
                        </div>
                      )}

                      <div className="text-[10px] text-[var(--t-text-muted)]">
                        Dados fornecidos por Google Hotels via SearchAPI — preços indicativos
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
