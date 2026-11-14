// Mudança de sistema (E4, 05/11/2026): o que exportar de cada lista do
// sistema anterior e os campos de cada uma (passo 1 do assistente). Só administrador.
//   GET → { listas: [{ id, rotulo, etapa, como_exportar[], campos[{ id, rotulo, obrigatorio, sinonimos, dica }], pelo_menos_um_de }] }
import { NextResponse } from 'next/server';
import { naRota } from '@/lib/migracao/rota';
import { dicionarioParaTela } from '@/lib/migracao/servidor';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';

export async function GET() {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async () => NextResponse.json({ listas: dicionarioParaTela() }));
}
