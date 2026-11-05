import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { ErroEncargos, garantirCategoriasDeEncargos } from '@/lib/encargos-servidor';

// Cria as categorias padrão dos encargos no plano de contas (05/11/2026).
// A primeira liquidação com juros, multa, desconto ou taxa já faz isto
// sozinha; aqui é o botão da tela. Rodar de novo não duplica nada.
export const dynamic = 'force-dynamic';

export async function POST() {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const tenantId = await getTenantId();
  try {
    const categorias_encargos = await emTransacao(exec => garantirCategoriasDeEncargos(exec, tenantId));
    return NextResponse.json({ categorias_encargos });
  } catch (e) {
    if (e instanceof ErroEncargos) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
