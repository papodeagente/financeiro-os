import { respostaPeriodoFechado } from '@/lib/guarda-rota';
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { emTransacao } from '@/lib/caixa-atomico';
import {
  conciliarComContas,
  conciliarCriandoConta,
  ErroConciliacao,
} from '@/lib/conciliacao-servidor';
import { aprenderComConciliacao, desfazerComRegras } from '@/lib/conciliacao-automatica';
import { ErroBaixa } from '@/lib/baixas-servidor';
import type { TipoLancamento } from '@/lib/conciliacao-plano';
import { recusaAcao } from '@/lib/guarda-rota';

/**
 * Conciliação de uma linha do extrato, numa transação só.
 *
 *   { acao: 'vincular', extrato_id, contas: [{ tipo, id }] }
 *   { acao: 'criar', extrato_id, nome, descricao, categoria_id?, venda_id?, cliente_id? }
 *   { acao: 'desfazer', extrato_id }
 *
 * Baixa conta e move saldo bancário: exige permissão de editar o financeiro.
 *
 * Depois de vincular ou criar, a conciliação ensina a regra daquela
 * descrição (E6): numa transação à parte, que nunca desfaz a conciliação.
 */

/** Aprender é bônus: se falhar, a conciliação que a pessoa fez continua. */
async function aprender(tenantId: string, extratoId: string): Promise<void> {
  try {
    await emTransacao(exec => aprenderComConciliacao(exec, tenantId, extratoId));
  } catch (e) {
    console.error('[conciliacao] regra não aprendida:', e instanceof Error ? e.message : e);
  }
}
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
    // Conciliar mexe no saldo da conta da linha: ela precisa estar liberada
    // para a pessoa (05/11/2026). Sem restrição, passa como antes.
    const { rows: linhaExtrato } = await pool.query(
      `SELECT COALESCE(NULLIF(conta_bancaria_id, ''), data->>'conta_bancaria_id', '') AS conta, data->>'conciliado_por' AS por
         FROM extrato_bancario WHERE id = $1 AND tenant_id = $2`,
      [extratoId, tenantId]);
    const recusaConta = await recusaAcao('conciliar', { contaBancariaId: String(linhaExtrato[0]?.conta ?? '') || null });
    if (recusaConta) return recusaConta;

    if (acao === 'vincular') {
      const contas = Array.isArray(body?.contas)
        ? (body.contas as Array<{ tipo?: unknown; id?: unknown }>).map(c => ({ tipo: String(c.tipo ?? '') as TipoLancamento, id: String(c.id ?? '') }))
        : [];
      const r = await emTransacao(exec => conciliarComContas(exec, tenantId, extratoId, contas));
      await aprender(tenantId, extratoId);
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
      await aprender(tenantId, extratoId);
      return NextResponse.json(r);
    }
    if (acao === 'desfazer') {
      // A conciliação automática liquidou pela liquidação no servidor:
      // desfazer é estornar aquela baixa, então pede o direito de estornar.
      if (linhaExtrato[0]?.por === 'regra') {
        const recusaEstorno = await recusaAcao('estornar_baixa', { contaBancariaId: String(linhaExtrato[0]?.conta ?? '') || null });
        if (recusaEstorno) return recusaEstorno;
      }
      const sessao = await getSession();
      const r = await emTransacao(exec => desfazerComRegras(exec, tenantId, extratoId, {
        usuarioId: sessao?.userId, usuarioNome: sessao?.nome,
      }, String(body?.motivo ?? '')));
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (e) {
    if (e instanceof ErroConciliacao) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ErroBaixa) return NextResponse.json({ error: e.message }, { status: e.status });
    const fechado = respostaPeriodoFechado(e);
    if (fechado) return fechado;
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
