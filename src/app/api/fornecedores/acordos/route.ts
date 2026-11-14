import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { listarAcordos, salvarAcordo } from '@/lib/fornecedor-servidor';
import { contexto, corpo, respostaDeErroDoFornecedor } from '@/lib/fornecedor-rota';

// Acordos com fornecedores (comissão, over, Taxa CC DU/RAV, representante, vigência).
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const forn = new URL(req.url).searchParams.get('fornecedor_id');
  try {
    return NextResponse.json({ acordos: await listarAcordos(pool as unknown as ExecutorSQL, tenantId, forn ? { fornecedor_id: forn } : {}) });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId, usuario } = await contexto();
  const c = await corpo(req);
  try {
    const a = await emTransacao(e => salvarAcordo(e, tenantId, { ...c, id: '' }, usuario));
    return NextResponse.json(a, { status: 201 });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
