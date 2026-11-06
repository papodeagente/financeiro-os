import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarChaveDaAgencia } from '@/lib/encargos-servidor';
import { lerConfigVenda, normalizarConfigVenda } from '@/lib/venda-servidor';
import { FORMAS_LIQUIDAVEIS } from '@/lib/venda-liquidar-auto';
import { temConfigPropria, type ExecutorEmpresas } from '@/lib/empresas-servidor';
import { empresaDoPedido } from '@/lib/empresas-rota';

// ?empresa=<id> (E7): a configuração daquela empresa.
async function resposta(exec: ExecutorSQL, tenantId: string, empresa: string | null) {
  const config = await lerConfigVenda(exec, tenantId, empresa);
  if (!empresa) return config;
  return { ...config, empresa_id: empresa, ...(await temConfigPropria(exec as unknown as ExecutorEmpresas, tenantId, empresa, 'vendas')) };
}

// Configurações › Vendas (E5; E7): quais componentes contam como receita da
// agência, se a taxa do cartão sai da receita, o texto do recibo da venda e
// dinheiro/cheque liquidados sozinhos. Guardada em agencia.data.venda_config.
//   GET → { receita: { componentes: { COMISSAO: true, ... }, taxa_cartao: true },
//           recibo: { texto, complemento },
//           liquidar_automaticamente: { DINHEIRO: { ligado, conta_bancaria_id }, CHEQUE: { ... } } }
//   PUT (só administrador) o mesmo formato, inteiro ou só uma parte (o que não
//   vier fica como está) → o GET atualizado.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { empresa, recusa: recusaEmpresa } = await empresaDoPedido(req);
  if (recusaEmpresa) return recusaEmpresa;
  return NextResponse.json(await resposta(pool as unknown as ExecutorSQL, await getTenantId(), empresa));
}

export async function PUT(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  const tenantId = await getTenantId();
  const { empresa, recusa: recusaEmpresa } = await empresaDoPedido(req);
  if (recusaEmpresa) return recusaEmpresa;
  const exec = pool as unknown as ExecutorSQL;
  const nova = normalizarConfigVenda(corpo, await lerConfigVenda(exec, tenantId, empresa));
  // A conta padrão da liquidação automática precisa ser desta agência.
  for (const f of FORMAS_LIQUIDAVEIS) {
    const conta = nova.liquidar_automaticamente[f].conta_bancaria_id;
    if (!conta) continue;
    const { rows } = await exec.query(`SELECT 1 FROM contas_bancarias WHERE tenant_id = $1 AND id = $2`, [tenantId, conta]);
    if (!rows.length) return NextResponse.json({ error: 'Escolha uma conta bancária desta agência para a liquidação automática.' }, { status: 400 });
  }
  await emTransacao(async e => {
    if (empresa) {
      await gravarChaveDaAgencia(e, tenantId, 'venda_config', nova, empresa);
      return;
    }
    // Chaves que outras partes guardem em venda_config ficam como estão.
    const { rows } = await e.query(
      `SELECT data->'venda_config' AS c FROM agencia WHERE tenant_id = $1 ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1`, [tenantId],
    );
    const bruto = rows[0]?.c && typeof rows[0].c === 'object' ? rows[0].c as Record<string, unknown> : {};
    await gravarChaveDaAgencia(e, tenantId, 'venda_config', { ...bruto, ...nova });
  });
  return NextResponse.json(await resposta(exec, tenantId, empresa));
}
