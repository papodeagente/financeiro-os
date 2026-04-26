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
  selectedIndex?: number | null;
  onSelectIndex?: (index: number | null) => void;
}

const PLANE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" width="22" height="22"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;

function bearing(from: L.LatLng, to: L.LatLng): number {
  const f1 = (from.lat * Math.PI) / 180;
  const f2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function lerp(from: L.LatLng, to: L.LatLng, t: number): L.LatLng {
  return L.latLng(
    from.lat + (to.lat - from.lat) * t,
    from.lng + (to.lng - from.lng) * t
  );
}

export default function RouteMapInterno({
  alojamentos,
  transportes,
  corPrimaria,
  selectedIndex,
  onSelectIndex,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const animationLayersRef = useRef<L.Layer[]>([]);
  const animationFramesRef = useRef<number[]>([]);
  const animationTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [animationKey, setAnimationKey] = useState(0);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

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

    if (allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [70, 70], maxZoom: 10 });
    } else {
      map.setView([20, 0], 2);
    }

    // Place static markers immediately (always visible)
    markersRef.current = [];
    validAlojs.forEach((a, i) => {
      const latlng = L.latLng(a.lat!, a.lng!);
      const color = MARKER_COLORS[i % MARKER_COLORS.length];
      const letter = String.fromCharCode(65 + i);

      const icon = L.divIcon({
        className: 'route-marker',
        html: `<div class="route-pin" style="
          background: ${color};
          color: white;
          width: 38px; height: 38px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          font-weight: 700;
          border: 3px solid white;
          box-shadow: 0 4px 14px rgba(0,0,0,0.35);
        ">${letter}</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });

      const popup = `<div style="text-align:center;min-width:170px">
        <strong style="display:block;color:${color};margin-bottom:2px;font-size:13px">${a.hotel_nome || a.destino_nome}</strong>
        <small style="color:#6b7280">${a.destino_nome}</small>
        ${a.noites ? `<br/><small style="color:#9ca3af">${a.noites} noite(s)</small>` : ''}
      </div>`;

      const marker = L.marker(latlng, { icon })
        .addTo(map)
        .bindPopup(popup);
      marker.on('click', () => onSelectIndex?.(i));
      markersRef.current.push(marker);
    });

    // Static lines (faded background, replaced during animation)
    for (let i = 0; i < allLatLngs.length - 1; i++) {
      const fromAloj = validAlojs[i];
      const toAloj = validAlojs[i + 1];
      const hasFlight = transportes.some(tr =>
        tr.tipo === 'VOO' &&
        tr.data >= (fromAloj.check_in || '') &&
        tr.data <= (toAloj.check_out || '')
      );
      L.polyline([allLatLngs[i], allLatLngs[i + 1]], {
        color: hasFlight ? '#94a3b8' : corPrimaria,
        weight: hasFlight ? 2 : 2.5,
        opacity: 0.25,
        dashArray: hasFlight ? '6, 8' : undefined,
        className: 'route-static-line',
      }).addTo(map);
    }

    return () => {
      animationFramesRef.current.forEach(cancelAnimationFrame);
      animationTimeoutsRef.current.forEach(clearTimeout);
      animationFramesRef.current = [];
      animationTimeoutsRef.current = [];
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [alojamentos, transportes, corPrimaria, onSelectIndex]);

  // Cleanup helper for the dynamic animation layers
  const clearAnimationLayers = () => {
    const map = mapInstance.current;
    if (!map) return;
    animationLayersRef.current.forEach(l => map.removeLayer(l));
    animationLayersRef.current = [];
    animationFramesRef.current.forEach(cancelAnimationFrame);
    animationFramesRef.current = [];
    animationTimeoutsRef.current.forEach(clearTimeout);
    animationTimeoutsRef.current = [];
  };

  // Run the route animation (pins + segment-by-segment with plane on flights)
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    const validAlojs = alojamentos.filter(a => a.lat && a.lng);
    const points = validAlojs.map(a => L.latLng(a.lat!, a.lng!));
    if (points.length === 0) return;

    let cancelled = false;

    const runOnce = () => {
      clearAnimationLayers();
      setIsPlaying(true);

      // Reset markers (hide initially) so they can drop in
      markersRef.current.forEach(m => {
        const el = m.getElement() as HTMLDivElement | undefined;
        if (el) el.style.opacity = '0';
      });

      // Phase 1 — drop pins sequentially
      validAlojs.forEach((_, i) => {
        const t1 = setTimeout(() => {
          if (cancelled) return;
          const m = markersRef.current[i];
          const el = m?.getElement() as HTMLDivElement | undefined;
          if (el) {
            el.style.opacity = '1';
            const pin = el.querySelector('.route-pin') as HTMLDivElement | null;
            if (pin) {
              pin.style.animation = 'none';
              void pin.offsetWidth; // restart animation
              pin.style.animation = 'routePinDrop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards';
            }
          }
          if (i === 0) {
            map.flyTo(points[i], Math.max(map.getZoom(), 5), { animate: true, duration: 0.6 });
          }
        }, 300 + i * 380);
        animationTimeoutsRef.current.push(t1);
      });

      const segmentsStartDelay = 300 + validAlojs.length * 380 + 200;

      // Phase 2 — animate segments one at a time
      let cumulativeDelay = segmentsStartDelay;
      for (let i = 0; i < points.length - 1; i++) {
        const fromAloj = validAlojs[i];
        const toAloj = validAlojs[i + 1];
        const from = points[i];
        const to = points[i + 1];

        const flight = transportes.find(tr =>
          tr.tipo === 'VOO' &&
          tr.data >= (fromAloj.check_in || '') &&
          tr.data <= (toAloj.check_out || '')
        );
        const matching = transportes.find(tr =>
          tr.data >= (fromAloj.check_in || '') &&
          tr.data <= (toAloj.check_out || '')
        );

        const isFlight = !!flight;

        const segmentColor = isFlight ? '#1e40af' : corPrimaria;
        const segmentWeight = isFlight ? 2.5 : 3.5;
        const segmentDuration = isFlight ? 1600 : 1100;

        const startSegment = cumulativeDelay;
        cumulativeDelay += segmentDuration + 250;

        const startTimeout = setTimeout(() => {
          if (cancelled || !mapInstance.current) return;

          // Frame the segment
          const segmentBounds = L.latLngBounds([from, to]).pad(0.3);
          map.flyToBounds(segmentBounds, { animate: true, duration: 0.7, maxZoom: 7 });

          // Polyline drawn progressively
          const line = L.polyline([from, from], {
            color: segmentColor,
            weight: segmentWeight,
            opacity: 0.85,
            dashArray: isFlight ? '8, 8' : undefined,
            lineCap: 'round',
          }).addTo(map);
          animationLayersRef.current.push(line);

          // Plane / pulse marker for flights
          let movingMarker: L.Marker | null = null;
          if (isFlight) {
            const planeIcon = L.divIcon({
              className: 'route-plane',
              html: `<div class="route-plane-inner" style="
                width: 36px; height: 36px;
                border-radius: 50%;
                background: linear-gradient(135deg, ${corPrimaria}, #1e40af);
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 14px rgba(0,0,0,0.35);
                border: 2px solid white;
              ">${PLANE_SVG}</div>`,
              iconSize: [36, 36],
              iconAnchor: [18, 18],
            });
            movingMarker = L.marker(from, { icon: planeIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
            animationLayersRef.current.push(movingMarker);
          }

          // Animate progress along the segment
          const startedAt = performance.now();
          const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.5);
          const tick = () => {
            if (cancelled || !mapInstance.current) return;
            const elapsed = performance.now() - startedAt;
            const t = Math.min(elapsed / segmentDuration, 1);
            const eased = easeOut(t);
            const cur = lerp(from, to, eased);
            line.setLatLngs([from, cur]);
            if (movingMarker) {
              movingMarker.setLatLng(cur);
              const angle = bearing(from, to);
              const inner = (movingMarker.getElement() as HTMLDivElement | null)?.querySelector('.route-plane-inner svg');
              if (inner) {
                (inner as SVGSVGElement).style.transform = `rotate(${angle - 45}deg)`;
              }
            }
            if (t < 1) {
              const f = requestAnimationFrame(tick);
              animationFramesRef.current.push(f);
            } else if (movingMarker) {
              // Fade out plane
              const el = movingMarker.getElement() as HTMLDivElement | null;
              if (el) {
                el.style.transition = 'opacity 0.4s ease-out';
                el.style.opacity = '0';
              }
              const fade = setTimeout(() => {
                if (movingMarker && mapInstance.current) {
                  mapInstance.current.removeLayer(movingMarker);
                }
              }, 450);
              animationTimeoutsRef.current.push(fade);
            }
          };
          tick();

          // Distance label — placed at end (~70%) of segment to avoid overlap with pins (which are at endpoints)
          if (matching?.distancia_km || matching?.tempo_estimado) {
            const labelText = [
              matching.distancia_km ? `${matching.distancia_km}km` : '',
              matching.tempo_estimado || '',
            ].filter(Boolean).join(' · ');

            const labelPos = lerp(from, to, 0.5);
            const labelIcon = L.divIcon({
              className: 'route-label',
              html: `<div class="route-label-inner" style="
                background: white;
                color: #1f2937;
                padding: 4px 10px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 600;
                white-space: nowrap;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                border: 1px solid #e5e7eb;
                opacity: 0;
                animation: routeLabelFade 0.6s ease-out forwards;
                animation-delay: 0.4s;
              ">${isFlight ? '✈ ' : '→ '}${labelText}</div>`,
              iconSize: [0, 0],
            });
            const labelTimeout = setTimeout(() => {
              if (cancelled || !mapInstance.current) return;
              const lab = L.marker(labelPos, { icon: labelIcon, interactive: false }).addTo(map);
              animationLayersRef.current.push(lab);
            }, segmentDuration * 0.5);
            animationTimeoutsRef.current.push(labelTimeout);
          }
        }, startSegment);
        animationTimeoutsRef.current.push(startTimeout);
      }

      // Phase 3 — refit
      const refitDelay = cumulativeDelay + 400;
      const refitTimeout = setTimeout(() => {
        if (cancelled || !mapInstance.current) return;
        if (points.length > 0) {
          map.flyToBounds(L.latLngBounds(points), { padding: [70, 70], maxZoom: 10, animate: true, duration: 1.2 });
        }
        setIsPlaying(false);
        setHasPlayed(true);
      }, refitDelay);
      animationTimeoutsRef.current.push(refitTimeout);
    };

    // Trigger via IntersectionObserver on first mount
    let observer: IntersectionObserver | null = null;
    if (animationKey === 0) {
      let started = false;
      const startOnce = () => {
        if (started) return;
        started = true;
        runOnce();
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
    } else {
      runOnce();
    }

    return () => {
      cancelled = true;
      if (observer) observer.disconnect();
      clearAnimationLayers();
      // Re-show static markers
      markersRef.current.forEach(m => {
        const el = m.getElement() as HTMLDivElement | undefined;
        if (el) el.style.opacity = '1';
      });
    };
  }, [animationKey, alojamentos, transportes, corPrimaria]);

  // React to selectedIndex from side panel
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || selectedIndex == null) return;
    const validAlojs = alojamentos.filter(a => a.lat && a.lng);
    const a = validAlojs[selectedIndex];
    if (!a) return;
    const target = L.latLng(a.lat!, a.lng!);
    map.flyTo(target, Math.max(map.getZoom(), 7), { animate: true, duration: 0.9 });
    const marker = markersRef.current[selectedIndex];
    if (marker) {
      setTimeout(() => marker.openPopup(), 600);
    }
  }, [selectedIndex, alojamentos]);

  const replay = () => setAnimationKey(k => k + 1);

  return (
    <div className="relative">
      <div
        ref={mapRef}
        className="w-full"
        style={{ height: '560px', position: 'relative', zIndex: 0, borderRadius: 20, overflow: 'hidden' }}
      />
      {(hasPlayed || isPlaying) && (
        <button
          onClick={replay}
          disabled={isPlaying}
          className="absolute bottom-4 left-4 z-[400] flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/95 backdrop-blur-sm shadow-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-white hover:scale-105 transition-all disabled:opacity-60 disabled:cursor-wait"
          aria-label="Reproduzir rota"
        >
          {isPlaying ? (
            <>
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                <path strokeLinecap="round" d="M21 12a9 9 0 0 0-9-9" />
              </svg>
              Reproduzindo...
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Reproduzir rota
            </>
          )}
        </button>
      )}
      <style jsx global>{`
        @keyframes routePinDrop {
          0% { opacity: 0; transform: translateY(-30px) scale(0.5); }
          60% { opacity: 1; transform: translateY(4px) scale(1.1); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes routeLabelFade {
          from { opacity: 0; transform: scale(0.85); }
          to { opacity: 1; transform: scale(1); }
        }
        .route-marker {
          background: transparent !important;
          border: none !important;
        }
        .route-plane {
          background: transparent !important;
          border: none !important;
          will-change: transform;
        }
        .route-plane-inner svg {
          transition: transform 0.1s linear;
          transform-origin: center;
        }
        .route-label {
          background: transparent !important;
          border: none !important;
        }
        .leaflet-popup-content-wrapper {
          border-radius: 12px;
          box-shadow: 0 6px 18px rgba(0,0,0,0.15);
        }
      `}</style>
    </div>
  );
}
