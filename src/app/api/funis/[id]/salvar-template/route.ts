import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { generateId } from '@/lib/utils';

interface SalvarTemplateBody {
  nome?: string;
  categoria?: string;
  descricao?: string;
}

/**
 * POST /api/funis/[id]/salvar-template
 *
 * Salva o estado atual de um funil como template reutilizável no escopo
 * do tenant. Aceita `nome`, `categoria` e `descricao` opcionais no body.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const tenantId = await getTenantId();
    const body = (await req.json().catch(() => ({}))) as SalvarTemplateBody;

    const { rows } = await pool.query(
      `SELECT data FROM funis WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 });

    const funil = rows[0].data as { nome: string; data: { nodes: unknown; edges: unknown; config: unknown; descricao?: string } };
    const templateId = generateId();
    const template = {
      id: templateId,
      nome: body.nome || funil.nome,
      categoria: body.categoria || 'Customizado',
      data: {
        descricao: body.descricao || funil.data.descricao || '',
        nodes: funil.data.nodes,
        edges: funil.data.edges,
        config: funil.data.config,
      },
    };

    await pool.query(
      `INSERT INTO funis_templates (id, tenant_id, nome, categoria, data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
      [templateId, tenantId, template.nome, template.categoria, JSON.stringify(template)],
    );

    return NextResponse.json(template);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
