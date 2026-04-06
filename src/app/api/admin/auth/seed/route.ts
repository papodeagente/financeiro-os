import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function POST() {
  try {
    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    const { rows } = await pool.query('SELECT COUNT(*) as cnt FROM super_admins');
    const count = parseInt(rows[0].cnt, 10);

    if (count > 0) {
      return NextResponse.json(
        { error: 'Ja existem super admins cadastrados' },
        { status: 400 }
      );
    }

    const email = process.env.SUPER_ADMIN_EMAIL || 'super@entur.com.br';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'super123';
    const senhaHash = await hashPassword(password);
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);

    const admin = {
      id,
      nome: 'Super Admin',
      email,
      senha_hash: senhaHash,
    };

    await pool.query(
      `INSERT INTO super_admins (id, email, nome, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [admin.id, admin.email, admin.nome, JSON.stringify(admin)]
    );

    return NextResponse.json({
      ok: true,
      message: 'Super admin criado com sucesso',
      email: admin.email,
      senha_hint: password.substring(0, 3) + '***',
      aviso: 'TROQUE A SENHA IMEDIATAMENTE APOS O PRIMEIRO LOGIN',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
