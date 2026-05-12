'use client';

import { useEffect, useRef } from 'react';
import type { AlojamentoData } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

const REGIME_LABELS: Record<string, Record<string, string>> = {
  pt: { RO: 'Somente hospedagem', BB: 'Café da manhã', HB: 'Meia pensão (café + jantar)', FB: 'Pensão completa (café + almoço + jantar)', AI: 'All Inclusive' },
  en: { RO: 'Room only', BB: 'Bed & Breakfast', HB: 'Half Board (breakfast + dinner)', FB: 'Full Board (all meals)', AI: 'All Inclusive' },
  es: { RO: 'Solo alojamiento', BB: 'Desayuno incluido', HB: 'Media pensión (desayuno + cena)', FB: 'Pensión completa', AI: 'Todo Incluido' },
};

interface Props {
  alojamento: AlojamentoData;
  idioma: IdiomaProposal;
  corPrimaria: string;
  onClose: () => void;
}

function formatDate(d: string, idioma: IdiomaProposal): string {
  if (!d) return '—';
  const locale = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR';
  return new Date(d + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
}

export function HotelModal({ alojamento: a, idioma, corPrimaria, onClose }: Props) {
  const i18n = t(idioma);
  const overlayRef = useRef<HTMLDivElement>(null);
  const lang = idioma === 'en' ? 'en' : idioma === 'es' ? 'es' : 'pt';
  const regimeDesc = REGIME_LABELS[lang]?.[a.regime] || a.regime;
  const proxyImg = (url: string) => {
    if (!url || url.startsWith('/')) return url;
    return `/api/img-proxy?url=${encodeURIComponent(url)}`;
  };
  const rawGaleria = a.hotel_galeria?.length ? a.hotel_galeria : a.hotel_imagem ? [a.hotel_imagem] : [];
  const galeria = rawGaleria.map(img => img.startsWith('/api/img-proxy') ? img : proxyImg(img));

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handleEsc); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
        >
          ✕
        </button>

        {/* Hero image */}
        {galeria.length > 0 && (
          <div className="relative">
            <img
              src={galeria[0]}
              alt={a.hotel_nome}
              className="w-full h-56 sm:h-72 object-cover rounded-t-2xl"
              referrerPolicy="no-referrer"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            {a.hotel_estrelas && (
              <div className="absolute bottom-3 left-4 px-2.5 py-1 rounded-lg bg-black/50 text-amber-400 text-sm font-medium backdrop-blur-sm">
                {'★'.repeat(a.hotel_estrelas)}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="p-5 sm:p-7 space-y-5">
          {/* Header */}
          <div>
            <h3 className="text-xl sm:text-2xl font-bold text-gray-900">{a.hotel_nome}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{a.destino_nome}</p>
          </div>

          {/* Avaliação Google (apenas se vendedor habilitou + dados disponíveis) */}
          {a.mostrar_avaliacao_google !== false && a.rating && a.rating > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-100">
              <div className="flex items-center gap-1">
                <span className="text-2xl">⭐</span>
                <div>
                  <div className="text-2xl font-bold text-amber-700 leading-none">{a.rating.toFixed(1)}</div>
                  <div className="text-[10px] text-amber-600 uppercase tracking-wide">Google Reviews</div>
                </div>
              </div>
              {a.reviews_count !== undefined && a.reviews_count > 0 && (
                <div className="text-sm text-gray-700 ml-2">
                  Baseado em <span className="font-semibold">{a.reviews_count.toLocaleString(idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR')}</span> {idioma === 'en' ? 'reviews' : idioma === 'es' ? 'reseñas' : 'avaliações'}
                </div>
              )}
            </div>
          )}

          {/* Description */}
          {a.hotel_descricao && (
            <p className="text-sm text-gray-700 leading-relaxed">{a.hotel_descricao}</p>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label={i18n.checkIn} value={formatDate(a.check_in, idioma)} icon="📅" />
            <InfoCard label={i18n.checkOut} value={formatDate(a.check_out, idioma)} icon="📅" />
            <InfoCard
              label={i18n.estadia}
              value={`${a.noites} ${a.noites === 1 ? (idioma === 'en' ? 'night' : 'noite') : i18n.noites}`}
              icon="🌙"
            />
            <InfoCard label={i18n.base} value={regimeDesc} icon="🍽️" />
            {a.quarto_tipo && <InfoCard label={idioma === 'en' ? 'Room type' : 'Tipo de quarto'} value={a.quarto_tipo} icon="🛏️" />}
            {a.bebidas && <InfoCard label={idioma === 'en' ? 'Beverages' : 'Bebidas'} value={a.bebidas} icon="🥂" />}
          </div>

          {/* Comodidades (Google amenities) — só se habilitado */}
          {a.mostrar_amenities !== false && a.amenities && a.amenities.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                {idioma === 'en' ? 'Amenities' : idioma === 'es' ? 'Comodidades' : 'Comodidades'}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {a.amenities.slice(0, 20).map((am, i) => (
                  <span
                    key={i}
                    className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200"
                  >
                    {am}
                  </span>
                ))}
                {a.amenities.length > 20 && (
                  <span className="text-[11px] px-2 py-1 rounded-full bg-gray-50 text-gray-500">
                    +{a.amenities.length - 20}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Gallery (só se habilitado) */}
          {a.mostrar_galeria !== false && galeria.length > 1 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">{idioma === 'en' ? 'Gallery' : idioma === 'es' ? 'Galería' : 'Galeria'}</h4>
              <div className="grid grid-cols-3 gap-2">
                {galeria.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt={`${a.hotel_nome} ${i + 1}`}
                    className="w-full h-24 sm:h-28 object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
                    referrerPolicy="no-referrer"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Link */}
          {a.hotel_link && (
            <a
              href={a.hotel_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: corPrimaria }}
            >
              {idioma === 'en' ? 'Visit website' : idioma === 'es' ? 'Visitar sitio web' : 'Visitar site'}
              <span className="text-xs">↗</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-gray-50 border border-gray-100">
      <span className="text-lg">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">{label}</div>
        <div className="text-sm font-medium text-gray-900 mt-0.5">{value}</div>
      </div>
    </div>
  );
}
