import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import {
  alterarCobranca, cancelarCobranca, carregarCobranca, detalheDaCobranca,
} from '@/lib/cobranca/servidor';
import { centavosDe, cobrancaParaTela, lerCorpo, quemEsta, respostaDeErroDaCobranca } from '@/lib/cobranca/rota';

// Uma cobrança (E3, 05/11/2026).
//   GET    → detalhe: a cobrança (valores em centavos e em reais), capacidades do provedor, a conta e o histórico.
//   PATCH  { vencimento?: 'AAAA-MM-DD', valor?: number (reais) } → 2ª via. Onde o provedor altera, altera;
//          onde não altera, cancela e emite outra (a nova vem com `substitui_id`).
//   DELETE { motivo? } → { ok: true, cobranca, aviso }: cancela no provedor e aqui (cancelar de novo devolve ok).
//          Link: só aqui, com `aviso` para desativar no painel do provedor.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

async function contaDa(id: string): Promise<{ tenantId: string; conta: string | null; existe: boolean }> {
  const tenantId = await getTenantId();
  const c = pool ? await carregarCobranca(pool as unknown as ExecutorSQL, tenantId, id) : null;
  return { tenantId, conta: c?.conta_bancaria_id ?? null, existe: Boolean(c) };
}

export async function GET(_req: Request, { params }: Params) {
  const semModulo = await recusaModulo('cobranca');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  try {
    const d = await detalheDaCobranca(pool as unknown as ExecutorSQL, await getTenantId(), id);
    const contaDaCobranca = (d.conta ?? {}) as { cliente_nome?: string; fatura_numero?: string | null };
    return NextResponse.json({ ...cobrancaParaTela({ ...d, cliente_nome: String(contaDaCobranca.cliente_nome ?? ''), fatura_numero: Number(contaDaCobranca.fatura_numero) || null }), capacidades: d.capacidades, conta: d.conta, eventos: d.eventos });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'detalhe');
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const semModulo = await recusaModulo('cobranca');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const corpo = await lerCorpo<{ vencimento?: string; valor?: number }>(req);
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  const { tenantId, conta, existe } = await contaDa(id);
  if (!existe) return NextResponse.json({ error: 'Cobrança não encontrada.' }, { status: 404 });
  const recusaConta = await recusaAcao('gerar_boletos', { contaBancariaId: conta });
  if (recusaConta) return recusaConta;
  try {
    const nova = await alterarCobranca(tenantId, id, {
      vencimento: corpo.vencimento || undefined, valor_centavos: centavosDe(corpo.valor),
    }, { quem: await quemEsta() });
    return NextResponse.json(cobrancaParaTela(nova));
  } catch (e) {
    return respostaDeErroDaCobranca(e, '2ª via');
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const semModulo = await recusaModulo('cobranca');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const corpo = (await lerCorpo<{ motivo?: string }>(req)) ?? {};
  const { tenantId, conta, existe } = await contaDa(id);
  if (!existe) return NextResponse.json({ error: 'Cobrança não encontrada.' }, { status: 404 });
  const recusaConta = await recusaAcao('gerar_boletos', { contaBancariaId: conta });
  if (recusaConta) return recusaConta;
  try {
    const r = await cancelarCobranca(tenantId, id, { motivo: corpo.motivo, quem: await quemEsta() });
    return NextResponse.json({ ok: true, cobranca: cobrancaParaTela(r.cobranca), aviso: r.aviso ?? null });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'cancelar');
  }
}
