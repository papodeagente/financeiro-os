'use client';

import { useParams } from 'next/navigation';

import { useModulos } from '@/components/useModulos';
import { ReciboCompleto } from './ReciboCompleto';
import { ReciboSimples } from './ReciboSimples';

/**
 * Recibo da venda: com o módulo de venda completa (modulos.ts), o recibo por
 * pagante feito das baixas; sem ele, o recibo do pacote vindo do CRM.
 */
export default function ReciboDaVendaPage() {
  const { id } = useParams<{ id: string }>();
  const modulos = useModulos();
  if (modulos.carregando) return null;
  return modulos.tem('venda') ? <ReciboCompleto id={String(id)} /> : <ReciboSimples />;
}
