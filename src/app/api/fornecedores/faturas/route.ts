import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gerarFatura, listarFaturas } from '@/lib/fornecedor-servidor';
import { contexto, corpo, respostaDeErroDoFornecedor, texto } from '@/lib/fornecedor-rota';

// Faturas do fornecedor (E5, parte C): listar e gerar. Contrato em src/lib/fornecedor-rota.ts.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const q = new URL(req.url).searchParams;
  try {
    const faturas = await listarFaturas(pool as unknown as ExecutorSQL, tenantId, {
      parte_id: q.get('parte_id') ?? undefined, situacao: q.get('situacao') ?? undefined, de: q.get('de') ?? undefined, ate: q.get('ate') ?? undefined,
    });
    return NextResponse.json({ faturas });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}

export async function POST(req: Request) {
  const recusa = await recusaAcao('gerar_fatura_fornecedor');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId, usuario } = await contexto();
  const c = await corpo(req);
  try {
    const fatura = await emTransacao(e => gerarFatura(e, tenantId, {
      parte_id: texto(c.parte_id), conta_ids: Array.isArray(c.conta_ids) ? c.conta_ids.map(texto) : [],
      corte: texto(c.corte) || undefined, vencimento: texto(c.vencimento) || undefined, observacoes: texto(c.observacoes),
      modo: texto(c.modo) === 'BRUTO' ? 'BRUTO' : 'SALDO',
      assinatura: texto(c.assinatura),
    }, usuario));
    return NextResponse.json(fatura, { status: 201 });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
