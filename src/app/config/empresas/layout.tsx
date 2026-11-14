import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "Várias empresas" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutConfigEmpresas({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('empresas');
  return children;
}
