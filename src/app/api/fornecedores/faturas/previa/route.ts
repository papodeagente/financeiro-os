import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaFinanceira } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { previaDaFaturaNoBanco } from '@/lib/fornecedor-servidor';
import { contexto, corpo, respostaDeErroDoFornecedor, texto } from '@/lib/fornecedor-rota';

// Prévia da fatura do fornecedor: itens, sinal a compensar, vencimento pela
// regra e os alertas. Nada é gravado; a assinatura volta para o "Gerar".
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const c = await corpo(req);
  try {
    return NextResponse.json(await previaDaFaturaNoBanco(pool as unknown as ExecutorSQL, tenantId, {
      parte_id: texto(c.parte_id), conta_ids: Array.isArray(c.conta_ids) ? c.conta_ids.map(texto) : [],
      corte: texto(c.corte) || undefined, vencimento: texto(c.vencimento) || undefined, modo: texto(c.modo) === 'BRUTO' ? 'BRUTO' : 'SALDO',
    }));
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
