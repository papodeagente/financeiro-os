import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { podeEditarFinanceiro } from '@/lib/permissoes';
import { hojeISO } from '@/lib/money';
import { emTransacao } from '@/lib/caixa-atomico';
import {
  listarRecebimentos, resumoRecebimentos, vincularVenda, marcarVendaDireta,
} from '@/lib/plataformas/fila';
import { candidatosDoCrm, ErroPlataforma } from '@/lib/plataformas/servico';
import { pontuar } from '@/lib/plataformas/conciliacao';

/**
 * Recebimentos das plataformas: painel e fila de conciliação.
 *
 * Exige permissão de financeiro, igual à configuração: vincular um
 * recebimento a uma venda muda de quem é o dinheiro no relatório.
 */
export async function GET(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const session = await getSession();
    if (!podeEditarFinanceiro(session ?? {})) {
      return NextResponse.json({ error: 'Sem permissao' }, { status: 403 });
    }
    const tenantId = await getTenantId();
    const url = new URL(req.url);

    // Busca de vendas candidatas para o operador escolher à mão.
    const candidatosDe = url.searchParams.get('candidatos_de');
    if (candidatosDe) {
      const plataforma = url.searchParams.get('plataforma') ?? '';
      const { rows } = await pool.query(
        `SELECT data FROM plataformas_transacoes
          WHERE tenant_id = $1 AND plataforma = $2 AND id_transacao = $3 LIMIT 1`,
        [tenantId, plataforma, candidatosDe],
      );
      if (rows.length === 0) return NextResponse.json({ error: 'Recebimento não encontrado' }, { status: 404 });
      const transacao = ((rows[0].data ?? {}) as Record<string, unknown>).transacao as never;
      const t = transacao as { comprador?: { documento?: string; email?: string; telefone?: string }; valor_bruto?: number; data_venda?: string; parcelas?: Array<{ data_pagamento?: string }> };
      const dataPagamento = t.parcelas?.find(p => p.data_pagamento)?.data_pagamento || t.data_venda || hojeISO();

      const candidatos = await emTransacao(exec => candidatosDoCrm(exec, tenantId, transacao, dataPagamento));
      const pagamento = {
        id_transacao: candidatosDe,
        documento: t.comprador?.documento ?? '',
        email: t.comprador?.email ?? '',
        telefone: t.comprador?.telefone ?? '',
        valor: Number(t.valor_bruto ?? 0),
        data: dataPagamento,
      };
      const lista = candidatos
        .map(c => ({ ...c, pontuacao: pontuar(pagamento, c) }))
        .sort((a, b) => b.pontuacao.pontos - a.pontuacao.pontos)
        .slice(0, 30);
      // As contas pendentes de cada candidata: é o que a unificação vai
      // substituir, e a tela mostra isso ANTES de o operador confirmar.
      const ids = lista.map(c => c.venda_id);
      const pendentes = new Map<string, Array<{ id: string; status: string; valor_final: number; data_vencimento: string }>>();
      if (ids.length > 0) {
        const { rows: crs } = await pool.query(
          `SELECT id, COALESCE(venda_id, data->>'origem_venda_id', data->>'venda_id') AS venda, data
             FROM contas_receber
            WHERE tenant_id = $1
              AND (venda_id = ANY($2::text[]) OR data->>'origem_venda_id' = ANY($2::text[]) OR data->>'venda_id' = ANY($2::text[]))
              AND COALESCE(data->>'plataforma_transacao', '') = ''`,
          [tenantId, ids],
        );
        for (const r of crs) {
          const d = (r.data ?? {}) as Record<string, unknown>;
          const v = String(r.venda ?? '');
          if (!pendentes.has(v)) pendentes.set(v, []);
          pendentes.get(v)!.push({ id: String(r.id), status: String(d.status ?? ''), valor_final: Number(d.valor_final ?? 0), data_vencimento: String(d.data_vencimento ?? '') });
        }
      }
      return NextResponse.json({
        total_plataforma: Number(t.valor_bruto ?? 0),
        candidatos: lista.map(c => ({ ...c, contas_da_venda: pendentes.get(c.venda_id) ?? [] })),
      });
    }

    const hoje = hojeISO();
    const de = url.searchParams.get('de') || `${hoje.slice(0, 8)}01`;
    const ate = url.searchParams.get('ate') || hoje;

    const [resumo, itens] = await Promise.all([
      resumoRecebimentos(tenantId, { de, ate }),
      listarRecebimentos(tenantId, {
        status: url.searchParams.get('status') ?? undefined,
        plataforma: url.searchParams.get('plataforma') ?? undefined,
        busca: url.searchParams.get('busca') ?? undefined,
      }),
    ]);

    return NextResponse.json({ periodo: { de, ate }, resumo, itens });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await initDB();
    const session = await getSession();
    if (!podeEditarFinanceiro(session ?? {})) {
      return NextResponse.json({ error: 'Sem permissao' }, { status: 403 });
    }
    const tenantId = await getTenantId();
    const body = await req.json();

    const plataforma = String(body.plataforma ?? '');
    const idTransacao = String(body.id_transacao ?? '');
    if (!plataforma || !idTransacao) {
      return NextResponse.json({ error: 'Informe a plataforma e a transação.' }, { status: 400 });
    }

    const acao = String(body.acao ?? '');
    if (acao === 'vincular') {
      const unificacao = await vincularVenda(tenantId, plataforma, idTransacao, String(body.venda_id ?? ''));
      return NextResponse.json({ ok: true, unificacao });
    }
    if (acao === 'direta') {
      const desfeito = await marcarVendaDireta(tenantId, plataforma, idTransacao);
      return NextResponse.json({ ok: true, ...desfeito });
    }
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (e) {
    const status = e instanceof ErroPlataforma ? 400 : 500;
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status });
  }
}
