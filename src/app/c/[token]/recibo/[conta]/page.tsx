'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PaginaDoRecibo } from '@/components/financeiro/cobranca/PaginaDoRecibo';

/** Recibo de uma conta paga, pelo portal do cliente (público, pelo link pessoal). */
export default function ReciboDoPortalPage({ params }: { params: Promise<{ token: string; conta: string }> }) {
  const { token, conta } = use(params);
  return (
    <PaginaDoRecibo
      url={`/api/portal/${encodeURIComponent(token)}/recibo/${encodeURIComponent(conta)}`}
      voltar={(
        <Link
          href={`/c/${encodeURIComponent(token)}`}
          className="inline-flex h-11 items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-2 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Voltar
        </Link>
      )}
    />
  );
}
