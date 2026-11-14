import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "Notas por regra" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutFinanceiroAgNotasGerar({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('notas');
  return children;
}
