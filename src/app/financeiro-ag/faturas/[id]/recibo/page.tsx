'use client';

import { use } from 'react';

import { PaginaDoReciboDaFatura } from '@/components/financeiro/cobranca/FolhaDoReciboDaVenda';

/**
 * Recibo consolidado da fatura ao cliente (E7): cada recebimento e o total.
 * /financeiro-ag/faturas/<id>/recibo, sem a moldura do sistema.
 */
export default function ReciboDaFaturaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PaginaDoReciboDaFatura faturaId={decodeURIComponent(id)} />;
}
