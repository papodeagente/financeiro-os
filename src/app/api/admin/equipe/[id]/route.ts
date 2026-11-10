import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { emTransacao } from '@/lib/caixa-atomico';
import { acessoDaPlataforma } from '@/lib/plataforma-servidor';
import { alterarPessoaDaPlataforma, ErroEquipe, type Executor } from '@/lib/equipe-da-plataforma';
import { esquecerSessaoEmCache } from '@/lib/sessao-viva';
import { TENANT_DA_PLATAFORMA } from '@/lib/plataforma';
import { registrarEventoAuditoria } from '@/lib/audit';

/**
 * PATCH /api/admin/equipe/[id] — só super admin.
 *   { papel: 'SUPER_ADMIN' | 'CS' } · { ativo: boolean }
 *   { nova_senha: true } → devolve a senha provisória, uma vez
 *   { zerar_autenticador: true } → a pessoa cadastra o app de novo no próximo acesso
 * Qualquer uma derruba as sessões abertas da pessoa.
 */
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await acessoDaPlataforma('gerir_equipe');
  if (acesso instanceof NextResponse) return acesso;
  try {
    const { id } = await params;
    await initDB();
    const corpo = await req.json().catch(() => ({}));
    const r = await emTransacao(exec =>
      alterarPessoaDaPlataforma(exec as unknown as Executor, id, corpo ?? {}, acesso.session.userId),
    );
    // As duas chaves de cache (super admin e CS) apontam para a mesma pessoa.
    esquecerSessaoEmCache({ userId: id, isSuperAdmin: true });
    await registrarEventoAuditoria({
      tenantId: TENANT_DA_PLATAFORMA,
      session: acesso.session,
      acao: 'EDITAR',
      modulo: 'Segurança',
      entidade: 'super_admins',
      entidadeId: id,
      descricao: `Equipe da plataforma, ${r.pessoa.nome}: ${r.descricao.join(', ')}.`,
    });
    return NextResponse.json({ pessoa: r.pessoa, ...(r.senha ? { senha: r.senha } : {}) });
  } catch (e) {
    if (e instanceof ErroEquipe) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[admin/equipe/id]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível salvar. Nada foi gravado.' }, { status: 500 });
  }
}
