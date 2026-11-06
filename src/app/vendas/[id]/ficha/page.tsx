import { FichaDaVenda } from '@/components/vendas/ficha/FichaDaVenda';

// Ficha da venda completa (E5): produtos, pagamentos, cliente, fornecedor,
// comissões e posição. A tela anterior (/vendas/[id]) continua igual.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FichaDaVenda vendaId={decodeURIComponent(id)} />;
}
