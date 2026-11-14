import { FichaDaFatura } from '@/components/financeiro/faturas/FichaDaFatura';

// Ficha da fatura do cliente (E5, parte B): itens, notas, conferência, cobrança e histórico.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FichaDaFatura key={id} faturaId={decodeURIComponent(id)} />;
}
