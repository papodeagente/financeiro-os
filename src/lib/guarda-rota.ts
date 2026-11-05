// Travas de permissão para rotas escritas à mão (as do CRUD genérico usam
// as opções de crud-api). Devolvem a resposta de recusa ou null.
import { NextResponse } from 'next/server';
import { getSession } from './auth';
import { bloqueioFinanceiro, podeExcluir, podeGerenciarUsuarios } from './permissoes';

export async function recusaFinanceira(modo: 'ler' | 'escrever'): Promise<NextResponse | null> {
  const bloqueio = bloqueioFinanceiro(await getSession(), modo);
  if (!bloqueio) return null;
  return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
}

/** Excluir exige o perfil que exclui (ADMIN). OPERADOR e VENDEDOR não apagam. */
export async function recusaExclusao(): Promise<NextResponse | null> {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  if (podeExcluir(sessao)) return null;
  return NextResponse.json({ error: 'Seu perfil nao pode excluir registros.' }, { status: 403 });
}

/** Só administrador da agência (ou superadmin). Manutenção, segredos, integração. */
export async function recusaAdmin(): Promise<NextResponse | null> {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  if (podeGerenciarUsuarios(sessao)) return null;
  return NextResponse.json({ error: 'Apenas administradores podem fazer isto.' }, { status: 403 });
}

/**
 * Rotas que só servem para teste (apagar vendas, simular venda) não existem
 * em produção, a não ser que PERMITIR_ROTAS_DE_TESTE=1 seja ligado de
 * propósito. Responde 404, como se a rota não existisse.
 */
export function rotaDeTesteDesligada(): NextResponse | null {
  const producao = process.env.NODE_ENV === 'production';
  if (!producao || process.env.PERMITIR_ROTAS_DE_TESTE === '1') return null;
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
