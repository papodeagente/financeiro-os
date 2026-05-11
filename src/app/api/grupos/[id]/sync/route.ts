import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { emitirEventoCRM, buildProdutoPayload } from '@/lib/crm-integration';
import type { GrupoViagem } from '@/lib/types';

// POST forca reenvio do PRODUTO_PUBLICADO para o CRM.
// Util quando o gatilho automatico falhou e o usuario quer corrigir
// manualmente. Tambem captura erros de build do payload (que antes
// quebravam silenciosamente no fluxo automatico).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!pool) return NextResponse.json({ error: 'no db' }, { status: 503 });
    await initDB();
    const tenantId = await getTenantId();
    const { id: grupoId } = await params;

    const { rows } = await pool.query(
      `SELECT data FROM grupos WHERE id = $1 AND tenant_id = $2`,
      [grupoId, tenantId],
    );
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: 'Grupo nao encontrado' }, { status: 404 });
    }
    const grupo: GrupoViagem = rows[0].data;

    let payload: Record<string, unknown>;
    try {
      payload = buildProdutoPayload(grupo);
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: `Falha ao montar payload: ${e instanceof Error ? e.message : 'desconhecido'}`,
      }, { status: 500 });
    }

    await emitirEventoCRM('PRODUTO_PUBLICADO', { ...payload, sincronizado_manualmente: true }, { tenantId });

    return NextResponse.json({ ok: true, message: 'Sincronizacao disparada' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
