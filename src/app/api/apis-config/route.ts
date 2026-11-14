import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin } from '@/lib/guarda-rota';
import { lerConfigApis, paraTela, salvarConfigApis, type Consulta } from '@/lib/config-apis';

// A tela recebe as chaves só mascaradas, e gravar exige administrador.
// Detalhes em src/lib/config-apis.ts.
export async function GET() {
  try {
    await initDB();
    if (!pool) return NextResponse.json(null);
    const tenantId = await getTenantId();
    const cfg = await lerConfigApis(pool as unknown as Consulta, tenantId);
    return NextResponse.json(Object.keys(cfg).length > 0 ? paraTela(cfg) : null);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const recusa = await recusaAdmin();
    if (recusa) return recusa;
    const data = await req.json();
    if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
    const tenantId = await getTenantId();
    return NextResponse.json(await salvarConfigApis(pool as unknown as Consulta, tenantId, data));
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
