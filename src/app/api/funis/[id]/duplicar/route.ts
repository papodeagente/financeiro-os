import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { generateId } from '@/lib/utils';

/**
 * POST /api/funis/[id]/duplicar
 *
 * Cria uma cópia de um funil com novo id, nome sufixado "(cópia)" e
 * status "rascunho". Nodes e edges são clonados 1:1 (mesmos ids internos
 * porque são escopo do próprio funil).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const tenantId = await getTenantId();

    const { rows } = await pool.query(
      `SELECT data FROM funis WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 });

    const original = rows[0].data as { id: string; nome: string; status: string; data: unknown };
    const novoId = generateId();
    const novoNome = `${original.nome} (cópia)`;
    const novo = {
      ...original,
      id: novoId,
      nome: novoNome,
      status: 'rascunho',
      data: {
        ...(original.data as object),
        ultimo_simulado_at: null,
      },
    };

    await pool.query(
      `INSERT INTO funis (id, tenant_id, nome, status, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())`,
      [novoId, tenantId, novoNome, 'rascunho', JSON.stringify(novo)],
    );

    return NextResponse.json(novo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
