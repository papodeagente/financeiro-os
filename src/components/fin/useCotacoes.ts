'use client';

import * as React from 'react';
import { useModulos } from '@/components/useModulos';

import type { Cotacao, EstadoDaFonte, ValorDeIndice } from '@/lib/cambio';

/** O que /api/cambio devolve (só o cache; a rota nunca chama as fontes). */
export interface PainelDeCambioTela {
  agora: string;
  cotacoes: Cotacao[];
  indices: ValorDeIndice[];
  fontes: EstadoDaFonte[];
  historico?: Cotacao[];
  limite_falhas?: number;
}

type Estado = 'carregando' | 'ok' | 'erro';

// Uma leitura por minuto para a tela inteira: vários campos de câmbio na
// mesma página dividem a mesma resposta.
let guardado: { ate: number; valor: Promise<PainelDeCambioTela> } | null = null;
const TTL_MS = 60_000;

function lerPainel(forcar = false): Promise<PainelDeCambioTela> {
  const agora = Date.now();
  if (!forcar && guardado && guardado.ate > agora) return guardado.valor;
  const valor = fetch('/api/cambio', { cache: 'no-store' }).then(async r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as PainelDeCambioTela;
  });
  guardado = { ate: agora + TTL_MS, valor };
  valor.catch(() => { guardado = null; });
  return valor;
}

/** Cotações e índices do cache, para campos e telas. */
export function useCotacoes(): { painel: PainelDeCambioTela | null; estado: Estado; recarregar: () => void } {
  const [painel, setPainel] = React.useState<PainelDeCambioTela | null>(null);
  const [estado, setEstado] = React.useState<Estado>('carregando');
  // Câmbio ao vivo é do módulo de câmbio (modulos.ts): sem ele, sem sugestão.
  const modulos = useModulos();
  const comCambio = modulos.carregando || modulos.tem('cambio');
  const carregar = React.useCallback((forcar = false) => {
    let vivo = true;
    if (!comCambio) { setEstado('ok'); return () => { vivo = false; }; }
    lerPainel(forcar)
      .then(p => { if (vivo) { setPainel(p); setEstado('ok'); } })
      .catch(() => { if (vivo) setEstado('erro'); });
    return () => { vivo = false; };
  }, [comCambio]);
  React.useEffect(() => carregar(), [carregar]);
  return { painel, estado, recarregar: () => { carregar(true); } };
}
