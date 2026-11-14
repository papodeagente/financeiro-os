import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { ErroContaPrevisao, gravarContaPrevisaoPadrao, lerContaPrevisaoPadrao, lerContasPrevisaoPorEmpresa } from '@/lib/conta-previsao-servidor';
import { empresaDoPedido } from '@/lib/empresas-rota';

// Configurações › Financeiro › Conta previsão padrão (06/11/2026, E7).
// Por empresa (E7, frente D): ?empresa=<id> lê e grava a daquela empresa;
// sem o parâmetro, a de sempre, mais `por_empresa` (a de cada empresa que
// escolheu a própria) para o fluxo de caixa.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ conta_previsao_padrao: null });
  const { empresa, recusa: recusaEmpresa } = await empresaDoPedido(req);
  if (recusaEmpresa) return recusaEmpresa;
  const tenantId = await getTenantId();
  const exec = pool as unknown as ExecutorSQL;
  if (empresa) return NextResponse.json({ conta_previsao_padrao: await lerContaPrevisaoPadrao(exec, tenantId, empresa), empresa_id: empresa });
  const porEmpresa = await lerContasPrevisaoPorEmpresa(exec, tenantId);
  return NextResponse.json({
    conta_previsao_padrao: await lerContaPrevisaoPadrao(exec, tenantId),
    ...(Object.keys(porEmpresa).length ? { por_empresa: porEmpresa } : {}),
  });
}

export async function PUT(req: Request) {
  const recusa = await recusaAdmin();
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { empresa, recusa: recusaEmpresa } = await empresaDoPedido(req);
  if (recusaEmpresa) return recusaEmpresa;
  const corpo = (await req.json().catch(() => ({}))) as { conta_previsao_padrao?: unknown };
  const tenantId = await getTenantId();
  try {
    const id = await emTransacao(exec => gravarContaPrevisaoPadrao(exec, tenantId, corpo.conta_previsao_padrao ?? null, empresa));
    return NextResponse.json({ conta_previsao_padrao: id });
  } catch (e) {
    if (e instanceof ErroContaPrevisao) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
