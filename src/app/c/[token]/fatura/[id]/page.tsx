'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FolhaDaFatura } from '@/components/financeiro/faturas/DocumentoDaFatura';
import type { DadosDaFolhaDaFatura } from '@/lib/cobranca/portal-fatura';

/**
 * A fatura pelo portal do cliente (E7): o mesmo documento que a agência
 * imprime, aberto pelo link pessoal, para ler e salvar em PDF. É o link que o
 * "Enviar por e-mail" manda quando a agência escolhe Fatura.
 */
type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; doc: DadosDaFolhaDaFatura }
  | { tipo: 'erro'; texto: string };

export default function FaturaDoPortalPage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = use(params);
  const [estado, setEstado] = React.useState<Estado>({ tipo: 'carregando' });

  React.useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/portal/${encodeURIComponent(token)}/faturas/${encodeURIComponent(id)}`, { signal: ac.signal, cache: 'no-store' })
      .then(async r => {
        const corpo = await r.json().catch(() => null);
        if (r.ok) {
          const doc = corpo as DadosDaFolhaDaFatura;
          document.title = `Fatura Nº ${doc.fatura.numero}`;
          setEstado({ tipo: 'ok', doc });
          return;
        }
        setEstado({
          tipo: 'erro',
          texto: r.status === 404 ? 'Esta fatura não está disponível por este link. Peça à agência.'
            : r.status === 429 ? 'Muitas tentativas. Espere alguns minutos e abra de novo.'
              : 'Não foi possível abrir agora. Tente de novo em alguns minutos.',
        });
      })
      .catch(() => { if (!ac.signal.aborted) setEstado({ tipo: 'erro', texto: 'Sem conexão. Confira a internet e abra de novo.' }); });
    return () => ac.abort();
  }, [token, id]);

  return (
    <main className="min-h-dvh bg-[var(--fin-bg)] px-[var(--fin-s-3)] pb-[var(--fin-s-6)] sm:px-[var(--fin-s-4)] print:bg-[var(--fin-surface)] print:p-0">
      <div className="fin-no-print mx-auto flex w-full max-w-[880px] flex-wrap items-center justify-between gap-[var(--fin-s-2)] pt-[var(--fin-s-4)]">
        <Link
          href={`/c/${encodeURIComponent(token)}`}
          className="inline-flex h-11 items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-2 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Suas contas
        </Link>
        <Button type="button" onClick={() => window.print()} disabled={estado.tipo !== 'ok'} className="gap-[var(--fin-s-2)]">
          <Printer aria-hidden="true" className="size-4" /> Imprimir ou salvar em PDF
        </Button>
      </div>

      {estado.tipo === 'ok' ? <FolhaDaFatura ficha={estado.doc} modelo={estado.doc.fatura.modelo} /> : estado.tipo === 'erro' ? (
        <div role="alert" className="mx-auto my-[var(--fin-s-6)] flex max-w-[560px] flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] text-center">
          <p className="fin-t-subhead text-[var(--fin-text)]">Sem fatura para mostrar</p>
          <p className="fin-t-body text-[var(--fin-text-2)]">{estado.texto}</p>
        </div>
      ) : (
        <div aria-busy="true" className="mx-auto my-[var(--fin-s-4)] flex w-full max-w-[880px] flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-6)]">
          <span className="block h-8 w-1/2 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-24 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-48 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="sr-only" role="status">Abrindo a fatura.</span>
        </div>
      )}
    </main>
  );
}
