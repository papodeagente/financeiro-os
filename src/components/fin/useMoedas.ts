'use client';

import * as React from 'react';

import { MOEDAS, definirCatalogoDoNavegador, type CatalogoDeMoedas } from '@/lib/cambio';

/**
 * Catálogo de moedas da agência (E7, frente D, 06/11/2026): as oito do
 * sistema mais as que ela cadastrou. Uma leitura por página; ao chegar, o
 * catálogo fica valendo para formatação e leitura de moeda no navegador
 * (definirCatalogoDoNavegador). Antes de chegar (ou sem rede), as oito de
 * sempre: nada quebra.
 */
let guardado: Promise<CatalogoDeMoedas> | null = null;
let atual: CatalogoDeMoedas | null = null;
const ouvintes = new Set<(c: CatalogoDeMoedas) => void>();

function lerCatalogo(forcar = false): Promise<CatalogoDeMoedas> {
  if (!forcar && guardado) return guardado;
  const valor = fetch('/api/moedas', { cache: 'no-store' }).then(async r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const corpo = (await r.json()) as { moedas?: CatalogoDeMoedas };
    const lista = Array.isArray(corpo.moedas) && corpo.moedas.length ? corpo.moedas : MOEDAS;
    atual = lista;
    definirCatalogoDoNavegador(lista);
    for (const o of ouvintes) o(lista);
    return lista;
  });
  guardado = valor;
  valor.catch(() => { guardado = null; });
  return valor;
}

/** Lê de novo (depois de cadastrar ou editar uma moeda). */
export function recarregarMoedas(): Promise<CatalogoDeMoedas> {
  return lerCatalogo(true);
}

export function useMoedas(): { moedas: CatalogoDeMoedas; carregado: boolean } {
  const [moedas, setMoedas] = React.useState<CatalogoDeMoedas>(() => atual ?? MOEDAS);
  const [carregado, setCarregado] = React.useState(atual !== null);
  React.useEffect(() => {
    let vivo = true;
    const ouvir = (c: CatalogoDeMoedas) => { if (vivo) { setMoedas(c); setCarregado(true); } };
    ouvintes.add(ouvir);
    lerCatalogo().then(ouvir).catch(() => { if (vivo) setCarregado(true); });
    return () => { vivo = false; ouvintes.delete(ouvir); };
  }, []);
  return { moedas, carregado };
}
