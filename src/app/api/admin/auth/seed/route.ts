import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) {
      return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    }

    // Accept optional body with custom credentials
    let body: { email?: string; senha?: string; nome?: string } = {};
    try { body = await req.json(); } catch { /* no body is fine */ }

    const email = body.email || process.env.SUPER_ADMIN_EMAIL || 'super@entur.com.br';
    const password = body.senha || process.env.SUPER_ADMIN_PASSWORD || 'super123';
    const nome = body.nome || 'Super Admin';

    // Check if this email already exists
    const { rows: existing } = await pool.query(
      `SELECT id FROM super_admins WHERE email = $1`,
      [email]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: `Super admin com email ${email} ja existe` },
        { status: 400 }
      );
    }

    const senhaHash = await hashPassword(password);
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);

    const admin = {
      id,
      nome,
      email,
      senha_hash: senhaHash,
      ativo: true,
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
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
