'use client';

import { useEffect, useState } from 'react';

import { FORMAS_DO_SISTEMA, type FormaPagamento } from '@/lib/formas-pagamento';

// Uma busca por carregamento de página: o formulário, a lista e a liquidação
// usam a mesma lista. `invalidarFormasDePagamento()` força a próxima busca.
let cache: Promise<FormaPagamento[]> | null = null;

function buscar(): Promise<FormaPagamento[]> {
  if (!cache) {
    cache = fetch('/api/formas-pagamento')
      .then(r => (r.ok ? r.json() : null))
      .then((l: unknown) => (Array.isArray(l) && l.length ? (l as FormaPagamento[]) : [...FORMAS_DO_SISTEMA]))
      .catch(() => {
        cache = null;
        return [...FORMAS_DO_SISTEMA];
      });
  }
  return cache;
}

export function invalidarFormasDePagamento(): void {
  cache = null;
}

/**
 * As formas de pagamento da agência. Começa com as formas de sempre (o campo
 * nunca fica vazio enquanto carrega, nem quando a busca falha) e troca pela
 * lista da agência quando ela chega.
 */
export function useFormasDePagamento(): FormaPagamento[] {
  const [formas, setFormas] = useState<FormaPagamento[]>(() => [...FORMAS_DO_SISTEMA]);
  useEffect(() => {
    let vivo = true;
    void buscar().then(l => { if (vivo) setFormas(l); });
    return () => { vivo = false; };
  }, []);
  return formas;
}
