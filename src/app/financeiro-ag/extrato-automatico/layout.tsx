import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "Extrato automático e conferência de operadora" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutFinanceiroAgExtratoAutomatico({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('extrato');
  return children;
}
