'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { PaginaDoReciboDaVenda } from '@/components/financeiro/cobranca/FolhaDoReciboDaVenda';

/**
 * Recibo da venda para imprimir ou salvar em PDF (E7):
 * /vendas/<id>/recibo?pagante=<chave>. Sem a moldura do sistema.
 */
function Recibo({ id }: { id: string }) {
  const busca = useSearchParams();
  const router = useRouter();
  const caminho = usePathname();
  return (
    <PaginaDoReciboDaVenda
      vendaId={decodeURIComponent(id)}
      pagante={busca.get('pagante')}
      onPagante={chave => router.replace(`${caminho}?pagante=${encodeURIComponent(chave)}`)}
    />
  );
}

export function ReciboCompleto({ id }: { id: string }) {
  return (
    <Suspense fallback={null}>
      <Recibo id={id} />
    </Suspense>
  );
}
