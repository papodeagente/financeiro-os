import { NextResponse } from 'next/server';
import pool, { initDB } from './db';

export function createCrudHandlers(tableName: string, indexColumns: string[] = []) {
  async function GET() {
    try {
      await initDB();
      if (!pool) return NextResponse.json([]);
      const { rows } = await pool.query(`SELECT data FROM ${tableName} ORDER BY created_at DESC`);
      return NextResponse.json(rows.map(r => r.data));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  async function POST(req: Request) {
    try {
      await initDB();
      const item = await req.json();
      if (!pool) return NextResponse.json(item);

      // Build dynamic upsert
      const paramValues: unknown[] = [item.id, JSON.stringify(item)];
      const insertCols = ['id', 'data'];
      const insertVals = ['$1', '$2'];
      const updateSets = ['data = $2', 'updated_at = NOW()'];

      indexColumns.forEach((col, i) => {
        const paramNum = i + 3;
        paramValues.push((item as Record<string, unknown>)[col] ?? '');
        insertCols.push(col);
        insertVals.push(`$${paramNum}`);
        updateSets.push(`${col} = $${paramNum}`);
      });

      await pool.query(
        `INSERT INTO ${tableName} (${insertCols.join(', ')}, created_at, updated_at)
         VALUES (${insertVals.join(', ')}, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET ${updateSets.join(', ')}`,
        paramValues
      );

      return NextResponse.json(item);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return { GET, POST };
}

export function createCrudItemHandlers(tableName: string, indexColumns: string[] = []) {
  async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      await initDB();
      const { id } = await params;
      if (!pool) return NextResponse.json(null);
      const { rows } = await pool.query(`SELECT data FROM ${tableName} WHERE id = $1`, [id]);
      if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json(rows[0].data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      await initDB();
      const { id } = await params;
      const item = await req.json();
      if (!pool) return NextResponse.json(item);

      const paramValues: unknown[] = [id, JSON.stringify(item)];
      const setClauses = ['data = $2', 'updated_at = NOW()'];

      indexColumns.forEach((col, i) => {
        const paramNum = i + 3;
        paramValues.push((item as Record<string, unknown>)[col] ?? '');
        setClauses.push(`${col} = $${paramNum}`);
      });

      await pool.query(
        `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $1`,
        paramValues
      );

      return NextResponse.json(item);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
      await initDB();
      const { id } = await params;
      if (pool) {
        await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [id]);
      }
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return { GET, PUT, DELETE };
}
