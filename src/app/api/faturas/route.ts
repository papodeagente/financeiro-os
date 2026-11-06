import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { listarFaturas, type FiltroDasFaturas } from '@/lib/fatura-servidor';
import { respostaDeErroDaFatura } from '@/lib/fatura-rota';

// Faturas ao cliente (E5, parte B). Contrato em src/lib/fatura-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ faturas: [], totais: null });
  const tenantId = await getTenantId();
  const u = new URL(req.url).searchParams;
  const campo = u.get('campo');
  try {
    const r = await listarFaturas(pool as unknown as ExecutorSQL, tenantId, {
      de: u.get('de') || undefined, ate: u.get('ate') || undefined,
      campo_data: campo === 'emissao' || campo === 'criacao' ? campo : 'vencimento',
      situacao: (u.get('situacao') || '') as FiltroDasFaturas['situacao'],
      pessoa_id: u.get('pessoa_id') || undefined, busca: u.get('busca') || undefined,
    });
    return NextResponse.json({ faturas: r.itens, totais: r.totais });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
