import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

// Temporary endpoint to create admin user — remove after use
export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponivel' }, { status: 503 });

    const { email, senha, nome, secret } = await req.json();

    // Simple protection
    if (secret !== 'entur-create-admin-2026') {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 403 });
    }

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
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET data = $4, nome = $2, email = $3, updated_at = NOW()`,
      [data.id, data.nome, data.email, JSON.stringify(data)]
    );

    return NextResponse.json({ ok: true, email: data.email, perfil: 'ADMIN' });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
