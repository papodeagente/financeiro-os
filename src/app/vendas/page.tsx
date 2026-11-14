'use client';

import { ListaDeVendas } from '@/components/vendas/lista/ListaDeVendas';
import { useModulos } from '@/components/useModulos';
import { ListaDeVendasSimples } from './ListaDeVendasSimples';

/**
 * Lista de vendas. Com o módulo de venda completa (modulos.ts), a lista nova
 * (src/components/vendas/lista: filtros, exportação, a linha abrindo a ficha);
 * sem ele, a lista de sempre.
 */
export default function VendasPage() {
  const modulos = useModulos();
  if (modulos.carregando) return null;
  return modulos.tem('venda') ? <ListaDeVendas /> : <ListaDeVendasSimples />;
}
