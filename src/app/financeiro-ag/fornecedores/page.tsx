import { redirect } from 'next/navigation';

// "Fornecedores" no financeiro abre na fatura do fornecedor (a trilha chega aqui).
export default function Page() {
  redirect('/financeiro-ag/fornecedores/faturas');
}
