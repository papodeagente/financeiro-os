import { DocumentoDaNotaDeDebito } from './DocumentoDaNotaDeDebito';

// Nota de débito da venda (E5, parte B): o documento que o cliente confere
// antes do faturamento. Página limpa para imprimir ou salvar em PDF.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentoDaNotaDeDebito vendaId={decodeURIComponent(id)} />;
}
