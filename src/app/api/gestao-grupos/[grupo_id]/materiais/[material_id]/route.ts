import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import type { MaterialData } from '@/lib/gestao-grupos';

// PUT /api/gestao-grupos/[grupo_id]/materiais/[material_id]
// Atualiza nome, descricao, visivel_para_passageiro.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; material_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, material_id } = await params;
  const body = await req.json();

  const { rows } = await pool.query(
    `SELECT id, nome, data FROM grupo_materiais WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [material_id, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Material não encontrado' }, { status: 404 });

  const dataAtual = rows[0].data as MaterialData;
  const nome = typeof body.nome === 'string' && body.nome.trim() ? body.nome.trim() : rows[0].nome;
  const dataNova: MaterialData = {
    ...dataAtual,
    descricao: typeof body.descricao === 'string' ? body.descricao : dataAtual.descricao,
    visivel_para_passageiro: typeof body.visivel_para_passageiro === 'boolean'
      ? body.visivel_para_passageiro
      : dataAtual.visivel_para_passageiro,
  };

  await pool.query(
    `UPDATE grupo_materiais SET nome = $1, data = $2, updated_at = NOW() WHERE id = $3 AND tenant_id = $4`,
    [nome, JSON.stringify(dataNova), material_id, tenantId],
  );

  return NextResponse.json({ id: material_id, grupo_id, nome, ...dataNova });
}

// DELETE /api/gestao-grupos/[grupo_id]/materiais/[material_id]
// Soft delete — marca data.removido=true para preservar histórico. O
// arquivo no volume NÃO é deletado (caso precise recuperar).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ grupo_id: string; material_id: string }> },
) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id, material_id } = await params;

  const { rows } = await pool.query(
    `SELECT data FROM grupo_materiais WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [material_id, grupo_id, tenantId],
  );
  if (rows.length === 0) return NextResponse.json({ error: 'Material não encontrado' }, { status: 404 });

  const dataNova = { ...(rows[0].data as MaterialData), removido: true };
  await pool.query(
    `UPDATE grupo_materiais SET data = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(dataNova), material_id, tenantId],
  );

  return NextResponse.json({ ok: true });
}
