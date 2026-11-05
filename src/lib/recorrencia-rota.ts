/**
 * Moldura comum das rotas de recorrência (05/11/2026): guarda de permissão,
 * banco iniciado, agência da sessão, transação e erro em português.
 */
import { NextResponse } from 'next/server';
import pool, { initDB } from './db';
import { getTenantId } from './tenant';
import { recusaExclusao, recusaFinanceira } from './guarda-rota';
import { emTransacao, type ExecutorSQL } from './caixa-atomico';
import { hojeISO } from './money';
import { ErroRecorrencia } from './recorrencia-servidor';

export interface ContextoDaRota {
  tenantId: string;
  hoje: string;
  tx: <T>(fn: (exec: ExecutorSQL) => Promise<T>) => Promise<T>;
}

export async function rodarRota(
  modo: 'ler' | 'escrever' | 'excluir',
  fn: (ctx: ContextoDaRota) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const recusa = modo === 'excluir'
      ? (await recusaExclusao()) ?? (await recusaFinanceira('escrever'))
      : await recusaFinanceira(modo);
    if (recusa) return recusa;
    await initDB();
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });
    const tenantId = await getTenantId();
    const corpo = await fn({ tenantId, hoje: hojeISO(), tx: emTransacao });
    return NextResponse.json(corpo);
  } catch (e) {
    if (e instanceof ErroRecorrencia) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : 'Erro';
    console.error('[recorrencias]', msg);
    return NextResponse.json({ error: 'Não foi possível concluir. Nada foi gravado.' }, { status: 500 });
  }
}

/** Corpo JSON como objeto (ou erro claro). */
export async function lerCorpo(req: Request): Promise<Record<string, unknown>> {
  let corpo: unknown;
  try { corpo = await req.json(); } catch { throw new ErroRecorrencia('Formato inválido.'); }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw new ErroRecorrencia('Formato inválido.');
  return corpo as Record<string, unknown>;
}

export function ehPrevia(corpo: Record<string, unknown>): boolean {
  return corpo.modo !== 'gravar';
}
