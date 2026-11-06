import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { recusaAcao, recusaFinanceira } from '@/lib/guarda-rota';
import { addDias, hojeISO } from '@/lib/money';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { emitirNotasDaRegra, gradeDeNotas } from '@/lib/nota-regras-servidor';
import { dataOu, lerSelecao, respostaDeErroDaNota } from '@/lib/nota-regras-rota';

// "Gerar notas" (E5, parte E): a grade Receitas × Valor das notas × Saldo e
// a emissão. Contrato em src/lib/nota-regras-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const q = new URL(req.url).searchParams;
  const hoje = hojeISO();
  try {
    return NextResponse.json(await gradeDeNotas(pool as unknown as ExecutorSQL, await getTenantId(), {
      de: dataOu(q.get('de'), addDias(hoje, -30)),
      ate: dataOu(q.get('ate'), hoje),
      busca: (q.get('busca') ?? '').slice(0, 120),
      so_pendentes: q.get('pendentes') === '1',
    }));
  } catch (e) {
    return respostaDeErroDaNota(e);
  }
}

export async function POST(req: Request) {
  const recusa = await recusaAcao('emitir_nota');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null;
  const selecao = lerSelecao(corpo?.selecao);
  if (!selecao.length) return NextResponse.json({ error: 'Marque ao menos uma venda para emitir.', codigo: 'SEM_SELECAO' }, { status: 400 });
  const assinatura = typeof corpo?.assinatura === 'string' ? corpo.assinatura : '';
  if (!assinatura) return NextResponse.json({ error: 'Abra a prévia antes de emitir.', codigo: 'SEM_PREVIA' }, { status: 400 });
  try {
    const sessao = await getSession();
    const r = await emitirNotasDaRegra(pool as unknown as ExecutorSQL, await getTenantId(), { selecao, assinatura }, {
      id: sessao?.userId ?? '', nome: sessao?.nome ?? '',
    });
    return NextResponse.json(r);
  } catch (e) {
    return respostaDeErroDaNota(e);
  }
}
