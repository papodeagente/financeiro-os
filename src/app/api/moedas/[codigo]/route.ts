// Editar uma moeda da agência (nome, símbolo, casas, ativa). O código não
// muda; as oito do sistema não se editam. Desativar só tira das escolhas: o
// que já foi gravado nela continua lido nela.
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { ErroMoeda, salvarMoedaDaAgencia } from '@/lib/moedas-servidor';
import { normalizarCodigo } from '@/lib/moedas';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const semModulo = await recusaModulo('cambio');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { codigo } = await params;
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return NextResponse.json({ error: 'Formato inválido' }, { status: 400 });
  const tenantId = await getTenantId();
  try {
    const moeda = await emTransacao(exec => salvarMoedaDaAgencia(exec, tenantId, corpo as Record<string, unknown>, normalizarCodigo(codigo)));
    return NextResponse.json({ moeda });
  } catch (e) {
    if (e instanceof ErroMoeda) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
