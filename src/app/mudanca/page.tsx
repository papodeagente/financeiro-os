import { getSession } from '@/lib/auth';
import { podeGerenciarUsuarios } from '@/lib/permissoes';
import { AssistenteDeMudanca } from './AssistenteDeMudanca';
import { SoAdministrador } from './SoAdministrador';

/**
 * Mudar para o EnturOS (E4, 05/11/2026): o assistente que traz contas,
 * categorias, pessoas, contas em aberto e saldos do sistema anterior.
 *
 * Só administrador: a mesma checagem das rotas de configuração
 * (`recusaAdmin` em src/lib/guarda-rota.ts usa `podeGerenciarUsuarios`).
 */
export default async function MudancaPage() {
  const sessao = await getSession();
  if (!podeGerenciarUsuarios(sessao)) return <SoAdministrador />;
  return <AssistenteDeMudanca />;
}
