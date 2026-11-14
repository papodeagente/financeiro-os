/**
 * Mudança de sistema (E4, 05/11/2026): o que todas as rotas /api/mudanca/*
 * fazem igual. Só administrador da agência entra (contrato E4, regra 10);
 * erros saem como `{ error, codigo }` com o status certo.
 */
import { NextResponse } from 'next/server';
import { getSession } from '../auth';
import pool, { initDB } from '../db';
import type { ExecutorSQL } from '../caixa-atomico';
import { recusaAdmin } from '../guarda-rota';
import { mensagemPeriodoFechado, periodoFechadoDoErro } from '../periodo-fechado';
import { getTenantId } from '../tenant';
import { ErroMudanca, type QuemFez } from './servidor';

export interface ContextoDaRota {
  exec: ExecutorSQL;
  tenantId: string;
  quem: QuemFez;
}

/** Confere o administrador e prepara o banco. Devolve a resposta de recusa ou o contexto. */
export async function entrarNaRota(): Promise<NextResponse | ContextoDaRota> {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponível.', codigo: 'SEM_BANCO' }, { status: 503 });
  const sessao = await getSession();
  return {
    exec: pool as unknown as ExecutorSQL,
    tenantId: await getTenantId(),
    quem: { id: sessao?.userId ?? '', nome: sessao?.nome ?? '' },
  };
}

export function respostaDeErro(e: unknown): NextResponse {
  if (e instanceof ErroMudanca) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status });
  const ate = periodoFechadoDoErro(e);
  if (ate) return NextResponse.json({ error: mensagemPeriodoFechado(ate), codigo: 'PERIODO_FECHADO', periodo_fechado_ate: ate }, { status: 423 });
  console.error('[mudanca]', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Algo deu errado do nosso lado. Nada foi gravado pela metade; tente de novo.', codigo: 'ERRO' }, { status: 500 });
}

/** Corpo JSON como objeto (vazio = {}); corpo que não é objeto vira 400. */
export async function corpoJson(req: Request): Promise<Record<string, unknown>> {
  const texto = await req.text();
  if (!texto.trim()) return {};
  let v: unknown;
  try { v = JSON.parse(texto); } catch { throw new ErroMudanca('Formato inválido.', 400, 'FORMATO_INVALIDO'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ErroMudanca('Formato inválido.', 400, 'FORMATO_INVALIDO');
  return v as Record<string, unknown>;
}

export function chaveDeIdempotencia(req: Request): string | null {
  const c = req.headers.get('Idempotency-Key')?.trim();
  return c ? c.slice(0, 200) : null;
}

/** Roda a rota com o contexto e o tratamento de erro padrão. */
export async function naRota(fn: (c: ContextoDaRota) => Promise<Response>): Promise<Response> {
  try {
    const c = await entrarNaRota();
    if (c instanceof NextResponse) return c;
    return await fn(c);
  } catch (e) {
    return respostaDeErro(e);
  }
}
