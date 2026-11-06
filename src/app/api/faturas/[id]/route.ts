import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { CAMPOS_DA_FATURA, MODELOS_DE_FATURA, normalizarRetencoes } from '@/lib/fatura-regras';
import { carregarFatura, recalcularFatura, registrarEventoDaFatura, travarFaturas, ErroFatura } from '@/lib/fatura-servidor';
import { lerJson, montarFichaDaFatura, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Ficha da fatura (GET) e o que se ajusta sem mexer nos itens (PATCH): modelo, colunas, observações, retenções.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  try {
    const ficha = await montarFichaDaFatura(pool as unknown as ExecutorSQL, await getTenantId(), id, await getSession());
    if (!ficha) return NextResponse.json({ error: 'Fatura não encontrada.', codigo: 'NAO_ACHOU' }, { status: 404 });
    return NextResponse.json(ficha);
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const corpo = await lerJson<{ modelo?: string; campos?: string[]; observacoes?: string; retencoes?: unknown }>(req);
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido.', codigo: 'DADOS' }, { status: 400 });
  const sessao = await getSession();
  const tenantId = await getTenantId();
  try {
    await emTransacao(async e => {
      await travarFaturas(e, tenantId);
      const f = await carregarFatura(e, tenantId, id);
      if (!f) throw new ErroFatura('NAO_ACHOU', 'Fatura não encontrada.', 404);
      const sets: string[] = [];
      const args: unknown[] = [tenantId, id];
      if (corpo.modelo !== undefined) {
        if (!(MODELOS_DE_FATURA as readonly string[]).includes(String(corpo.modelo))) throw new ErroFatura('DADOS', 'Modelo de fatura desconhecido.', 400);
        args.push(corpo.modelo); sets.push(`modelo = $${args.length}`);
      }
      if (Array.isArray(corpo.campos)) {
        const validos = CAMPOS_DA_FATURA.map(c => c.id).filter(c => corpo.campos!.includes(c));
        args.push(JSON.stringify(validos)); sets.push(`campos = $${args.length}::jsonb`);
      }
      if (typeof corpo.observacoes === 'string') { args.push(corpo.observacoes.slice(0, 2000)); sets.push(`observacoes = $${args.length}`); }
      if (corpo.retencoes !== undefined) {
        if (f.situacao !== 'ABERTA') throw new ErroFatura('FATURA_FECHADA', 'As retenções só mudam com a fatura aberta.', 409);
        args.push(JSON.stringify(normalizarRetencoes(corpo.retencoes))); sets.push(`retencoes = $${args.length}::jsonb`);
      }
      if (!sets.length) return;
      await e.query(`UPDATE faturas SET ${sets.join(', ')}, atualizado_em = NOW() WHERE tenant_id = $1 AND id = $2`, args);
      await registrarEventoDaFatura(e, tenantId, id, 'ajustada', { usuario: usuarioDaFatura(sessao), detalhe: { campos: Object.keys(corpo) } });
      if (corpo.retencoes !== undefined) await recalcularFatura(e, tenantId, id);
    });
    return NextResponse.json(await montarFichaDaFatura(pool as unknown as ExecutorSQL, tenantId, id, sessao));
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
