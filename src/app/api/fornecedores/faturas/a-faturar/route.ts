import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { aFaturarDaParte, resumoAFaturar } from '@/lib/fornecedor-servidor';
import { contexto, respostaDeErroDoFornecedor } from '@/lib/fornecedor-rota';

// O que está a faturar: um resumo por fornecedor ou, com parte_id, os itens
// dele com a regra, as próximas 3 faturas e os sinais disponíveis.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const parte = new URL(req.url).searchParams.get('parte_id');
  const exec = pool as unknown as ExecutorSQL;
  try {
    if (parte) return NextResponse.json(await aFaturarDaParte(exec, tenantId, parte));
    return NextResponse.json({ partes: await resumoAFaturar(exec, tenantId) });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
