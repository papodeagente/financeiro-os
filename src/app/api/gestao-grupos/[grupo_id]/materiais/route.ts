import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import type { MaterialData, MaterialTipo } from '@/lib/gestao-grupos';

const TIPOS_VALIDOS: MaterialTipo[] = ['arquivo', 'link', 'roteiro', 'contrato', 'voucher', 'outro'];

// GET /api/gestao-grupos/[grupo_id]/materiais?tipo=...
// Filtra opcionalmente por tipo. Não retorna registros marcados como
// removido (soft delete em data.removido=true).
export async function GET(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json([]);
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const tipo = new URL(req.url).searchParams.get('tipo') || '';

  const wheres = ['grupo_id = $1', 'tenant_id = $2'];
  const params_: unknown[] = [grupo_id, tenantId];
  if (tipo) { params_.push(tipo); wheres.push(`tipo = $${params_.length}`); }

  const { rows } = await pool.query(
    `SELECT id, tipo, nome, data, created_at, updated_at
       FROM grupo_materiais
      WHERE ${wheres.join(' AND ')}
      ORDER BY created_at DESC`,
    params_,
  );

  const materiais = rows
    .map(r => ({
      id: r.id,
      tipo: r.tipo as MaterialTipo,
      nome: r.nome,
      ...(r.data as MaterialData & { removido?: boolean }),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }))
    .filter(m => !(m as { removido?: boolean }).removido);

  return NextResponse.json(materiais);
}

// POST /api/gestao-grupos/[grupo_id]/materiais
// Body: { tipo, nome, url, descricao?, visivel_para_passageiro?,
//         tamanho_bytes?, extensao? }
// url pode ser de upload local (/api/uploads/...) ou link externo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const body = await req.json();

  const tipo: MaterialTipo = TIPOS_VALIDOS.includes(body.tipo) ? body.tipo : 'outro';
  const nome = String(body.nome || '').trim();
  const url = String(body.url || '').trim();
  if (!nome) return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 });
  if (!url) return NextResponse.json({ error: 'URL ou arquivo é obrigatório' }, { status: 400 });

  const id = generateId();
  const data: MaterialData = {
    url,
    tamanho_bytes: typeof body.tamanho_bytes === 'number' ? body.tamanho_bytes : null,
    extensao: typeof body.extensao === 'string' ? body.extensao : null,
    descricao: String(body.descricao || ''),
    visivel_para_passageiro: !!body.visivel_para_passageiro,
    enviado_para: Array.isArray(body.enviado_para) ? body.enviado_para : [],
  };

  await pool.query(
    `INSERT INTO grupo_materiais (id, grupo_id, tipo, nome, data, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [id, grupo_id, tipo, nome, JSON.stringify(data), tenantId],
  );

  return NextResponse.json({ id, grupo_id, tipo, nome, ...data });
}
