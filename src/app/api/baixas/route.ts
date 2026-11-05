import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, respostaPeriodoFechado } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { ErroBaixa, historicoDaConta, registrarBaixas, type ItemBaixa } from '@/lib/baixas-servidor';
import type { TituloTabela } from '@/lib/baixa-calculo';

// Liquidação no servidor (05/11/2026).
//   POST { modo: 'previa' | 'gravar', itens: ItemBaixa[], assinatura? }
//        cabeçalho Idempotency-Key ao gravar: repetir não grava duas vezes.
//   GET  ?titulo_tabela=contas_receber&titulo_id=...  → histórico de baixas.
export const dynamic = 'force-dynamic';

function erro(e: unknown) {
  const periodo = respostaPeriodoFechado(e);
  if (periodo) return periodo;
  if (e instanceof ErroBaixa) return NextResponse.json({ error: e.message }, { status: e.status });
  const st = (e as { status?: number })?.status;
  if (typeof st === 'number' && st >= 400 && st < 500) {
    return NextResponse.json({ error: (e as Error).message }, { status: st });
  }
  console.error('[baixas]', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível registrar a baixa. Nada foi gravado.' }, { status: 500 });
}

export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { modo?: string; itens?: ItemBaixa[]; assinatura?: string } | null;
  const gravar = corpo?.modo === 'gravar';
  const recusa = await recusaFinanceira(gravar ? 'escrever' : 'ler');
  if (recusa) return recusa;
  if (!corpo || !Array.isArray(corpo.itens)) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const tenantId = await getTenantId();
  const sessao = await getSession();
  const ctx = {
    tenantId,
    usuarioId: sessao?.userId,
    usuarioNome: sessao?.nome,
    origem: (corpo.itens.length > 1 ? 'lote' : 'tela') as 'lote' | 'tela',
    idempotencia: req.headers.get('idempotency-key') || undefined,
  };
  try {
    const r = gravar
      ? await emTransacao(exec => registrarBaixas(exec, ctx, corpo.itens!, { gravar: true, assinatura: corpo.assinatura }))
      : await registrarBaixas(pool as unknown as ExecutorSQL, ctx, corpo.itens, { gravar: false });
    return NextResponse.json(r);
  } catch (e) {
    return erro(e);
  }
}

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json([]);
  const url = new URL(req.url);
  const tabela = url.searchParams.get('titulo_tabela') as TituloTabela | null;
  const id = url.searchParams.get('titulo_id');
  if (!id || (tabela !== 'contas_receber' && tabela !== 'contas_pagar')) {
    return NextResponse.json({ error: 'Informe titulo_tabela e titulo_id.' }, { status: 400 });
  }
  const tenantId = await getTenantId();
  return NextResponse.json(await historicoDaConta(pool as unknown as ExecutorSQL, tenantId, tabela, id));
}
