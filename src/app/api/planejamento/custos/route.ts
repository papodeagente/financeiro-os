import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import {
  hidratarPlanoCustos,
  mesPlanejamentoValido,
  validarPayloadPlanoCustos,
} from '@/lib/planejamento-custos-schema';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };
const MAX_BODY_BYTES = 200_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

async function contexto(modo: 'ler' | 'escrever') {
  const session = await getSession();
  const bloqueio = bloqueioFinanceiro(session, modo);
  if (bloqueio) return { response: json({ error: bloqueio.erro }, bloqueio.status) } as const;

  const tenantId = session!.impersonatingTenantId || session!.tenantId;
  if (!tenantId) return { response: json({ error: 'Agência não identificada.' }, 403) } as const;
  return { tenantId } as const;
}

export async function GET(req: Request) {
  try {
    const ctx = await contexto('ler');
    if ('response' in ctx) return ctx.response;
    if (!pool) return json({ error: 'Banco de dados indisponível.' }, 503);

    const mes = new URL(req.url).searchParams.get('mes');
    if (mes !== null && !mesPlanejamentoValido(mes)) {
      return json({ error: 'Mês de referência inválido.' }, 400);
    }

    await initDB();
    if (mes) {
      const { rows } = await pool.query(
        `SELECT id, mes, data
           FROM planejamento_custos
          WHERE tenant_id = $1 AND mes = $2
          LIMIT 1`,
        [ctx.tenantId, mes],
      );
      if (rows.length === 0) return json(null);
      return json(hidratarPlanoCustos(rows[0].data, rows[0].mes, rows[0].id));
    }

    const { rows } = await pool.query(
      `SELECT id, mes, data
         FROM planejamento_custos
        WHERE tenant_id = $1
        ORDER BY mes DESC`,
      [ctx.tenantId],
    );
    return json(rows.map(row => hidratarPlanoCustos(row.data, row.mes, row.id)));
  } catch (error) {
    console.error('[planejamento/custos] Falha ao consultar:', error instanceof Error ? error.name : 'Erro');
    return json({ error: 'Não foi possível carregar o planejamento.' }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await contexto('escrever');
    if ('response' in ctx) return ctx.response;
    if (!pool) return json({ error: 'Banco de dados indisponível.' }, 503);

    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return json({ error: 'O planejamento enviado é grande demais.' }, 413);
    }

    const body = await req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return json({ error: 'O planejamento enviado é grande demais.' }, 413);
    }
    let payload: unknown = null;
    try {
      payload = JSON.parse(body);
    } catch {
      return json({ error: 'O planejamento enviado é inválido.' }, 400);
    }
    const validado = validarPayloadPlanoCustos(payload);
    if (!validado.ok) return json({ error: validado.error }, 400);

    await initDB();
    const idNovo = randomUUID();
    const planoNovo = { ...validado.data, id: idNovo };
    const { rows } = await pool.query(
      `INSERT INTO planejamento_custos
         (id, tenant_id, mes, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
       ON CONFLICT (tenant_id, mes) DO UPDATE
         SET data = jsonb_set(
               EXCLUDED.data,
               '{id}',
               to_jsonb(planejamento_custos.id),
               true
             ),
             updated_at = NOW()
       RETURNING id, mes, data`,
      [idNovo, ctx.tenantId, planoNovo.mes, JSON.stringify(planoNovo)],
    );

    const salvo = rows[0];
    if (!salvo) throw new Error('PLANO_NAO_PERSISTIDO');
    return json(hidratarPlanoCustos(salvo.data, salvo.mes, salvo.id));
  } catch (error) {
    console.error('[planejamento/custos] Falha ao salvar:', error instanceof Error ? error.name : 'Erro');
    return json({ error: 'Não foi possível salvar o planejamento.' }, 500);
  }
}
