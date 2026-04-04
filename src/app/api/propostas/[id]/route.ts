import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { emitirEventoCRM } from '@/lib/crm-integration';

const TABLE = 'propostas';
const INDEX_COLS = ['numero', 'cliente_id', 'vendedor_id', 'status'];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1`, [id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0].data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    const item = await req.json();
    if (!pool) return NextResponse.json(item);

    // Get previous status to detect changes
    const { rows: prev } = await pool.query(`SELECT status FROM ${TABLE} WHERE id = $1`, [id]);
    const prevStatus = prev.length > 0 ? prev[0].status : null;

    const paramValues: unknown[] = [id, JSON.stringify(item)];
    const setClauses = ['data = $2', 'updated_at = NOW()'];

    INDEX_COLS.forEach((col, i) => {
      const paramNum = i + 3;
      paramValues.push((item as Record<string, unknown>)[col] ?? '');
      setClauses.push(`${col} = $${paramNum}`);
    });

    await pool.query(
      `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1`,
      paramValues
    );

    // CRM emission based on status change
    const newStatus = item.status;
    if (newStatus && newStatus !== prevStatus) {
      if (newStatus === 'ENVIADO') {
        emitirEventoCRM('PROPOSTA_ENVIADA', {
          proposta_id: id,
          numero: item.numero,
          cliente_id: item.cliente_id,
          valor_total: item.valor_total,
          link_publico: `/p/${id.substring(0, 8)}`,
        });
      } else if (newStatus === 'ACEITO') {
        emitirEventoCRM('PROPOSTA_ACEITA', {
          proposta_id: id,
          numero: item.numero,
          cliente_id: item.cliente_id,
          valor_total: item.valor_total,
          aceite_timestamp: new Date().toISOString(),
          grupo_id: item.grupo_id,
        });
      } else if (newStatus === 'REJEITADO') {
        emitirEventoCRM('PROPOSTA_REJEITADA', {
          proposta_id: id,
          numero: item.numero,
          cliente_id: item.cliente_id,
          motivo: item.motivo ?? null,
        });
      }
    }

    return NextResponse.json(item);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (pool) {
      await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
