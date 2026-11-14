// Excluir um perfil de acesso (05/11/2026). Os membros voltam a valer pelo
// papel (ou pelos outros perfis de que façam parte).
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { excluirGrupo, tenantDaSessao, type ExecutorPermissoes } from '@/lib/permissoes-servidor';
import { respostaDeErro } from '@/lib/permissoes-rota';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    await initDB();
    const recusa = await recusaAcao('gerenciar_usuarios');
    if (recusa) return recusa;
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
    const { id } = await params;
    const sessao = (await getSession())!;
    const apagou = await excluirGrupo(pool as unknown as ExecutorPermissoes, tenantDaSessao(sessao), id);
    if (!apagou) return NextResponse.json({ error: 'Grupo não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return respostaDeErro(e);
  }
}
