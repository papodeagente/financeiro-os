import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    if (!pool) return NextResponse.json({ items: [], total: 0 });
    await initDB();

    const url = new URL(req.url);
    const direcao = url.searchParams.get('direcao') || 'saida';
    const tipo = url.searchParams.get('tipo');
    const status = url.searchParams.get('status');
    const pagina = parseInt(url.searchParams.get('pagina') || '1', 10);
    const limite = Math.min(parseInt(url.searchParams.get('limite') || '20', 10), 100);
    const offset = (pagina - 1) * limite;

    const table = direcao === 'entrada' ? 'crm_eventos_entrada' : 'crm_eventos_saida';
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (tipo) {
      conditions.push(`tipo = $${paramIdx++}`);
      params.push(tipo);
    }
    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*) as total FROM ${table} ${where}`;
    const { rows: countRows } = await pool.query(countQuery, params);
    const total = parseInt(countRows[0].total, 10);

    const dataQuery = `SELECT * FROM ${table} ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`;
    params.push(limite, offset);
    const { rows } = await pool.query(dataQuery, params);

    return NextResponse.json({ items: rows, total, pagina, limite });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
