import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { faturarNotasEsperando, faturarSoltosAvulso } from '@/lib/fatura-servidor';
import { lerJson, montarFichaDaFatura, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Faturar avulso itens soltos { conta_ids, vencimento? } ou as notas que esperavam { pessoa_id, notas: true, vencimento? }.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await lerJson<{ conta_ids?: string[]; vencimento?: string; pessoa_id?: string; notas?: boolean }>(req);
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido.', codigo: 'DADOS' }, { status: 400 });
  const sessao = await getSession();
  const tenantId = await getTenantId();
  const usuario = usuarioDaFatura(sessao);
  try {
    const f = corpo.notas === true && corpo.pessoa_id
      ? await emTransacao(e => faturarNotasEsperando(e, tenantId, String(corpo.pessoa_id), { usuario, vencimento: corpo.vencimento }))
      : await emTransacao(e => faturarSoltosAvulso(e, tenantId, Array.isArray(corpo.conta_ids) ? corpo.conta_ids.map(String) : [], { usuario, vencimento: corpo.vencimento }));
    return NextResponse.json(await montarFichaDaFatura(pool as unknown as ExecutorSQL, tenantId, f.id, sessao), { status: 201 });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
