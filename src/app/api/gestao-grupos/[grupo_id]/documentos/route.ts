import { NextRequest, NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { generateId } from '@/lib/utils';
import { getTenantId } from '@/lib/tenant';
import {
  createDocumentoData,
  DOCUMENTO_TIPO_LABEL,
  DOCUMENTO_STATUS_LABEL,
  type DocumentoData,
  type DocumentoTipo,
  type DocumentoStatus,
} from '@/lib/gestao-grupos';

const TIPOS_VALIDOS: DocumentoTipo[] = Object.keys(DOCUMENTO_TIPO_LABEL) as DocumentoTipo[];
const STATUS_VALIDOS: DocumentoStatus[] = Object.keys(DOCUMENTO_STATUS_LABEL) as DocumentoStatus[];

// GET /api/gestao-grupos/[grupo_id]/documentos?passageiro_id=X&status=Y
//
// Lista documentos do grupo (ou de um passageiro específico) com JOIN
// pra trazer nome do passageiro.
export async function GET(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json([]);
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const url = new URL(req.url);
  const passageiroId = url.searchParams.get('passageiro_id') || '';
  const statusFiltro = url.searchParams.get('status') || '';

  const wheres = ['d.grupo_id = $1', 'd.tenant_id = $2'];
  const params_: unknown[] = [grupo_id, tenantId];
  if (passageiroId) { params_.push(passageiroId); wheres.push(`d.passageiro_id = $${params_.length}`); }
  if (statusFiltro) { params_.push(statusFiltro); wheres.push(`d.status = $${params_.length}`); }

  const { rows } = await pool.query(
    `SELECT d.id, d.passageiro_id, d.tipo, d.status, d.data, d.created_at, d.updated_at,
            p.nome_completo AS passageiro_nome
       FROM grupo_documentos d
       LEFT JOIN grupo_passageiros p ON p.id = d.passageiro_id AND p.tenant_id = d.tenant_id
      WHERE ${wheres.join(' AND ')}
      ORDER BY d.created_at DESC`,
    params_,
  );

  const docs = rows.map(r => ({
    id: r.id,
    grupo_id,
    passageiro_id: r.passageiro_id,
    passageiro_nome: r.passageiro_nome || '',
    tipo: r.tipo as DocumentoTipo,
    status: r.status as DocumentoStatus,
    ...(r.data as DocumentoData),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  // Stats
  const stats: Record<DocumentoStatus | 'total', number> = {
    total: docs.length,
    pendente: 0, enviado: 0, em_analise: 0, aprovado: 0, reprovado: 0, vencido: 0, nao_aplica: 0,
  };
  for (const d of docs) stats[d.status] = (stats[d.status] || 0) + 1;

  return NextResponse.json({ documentos: docs, stats });
}

// POST /api/gestao-grupos/[grupo_id]/documentos
// Body: { passageiro_id, tipo, status?, nome_personalizado?, url?, nome_arquivo?, ... }
export async function POST(req: NextRequest, { params }: { params: Promise<{ grupo_id: string }> }) {
  if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
  await initDB();
  const tenantId = await getTenantId();
  const { grupo_id } = await params;
  const body = await req.json();

  const passageiroId = String(body.passageiro_id || '');
  if (!passageiroId) return NextResponse.json({ error: 'passageiro_id é obrigatório' }, { status: 400 });

  // Verifica que passageiro existe no grupo
  const { rows: pRows } = await pool.query(
    `SELECT id FROM grupo_passageiros WHERE id = $1 AND grupo_id = $2 AND tenant_id = $3`,
    [passageiroId, grupo_id, tenantId],
  );
  if (pRows.length === 0) return NextResponse.json({ error: 'Passageiro não encontrado neste grupo' }, { status: 400 });

  const tipo: DocumentoTipo = TIPOS_VALIDOS.includes(body.tipo) ? body.tipo : 'outros';
  const status: DocumentoStatus = STATUS_VALIDOS.includes(body.status) ? body.status : 'pendente';

  const id = generateId();
  const data: DocumentoData = {
    ...createDocumentoData(),
    nome_personalizado: body.nome_personalizado || '',
    url: body.url || '',
    nome_arquivo: body.nome_arquivo || '',
    tamanho_bytes: typeof body.tamanho_bytes === 'number' ? body.tamanho_bytes : null,
    extensao: body.extensao || null,
    data_vencimento: body.data_vencimento || '',
    observacoes: body.observacoes || '',
  };
  if (body.url) data.data_envio = new Date().toISOString();

  await pool.query(
    `INSERT INTO grupo_documentos (id, grupo_id, passageiro_id, tipo, status, data, tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
    [id, grupo_id, passageiroId, tipo, status, JSON.stringify(data), tenantId],
  );

  return NextResponse.json({ id, grupo_id, passageiro_id: passageiroId, tipo, status, ...data });
}
