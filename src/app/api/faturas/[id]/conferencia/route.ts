import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { conferirPorArquivo } from '@/lib/fatura-servidor';
import type { LinhaDoArquivo } from '@/lib/fatura-regras';
import { lerJson, montarFichaDaFatura, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Conferência por arquivo: a tela lê a planilha do cliente (SheetJS no navegador), a pessoa escolhe as colunas de
// referência e de valor, e manda as linhas: { linhas: [{ referencia, valor_centavos? }], arquivo? }.
// Responde { relatorio, ficha }: o que bateu, o que tem valor diferente, o que falta no arquivo e o que sobra nele.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const corpo = await lerJson<{ linhas?: LinhaDoArquivo[]; arquivo?: string }>(req);
  if (!corpo || !Array.isArray(corpo.linhas)) return NextResponse.json({ error: 'Mande as linhas do arquivo.', codigo: 'DADOS' }, { status: 400 });
  const sessao = await getSession();
  const tenantId = await getTenantId();
  try {
    const relatorio = await emTransacao(e => conferirPorArquivo(e, tenantId, id, corpo.linhas!, { usuario: usuarioDaFatura(sessao), arquivo: String(corpo.arquivo ?? '').slice(0, 200) }));
    return NextResponse.json({ relatorio, ficha: await montarFichaDaFatura(pool as unknown as ExecutorSQL, tenantId, id, sessao) });
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
