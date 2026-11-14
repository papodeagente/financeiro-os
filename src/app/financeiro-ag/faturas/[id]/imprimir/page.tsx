'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';

import { DocumentoDaFatura } from '@/components/financeiro/faturas/DocumentoDaFatura';

/**
 * Fatura para imprimir ou salvar em PDF (E5, parte B):
 * /financeiro-ag/faturas/<id>/imprimir?modelo=PADRAO|PERSONALIZADA|SIMPLIFICADA.
 * Sem a moldura do sistema (AppShell), para a folha sair limpa.
 */
function Documento({ id }: { id: string }) {
  const modelo = useSearchParams().get('modelo');
  return <DocumentoDaFatura faturaId={decodeURIComponent(id)} modeloPedido={modelo} />;
}

export default function ImprimirFaturaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={null}>
      <Documento id={id} />
    </Suspense>
  );
}
