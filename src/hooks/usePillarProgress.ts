'use client';

import { useState, useCallback, useEffect } from 'react';
import type { Pillar } from './useActivePillar';

const STORAGE_KEY = 'entur:pillar-progress';

export function usePillarProgress() {
  const [visited, setVisited] = useState<Set<Pillar>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setVisited(new Set(JSON.parse(stored) as Pillar[]));
      }
    } catch { /* ignore */ }
  }, []);

  const markVisited = useCallback((pillar: Pillar) => {
    setVisited(prev => {
      if (prev.has(pillar)) return prev;
      const next = new Set(prev);
      next.add(pillar);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { visited, markVisited };
}
