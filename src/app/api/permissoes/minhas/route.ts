// O que a pessoa logada pode, ação por ação, e as contas liberadas
// (05/11/2026). As telas usam para esconder botão; quem decide é o servidor.
import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { resumoDePermissoes } from '@/lib/permissoes-servidor';
import { respostaDeErro } from '@/lib/permissoes-rota';

export async function GET() {
  try {
    await initDB();
    const sessao = await getSession();
    if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
    return NextResponse.json(await resumoDePermissoes(sessao));
  } catch (e) {
    return respostaDeErro(e);
  }
}
