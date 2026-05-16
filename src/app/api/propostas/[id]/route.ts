import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { emitirEventoCRM } from '@/lib/crm-integration';
import { getTenantId } from '@/lib/tenant';

const TABLE = 'propostas';
const INDEX_COLS = ['numero', 'cliente_id', 'vendedor_id', 'status'];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const { rows } = await pool.query(`SELECT data FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
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

    const tenantId = await getTenantId();
    // Get previous status to detect changes
    const { rows: prev } = await pool.query(`SELECT status FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    const prevStatus = prev.length > 0 ? prev[0].status : null;

    const paramValues: unknown[] = [id, JSON.stringify(item)];
    const setClauses = ['data = $2', 'updated_at = NOW()'];

    INDEX_COLS.forEach((col, i) => {
      const paramNum = i + 3;
      paramValues.push((item as Record<string, unknown>)[col] ?? '');
      setClauses.push(`${col} = $${paramNum}`);
    });

    paramValues.push(tenantId);
    const tenantParamNum = paramValues.length;
    await pool.query(
      `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $${tenantParamNum}`,
      paramValues
    );

    // CRM emission based on status change
    const newStatus = item.status;
    if (newStatus && newStatus !== prevStatus) {
      if (newStatus === 'ENVIADO') {
        // Le agencia pra montar link com dominio customizado quando
        // configurado pelo tenant.
        const agenciaRow = await pool.query(
          'SELECT data FROM agencia WHERE tenant_id = $1 LIMIT 1',
          [tenantId],
        );
        const agencia = agenciaRow.rows[0]?.data as { custom_proposta_domain?: string } | undefined;
        const customDomain = agencia?.custom_proposta_domain?.trim();
        const linkBase = customDomain
          ? (/^https?:\/\//i.test(customDomain)
              ? customDomain.replace(/\/+$/, '')
              : `https://${customDomain.replace(/\/+$/, '')}`)
          : (process.env.PUBLIC_APP_URL || 'https://fin.enturos.com').replace(/\/+$/, '');
        emitirEventoCRM('PROPOSTA_ENVIADA', {
          proposta_id: id,
          numero: item.numero,
          cliente_id: item.cliente_id,
          valor_total: item.valor_total,
          link_publico: `${linkBase}/p/${id.substring(0, 8)}`,
        }, { tenantId });
      } else if (newStatus === 'ACEITO') {
        emitirEventoCRM('PROPOSTA_ACEITA', {
          proposta_id: id,
          numero: item.numero,
          cliente_id: item.cliente_id,
          valor_total: item.valor_total,
          aceite_timestamp: new Date().toISOString(),
          grupo_id: item.grupo_id,
        }, { tenantId });
      } else if (newStatus === 'REJEITADO') {
        emitirEventoCRM('PROPOSTA_REJEITADA', {
          proposta_id: id,
          numero: item.numero,
          cliente_id: item.cliente_id,
          motivo: item.motivo ?? null,
        }, { tenantId });
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
      const tenantId = await getTenantId();
      await pool.query(`DELETE FROM ${TABLE} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    }
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
