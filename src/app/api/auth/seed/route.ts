import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function POST() {
  try {
    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco indisponivel' }, { status: 503 });
    }

    // Check if any user exists
    const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM usuarios');
    const count = parseInt(rows[0].cnt, 10);

    if (count > 0) {
      return NextResponse.json({ error: 'Ja existem usuarios cadastrados. Use a tela de usuarios para gerenciar.' }, { status: 400 });
    }

    // Find or create default tenant
    let tenantId = '';
    const { rows: tenantRows } = await pool.query('SELECT id FROM tenants LIMIT 1');
    if (tenantRows.length > 0) {
      tenantId = tenantRows[0].id;
    } else {
      // Create default tenant
      tenantId = 'tenant_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
      const tenantData = {
        id: tenantId,
        slug: 'default',
        nome: 'Agencia Padrao',
        plano: 'enterprise',
        status: 'ativo',
        max_usuarios: -1,
        max_grupos: -1,
        features: ['crm', 'ai', 'propostas'],
      };
      await pool.query(
        `INSERT INTO tenants (id, slug, nome, cnpj, plano, status, data, created_at, updated_at)
         VALUES ($1, 'default', 'Agencia Padrao', '', 'enterprise', 'ativo', $2, NOW(), NOW())`,
        [tenantId, JSON.stringify(tenantData)]
      );
    }

    // Generate a random password for security
    const randomPwd = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 16);

    const adminEmail = process.env.ADMIN_EMAIL || 'admin@entur.com.br';
    const senhaHash = await hashPassword(randomPwd);
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    const admin = {
      id,
      nome: 'Administrador',
      email: adminEmail,
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
    };

    await pool.query(
      `INSERT INTO usuarios (id, tenant_id, nome, email, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [admin.id, tenantId, admin.nome, admin.email, JSON.stringify(admin)]
    );

    return NextResponse.json({
      ok: true,
      message: 'Admin criado com sucesso',
      email: admin.email,
      senha: randomPwd,
      tenantId,
      aviso: 'ANOTE ESTA SENHA! Ela nao sera exibida novamente. Troque apos o primeiro login.',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
