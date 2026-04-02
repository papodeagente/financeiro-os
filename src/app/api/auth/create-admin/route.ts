import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponivel' }, { status: 503 });

    const { email, senha, nome, secret } = await req.json();
    if (secret !== 'entur-create-admin-2026') {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 403 });
    }

    // Delete existing user with same email first
    await pool.query(`DELETE FROM usuarios WHERE data->>'email' = $1`, [email]);

    const senhaHash = await hashPassword(senha);
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    const data = {
      id,
      nome: nome || 'Admin',
      email,
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
      `INSERT INTO usuarios (id, nome, email, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [data.id, data.nome, data.email, JSON.stringify(data)]
    );

    // Immediately verify the password works
    const { rows } = await pool.query(`SELECT data FROM usuarios WHERE data->>'email' = $1`, [email]);
    const savedHash = rows[0]?.data?.senha_hash;

    // Import verifyPassword to test
    const { verifyPassword } = await import('@/lib/auth');
    const valid = await verifyPassword(senha, savedHash);

    return NextResponse.json({ ok: true, email, perfil: 'ADMIN', password_verified: valid, id: data.id });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
