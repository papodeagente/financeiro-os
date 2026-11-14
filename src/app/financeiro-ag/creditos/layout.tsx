import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "Venda completa, faturas e fornecedor" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutFinanceiroAgCreditos({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('venda');
  return children;
}
