/**
 * Trava das rotas do painel /admin por papel (regras em ./plataforma).
 *
 *   const acesso = await acessoDaPlataforma('ver_agencias');
 *   if (acesso instanceof NextResponse) return acesso;
 *   acesso.session, acesso.papel
 */
import { NextResponse } from 'next/server';
import { getSession, type SessionPayload } from './auth';
import { papelDaSessao, podeNaPlataforma, type AcaoDaPlataforma, type PapelDaPlataforma } from './plataforma';

export async function acessoDaPlataforma(
  acao: AcaoDaPlataforma,
): Promise<{ session: SessionPayload; papel: PapelDaPlataforma } | NextResponse> {
  const session = await getSession();
  const papel = papelDaSessao(session);
  if (!session || !papel) return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
  if (!podeNaPlataforma(papel, acao)) {
    return NextResponse.json({ error: 'Seu papel na plataforma não permite esta ação.' }, { status: 403 });
  }
  return { session, papel };
}
