'use client';

import * as React from 'react';

import type { Recibo } from '@/lib/cobranca/recibo';
import { BarraDoRecibo, FolhaDoRecibo } from './FolhaDoRecibo';

/**
 * Página do recibo (05/11/2026): lê o recibo pronto de `url` e mostra a
 * folha com o botão de imprimir. Carregando: a forma da folha. Erro: o
 * motivo, em uma frase (conta não recebida, recebimento estornado...).
 */
export function PaginaDoRecibo({ url, voltar }: { url: string; voltar?: React.ReactNode }) {
  const [recibo, setRecibo] = React.useState<Recibo | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    fetch(url, { signal: ac.signal })
      .then(async r => {
        const corpo = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : 'Não foi possível abrir o recibo.');
        setRecibo(corpo as Recibo);
        document.title = `Recibo ${(corpo as Recibo).numero}`;
      })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'Não foi possível abrir o recibo.'); });
    return () => ac.abort();
  }, [url]);

  return (
    <main className="min-h-dvh bg-[var(--fin-bg)] px-[var(--fin-s-3)] pb-[var(--fin-s-6)] sm:px-0 print:bg-[var(--fin-surface)] print:p-0">
      <BarraDoRecibo voltar={voltar} />
      {recibo ? <FolhaDoRecibo recibo={recibo} /> : erro ? (
        <div role="alert" className="mx-auto my-[var(--fin-s-6)] flex max-w-[560px] flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] text-center">
          <p className="fin-t-subhead text-[var(--fin-text)]">Sem recibo para mostrar</p>
          <p className="fin-t-body text-[var(--fin-text-2)]">{erro}</p>
        </div>
      ) : (
        <div aria-busy="true" className="mx-auto my-[var(--fin-s-4)] flex w-full max-w-[760px] flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-6)]">
          <span className="block h-8 w-1/2 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-20 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-16 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="sr-only" role="status">Montando o recibo.</span>
        </div>
      )}
    </main>
  );
}
