// Regras centrais de permissão por perfil de usuário.
//
// 3 perfis principais:
//
//   ADMIN
//     Acesso geral à tenant. Pode tudo: criar/editar/excluir/exportar,
//     ver financeiro de todos, ver comissões, gerenciar usuários,
//     promover/rebaixar perfis.
//
//   OPERADOR
//     Mesma visualização do Admin (vendas/financeiro/relatórios), mas
//     SEM permissão de exclusão (não apaga registros) e SEM exportação
//     (não baixa PDF/Excel). Não gerencia usuários.
//
//   VENDEDOR
//     Vê apenas as PRÓPRIAS vendas e suas comissões. Lança vendas no
//     nome dele mesmo. Não acessa financeiro, relatórios gerais ou
//     dados de outros vendedores. Não exclui nem exporta.
//
// Perfis legados (GERENTE, FINANCEIRO, VISUALIZADOR) mapeiam pra OPERADOR.

import type { PerfilUsuario, Usuario } from './crm-types';

export type Permissoes = Usuario['permissoes'];

// Normaliza perfil legado pro grupo de 3.
// 'owner' (legado do signup antigo) é tratado como ADMIN — criador da conta.
export function perfilCanonico(perfil: PerfilUsuario | string | undefined): 'ADMIN' | 'OPERADOR' | 'VENDEDOR' {
  if (perfil === 'ADMIN' || perfil === 'owner') return 'ADMIN';
  if (perfil === 'VENDEDOR') return 'VENDEDOR';
  // GERENTE / FINANCEIRO / VISUALIZADOR / OPERADOR
  return 'OPERADOR';
}

export const PERFIS: { id: 'ADMIN' | 'OPERADOR' | 'VENDEDOR'; label: string; descricao: string }[] = [
  {
    id: 'ADMIN',
    label: 'Administrador',
    descricao: 'Acesso total à conta. Pode criar, editar, excluir, exportar, gerenciar usuários e configurações.',
  },
  {
    id: 'OPERADOR',
    label: 'Operador',
    descricao: 'Acesso de visualização e edição. Não pode excluir registros nem exportar relatórios.',
  },
  {
    id: 'VENDEDOR',
    label: 'Vendedor',
    descricao: 'Acessa apenas as próprias vendas e comissões. Pode lançar vendas em seu nome.',
  },
];

// Aplica regras de permissão a partir do perfil. Sempre sobrescreve as
// permissões — o perfil define o que o usuário pode fazer.
export function permissoesParaPerfil(perfil: PerfilUsuario): Permissoes {
  const canonico = perfilCanonico(perfil);
  switch (canonico) {
    case 'ADMIN':
      return {
        ver_vendas_todos: true,
        ver_financeiro: true,
        editar_financeiro: true,
        ver_comissoes: true,
        acessar_relatorios: true,
        gerenciar_usuarios: true,
        pode_excluir: true,
        pode_exportar: true,
        ver_extrato_contas: [],
      };
    case 'OPERADOR':
      return {
        ver_vendas_todos: true,
        ver_financeiro: true,
        editar_financeiro: true,
        ver_comissoes: true,
        acessar_relatorios: true,
        gerenciar_usuarios: false,
        pode_excluir: false,
        pode_exportar: false,
        ver_extrato_contas: [],
      };
    case 'VENDEDOR':
      return {
        ver_vendas_todos: false,
        ver_financeiro: false,
        editar_financeiro: false,
        ver_comissoes: true,
        acessar_relatorios: false,
        gerenciar_usuarios: false,
        pode_excluir: false,
        pode_exportar: false,
        ver_extrato_contas: [],
      };
  }
}

// =========================================================
// Helpers server-side (usados nas rotas API)
// =========================================================
//
// O JWT da sessão já carrega `permissoes` e `perfil`. Essas funções
// fazem a checagem usando esses campos.

export interface SessionLike {
  userId?: string;
  perfil?: string;
  permissoes?: Record<string, unknown>;
  isSuperAdmin?: boolean;
}

function perm(session: SessionLike, key: keyof Permissoes): boolean {
  if (session.isSuperAdmin) return true;
  if (perfilCanonico(session.perfil) === 'ADMIN') return true;
  // Quando o perfil canônico é OPERADOR/VENDEDOR, deriva da regra do perfil
  // — não confia em permissoes do JWT que podem estar desatualizadas.
  const canonico = perfilCanonico(session.perfil);
  const perfilPerms = permissoesParaPerfil(canonico as PerfilUsuario);
  return perfilPerms[key] === true;
}

export function podeExcluir(session: SessionLike | null | undefined): boolean {
  if (!session) return false;
  return perm(session, 'pode_excluir');
}

export function podeExportar(session: SessionLike | null | undefined): boolean {
  if (!session) return false;
  return perm(session, 'pode_exportar');
}

export function podeGerenciarUsuarios(session: SessionLike | null | undefined): boolean {
  if (!session) return false;
  if (session.isSuperAdmin) return true;
  return perfilCanonico(session.perfil) === 'ADMIN';
}

// Vendedor só vê as próprias vendas. Outros perfis veem tudo do tenant.
export function podeVerTodasVendas(session: SessionLike | null | undefined): boolean {
  if (!session) return false;
  if (session.isSuperAdmin) return true;
  const canonico = perfilCanonico(session.perfil);
  if (canonico === 'VENDEDOR') return false;
  // ADMIN/OPERADOR
  return true;
}

// Se uma venda específica pode ser vista pelo usuário atual.
export function podeVerVenda(session: SessionLike | null | undefined, vendaVendedorId: string): boolean {
  if (!session) return false;
  if (podeVerTodasVendas(session)) return true;
  return session.userId === vendaVendedorId;
}
