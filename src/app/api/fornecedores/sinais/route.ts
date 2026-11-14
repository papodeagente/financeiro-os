import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { criarSinal, sinaisComSaldo } from '@/lib/fornecedor-servidor';
import { contexto, corpo, respostaDeErroDoFornecedor, texto } from '@/lib/fornecedor-rota';

// Sinal ao fornecedor: listar (com saldo a compensar) e lançar.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const q = new URL(req.url).searchParams;
  try {
    const parte = q.get('parte_id');
    const sinais = await sinaisComSaldo(pool as unknown as ExecutorSQL, tenantId, {
      ...(parte ? { parte_ids: [parte] } : {}), so_abertos: q.get('situacao') === 'ABERTO',
    });
    return NextResponse.json({ sinais });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('gerar_fatura_fornecedor');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId, usuario } = await contexto();
  const c = await corpo(req);
  try {
    const s = await emTransacao(e => criarSinal(e, tenantId, {
      parte_id: texto(c.parte_id), valor_centavos: Number(c.valor_centavos), vencimento: texto(c.vencimento),
      venda_id: texto(c.venda_id) || null, descricao: texto(c.descricao),
    }, usuario));
    return NextResponse.json(s, { status: 201 });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
