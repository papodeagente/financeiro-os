'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [animationKey, setAnimationKey] = useState(0);
  const [hasPlayed, setHasPlayed] = useState(false);

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

    const validAlojs = alojamentos.filter(a => a.lat && a.lng);
    const allLatLngs: L.LatLng[] = validAlojs.map(a => L.latLng(a.lat!, a.lng!));

    // Initial bounds — show full route from start so user has context
    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [60, 60], maxZoom: 10 });
    } else {
      map.setView([20, 0], 2);
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const layers: L.Layer[] = [];

    const animate = () => {
      // Clear previous animated layers
      layers.forEach(l => map.removeLayer(l));
      layers.length = 0;

      // Step 1 — drop markers sequentially
      validAlojs.forEach((a, i) => {
        const t = setTimeout(() => {
          if (!mapInstance.current) return;
          const latlng = L.latLng(a.lat!, a.lng!);
          const color = MARKER_COLORS[i % MARKER_COLORS.length];
          const letter = String.fromCharCode(65 + i);

          const icon = L.divIcon({
            className: 'route-marker',
            html: `<div class="route-pin" style="
              --pin-color: ${color};
              background: ${color};
              color: white;
              width: 36px; height: 36px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 15px;
              font-weight: 700;
              border: 3px solid white;
              box-shadow: 0 4px 14px rgba(0,0,0,0.35);
            ">${letter}</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          });

          const marker = L.marker(latlng, { icon })
            .addTo(map)
            .bindPopup(`<div style="text-align:center;min-width:160px">
              <strong style="display:block;color:${color};margin-bottom:2px">${a.hotel_nome || a.destino_nome}</strong>
              <small style="color:#6b7280">${a.destino_nome}</small>
              ${a.noites ? `<br/><small style="color:#9ca3af">${a.noites} noite(s)</small>` : ''}
            </div>`);
          layers.push(marker);

          // Pan to most recent pin halfway through animation
          if (i > 0 && i < validAlojs.length - 1 && validAlojs.length > 2) {
            map.panTo(latlng, { animate: true, duration: 0.6 });
          }
        }, 400 + i * 450);
        timeouts.push(t);
      });

      // Step 2 — draw lines between consecutive hotels (after pins land)
      const linesStartDelay = 400 + validAlojs.length * 450;
      for (let i = 0; i < allLatLngs.length - 1; i++) {
        const t = setTimeout(() => {
          if (!mapInstance.current) return;
          const fromAloj = validAlojs[i];
          const toAloj = validAlojs[i + 1];

          const hasFlight = transportes.some(tr =>
            tr.tipo === 'VOO' &&
            tr.data >= (fromAloj.check_in || '') &&
            tr.data <= (toAloj.check_out || '')
          );

          const line = L.polyline([allLatLngs[i], allLatLngs[i + 1]], {
            color: hasFlight ? '#64748b' : corPrimaria,
            weight: hasFlight ? 2.5 : 3.5,
            opacity: 0,
            dashArray: hasFlight ? '8, 10' : undefined,
            className: 'route-line-animated',
          }).addTo(map);
          layers.push(line);

          // Fade in
          let op = 0;
          const fadeInterval = setInterval(() => {
            op += 0.08;
            if (op >= 0.75) {
              op = 0.75;
              clearInterval(fadeInterval);
            }
            line.setStyle({ opacity: op });
          }, 30);

          // Distance / time label at midpoint
          const matching = transportes.find(tr =>
            tr.data >= (fromAloj.check_in || '') &&
            tr.data <= (toAloj.check_out || '')
          );

          if (matching?.distancia_km || matching?.tempo_estimado) {
            const labelText = [
              matching.distancia_km ? `${matching.distancia_km}km` : '',
              matching.tempo_estimado || '',
            ].filter(Boolean).join(' · ');

            const mid = L.latLng(
              (allLatLngs[i].lat + allLatLngs[i + 1].lat) / 2,
              (allLatLngs[i].lng + allLatLngs[i + 1].lng) / 2
            );

            const labelIcon = L.divIcon({
              className: 'route-label',
              html: `<div style="
                background: white;
                color: #374151;
                padding: 3px 9px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                white-space: nowrap;
                box-shadow: 0 2px 6px rgba(0,0,0,0.18);
                border: 1px solid #e5e7eb;
                opacity: 0;
                animation: routeLabelFade 0.6s ease-out forwards;
                animation-delay: 0.2s;
              ">${hasFlight ? '✈ ' : ''}${labelText}</div>`,
              iconSize: [0, 0],
            });

            const label = L.marker(mid, { icon: labelIcon, interactive: false }).addTo(map);
            layers.push(label);
          }
        }, linesStartDelay + i * 350);
        timeouts.push(t);
      }

      // Step 3 — refit bounds at end
      const refitDelay = linesStartDelay + (allLatLngs.length - 1) * 350 + 500;
      const refitTimeout = setTimeout(() => {
        if (!mapInstance.current) return;
        if (allLatLngs.length > 0) {
          map.fitBounds(L.latLngBounds(allLatLngs), { padding: [60, 60], maxZoom: 10, animate: true, duration: 1.2 });
        }
      }, refitDelay);
      timeouts.push(refitTimeout);
    };

    // Trigger animation when map enters viewport
    let observer: IntersectionObserver | null = null;
    let started = false;
    const startOnce = () => {
      if (started) return;
      started = true;
      animate();
      setHasPlayed(true);
    };

    if (mapRef.current && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(
        entries => {
          entries.forEach(e => {
            if (e.isIntersecting) startOnce();
          });
        },
        { threshold: 0.3 }
      );
      observer.observe(mapRef.current);
    } else {
      startOnce();
    }

    return () => {
      timeouts.forEach(clearTimeout);
      if (observer) observer.disconnect();
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [alojamentos, transportes, corPrimaria, animationKey]);

  const replay = () => {
    setAnimationKey(k => k + 1);
  };

  return (
    <div className="relative">
      <div
        ref={mapRef}
        className="w-full rounded-[20px] overflow-hidden"
        style={{ height: '500px', position: 'relative', zIndex: 0 }}
      />
      {hasPlayed && (
        <button
          onClick={replay}
          className="absolute bottom-4 left-4 z-[400] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-sm shadow-md border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-white hover:scale-105 transition-all"
          aria-label="Reproduzir rota"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          Reproduzir rota
        </button>
      )}
      <style jsx global>{`
        @keyframes routePinDrop {
          0% { opacity: 0; transform: translateY(-30px) scale(0.5); }
          60% { opacity: 1; transform: translateY(4px) scale(1.1); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes routeLabelFade {
          from { opacity: 0; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1); }
        }
        .route-pin {
          animation: routePinDrop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .route-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
}
