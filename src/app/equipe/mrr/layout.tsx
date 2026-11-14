import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Tela do módulo "Comissões por função" (src/lib/modulos.ts): sem ele, a agência vê a página 404.
export default async function LayoutEquipeMrr({ children }: { children: React.ReactNode }) {
  await exigirModuloNaTela('comissoes');
  return children;
}
