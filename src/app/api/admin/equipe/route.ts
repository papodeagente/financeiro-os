import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { acessoDaPlataforma } from '@/lib/plataforma-servidor';
import { criarPessoaDaPlataforma, ErroEquipe, listarEquipe, type Executor } from '@/lib/equipe-da-plataforma';
import { rotuloDoPapel, TENANT_DA_PLATAFORMA } from '@/lib/plataforma';
import { registrarEventoAuditoria } from '@/lib/audit';

/**
 * Equipe da plataforma (super admins e CS). Só super admin.
 *   GET  → a lista
 *   POST { nome, email, papel } → cria e devolve a senha provisória, uma vez
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const acesso = await acessoDaPlataforma('gerir_equipe');
  if (acesso instanceof NextResponse) return acesso;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
  return NextResponse.json({ equipe: await listarEquipe(pool as unknown as Executor), eu: acesso.session.userId });
}

export async function POST(req: Request) {
  const acesso = await acessoDaPlataforma('gerir_equipe');
  if (acesso instanceof NextResponse) return acesso;
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    const corpo = await req.json().catch(() => ({}));
    const { pessoa, senha } = await criarPessoaDaPlataforma(pool as unknown as Executor, corpo ?? {});
    await registrarEventoAuditoria({
      tenantId: TENANT_DA_PLATAFORMA,
      session: acesso.session,
      acao: 'CRIAR',
      modulo: 'Segurança',
      entidade: 'super_admins',
      entidadeId: pessoa.id,
      descricao: `Adicionou ${pessoa.nome} (${pessoa.email}) à equipe da plataforma como ${rotuloDoPapel(pessoa.papel)}.`,
    });
    return NextResponse.json({ pessoa, senha }, { status: 201 });
  } catch (e) {
    if (e instanceof ErroEquipe) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[admin/equipe]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível adicionar. Nada foi gravado.' }, { status: 500 });
  }
}
