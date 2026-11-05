import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { podeVerFinanceiro } from '@/lib/permissoes';

// As telas do financeiro conferem o perfil antes de abrir (05/11/2026). Antes
// a barra existia só nas rotas da API: o vendedor via a tela vazia, com erros.
export default async function FinanceiroLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSession();
  if (!sessao) redirect('/login');
  if (!podeVerFinanceiro(sessao)) redirect('/dashboard');
  return children;
}
