import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { proximasFaturas } from '@/lib/fornecedor-regra';
import { lerRegraDoFornecedor, salvarRegraDoFornecedor } from '@/lib/fornecedor-servidor';
import { contexto, corpo, respostaDeErroDoFornecedor } from '@/lib/fornecedor-rota';

// Regra de faturamento do fornecedor (corte, vencimento, dia útil, data base)
// e a prévia das próximas 3 faturas.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const parte = new URL(req.url).searchParams.get('parte_id') ?? '';
  try {
    const regra = await lerRegraDoFornecedor(pool as unknown as ExecutorSQL, tenantId, parte);
    if (!regra.cadastrado) return NextResponse.json({ error: 'Fornecedor não encontrado.' }, { status: 404 });
    return NextResponse.json({ regra, proximas: proximasFaturas(hojeISO(), regra.regra, 3) });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}

export async function PUT(req: Request) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('gerar_fatura_fornecedor');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { tenantId } = await contexto();
  const parte = new URL(req.url).searchParams.get('parte_id') ?? '';
  const c = await corpo(req);
  try {
    const regra = await emTransacao(e => salvarRegraDoFornecedor(e, tenantId, parte, c));
    return NextResponse.json({ regra, proximas: proximasFaturas(hojeISO(), regra.regra, 3) });
  } catch (e) {
    return respostaDeErroDoFornecedor(e);
  }
}
