import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { generateId } from '@/lib/utils';

// GET /api/vendas-crm/[id]/anotacoes
// Lista anotacoes de uma negociacao em ordem decrescente.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json([]);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(
      `SELECT id, autor_id, autor_nome, texto, origem, tipo_evento, data, created_at
       FROM negociacao_anotacoes
       WHERE tenant_id = $1 AND venda_id = $2
       ORDER BY created_at DESC
       LIMIT 200`,
      [tenantId, id],
    );
    return NextResponse.json(rows);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

// POST /api/vendas-crm/[id]/anotacoes
// Cria anotacao manual. Body: { texto: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ error: 'DB indisponível' }, { status: 500 });
    const tenantId = await getTenantId();
    const body = await req.json();
    const texto = String(body.texto || '').trim();
    if (!texto) return NextResponse.json({ error: 'Texto obrigatório' }, { status: 400 });
    const anotacaoId = generateId();
    await pool.query(
      `INSERT INTO negociacao_anotacoes (id, tenant_id, venda_id, autor_id, autor_nome, texto, origem, data)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual', '{}'::jsonb)`,
      [anotacaoId, tenantId, id, String(body.autor_id || ''), String(body.autor_nome || ''), texto],
    );
    return NextResponse.json({ ok: true, id: anotacaoId });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
