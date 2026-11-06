import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { podeVerFinanceiro } from '@/lib/permissoes';

// Mudar para o EnturOS (E4, 05/11/2026). Glossário e checklist de paridade
// valem para quem vê o financeiro; o assistente em si é só do administrador
// (a página confere, e cada rota /api/mudanca/* barra no servidor).
export default async function MudancaLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSession();
  if (!sessao) redirect('/login');
  if (!podeVerFinanceiro(sessao)) redirect('/dashboard');
  return children;
}
