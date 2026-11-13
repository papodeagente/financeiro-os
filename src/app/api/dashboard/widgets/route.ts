import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { normalizarSelecao } from '@/lib/dashboard-widgets';

/**
 * Os widgets que a pessoa escolheu para o Dashboard financeiro (12/11/2026).
 *
 *   GET → { widgets: string[] | null }   (null = nunca escolheu: a tela usa o padrão)
 *   PUT { widgets: string[] } → { ok, widgets }
 *
 * A escolha mora no cadastro da pessoa (usuarios.data.dashboard_widgets),
 * então vale em qualquer navegador. Só a chave é gravada, por cima do banco
 * atual: regravar o `data` inteiro desfaria uma saída (token_version) ou um
 * 2FA feitos no meio. Quem não tem cadastro de agência (super admin entrando
 * como agência) recebe null e a tela guarda a escolha só no navegador.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const sessao = await getSession();
  if (!sessao?.userId) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  if (sessao.isSuperAdmin || !sessao.tenantId) return NextResponse.json({ widgets: null });
  await initDB();
  if (!pool) return NextResponse.json({ widgets: null });
  const { rows } = await pool.query(
    `SELECT data->'dashboard_widgets' AS widgets FROM usuarios WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [sessao.userId, sessao.tenantId],
  );
  return NextResponse.json(
    { widgets: normalizarSelecao(rows[0]?.widgets ?? null) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PUT(req: Request) {
  const sessao = await getSession();
  if (!sessao?.userId) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  const corpo = (await req.json().catch(() => ({}))) as { widgets?: unknown };
  const widgets = normalizarSelecao(corpo.widgets);
  if (widgets === null) return NextResponse.json({ error: 'Envie a lista de widgets.' }, { status: 400 });
  if (sessao.isSuperAdmin || !sessao.tenantId) return NextResponse.json({ ok: false, widgets });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const r = await pool.query(
    `UPDATE usuarios
        SET data = jsonb_set(data, '{dashboard_widgets}', $3::jsonb, true), updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    [sessao.userId, sessao.tenantId, JSON.stringify(widgets)],
  );
  return NextResponse.json({ ok: (r.rowCount ?? 0) > 0, widgets });
}
