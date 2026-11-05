import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { categoriasDosEncargos, linhasDeEncargos } from '@/lib/encargos-servidor';

// Encargos registrados na liquidação (05/11/2026), para o DRE: as baixas com
// juros, multa, desconto ou taxa e a categoria escolhida para cada um. Só
// leitura: nada é criado aqui.
export const dynamic = 'force-dynamic';

export async function GET() {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ linhas: [], categorias: {} });
  const tenantId = await getTenantId();
  const [linhas, categorias] = await Promise.all([
    linhasDeEncargos(pool, tenantId),
    categoriasDosEncargos(pool, tenantId).catch(() => ({})),
  ]);
  return NextResponse.json({ linhas, categorias });
}
