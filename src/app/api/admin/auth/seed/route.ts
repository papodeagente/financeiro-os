import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function POST() {
  try {
    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars are required' },
        { status: 400 }
      );
    }

    const nome = 'Super Admin';
    const senhaHash = await hashPassword(password);

    // UPSERT por email — cria se nao existe, atualiza senha se ja
    // existe (util pra recuperacao de acesso ou rotacao de senha).
    const { rows: existing } = await pool.query(
      `SELECT id FROM super_admins WHERE email = $1`,
      [email]
    );

    // O super admin JÁ EXISTE: este endpoint não reescreve a senha dele.
    //
    // A rota é pública (está em PUBLIC_PATHS, e precisa ser, para permitir o
    // primeiro seed numa instalação nova). Enquanto ela também atualizava a
    // senha, qualquer pessoa na internet podia fazer POST aqui e reverter o
    // super admin para a senha da variável de ambiente, anulando qualquer
    // rotação de credencial feita fora dela. Criar o primeiro registro é
    // seguro; regravar um existente não é.
    if (existing.length > 0) {
      return NextResponse.json(
        {
          error: 'Super admin já existe. Esta rota não troca a senha de um cadastro existente.',
          modo: 'ignorado',
        },
        { status: 409 },
      );
    }

    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    const admin = { id, nome, email, senha_hash: senhaHash, ativo: true };
    await pool.query(
      `INSERT INTO super_admins (id, email, nome, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [id, email, nome, JSON.stringify(admin)],
    );

    return NextResponse.json({
      ok: true,
      message: 'Super admin criado com sucesso',
      email,
      modo: 'criado',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
