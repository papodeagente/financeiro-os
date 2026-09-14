import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession, type SessionPayload } from '@/lib/auth';
import { getCanonicalBaseUrl } from '@/lib/canonical-hosts';
import { podeExportar } from '@/lib/permissoes';
import { registrarEventoAuditoria } from '@/lib/audit';
import {
  idMapaMentalValido,
  origemMutacaoPermitida,
  requisicaoJson,
} from '@/lib/mapas-mentais-compartilhamento';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
};
const MAX_BODY_BYTES = 64;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function tenantDaSessao(session: SessionPayload): string {
  return session.impersonatingTenantId || session.tenantId || '';
}

/**
 * Autoriza a entrega do PDF gerado no navegador e registra a exportação.
 * O mapa em si não trafega por esta rota: isso evita duplicar conteúdo privado
 * no payload e mantém a auditoria limitada à identidade do recurso.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return json({ error: 'Não autenticado' }, 401);
    const tenantId = tenantDaSessao(session);
    if (!tenantId) return json({ error: 'Agência não identificada' }, 403);
    if (!podeExportar(session)) return json({ error: 'Sem permissão para exportar' }, 403);
    if (!origemMutacaoPermitida(req, getCanonicalBaseUrl())) {
      return json({ error: 'Origem da requisição não permitida' }, 403);
    }
    if (!requisicaoJson(req)) return json({ error: 'Content-Type deve ser application/json' }, 415);

    const { id } = await params;
    if (!idMapaMentalValido(id)) return json({ error: 'ID inválido' }, 400);

    const declaredLength = req.headers.get('content-length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
      return json({ error: 'Payload muito grande' }, 413);
    }

    let body: unknown;
    try {
      const rawBody = await req.text();
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
        return json({ error: 'Payload muito grande' }, 413);
      }
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: 'JSON inválido' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
      return json({ error: 'Payload inválido' }, 400);
    }

    await initDB();
    if (!pool) return json({ error: 'Banco de dados indisponível' }, 503);
    const mapa = await pool.query(
      `SELECT id
         FROM mapas_mentais
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
      [id, tenantId],
    );
    if (mapa.rows.length === 0) return json({ error: 'Mapa não encontrado' }, 404);

    await registrarEventoAuditoria({
      session,
      tenantId,
      acao: 'EXPORTAR',
      modulo: 'Planejamento',
      entidade: 'mapas_mentais',
      entidadeId: id,
      descricao: 'Exportou um mapa mental em PDF.',
    });

    return json({ ok: true });
  } catch {
    return json({ error: 'Não foi possível registrar a exportação' }, 500);
  }
}
