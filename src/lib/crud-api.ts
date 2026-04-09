import { NextResponse } from 'next/server';
import pool, { initDB } from './db';
import { getTenantId } from './tenant';

export function createCrudHandlers(tableName: string, indexColumns: string[] = []) {
  async function GET() {
    try {
      await initDB();
      if (!pool) return NextResponse.json([]);
      const tenantId = await getTenantId();
      const { rows } = await pool.query(
        `SELECT data FROM ${tableName} WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId]
      );
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
      if (!item || typeof item !== 'object' || !item.id || typeof item.id !== 'string') {
        return NextResponse.json({ error: 'Invalid payload: id is required' }, { status: 400 });
      }
      if (!pool) return NextResponse.json(item);
      const tenantId = await getTenantId();

      // Build dynamic upsert with tenant_id
      const paramValues: unknown[] = [item.id, tenantId, JSON.stringify(item)];
      const insertCols = ['id', 'tenant_id', 'data'];
      const insertVals = ['$1', '$2', '$3'];
      const updateSets = ['data = $3', 'updated_at = NOW()'];

      indexColumns.forEach((col, i) => {
        const paramNum = i + 4;
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
      const tenantId = await getTenantId();
      const { rows } = await pool.query(
        `SELECT data FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
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
      if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });
      const item = await req.json();
      if (!item || typeof item !== 'object') {
        return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
      }
      if (!pool) return NextResponse.json(item);
      const tenantId = await getTenantId();

      const paramValues: unknown[] = [id, tenantId, JSON.stringify(item)];
      const setClauses = ['data = $3', 'updated_at = NOW()'];

      indexColumns.forEach((col, i) => {
        const paramNum = i + 4;
        paramValues.push((item as Record<string, unknown>)[col] ?? '');
        setClauses.push(`${col} = $${paramNum}`);
      });

      await pool.query(
        `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $2`,
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
        const tenantId = await getTenantId();
        await pool.query(
          `DELETE FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
      }
      return NextResponse.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  return { GET, PUT, DELETE };
}
