import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { listarFaturas, type FiltroDasFaturas } from '@/lib/fatura-servidor';
import { respostaDeErroDaFatura } from '@/lib/fatura-rota';
import { getSession } from '@/lib/auth';
import { escopoDaSessao, type ExecutorEmpresas } from '@/lib/empresas-servidor';

// Faturas ao cliente (E5, parte B). Contrato em src/lib/fatura-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
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
      // Empresas marcadas e liberadas (E7). Uma empresa só: todas.
      empresas: (await escopoDaSessao(await getSession(), pool as unknown as ExecutorEmpresas)).visiveis,
    });
    return NextResponse.json({ faturas: r.itens, totais: r.totais });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
