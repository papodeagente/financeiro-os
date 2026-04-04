import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';

// Temporary route to fix BUG-003 (typo "burno" -> "bruno")
// DELETE THIS FILE AFTER USE

export async function GET(req: NextRequest) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();

  const action = req.nextUrl.searchParams.get('action');

  if (action === 'fix') {
    // Fix all occurrences of "burno" -> "bruno" across all tables with JSONB data
    const tables = ['clientes', 'propostas', 'vendas_crm', 'membros'];
    const results: Record<string, number> = {};

    for (const table of tables) {
      try {
        const { rowCount } = await pool.query(
          `UPDATE ${table} SET data = REPLACE(data::text, 'burno', 'bruno')::jsonb WHERE data::text ILIKE '%burno%'`
        );
        results[table] = rowCount || 0;
      } catch (e) {
        results[table] = -1;
      }
    }

    return NextResponse.json({ action: 'fix', results });
  }

  // Default: search for "burno" across tables
  const tables = ['clientes', 'propostas', 'vendas_crm', 'membros'];
  const found: Record<string, unknown[]> = {};

  for (const table of tables) {
    try {
      const { rows } = await pool.query(
        `SELECT id, data FROM ${table} WHERE data::text ILIKE '%burno%'`
      );
      if (rows.length > 0) found[table] = rows.map(r => ({ id: r.id, data: r.data }));
    } catch { /* table may not exist */ }
  }

  return NextResponse.json({ action: 'search', found });
}
