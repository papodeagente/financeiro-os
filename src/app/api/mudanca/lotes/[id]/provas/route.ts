// Mudança de sistema (E4, 05/11/2026): as provas de que bateu. Só administrador.
//   GET → { data_corte, gerado_em, contas[], pessoas[], meses[], arquivos[], fora[], resumo, diferencas_sem_explicacao }
//         cada linha com explicacoes: [{ motivo, linhas, valor, codigo, filtro? }] (valores em reais)
import { NextResponse } from 'next/server';
import { naRota } from '@/lib/migracao/rota';
import { provasDoLote } from '@/lib/migracao/provas';
import { provasParaTela } from '@/lib/migracao/telas';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    return NextResponse.json(provasParaTela(await provasDoLote(exec, tenantId, id)));
  });
}
