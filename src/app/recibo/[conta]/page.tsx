'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { PaginaDoRecibo } from '@/components/financeiro/cobranca/PaginaDoRecibo';

/**
 * Recibo para imprimir (05/11/2026): /recibo/<conta> (conta recebida) ou
 * /recibo/<conta>?baixa=<id> (um recebimento). Fora da moldura do sistema,
 * para a folha sair limpa no papel e no PDF.
 */
function Recibo({ conta }: { conta: string }) {
  const baixa = useSearchParams().get('baixa');
  const url = `/api/recibos/${encodeURIComponent(conta)}${baixa ? `?baixa=${encodeURIComponent(baixa)}` : ''}`;
  return (
    <PaginaDoRecibo
      url={url}
      voltar={(
        <Link
          href={`/financeiro-ag/receber?abrir=${encodeURIComponent(conta)}`}
          className="inline-flex h-11 items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-2 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] lg:h-9"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Voltar à conta
        </Link>
      )}
    />
  );
}

export default function ReciboPage({ params }: { params: Promise<{ conta: string }> }) {
  const { conta } = use(params);
  return (
    <Suspense fallback={null}>
      <Recibo conta={conta} />
    </Suspense>
  );
}
