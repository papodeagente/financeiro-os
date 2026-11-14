import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { hojeISO } from '@/lib/money';
import { lerPedidoDeEmissao, SITUACOES_DO_CHEQUE, type SituacaoDoCheque } from '@/lib/cheques';
import { emitirChequeDoTitulo, listarCheques, totaisDosCheques } from '@/lib/cheques-servidor';
import { contasDoCheque, respostaDoErro } from '@/lib/cheques-rota';

/**
 * Cheques emitidos (E7, frente C).
 *   GET  ?conta=&situacao=EMITIDO|COMPENSADO|DEVOLVIDO|CANCELADO&data_de=emissao|bom_para&de=&ate=&busca=&titulo_id=
 *        → { cheques, totais, contas_liberadas } (só das contas que a pessoa enxerga)
 *   POST { titulo_id, conta_bancaria_id, numero, emissao?, bom_para?, favorecido?, cidade?, valor_centavos? }
 *        → emite o cheque de uma conta a pagar em aberto (valor padrão: o que falta pagar).
 * Direitos: listar = ver saldo e extrato; emitir = dar baixa em contas a pagar e
 * usar a conta bancária escolhida.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const semModulo = await recusaModulo('cheques');
  if (semModulo) return semModulo;
  const recusa = (await recusaFinanceira('ler')) ?? (await recusaAcao('ver_conta_bancaria'));
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  const sessao = (await getSession())!;
  const tenantId = await getTenantId();
  const u = new URL(req.url).searchParams;
  const sit = (u.get('situacao') ?? '').toUpperCase();
  try {
    const contas = await contasDoCheque(exec, tenantId, sessao);
    const cheques = await listarCheques(exec, tenantId, {
      conta_bancaria_id: u.get('conta') ?? undefined,
      situacao: (SITUACOES_DO_CHEQUE as readonly string[]).includes(sit) ? (sit as SituacaoDoCheque) : '',
      data_de: u.get('data_de') === 'bom_para' ? 'bom_para' : 'emissao',
      de: u.get('de') ?? undefined, ate: u.get('ate') ?? undefined,
      busca: u.get('busca') ?? undefined, titulo_id: u.get('titulo_id') ?? undefined,
    }, contas);
    return NextResponse.json({ cheques, totais: totaisDosCheques(cheques), contas_liberadas: contas ? [...contas] : null });
  } catch (e) {
    return respostaDoErro(e, 'listar');
  }
}

export async function POST(req: Request) {
  const semModulo = await recusaModulo('cheques');
  if (semModulo) return semModulo;
  const recusa = (await recusaFinanceira('escrever')) ?? (await recusaAcao('liquidar_pagar'));
  if (recusa) return recusa;
  const corpo = await req.json().catch(() => null);
  const lido = lerPedidoDeEmissao(corpo, hojeISO());
  if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const naConta = await recusaAcao('movimentar_conta_bancaria', { contaBancariaId: lido.pedido.conta_bancaria_id });
  if (naConta) return naConta;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const sessao = (await getSession())!;
  const tenantId = await getTenantId();
  try {
    const contas = await contasDoCheque(pool as unknown as ExecutorSQL, tenantId, sessao);
    const cheque = await emTransacao(exec => emitirChequeDoTitulo(exec, tenantId, lido.pedido, { id: sessao.userId ?? '', nome: sessao.nome ?? '' }, contas));
    // O registro de quem emitiu fica na auditoria (a tabela é auditada) e em criado_por.
    return NextResponse.json(cheque, { status: 201 });
  } catch (e) {
    return respostaDoErro(e, 'emitir');
  }
}
