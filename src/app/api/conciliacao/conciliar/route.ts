import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { emTransacao } from '@/lib/caixa-atomico';
import {
  conciliarComContas,
  conciliarCriandoConta,
  desfazerConciliacao,
  ErroConciliacao,
} from '@/lib/conciliacao-servidor';
import type { TipoLancamento } from '@/lib/conciliacao-plano';

/**
 * Conciliação de uma linha do extrato, numa transação só.
 *
 *   { acao: 'vincular', extrato_id, contas: [{ tipo, id }] }
 *   { acao: 'criar', extrato_id, nome, descricao, categoria_id?, venda_id?, cliente_id? }
 *   { acao: 'desfazer', extrato_id }
 *
 * Baixa conta e move saldo bancário: exige permissão de editar o financeiro.
 */
export async function POST(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503 });

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const acao = String(body?.acao ?? '');
    const extratoId = String(body?.extrato_id ?? '');
    if (!extratoId) return NextResponse.json({ error: 'Informe a linha do extrato.' }, { status: 400 });
    const tenantId = await getTenantId();

    if (acao === 'vincular') {
      const contas = Array.isArray(body?.contas)
        ? (body.contas as Array<{ tipo?: unknown; id?: unknown }>).map(c => ({ tipo: String(c.tipo ?? '') as TipoLancamento, id: String(c.id ?? '') }))
        : [];
      const r = await emTransacao(exec => conciliarComContas(exec, tenantId, extratoId, contas));
      return NextResponse.json(r);
    }
    if (acao === 'criar') {
      const r = await emTransacao(exec => conciliarCriandoConta(exec, tenantId, extratoId, {
        nome: String(body?.nome ?? ''),
        descricao: String(body?.descricao ?? ''),
        categoria_id: body?.categoria_id ? String(body.categoria_id) : undefined,
        venda_id: body?.venda_id ? String(body.venda_id) : undefined,
        cliente_id: body?.cliente_id ? String(body.cliente_id) : undefined,
      }));
      return NextResponse.json(r);
    }
    if (acao === 'desfazer') {
      const r = await emTransacao(exec => desfazerConciliacao(exec, tenantId, extratoId));
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (e) {
    if (e instanceof ErroConciliacao) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
