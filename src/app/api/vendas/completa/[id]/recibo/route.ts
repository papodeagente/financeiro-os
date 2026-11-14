import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { lerReciboDaVenda } from '@/lib/recibo-da-venda-servidor';
import { registrarReciboDaVenda } from '@/lib/recibo-emitido';
import { recusaModulo } from '@/lib/guarda-rota';

// Recibo da venda (E7): GET ?pagante=<chave> → { recibo, pagantes }; sem pagamento recebido → 422 { error, pagantes }.
// Quem vê a venda vê o recibo (o vendedor sem "ver vendas de todos" só as dele).
// POST ?pagante=<chave> → o mesmo recibo, EMITIDO: abrir para imprimir ou mandar registra o número e a versão
// (recibos_emitidos). Mesmo conteúdo, mesmo número; a venda mudou depois de emitido: versão nova, com
// `substitui` = o número anterior.
export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  try {
    const pagante = new URL(req.url).searchParams.get('pagante');
    const r = await lerReciboDaVenda(pool as unknown as ExecutorSQL, acesso.tenantId, id, { pagante, hoje: hojeISO() });
    if (!r) return NextResponse.json({ error: 'Venda não encontrada.' }, { status: 404, headers: HEADERS });
    if (!r.ok) return NextResponse.json({ error: r.motivo, pagantes: r.pagantes }, { status: 422, headers: HEADERS });
    return NextResponse.json({ recibo: r.recibo, pagantes: r.pagantes }, { headers: HEADERS });
  } catch (e) {
    console.error('[recibo-venda] falha:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível montar o recibo. Tente de novo.' }, { status: 500, headers: HEADERS });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  try {
    const exec = pool as unknown as ExecutorSQL;
    const pagante = new URL(req.url).searchParams.get('pagante');
    const r = await lerReciboDaVenda(exec, acesso.tenantId, id, { pagante, hoje: hojeISO() });
    if (!r) return NextResponse.json({ error: 'Venda não encontrada.' }, { status: 404, headers: HEADERS });
    if (!r.ok) return NextResponse.json({ error: r.motivo, pagantes: r.pagantes }, { status: 422, headers: HEADERS });
    const recibo = r.recibo;
    const chave = pagante ?? r.pagantes.find(p => p.nome === recibo.pagador.nome)?.chave ?? r.pagantes[0]?.chave ?? '';
    const emitido = await emTransacao(tx => registrarReciboDaVenda(tx, acesso.tenantId, id, {
      numero_base: recibo.numero, pagante: chave, valor: recibo.valor, pagador: recibo.pagador, recebimentos: recibo.recebimentos,
    }, acesso.sessao.nome || acesso.sessao.email || ''));
    return NextResponse.json({ recibo: { ...recibo, numero: emitido.numero, substitui: emitido.substitui }, pagantes: r.pagantes }, { headers: HEADERS });
  } catch (e) {
    console.error('[recibo-venda] emissão:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível montar o recibo. Tente de novo.' }, { status: 500, headers: HEADERS });
  }
}
