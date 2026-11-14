import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "Cobrança e portal do cliente" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutRecibo({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('cobranca');
  return children;
}
