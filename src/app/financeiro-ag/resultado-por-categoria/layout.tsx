import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "Relatórios e exportação" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutFinanceiroAgResultadoPorCategoria({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('relatorios');
  return children;
}
