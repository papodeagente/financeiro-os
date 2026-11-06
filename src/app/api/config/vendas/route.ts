import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarChaveDaAgencia } from '@/lib/encargos-servidor';
import { lerConfigVenda, normalizarConfigVenda } from '@/lib/venda-servidor';
import { FORMAS_LIQUIDAVEIS } from '@/lib/venda-liquidar-auto';

// Configurações › Vendas (E5; E7): quais componentes contam como receita da
// agência, se a taxa do cartão sai da receita, e dinheiro/cheque liquidados
// sozinhos. Guardada em agencia.data.venda_config.
//   GET → { receita: { componentes: { COMISSAO: true, ... }, taxa_cartao: true },
//           liquidar_automaticamente: { DINHEIRO: { ligado, conta_bancaria_id }, CHEQUE: { ... } } }
//   PUT (só administrador) o mesmo formato (o que não vier fica como está) → o GET atualizado.
export const dynamic = 'force-dynamic';

export async function GET() {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  return NextResponse.json(await lerConfigVenda(pool as unknown as ExecutorSQL, await getTenantId()));
}

export async function PUT(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  const tenantId = await getTenantId();
  const exec = pool as unknown as ExecutorSQL;
  const atual = await lerConfigVenda(exec, tenantId);
  const nova = normalizarConfigVenda({ ...atual, ...corpo });
  // A conta padrão da liquidação automática precisa ser desta agência.
  for (const f of FORMAS_LIQUIDAVEIS) {
    const conta = nova.liquidar_automaticamente[f].conta_bancaria_id;
    if (!conta) continue;
    const { rows } = await exec.query(`SELECT 1 FROM contas_bancarias WHERE tenant_id = $1 AND id = $2`, [tenantId, conta]);
    if (!rows.length) return NextResponse.json({ error: 'Escolha uma conta bancária desta agência para a liquidação automática.' }, { status: 400 });
  }
  await emTransacao(e => gravarChaveDaAgencia(e, tenantId, 'venda_config', nova));
  return NextResponse.json(await lerConfigVenda(exec, tenantId));
}
