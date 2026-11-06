import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { aplicarAssistente, prepararAgenciaNova, situacaoDoAssistente } from '@/lib/assistente-inicial-servidor';

// Assistente inicial do Financeiro (E7, frente D, 06/11/2026).
//   GET  → { modo: 'automatico'|'oferecer'|'pronto', faltam, encargos_faltam, ... }
//   POST → { automatico?: true }: com `automatico`, só roda se a agência for
//          nova (sem plano próprio e sem contas); sem ele, é o clique da
//          oferta: cria o que falta e liga o que está vazio, sem mudar nada
//          que já está gravado. Só administrador.
export const dynamic = 'force-dynamic';

export async function GET() {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ modo: 'pronto', faltam: [], encargos_faltam: [] });
  const tenantId = await getTenantId();
  return NextResponse.json(await situacaoDoAssistente(pool as unknown as ExecutorSQL, tenantId));
}

export async function POST(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => ({}))) as { automatico?: unknown };
  const tenantId = await getTenantId();
  try {
    const resultado = await emTransacao(exec => (corpo.automatico === true ? prepararAgenciaNova(exec, tenantId) : aplicarAssistente(exec, tenantId)));
    const situacao = await situacaoDoAssistente(pool as unknown as ExecutorSQL, tenantId);
    return NextResponse.json({ aplicado: resultado !== null, resultado, situacao });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
