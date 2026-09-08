import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { round2, num, somaPor } from '@/lib/money';
import {
  calcularResultado,
  type ContaReceberMin,
  type ContaPagarMin,
} from '@/lib/resultado-financeiro';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initDB();
    const { id } = await params;
    if (!pool) return NextResponse.json({ error: 'No database' }, { status: 500 });
    const tenantId = await getTenantId();

    // Fetch venda, itens, contas in parallel
    const [vendaRes, itensRes, crRes, cpRes] = await Promise.all([
      pool.query(
        `SELECT data FROM vendas_crm WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      ),
      pool.query(
        `SELECT data FROM itens_venda WHERE venda_id = $1 AND tenant_id = $2 ORDER BY sequencia ASC`,
        [id, tenantId],
      ),
      // Todas as contas da venda, geradas automaticamente ou lançadas à mão.
      // O filtro auto_gerado='true' escondia do resumo qualquer ajuste manual
      // (taxa de emissão, custo extra do fornecedor), então a ficha da venda
      // mostrava uma margem que nenhuma outra tela confirmava.
      pool.query(
        `SELECT data FROM contas_receber
          WHERE tenant_id = $1
            AND (data->>'origem_venda_id' = $2 OR venda_id = $2)`,
        [tenantId, id],
      ),
      pool.query(
        `SELECT data FROM contas_pagar
          WHERE tenant_id = $1
            AND (data->>'origem_venda_id' = $2 OR data->>'venda_id' = $2)`,
        [tenantId, id],
      ),
    ]);

    if (vendaRes.rows.length === 0) {
      return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 });
    }

    const venda = vendaRes.rows[0].data;
    const itens = itensRes.rows.map(r => r.data);
    const contas_receber = crRes.rows.map(r => r.data);
    const contas_pagar = cpRes.rows.map(r => r.data);

    // Resumo pela FONTE ÚNICA DA VERDADE (src/lib/resultado-financeiro.ts).
    //
    // A versão anterior filtrava status === 'RECEBIDO' e ignorava PARCIAL:
    // uma venda com entrada paga mostrava recebido zero e lucro realizado
    // negativo. Também somava com reduce, acumulando erro de centavo.
    //
    // A baseline vem da própria venda, gravada quando as contas foram
    // geradas. É o que permite dizer que o custo estourou o orçado: as
    // contas a pagar de hoje já foram reescritas com o valor novo.
    // Custo da venda que não tem conta a pagar correspondente.
    //
    // Conta a pagar só nasce com fornecedor real. O custo de um item sem
    // fornecedor identificado continua valendo para a margem (margem é venda
    // menos custo), então entra aqui para não sumir do cálculo. Nas vendas
    // com fornecedor detalhado a diferença é zero e nada muda.
    const custoLancado = somaPor(contas_pagar as ContaPagarMin[], c => num(c.valor_final));
    const custoDaVenda = round2(num(venda?.valor_total_custo));
    const custoSemConta = Math.max(0, round2(custoDaVenda - custoLancado));

    const resultado = calcularResultado({
      contas_receber: contas_receber as ContaReceberMin[],
      contas_pagar: contas_pagar as ContaPagarMin[],
      custo_sem_conta: custoSemConta,
      baseline: {
        margem: venda?.margem_prevista_original ?? null,
        custo: venda?.custo_previsto_original ?? null,
      },
    });

    return NextResponse.json({
      venda,
      itens,
      contas_receber,
      contas_pagar,
      resultado,
      // Campos antigos mantidos para não quebrar telas que já os consomem.
      // Os valores agora respeitam baixa parcial e conta cancelada.
      resumo: {
        total_receber: round2(resultado.recebido + resultado.a_receber),
        total_recebido: resultado.recebido,
        total_pendente_receber: resultado.a_receber,
        total_pagar: resultado.custo_previsto,
        total_pago: resultado.custo_pago,
        total_pendente_pagar: resultado.custo_pendente,
        lucro_previsto: resultado.margem_prevista,
        lucro_realizado: resultado.margem_realizada,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
