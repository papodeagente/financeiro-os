// Mudança v2 (E7, 06/11/2026): os registros trazidos do sistema anterior
// (faturas, notas emitidas, comissões já pagas), só para consulta. Só administrador.
//   GET ?tipo=faturas|notas|comissoes_pagas&busca=&pagina= → { registros, total, contagem }
import { NextResponse } from 'next/server';
import { naRota } from '@/lib/migracao/rota';
import { listarHistorico } from '@/lib/migracao/historico-leitura';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ exec, tenantId }) => {
    const u = new URL(req.url);
    return NextResponse.json(await listarHistorico(exec, tenantId, {
      tipo: u.searchParams.get('tipo') ?? '', busca: u.searchParams.get('busca') ?? '', pagina: Number(u.searchParams.get('pagina') ?? 1),
    }));
  });
}
