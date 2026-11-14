import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { ACOES_DO_CHEQUE, acoesPossiveis, desenharCheque, type AcaoDoCheque } from '@/lib/cheques';
import { lerCheque, lerConfigDoCheque, marcarImpresso, mudarSituacao, sugestoesDoExtrato } from '@/lib/cheques-servidor';
import { contasDoCheque, respostaDoErro } from '@/lib/cheques-rota';

/**
 * Um cheque (E7, frente C).
 *   GET   → { cheque, desenho (o cheque em mm, com o ajuste da conta), config, acoes, sugestoes_do_extrato }
 *   PATCH { acao: 'compensar', data?, extrato_id? } | { acao: 'devolver'|'cancelar', motivo } | { acao: 'marcar_impresso' }
 * Direitos: ver = ver saldo e extrato na conta do cheque; mudar = dar baixa em
 * contas a pagar e usar a conta do cheque.
 */
export const dynamic = 'force-dynamic';

type Contexto = { params: Promise<{ id: string }> };

async function carregar(id: string) {
  await initDB();
  if (!pool) return { erro: NextResponse.json({ error: 'Banco indisponível' }, { status: 503 }) } as const;
  const exec = pool as unknown as ExecutorSQL;
  const sessao = (await getSession())!;
  const tenantId = await getTenantId();
  const cheque = await lerCheque(exec, tenantId, id);
  const contas = await contasDoCheque(exec, tenantId, sessao);
  // Cheque de conta que a pessoa não enxerga responde como se não existisse.
  if (!cheque || (contas && !contas.has(cheque.conta_bancaria_id))) {
    return { erro: NextResponse.json({ error: 'Cheque não encontrado.' }, { status: 404 }) } as const;
  }
  return { exec, sessao, tenantId, cheque } as const;
}

export async function GET(_req: Request, { params }: Contexto) {
  const recusa = (await recusaFinanceira('ler')) ?? (await recusaAcao('ver_conta_bancaria'));
  if (recusa) return recusa;
  const { id } = await params;
  try {
    const c = await carregar(id);
    if ('erro' in c) return c.erro;
    const cfg = await lerConfigDoCheque(c.exec, c.tenantId, c.cheque.conta_bancaria_id);
    const config = cfg?.config;
    const desenho = c.cheque.valor_centavos > 0
      ? desenharCheque({ valor_centavos: c.cheque.valor_centavos, favorecido: c.cheque.favorecido, cidade: c.cheque.cidade || config?.cidade_padrao || '', data: c.cheque.bom_para || c.cheque.emissao }, config)
      : null;
    const sugestoes = c.cheque.situacao === 'EMITIDO' || c.cheque.situacao === 'DEVOLVIDO' ? await sugestoesDoExtrato(c.exec, c.tenantId, c.cheque) : [];
    return NextResponse.json({ cheque: c.cheque, desenho, config: config ?? null, acoes: acoesPossiveis(c.cheque.situacao), sugestoes_do_extrato: sugestoes });
  } catch (e) {
    return respostaDoErro(e, 'ler');
  }
}

export async function PATCH(req: Request, { params }: Contexto) {
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  const { id } = await params;
  const corpo = (await req.json().catch(() => null)) as { acao?: string; data?: string; motivo?: string; extrato_id?: string } | null;
  const acao = String(corpo?.acao ?? '');
  if (acao !== 'marcar_impresso' && !(ACOES_DO_CHEQUE as readonly string[]).includes(acao)) {
    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  }
  try {
    const c = await carregar(id);
    if ('erro' in c) return c.erro;
    const direito = (await recusaAcao('liquidar_pagar'))
      ?? (await recusaAcao('movimentar_conta_bancaria', { contaBancariaId: c.cheque.conta_bancaria_id }));
    if (direito) return direito;
    if (acao === 'marcar_impresso') {
      const cheque = await emTransacao(exec => marcarImpresso(exec, c.tenantId, id));
      return NextResponse.json({ cheque, aviso: null });
    }
    const quem = { id: c.sessao.userId ?? '', nome: c.sessao.nome ?? '' };
    const r = await emTransacao(exec => mudarSituacao(exec, c.tenantId, id, {
      acao: acao as AcaoDoCheque, data: corpo?.data, motivo: corpo?.motivo, extrato_id: corpo?.extrato_id || null,
    }, quem));
    return NextResponse.json(r);
  } catch (e) {
    return respostaDoErro(e, 'situação');
  }
}
