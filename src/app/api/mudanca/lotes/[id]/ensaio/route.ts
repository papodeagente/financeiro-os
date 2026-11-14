// Mudança de sistema (E4, 05/11/2026): o ensaio (lê, mapeia, identifica e
// mostra o resultado de cada linha SEM gravar no financeiro). Só administrador.
//   POST → Lote (situação 'ensaiado', com resumo_do_ensaio e `ensaio` completo)
//   GET  ?resultado=criar|vincular|recusar&tipo_lista=&arquivo=&codigo=&busca=&pagina=&por_pagina=
//        → { resumo: ResumoPorLista[], linhas: LinhaDoEnsaio[], total, pagina, por_pagina, assinatura, contagem }
import { NextResponse } from 'next/server';
import { emTransacao } from '@/lib/caixa-atomico';
import { naRota } from '@/lib/migracao/rota';
import { ensaiarLote, lerLote, listarLinhas } from '@/lib/migracao/servidor';
import { linhaParaTela, loteParaTela, resumoPorLista } from '@/lib/migracao/telas';
import { recusaModulo } from '@/lib/guarda-rota';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ tenantId }) => {
    const { id } = await params;
    return NextResponse.json(await emTransacao(async exec => {
      const r = await ensaiarLote(exec, tenantId, id);
      return loteParaTela(exec, tenantId, r.lote);
    }));
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('mudanca');
  if (semModulo) return semModulo;
  return naRota(async ({ exec, tenantId }) => {
    const { id } = await params;
    const q = new URL(req.url).searchParams;
    const valor = (k: string) => {
      const v = q.get(k);
      return v && v !== 'todos' && v !== 'todas' ? v : undefined;
    };
    const lote = await lerLote(exec, tenantId, id);
    const r = await listarLinhas(exec, tenantId, id, {
      resultado: valor('resultado'), lista: valor('tipo_lista') ?? valor('lista'), arquivo: valor('arquivo'), codigo: valor('codigo'),
      busca: valor('busca'), pagina: Number(q.get('pagina') ?? 1), por_pagina: Number(q.get('por_pagina') ?? 100), sem_ignoradas: true,
    });
    return NextResponse.json({
      resumo: resumoPorLista(lote.resumo) ?? [], linhas: r.linhas.map(linhaParaTela), total: r.total, pagina: r.pagina,
      por_pagina: r.por_pagina, assinatura: lote.assinatura ?? '', contagem: r.contagem,
    });
  });
}
