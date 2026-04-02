'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

export default function MapaRoteiroInterno({ pontos, height = '300px' }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || pontos.length === 0) return;

    // Clean up previous map
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

    const map = L.map(mapRef.current, {
      scrollWheelZoom: false,
      attributionControl: false,
    });
    mapInstance.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const markers: L.LatLng[] = [];

    pontos.forEach((p, i) => {
      const latlng = L.latLng(p.lat, p.lng);
      markers.push(latlng);

      const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          background: #004aad;
          color: white;
          width: 28px; height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          border: 2px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        ">${p.dia ?? i + 1}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      L.marker(latlng, { icon })
        .addTo(map)
        .bindPopup(`<strong>${p.label}</strong>`);
    });

    // Draw route line
    if (markers.length > 1) {
      L.polyline(markers, {
        color: '#004aad',
        weight: 3,
        opacity: 0.7,
        dashArray: '8, 8',
      }).addTo(map);
    }

    // Fit bounds
    const bounds = L.latLngBounds(markers);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [pontos]);

  return (
    <div
      ref={mapRef}
      className="w-full rounded-xl overflow-hidden"
      style={{ height }}
    />
  );
}
