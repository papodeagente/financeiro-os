// Sugestão de categoria pelo histórico, para o lançamento à mão (E7, frente D).
// GET /api/sugestao-categoria?tabela=pagar|receber&pessoa_id=&nome=&documento=
//   → { categorias: [{ id, codigo, nome, vezes }] } (até três; só sugere).
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { sugerirCategoriaPeloHistorico } from '@/lib/sugestao-categoria-servidor';
import { tabelaDoEndereco } from '@/lib/titulo-rota';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  const q = new URL(req.url).searchParams;
  const tabela = tabelaDoEndereco(q.get('tabela') ?? '');
  if (!tabela) return NextResponse.json({ error: 'Diga se é a pagar ou a receber.' }, { status: 400 });
  if (!pool) return NextResponse.json({ categorias: [] });
  const tenantId = await getTenantId();
  const categorias = await sugerirCategoriaPeloHistorico(pool as unknown as ExecutorSQL, tenantId, tabela, {
    pessoa_id: (q.get('pessoa_id') ?? '').slice(0, 120),
    nome: (q.get('nome') ?? '').slice(0, 160),
    documento: (q.get('documento') ?? '').slice(0, 30),
  });
  return NextResponse.json({ categorias });
}
