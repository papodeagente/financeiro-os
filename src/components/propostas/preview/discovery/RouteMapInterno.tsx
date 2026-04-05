'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AlojamentoData, TransporteData } from '@/lib/crm-types';

const MARKER_COLORS = [
  '#004aad', '#0891b2', '#7c3aed', '#d97706', '#dc2626',
  '#059669', '#c026d3', '#0d9488', '#ea580c', '#4f46e5',
];

interface Props {
  alojamentos: AlojamentoData[];
  transportes: TransporteData[];
  corPrimaria: string;
}

export default function RouteMapInterno({ alojamentos, transportes, corPrimaria }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

    const map = L.map(mapRef.current, {
      scrollWheelZoom: false,
      attributionControl: false,
      zoomControl: true,
    });
    mapInstance.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const allLatLngs: L.LatLng[] = [];

    // Hotel markers (lettered A, B, C...)
    alojamentos.forEach((a, i) => {
      if (!a.lat || !a.lng) return;
      const latlng = L.latLng(a.lat, a.lng);
      allLatLngs.push(latlng);
      const color = MARKER_COLORS[i % MARKER_COLORS.length];
      const letter = String.fromCharCode(65 + i);

      const icon = L.divIcon({
        className: 'route-marker',
        html: `<div style="
          background: ${color};
          color: white;
          width: 32px; height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 700;
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ">${letter}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      L.marker(latlng, { icon })
        .addTo(map)
        .bindPopup(`<div style="text-align:center">
          <strong>${a.hotel_nome || a.destino_nome}</strong>
          <br/><small>${a.destino_nome}</small>
          ${a.noites ? `<br/><small>${a.noites} noite(s)</small>` : ''}
        </div>`);
    });

    // Draw lines between consecutive hotels (solid for transfers)
    const hotelCoords = alojamentos
      .filter(a => a.lat && a.lng)
      .map(a => L.latLng(a.lat!, a.lng!));

    if (hotelCoords.length > 1) {
      // Check if there's a VOO transport between consecutive hotels
      for (let i = 0; i < hotelCoords.length - 1; i++) {
        const fromAloj = alojamentos.filter(a => a.lat && a.lng)[i];
        const toAloj = alojamentos.filter(a => a.lat && a.lng)[i + 1];

        // Check if there's a flight between these locations
        const hasFlight = transportes.some(t =>
          t.tipo === 'VOO' &&
          t.data >= (fromAloj.check_in || '') &&
          t.data <= (toAloj.check_out || '')
        );

        const line = L.polyline([hotelCoords[i], hotelCoords[i + 1]], {
          color: hasFlight ? '#64748b' : corPrimaria,
          weight: hasFlight ? 2 : 3,
          opacity: 0.7,
          dashArray: hasFlight ? '6, 8' : undefined,
        }).addTo(map);

        // Distance label at midpoint
        const mid = L.latLng(
          (hotelCoords[i].lat + hotelCoords[i + 1].lat) / 2,
          (hotelCoords[i].lng + hotelCoords[i + 1].lng) / 2
        );

        // Find matching transport for distance info
        const matchingTransport = transportes.find(t =>
          t.data >= (fromAloj.check_in || '') &&
          t.data <= (toAloj.check_out || '')
        );

        if (matchingTransport?.distancia_km || matchingTransport?.tempo_estimado) {
          const labelText = [
            matchingTransport.distancia_km ? `${matchingTransport.distancia_km}km` : '',
            matchingTransport.tempo_estimado || '',
          ].filter(Boolean).join(' · ');

          const labelIcon = L.divIcon({
            className: 'route-label',
            html: `<div style="
              background: white;
              color: #374151;
              padding: 2px 8px;
              border-radius: 10px;
              font-size: 10px;
              font-weight: 600;
              white-space: nowrap;
              box-shadow: 0 1px 4px rgba(0,0,0,0.15);
              border: 1px solid #e5e7eb;
            ">${labelText}</div>`,
            iconSize: [0, 0],
          });

          L.marker(mid, { icon: labelIcon, interactive: false }).addTo(map);
        }
      }
    }

    // Fit bounds
    if (allLatLngs.length > 0) {
      const bounds = L.latLngBounds(allLatLngs);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
    } else {
      map.setView([20, 0], 2);
    }

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [alojamentos, transportes, corPrimaria]);

  return (
    <div
      ref={mapRef}
      className="w-full rounded-[20px] overflow-hidden"
      style={{ height: '500px', position: 'relative', zIndex: 0 }}
    />
  );
}
