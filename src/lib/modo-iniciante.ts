'use client';

import { useEffect, useState } from 'react';

// Modo iniciante: oculta telas avançadas (contas bancárias, transferências,
// conciliação) da navegação. Default true para reduzir atrito de novos
// usuários. Pode ser desativado em /config.

const STORAGE_KEY = 'modo_iniciante';

export function isModoIniciante(): boolean {
  if (typeof window === 'undefined') return true;
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === null) return true; // default
  return v === 'true';
}

export function setModoIniciante(value: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, String(value));
  // Notifica outros componentes na mesma aba
  window.dispatchEvent(new Event('modo-iniciante-change'));
}

// Hook reativo — re-renderiza quando o modo muda (mesma aba ou outra).
export function useModoIniciante(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(true);
  useEffect(() => {
    setV(isModoIniciante());
    const onChange = () => setV(isModoIniciante());
    window.addEventListener('storage', onChange);
    window.addEventListener('modo-iniciante-change', onChange);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener('modo-iniciante-change', onChange);
    };
  }, []);
  const update = (val: boolean) => { setModoIniciante(val); setV(val); };
  return [v, update];
}

// Chaves do menu que ficam ESCONDIDAS no modo iniciante (telas avançadas).
export const MODO_INICIANTE_HIDDEN_KEYS = new Set<string>([
  'contas-bancarias',
  'transferencias',
  'conciliacao',
  'plano-contas',
]);
