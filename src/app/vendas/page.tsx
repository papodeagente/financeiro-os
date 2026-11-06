'use client';

import { ListaDeVendas } from '@/components/vendas/lista/ListaDeVendas';

/**
 * Lista de vendas. A tela mora em src/components/vendas/lista: filtros por
 * fornecedor, produto, vendedor, unidade, período e situação, exportação e a
 * linha abrindo a ficha da venda. A tela anterior de cada venda continua em
 * /vendas/[id] (ícone na linha); "Lançar venda" oferece a completa e a simples.
 */
export default function VendasPage() {
  return <ListaDeVendas />;
}
