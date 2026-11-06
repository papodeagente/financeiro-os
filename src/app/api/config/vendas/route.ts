import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarChaveDaAgencia } from '@/lib/encargos-servidor';
import { lerConfigVenda, normalizarConfigVenda } from '@/lib/venda-servidor';

// Configurações › Vendas (E5): quais componentes contam como receita da
// agência e (E7) o texto do recibo da venda. Guardada em agencia.data.venda_config.
//   GET → { receita: { componentes: { COMISSAO: true, OVER: true, TAXA_DU: true, ... } },
//           recibo: { texto, complemento } }
//   PUT (só administrador) o mesmo formato, inteiro ou só uma parte (a outra
//   fica como está) → o GET atualizado.
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
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  const tenantId = await getTenantId();
  await emTransacao(async exec => {
    // Chaves que outras partes guardem em venda_config ficam como estão.
    const { rows } = await exec.query(
      `SELECT data->'venda_config' AS c FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`, [tenantId],
    );
    const bruto = rows[0]?.c && typeof rows[0].c === 'object' ? rows[0].c as Record<string, unknown> : {};
    await gravarChaveDaAgencia(exec, tenantId, 'venda_config', { ...bruto, ...normalizarConfigVenda(corpo, await lerConfigVenda(exec, tenantId)) });
  });
  return NextResponse.json(await lerConfigVenda(pool as unknown as ExecutorSQL, tenantId));
}
