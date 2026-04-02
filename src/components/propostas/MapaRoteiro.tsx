'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';

interface Ponto {
  lat: number;
  lng: number;
  label: string;
  dia?: number;
}

interface Props {
  pontos: Ponto[];
  height?: string;
}

// Lazy load to avoid SSR issues with Leaflet
const MapaInterno = dynamic(() => import('./MapaRoteiroInterno'), {
  ssr: false,
  loading: () => (
    <div className="w-full bg-gray-100 rounded-xl flex items-center justify-center text-gray-400 text-sm" style={{ height: 300 }}>
      Carregando mapa...
    </div>
  ),
});

export function MapaRoteiro({ pontos, height }: Props) {
  const validPontos = useMemo(
    () => pontos.filter(p => p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng)),
    [pontos]
  );

  if (validPontos.length === 0) return null;

  return <MapaInterno pontos={validPontos} height={height} />;
}
