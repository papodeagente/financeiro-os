import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "IA" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutFinanceiroAgPerguntar({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('ia');
  return children;
}
