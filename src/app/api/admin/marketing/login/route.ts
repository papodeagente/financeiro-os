import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';

async function requireSuper() {
  const session = await getSession();
  if (!session || session.isSuperAdmin !== true) return null;
  return session;
}

// GET /api/admin/marketing/login — retorna config atual.
export async function GET() {
  if (!(await requireSuper())) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json({ image_url: '', link_url: '', alt: '', ativo: true });
    const { rows } = await pool.query(`SELECT data FROM saas_config WHERE key = 'login_campanha' LIMIT 1`);
    if (rows.length === 0) {
      return NextResponse.json({ image_url: '', link_url: '', alt: '', ativo: true });
    }
    return NextResponse.json(rows[0].data || {});
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// PUT /api/admin/marketing/login — atualiza config.
// Body: { image_url, link_url, alt, ativo }
export async function PUT(req: Request) {
  if (!(await requireSuper())) return NextResponse.json({ error: 'Acesso restrito' }, { status: 403 });
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 503 });
    const body = await req.json();
    const payload = {
      image_url: String(body.image_url || '').trim(),
      link_url: String(body.link_url || '').trim(),
      alt: String(body.alt || 'Campanha').trim(),
      ativo: body.ativo !== false,
      updated_at: new Date().toISOString(),
    };
    await pool.query(
      `INSERT INTO saas_config (key, data) VALUES ('login_campanha', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(payload)],
    );
    return NextResponse.json({ ok: true, data: payload });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
