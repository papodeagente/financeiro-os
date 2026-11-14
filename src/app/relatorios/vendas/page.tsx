'use client';

import { useRouter } from 'next/navigation';
import { RelatoriosDeVendas } from '@/components/relatorios/RelatoriosDeVendas';

/** Relatórios de vendas (E5, parte F). A tela mora em src/components/relatorios. */
export default function RelatoriosDeVendasPage() {
  const router = useRouter();
  return <RelatoriosDeVendas abrirVenda={id => router.push(`/vendas/${encodeURIComponent(id)}/ficha`)} />;
}
