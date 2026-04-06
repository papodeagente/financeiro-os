import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession, hashPassword } from '@/lib/auth';

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.isSuperAdmin !== true) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    const { rows: tenants } = await pool.query(
      'SELECT data FROM tenants ORDER BY created_at DESC'
    );

    const result = await Promise.all(
      tenants.map(async (row: { data: Record<string, unknown> }) => {
        const tenant = row.data;
        const { rows: countRows } = await pool!.query(
          'SELECT COUNT(*) as cnt FROM usuarios WHERE tenant_id = $1',
          [tenant.id]
        );
        return {
          ...tenant,
          userCount: parseInt(countRows[0].cnt, 10),
        };
      })
    );

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || session.isSuperAdmin !== true) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
    }

    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    const { nome, slug, cnpj, plano, admin_email, admin_senha } = await req.json();

    if (!nome || !slug || !admin_email || !admin_senha) {
      return NextResponse.json(
        { error: 'nome, slug, admin_email e admin_senha sao obrigatorios' },
        { status: 400 }
      );
    }

    // Check slug uniqueness
    const { rows: existing } = await pool.query(
      'SELECT id FROM tenants WHERE slug = $1',
      [slug]
    );
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Slug ja existe' }, { status: 409 });
    }

    const tenantId = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    const tenantData = {
      id: tenantId,
      nome,
      slug,
      cnpj: cnpj || '',
      plano: plano || 'free',
      status: 'ativo',
      created_at: new Date().toISOString(),
    };

    await pool.query(
      `INSERT INTO tenants (id, slug, nome, cnpj, plano, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'ativo', $6, NOW(), NOW())`,
      [tenantId, slug, nome, cnpj || '', plano || 'free', JSON.stringify(tenantData)]
    );

    // Create admin user for this tenant
    const userId = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    const senhaHash = await hashPassword(admin_senha);
    const adminUser = {
      id: userId,
      nome: 'Administrador',
      email: admin_email.toLowerCase().trim(),
      senha_hash: senhaHash,
      perfil: 'ADMIN',
      permissoes: {
        ver_vendas_todos: true,
        ver_financeiro: true,
        editar_financeiro: true,
        ver_comissoes: true,
        acessar_relatorios: true,
        gerenciar_usuarios: true,
        ver_extrato_contas: [],
      },
      ativo: true,
      tenant_id: tenantId,
    };

    await pool.query(
      `INSERT INTO usuarios (id, nome, email, data, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, adminUser.nome, adminUser.email, JSON.stringify(adminUser), tenantId]
    );

    // Create agencia record for this tenant
    const agenciaId = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    const agenciaData = {
      id: agenciaId,
      nome_fantasia: nome,
      cnpj: cnpj || '',
      tenant_id: tenantId,
    };

    await pool.query(
      `INSERT INTO agencia (id, data, tenant_id, updated_at)
       VALUES ($1, $2, $3, NOW())`,
      [agenciaId, JSON.stringify(agenciaData), tenantId]
    );

    return NextResponse.json({
      ok: true,
      tenant: tenantData,
      admin: { id: userId, email: adminUser.email },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
