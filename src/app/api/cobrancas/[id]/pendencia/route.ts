import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { ErroBaixa } from '@/lib/baixas-servidor';
import { RecusaDaBaixa, type SessaoDaBaixa } from '@/lib/baixas-porteiro';
import { planoDaPendenciaNoBanco, resolverPendencia } from '@/lib/cobranca/pagamento-servidor';
import type { EscolhaDaPendencia } from '@/lib/cobranca/pendencia';
import { ErroCobranca } from '@/lib/cobranca/tipos';
import { chaveDe, lerCorpo, quemEsta, respostaDeErroDaCobranca } from '@/lib/cobranca/rota';

// Pendência da baixa automática (E7, 06/11/2026): o provedor avisou o pagamento e a baixa não entrou sozinha.
//   GET  → { cobranca_id, pendencia, tipo, pagamento, divisao, conta: { status, saldo, cliente_id } | null, conta_aberta,
//            escolhas: { corrigir, credito, ignorar: { pode, frase, credito?, entra? } } }
//   POST { escolha: 'corrigir' | 'credito' | 'ignorar', motivo? (≥ 10 letras em "ignorar") }, cabeçalho Idempotency-Key
//        → { escolha, cobranca_id, baixa_id, credito_id, repetido? }
//        corrigir/credito passam pelo porteiro de baixas (direito, conta, alçada, limites): fora dos limites, 409.
export const dynamic = 'force-dynamic';

function erro(e: unknown, contexto: string) {
  if (e instanceof RecusaDaBaixa) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ErroBaixa) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof ErroCobranca) return respostaDeErroDaCobranca(e, contexto);
  // Crédito do cliente (carteira) e período fechado chegam com status próprio.
  const st = (e as { status?: number })?.status;
  if (typeof st === 'number' && st >= 400 && st < 500 && e instanceof Error && !/PERIODO_FECHADO/.test(e.message)) {
    return NextResponse.json({ error: e.message }, { status: st });
  }
  return respostaDeErroDaCobranca(e, contexto);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('cobranca');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  try {
    return NextResponse.json(await planoDaPendenciaNoBanco(pool as unknown as ExecutorSQL, await getTenantId(), id));
  } catch (e) {
    return erro(e, 'pendência');
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('cobranca');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const corpo = await lerCorpo<{ escolha?: EscolhaDaPendencia; motivo?: string }>(req);
  if (!corpo?.escolha) return NextResponse.json({ error: 'Escolha o que fazer com o pagamento.' }, { status: 400 });
  try {
    const sessao = ((await getSession()) ?? {}) as SessaoDaBaixa;
    const r = await resolverPendencia(await getTenantId(), id, { escolha: corpo.escolha, motivo: corpo.motivo }, {
      sessao, quem: await quemEsta(), idempotencia: chaveDe(req),
    });
    return NextResponse.json(r);
  } catch (e) {
    return erro(e, 'pendência');
  }
}
