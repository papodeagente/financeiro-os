import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { podeVerFinanceiro } from '@/lib/permissoes';
import { exigirModuloNaTela } from '@/lib/guarda-tela';

// Mudar para o EnturOS (E4, 05/11/2026). Glossário e checklist de paridade
// valem para quem vê o financeiro; o assistente em si é só do administrador
// (a página confere, e cada rota /api/mudanca/* barra no servidor).
// Só com o módulo "Mudança de sistema" (14/11/2026): sem ele, página 404.
export default async function MudancaLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSession();
  if (!sessao) redirect('/login');
  if (!podeVerFinanceiro(sessao)) redirect('/dashboard');
  await exigirModuloNaTela('mudanca');
  return children;
}
