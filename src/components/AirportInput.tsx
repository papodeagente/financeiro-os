'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface AirportOption {
  iataCode: string;
  name: string;
  cityName: string;
  countryCode: string;
}

interface AirportInputProps {
  label: string;
  value: string;
  onChange: (iata: string, display: string) => void;
}

export function AirportInput({ label, value, onChange }: AirportInputProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<AirportOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [display, setDisplay] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDisplay(value); }, [value]);

  const search = useCallback(async (kw: string) => {
    if (kw.length < 2) { setOptions([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/flights/airports?keyword=${encodeURIComponent(kw)}`);
      const json = await res.json();
      const locs = json.data || [];
      setOptions(locs.map((l: { iataCode: string; name: string; cityName?: string; countryCode?: string; address?: { cityName?: string; countryCode?: string } }) => ({
        iataCode: l.iataCode,
        name: l.name,
        cityName: l.cityName || l.address?.cityName || '',
        countryCode: l.countryCode || l.address?.countryCode || '',
      })));
    } catch { setOptions([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(query), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">{label}</label>
      <input
        value={open ? query : display}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Código IATA ou cidade"
        className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
      />
      {open && (options.length > 0 || loading) && (
        <div className="absolute z-50 top-full mt-1 w-full bg-[var(--t-surface)] shadow-[var(--t-card-shadow)] rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {loading && <div className="px-3 py-2 text-xs text-[var(--t-text-secondary)]">Buscando...</div>}
          {options.map(o => (
            <button
              key={o.iataCode}
              className="w-full px-3 py-2 text-left hover:bg-[var(--t-hover)] text-sm"
              onClick={() => {
                const d = `${o.iataCode} — ${o.cityName}, ${o.countryCode}`;
                setDisplay(d);
                onChange(o.iataCode, d);
                setOpen(false);
              }}
            >
              <span className="font-mono font-bold text-[var(--t-green)]">{o.iataCode}</span>
              <span className="text-[var(--t-text)]"> — {o.cityName || o.name}, {o.countryCode}</span>
              <div className="text-xs text-[var(--t-text-muted)] truncate">{o.name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
