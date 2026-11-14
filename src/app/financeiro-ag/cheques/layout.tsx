import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "Cheques" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutFinanceiroAgCheques({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('cheques');
  return children;
}
