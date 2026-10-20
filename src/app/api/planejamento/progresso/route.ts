import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { apagarRegistro, gravarRegistro, listarRegistros } from '@/lib/plano-do-mes-servidor';
import { hojeISO } from '@/lib/money';
import type { ExecutorSQL } from '@/lib/caixa-atomico';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

async function contexto(modo: 'ler' | 'escrever') {
  const session = await getSession();
  const bloqueio = bloqueioFinanceiro(session, modo);
  if (bloqueio) return { response: json({ error: bloqueio.erro }, bloqueio.status) } as const;
  const tenantId = session!.impersonatingTenantId || session!.tenantId;
  if (!tenantId) return { response: json({ error: 'Agência não identificada.' }, 403) } as const;
  if (!pool) return { response: json({ error: 'Banco de dados indisponível.' }, 503) } as const;
  await initDB();
  return { tenantId, autor: session!.nome || session!.email || '', exec: pool as unknown as ExecutorSQL } as const;
}

/** Registros de progresso do mês (o que o sistema não mede sozinho). */
export async function GET(req: Request) {
  try {
    const ctx = await contexto('ler');
    if ('response' in ctx) return ctx.response;
    const mes = new URL(req.url).searchParams.get('mes') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return json({ error: 'Mês de referência inválido.' }, 400);
    return json(await listarRegistros(ctx.exec, ctx.tenantId, mes));
  } catch (error) {
    console.error('[planejamento/progresso] Falha ao listar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível carregar os registros.' }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await contexto('escrever');
    if ('response' in ctx) return ctx.response;
    let corpo: Record<string, unknown>;
    try {
      corpo = await req.json();
    } catch {
      return json({ error: 'Registro inválido.' }, 400);
    }
    const r = await gravarRegistro(ctx.exec, ctx.tenantId, {
      chave: String(corpo?.chave ?? ''),
      valor: corpo?.valor,
      data: String(corpo?.data ?? ''),
      observacao: corpo?.observacao,
    }, ctx.autor, hojeISO());
    if (!r.ok) return json({ error: r.erro }, 400);
    return json(r.registro, 201);
  } catch (error) {
    console.error('[planejamento/progresso] Falha ao gravar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível gravar o registro.' }, 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await contexto('escrever');
    if ('response' in ctx) return ctx.response;
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return json({ error: 'Registro não informado.' }, 400);
    const apagou = await apagarRegistro(ctx.exec, ctx.tenantId, id);
    if (!apagou) return json({ error: 'Registro não encontrado.' }, 404);
    return json({ ok: true });
  } catch (error) {
    console.error('[planejamento/progresso] Falha ao apagar:', error instanceof Error ? error.message : 'Erro');
    return json({ error: 'Não foi possível apagar o registro.' }, 500);
  }
}
