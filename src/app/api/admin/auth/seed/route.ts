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

    let id: string;
    let modo: 'criado' | 'atualizado';

    if (existing.length > 0) {
      id = existing[0].id;
      modo = 'atualizado';
      await pool.query(
        `UPDATE super_admins
         SET data = jsonb_build_object(
               'id', $2::text,
               'nome', $3::text,
               'email', $4::text,
               'senha_hash', $5::text,
               'ativo', true
             ),
             updated_at = NOW()
         WHERE id = $1`,
        [id, id, nome, email, senhaHash],
      );
    } else {
      id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
      modo = 'criado';
      const admin = { id, nome, email, senha_hash: senhaHash, ativo: true };
      await pool.query(
        `INSERT INTO super_admins (id, email, nome, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [id, email, nome, JSON.stringify(admin)],
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Super admin ${modo} com sucesso`,
      email,
      modo,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
