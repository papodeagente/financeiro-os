'use client';

import dynamic from 'next/dynamic';
import type { AlojamentoData, TransporteData } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

const RouteMapInterno = dynamic(() => import('./RouteMapInterno'), {
  ssr: false,
  loading: () => (
    <div className="w-full bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400 text-sm" style={{ height: 500 }}>
      Carregando mapa...
    </div>
  ),
});

interface Props {
  alojamentos: AlojamentoData[];
  transportes: TransporteData[];
  idioma: IdiomaProposal;
  corPrimaria: string;
}

export function RouteMap({ alojamentos, transportes, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);

  // Only render if at least one alojamento has coordinates
  const hasCoords = alojamentos.some(a => a.lat && a.lng);
  if (!hasCoords) return null;

  return (
    <section id="discovery-map" className="py-16 bg-gray-50">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-8">{i18n.mapaRota}</h2>
        <RouteMapInterno
          alojamentos={alojamentos}
          transportes={transportes}
          corPrimaria={corPrimaria}
        />
      </div>
    </section>
  );
}
