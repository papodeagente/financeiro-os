import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "Núcleo completo" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutConfigPerfisDeAcesso({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('nucleo');
  return children;
}
