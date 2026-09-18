import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { podeEditarFinanceiro } from '@/lib/permissoes';
import { round2, num, hojeISO, addMeses, mesDe } from '@/lib/money';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gerarParcelas, MAX_PARCELAS, type CompraCartao } from '@/lib/cartao-lancamentos';
import type { CartaoCorporativo } from '@/lib/crm-types';

/**
 * Lança despesa no cartão.
 *
 * Gera uma conta a pagar POR PARCELA, com id determinístico, para a fatura
 * do mês seguinte reconhecer a mesma compra em vez de duplicar.
 *
 * Despesa de cartão nasce PENDENTE e NÃO move o caixa: quem move é o
 * pagamento da fatura. Creditar aqui debitaria o banco duas vezes, uma na
 * compra e outra na fatura.
 */

interface CorpoLancamento {
  cartao_id: string;
  descricao: string;
  valor_total: number;
  data_compra: string;
  parcelas: number;
  categoria_id?: string;
  fornecedor_nome?: string;
  observacoes?: string;
}

async function carregarCartao(tenantId: string, cartaoId: string): Promise<CartaoCorporativo | null> {
  if (!pool) return null;
  const { rows } = await pool.query(
    `SELECT data FROM cartoes_corp WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [cartaoId, tenantId],
  );
  return (rows[0]?.data ?? null) as CartaoCorporativo | null;
}

function montarConta(
  compra: CompraCartao,
  p: ReturnType<typeof gerarParcelas>[number],
) {
  return {
    id: p.id,
    origem: 'OUTROS',
    venda_id: null,
    grupo_id: null,
    fornecedor_id: '',
    fornecedor_nome: compra.fornecedor_nome || '',
    descricao: p.descricao,
    categoria_id: compra.categoria_id || '',
    centro_custo: '',
    valor_original: p.valor,
    juros: 0, multa: 0, desconto: 0,
    valor_final: p.valor,
    moeda: 'BRL', cambio: 1, valor_brl: p.valor,
    data_emissao: compra.data_compra,
    data_vencimento: p.data_vencimento,
    // PENDENTE de propósito: o caixa só se move no pagamento da fatura.
    data_pagamento: null,
    valor_pago: null,
    conta_bancaria_id: null,
    forma_pagamento: 'CARTAO_CORP',
    cartao_id: compra.cartao_id,
    parcela_numero: p.parcela_numero,
    total_parcelas: p.total_parcelas,
    status: 'PENDENTE',
    natureza_custo: 'VARIAVEL',
    is_custo_comercial: false,
    rateio: [], anexos: [],
    observacoes: compra.observacoes || '',
    // Identidade da compra: é o que a importação da fatura usa para
    // reconhecer a série em vez de criar despesa nova todo mês.
    compra_id: p.compra_id,
  };
}

export async function POST(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const session = await getSession();
    if (!podeEditarFinanceiro(session ?? {})) {
      return NextResponse.json({ error: 'Sem permissao' }, { status: 403 });
    }
    const tenantId = await getTenantId();
    const body = await req.json();

    // Duas entradas, um caminho de gravação só: a compra manual e a
    // importação da fatura viram a mesma coisa, então não há duas regras
    // de parcela para divergirem.
    const compras: CorpoLancamento[] = Array.isArray(body.compras)
      ? body.compras
      : [body as CorpoLancamento];

    const cartaoId = String(compras[0]?.cartao_id ?? '');
    if (!cartaoId) return NextResponse.json({ error: 'Escolha o cartão.' }, { status: 400 });

    const cartao = await carregarCartao(tenantId, cartaoId);
    if (!cartao) return NextResponse.json({ error: 'Cartão não encontrado.' }, { status: 404 });
    const diaVencimento = num(cartao.dia_vencimento) || 10;

    for (const c of compras) {
      if (!String(c.descricao ?? '').trim()) {
        return NextResponse.json({ error: 'Toda despesa precisa de descrição.' }, { status: 400 });
      }
      if (round2(num(c.valor_total)) <= 0) {
        return NextResponse.json({ error: `"${c.descricao}" está sem valor.` }, { status: 400 });
      }
      const n = Math.trunc(num(c.parcelas) || 1);
      if (n < 1 || n > MAX_PARCELAS) {
        return NextResponse.json({ error: `Parcelas devem ser de 1 a ${MAX_PARCELAS}.` }, { status: 400 });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.data_compra ?? ''))) {
        return NextResponse.json({ error: `"${c.descricao}" está sem data de compra.` }, { status: 400 });
      }
    }

    const resultado = await emTransacao(async (exec: ExecutorSQL) => {
      let criadas = 0, jaExistiam = 0;
      for (const c of compras) {
        const compra: CompraCartao = {
          cartao_id: cartaoId,
          descricao: String(c.descricao).trim(),
          valor_total: round2(num(c.valor_total)),
          data_compra: String(c.data_compra),
          categoria_id: String(c.categoria_id ?? ''),
          fornecedor_nome: String(c.fornecedor_nome ?? ''),
          parcelas: Math.trunc(num(c.parcelas) || 1),
          observacoes: String(c.observacoes ?? ''),
        };
        for (const p of gerarParcelas(compra, diaVencimento)) {
          const conta = montarConta(compra, p);
          // DO NOTHING pelo id determinístico: reimportar a mesma fatura,
          // ou clicar duas vezes, não cria a parcela de novo.
          const r = await exec.query(
            `INSERT INTO contas_pagar (id, fornecedor_id, status, data, tenant_id, created_at, updated_at)
             VALUES ($1, '', 'PENDENTE', $2::jsonb, $3, NOW(), NOW())
             ON CONFLICT (id) DO NOTHING`,
            [conta.id, JSON.stringify(conta), tenantId],
          );
          if ((r.rowCount ?? 0) > 0) criadas++; else jaExistiam++;
        }
      }
      return { criadas, jaExistiam };
    });

    return NextResponse.json({ ok: true, ...resultado });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Painel de inteligência do cartão: para onde o dinheiro está indo. */
export async function GET(req: Request) {
  try {
    await initDB();
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const session = await getSession();
    if (!podeEditarFinanceiro(session ?? {})) {
      return NextResponse.json({ error: 'Sem permissao' }, { status: 403 });
    }
    const tenantId = await getTenantId();
    const cartaoId = new URL(req.url).searchParams.get('cartao_id') ?? '';

    const { rows } = await pool.query(
      `SELECT id, data FROM contas_pagar
        WHERE tenant_id = $1
          AND COALESCE(data->>'cartao_id', '') <> ''
          AND ($2 = '' OR data->>'cartao_id' = $2)
          AND COALESCE(data->>'status', '') <> 'CANCELADO'`,
      [tenantId, cartaoId],
    );

    const lancamentos = rows.map(r => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return {
        id: String(r.id),
        descricao: String(d.descricao ?? ''),
        valor: round2(num(d.valor_final)),
        categoria_id: String(d.categoria_id ?? ''),
        cartao_id: String(d.cartao_id ?? ''),
        competencia: mesDe(String(d.data_vencimento ?? '')),
        parcela_numero: num(d.parcela_numero) || 1,
        total_parcelas: num(d.total_parcelas) || 1,
        pago: String(d.status ?? '') === 'PAGO',
      };
    });

    return NextResponse.json({ lancamentos, mes_atual: mesDe(hojeISO()), proximo: mesDe(addMeses(hojeISO(), 1)) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro interno';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
