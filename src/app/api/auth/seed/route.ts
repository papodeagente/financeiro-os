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

    // Create default admin
    const senhaHash = await hashPassword('admin123');
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    const admin = {
      id,
      nome: 'Administrador',
      email: 'admin@entur.com.br',
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
      [admin.id, admin.nome, admin.email, JSON.stringify(admin)]
    );

    return NextResponse.json({
      ok: true,
      message: 'Admin criado com sucesso',
      email: admin.email,
      senha: 'admin123',
      aviso: 'TROQUE A SENHA IMEDIATAMENTE APOS O PRIMEIRO LOGIN',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
