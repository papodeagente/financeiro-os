import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { perfilDaConta } from '@/lib/perfil-da-conta';
import { apagarCategorias, categoriasDaConta, contarCategorias, type ResetCategory } from '@/lib/reset-da-conta';
import type { ExecutorSQL } from '@/lib/caixa-atomico';

// Reset categorizado de dados do tenant. As categorias, e quais delas cada
// conta pode zerar, estão em src/lib/reset-da-conta.ts.

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }

    // Restringe a ADMIN do tenant (super admin também passa pelo flag).
    if (session.perfil !== 'ADMIN' && !session.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Apenas administradores podem resetar dados' },
        { status: 403 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const categories = Array.isArray(body.categories) ? (body.categories as string[]) : [];
    const confirm = typeof body.confirm === 'string' ? body.confirm : '';

    if (categories.length === 0) {
      return NextResponse.json(
        { error: 'Selecione pelo menos uma categoria pra resetar' },
        { status: 400 },
      );
    }

    if (confirm !== 'RESETAR') {
      return NextResponse.json(
        { error: 'Confirmação inválida — digite RESETAR pra prosseguir' },
        { status: 400 },
      );
    }

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const tenantId = session.tenantId;
    const perfil = await perfilDaConta(tenantId, pool as unknown as ExecutorSQL);

    // Filtra somente categorias que esta conta pode zerar
    const permitidas = categoriasDaConta(perfil);
    const validCats = categories.filter(
      (c): c is ResetCategory => (permitidas as string[]).includes(c),
    );
    if (validCats.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma categoria válida informada' },
        { status: 400 },
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { total, summary } = await apagarCategorias(client, tenantId, perfil, validCats);
      await client.query('COMMIT');
      return NextResponse.json({ ok: true, total, summary, categories: validCats });
    } catch (e: unknown) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Erro durante reset (rollback aplicado)' },
        { status: 500 },
      );
    } finally {
      client.release();
    }
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro desconhecido' },
      { status: 500 },
    );
  }
}

// Preview: conta quantos registros existem por tabela em cada categoria
// pra mostrar o impacto antes do usuário confirmar. `disponiveis` diz quais
// categorias esta conta pode zerar.
export async function GET() {
  try {
    const session = await getSession();
    if (!session || !session.tenantId) {
      return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
    }
    if (session.perfil !== 'ADMIN' && !session.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Apenas administradores podem ver o preview' },
        { status: 403 },
      );
    }

    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });

    const exec = pool as unknown as ExecutorSQL;
    const perfil = await perfilDaConta(session.tenantId, exec);
    const counts = await contarCategorias(exec, session.tenantId, perfil);

    return NextResponse.json({ counts, disponiveis: categoriasDaConta(perfil) });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro' },
      { status: 500 },
    );
  }
}
