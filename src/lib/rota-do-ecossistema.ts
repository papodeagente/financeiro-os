/**
 * O começo comum das rotas do ecossistema (comissão por MRR): sessão,
 * permissão do financeiro, empresa, banco e o perfil da conta. Uma agência
 * recebe 404: para ela a rota não existe.
 */
import { NextResponse } from 'next/server';
import pool, { initDB } from './db';
import { getSession } from './auth';
import { bloqueioFinanceiro } from './permissoes';
import { exigirEcossistema } from './perfil-da-conta';
import type { ExecutorSQL } from './caixa-atomico';

const HEADERS = { 'Cache-Control': 'private, no-store' };

export function respostaJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function contextoDoEcossistema(modo: 'ler' | 'escrever') {
  const session = await getSession();
  const bloqueio = bloqueioFinanceiro(session, modo);
  if (bloqueio) return { response: respostaJson({ error: bloqueio.erro }, bloqueio.status) } as const;
  const tenantId = session!.impersonatingTenantId || session!.tenantId;
  if (!tenantId) return { response: respostaJson({ error: 'Agência não identificada.' }, 403) } as const;
  if (!pool) return { response: respostaJson({ error: 'Banco de dados indisponível.' }, 503) } as const;
  await initDB();
  const exec = pool as unknown as ExecutorSQL;
  const fora = await exigirEcossistema(tenantId, exec);
  if (fora) return { response: respostaJson({ error: fora.erro }, fora.status) } as const;
  return { tenantId, exec } as const;
}
