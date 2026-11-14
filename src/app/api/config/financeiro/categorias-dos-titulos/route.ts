import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import {
  ErroCategoriasDosTitulos, lerCategoriasDosTitulos, salvarCategoriasDosTitulos,
} from '@/lib/categorias-padrao-titulos-servidor';
import { empresaDoPedido } from '@/lib/empresas-rota';

// Configurações › Financeiro › Categorias das contas geradas (06/11/2026, E7):
// em que categoria nasce cada conta que o sistema cria sozinho (venda,
// fornecedor, reembolso, restituição). Ler: financeiro. Gravar: administrador.
// Contas já gravadas não mudam. Por empresa (E7, frente D): ?empresa=<id>.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ categorias: {} });
  const { empresa, recusa: recusaEmpresa } = await empresaDoPedido(req);
  if (recusaEmpresa) return recusaEmpresa;
  const tenantId = await getTenantId();
  return NextResponse.json({ categorias: await lerCategoriasDosTitulos(pool as unknown as ExecutorSQL, tenantId, empresa) });
}

export async function PUT(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { empresa, recusa: recusaEmpresa } = await empresaDoPedido(req);
  if (recusaEmpresa) return recusaEmpresa;
  const corpo = (await req.json().catch(() => ({}))) as { categorias?: unknown };
  const tenantId = await getTenantId();
  try {
    const categorias = await emTransacao(exec => salvarCategoriasDosTitulos(exec, tenantId, corpo.categorias, empresa));
    return NextResponse.json({ categorias });
  } catch (e) {
    if (e instanceof ErroCategoriasDosTitulos) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
