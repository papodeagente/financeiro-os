import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { comissoesNoPeriodo } from '@/lib/fornecedor-servidor';
import { contexto, respostaDeErroDoFornecedor } from '@/lib/fornecedor-rota';

// Comissão esperada (acordo) × lançada (venda) × recebida, por operadora, no
// período das vendas. Mostra o ganho da agência: exige ver as colunas de comissão.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = (await recusaFinanceira('ler')) ?? (await recusaAcao('ver_colunas_comissao'));
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const q = new URL(req.url).searchParams;
  try {
    return NextResponse.json(await comissoesNoPeriodo(pool as unknown as ExecutorSQL, tenantId, { de: q.get('de') ?? '', ate: q.get('ate') ?? '' }));
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
