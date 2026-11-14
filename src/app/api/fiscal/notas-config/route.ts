import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarConfigNotas, lerConfigNotas } from '@/lib/nota-regras-servidor';

// Emissão automática por gatilho e envio ao cliente (E5, parte E).
//   GET → { automatico, enviar_ao_cliente }   PUT o mesmo formato.
export const dynamic = 'force-dynamic';

export async function GET() {
  const semModulo = await recusaModulo('notas');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  return NextResponse.json(await lerConfigNotas(pool as unknown as ExecutorSQL, await getTenantId()));
}

export async function PUT(req: Request) {
  const semModulo = await recusaModulo('notas');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('configurar_notas');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  const tenantId = await getTenantId();
  return NextResponse.json(await emTransacao(exec => gravarConfigNotas(exec, tenantId, corpo)));
}
