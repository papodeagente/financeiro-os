import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarChaveDaAgencia } from '@/lib/encargos-servidor';
import { lerConfigVenda, normalizarConfigVenda } from '@/lib/venda-servidor';
import { temConfigPropria, type ExecutorEmpresas } from '@/lib/empresas-servidor';
import { empresaDoPedido } from '@/lib/empresas-rota';

// ?empresa=<id> (E7): a configuração daquela empresa.
async function resposta(exec: ExecutorSQL, tenantId: string, empresa: string | null) {
  const config = await lerConfigVenda(exec, tenantId, empresa);
  if (!empresa) return config;
  return { ...config, empresa_id: empresa, ...(await temConfigPropria(exec as unknown as ExecutorEmpresas, tenantId, empresa, 'vendas')) };
}

// Configurações › Vendas (E5): quais componentes contam como receita da
// agência. Guardada em agencia.data.venda_config.
//   GET → { receita: { componentes: { COMISSAO: true, OVER: true, TAXA_DU: true, ... } } }
//   PUT (só administrador) o mesmo formato → o GET atualizado.
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
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  const tenantId = await getTenantId();
  const { empresa, recusa: recusaEmpresa } = await empresaDoPedido(req);
  if (recusaEmpresa) return recusaEmpresa;
  await emTransacao(exec => gravarChaveDaAgencia(exec, tenantId, 'venda_config', normalizarConfigVenda(corpo), empresa));
  return NextResponse.json(await resposta(pool as unknown as ExecutorSQL, tenantId, empresa));
}
