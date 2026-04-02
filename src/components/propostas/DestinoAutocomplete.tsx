'use client';

import { useState, useEffect, useRef } from 'react';
import { Destino } from '@/lib/crm-types';
import { MapPin, Search, Sparkles, Loader2 } from 'lucide-react';

interface Props {
  onSelect: (destino: Destino) => void;
}

export function DestinoAutocomplete({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Destino[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/destinos?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setResults(data);
          setOpen(data.length > 0);
        }
      } catch { /* ignore */ }
      setLoading(false);
    }, 300);

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--t-text-muted)]" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Buscar destino..."
          className="w-full pl-8 pr-8 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)] placeholder:text-[var(--t-text-muted)]"
        />
        {loading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-[var(--t-text-muted)]" />}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {results.map(d => (
            <button
              key={d.id}
              onClick={() => {
                onSelect(d);
                setQuery(d.nome);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[var(--t-surface-hover)] transition-colors border-b border-[var(--t-border)] last:border-0"
            >
              <MapPin className="w-3.5 h-3.5 text-[var(--t-green)] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--t-text)] truncate">{d.nome}</div>
                {d.pais && <div className="text-[10px] text-[var(--t-text-muted)]">{d.pais}</div>}
              </div>
              {d.enriquecido && (
                <Sparkles className="w-3 h-3 text-purple-400 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
