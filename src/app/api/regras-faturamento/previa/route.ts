import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { descricaoDaRegra, normalizarRegra, proximasFaturas } from '@/lib/fatura-regras';
import { calendarioDaAgencia } from '@/lib/fatura-servidor';
import { lerJson, respostaDeErroDaFatura } from '@/lib/fatura-rota';

// Prévia da regra enquanto ela é editada: { regra, a_partir_de? } → { descricao, proximas (3), erros }. Nada é gravado.
// Usa o calendário da agência (feriados nacionais + os dela).
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  const corpo = await lerJson<{ regra?: unknown; a_partir_de?: string }>(req);
  if (!corpo?.regra) return NextResponse.json({ error: 'Mande a regra.', codigo: 'DADOS' }, { status: 400 });
  try {
    const { regra, erros } = normalizarRegra(corpo.regra);
    const outros = erros.filter(e => e.campo !== 'pessoa_id');
    const hoje = corpo.a_partir_de && /^\d{4}-\d{2}-\d{2}$/.test(corpo.a_partir_de) ? corpo.a_partir_de : hojeISO();
    const cal = pool ? await calendarioDaAgencia(pool as unknown as ExecutorSQL, await getTenantId()) : undefined;
    return NextResponse.json({
      descricao: descricaoDaRegra(regra),
      proximas: outros.length ? [] : proximasFaturas(regra, hoje, 3, cal),
      erros: outros,
    });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
