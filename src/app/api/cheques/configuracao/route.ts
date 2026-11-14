import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { lerConfigDoCheque, salvarConfigDoCheque } from '@/lib/cheques-servidor';
import { contasDoCheque, respostaDoErro } from '@/lib/cheques-rota';

/**
 * Ajuste do cheque por conta bancária (E7, frente C): margens (geral e por
 * campo), cidade padrão e o último número do talão. Fica em
 * contas_bancarias.data.cheque; o resto da conta não muda.
 *   GET ?conta=ID → { conta_nome, config, proximo_numero }
 *   PUT { conta_bancaria_id, deslocar_x_mm?, deslocar_y_mm?, campos?, cidade_padrao?, ultimo_numero? }
 */
export const dynamic = 'force-dynamic';

async function contaVisivel(contaId: string): Promise<NextResponse | null> {
  const sessao = (await getSession())!;
  const contas = await contasDoCheque(pool as unknown as ExecutorSQL, await getTenantId(), sessao);
  if (contas && !contas.has(contaId)) return NextResponse.json({ error: 'Esta conta bancária não está liberada para você.' }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const semModulo = await recusaModulo('cheques');
  if (semModulo) return semModulo;
  const conta = (new URL(req.url).searchParams.get('conta') ?? '').trim();
  if (!conta) return NextResponse.json({ error: 'Escolha a conta bancária.' }, { status: 400 });
  const recusa = (await recusaFinanceira('ler')) ?? (await recusaAcao('ver_conta_bancaria', { contaBancariaId: conta }));
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  try {
    const fora = await contaVisivel(conta);
    if (fora) return fora;
    const r = await lerConfigDoCheque(pool as unknown as ExecutorSQL, await getTenantId(), conta);
    if (!r) return NextResponse.json({ error: 'Conta bancária não encontrada.' }, { status: 404 });
    return NextResponse.json(r);
  } catch (e) {
    return respostaDoErro(e, 'configuração');
  }
}

export async function PUT(req: Request) {
  const semModulo = await recusaModulo('cheques');
  if (semModulo) return semModulo;
  const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const conta = String(corpo?.conta_bancaria_id ?? '').trim();
  if (!conta) return NextResponse.json({ error: 'Escolha a conta bancária.' }, { status: 400 });
  const recusa = (await recusaFinanceira('escrever')) ?? (await recusaAcao('movimentar_conta_bancaria', { contaBancariaId: conta }));
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  try {
    const fora = await contaVisivel(conta);
    if (fora) return fora;
    const tenantId = await getTenantId();
    const resto: Record<string, unknown> = { ...(corpo ?? {}) };
    delete resto.conta_bancaria_id;
    const config = await emTransacao(exec => salvarConfigDoCheque(exec, tenantId, conta, resto));
    return NextResponse.json({ config });
  } catch (e) {
    return respostaDoErro(e, 'configuração');
  }
}
