import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { recusaAcao, recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { vendaAutorizada } from '@/lib/venda-autorizada';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import { lancarAvulsaDaVenda } from '@/lib/venda-avulsas';
import { montarFicha, respostaDeErroDaVenda, usuarioDa } from '@/lib/venda-rota';

// Contas avulsas ligadas à venda (E7): pagamento avulso ao fornecedor e
// contas a pagar/receber que nascem por causa da venda.
//   POST { tipo: 'pagamento_fornecedor'|'pagar'|'receber', pessoa: { id, nome }, valor_centavos,
//          vencimento: 'AAAA-MM-DD', descricao?, categoria_id?, observacoes? }
//   → 201 { conta_id, tabela, avisos, ficha }
// Direitos: lançar no financeiro e ver o financeiro dentro da venda.
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = (await recusaFinanceira('escrever')) ?? (await recusaAcao('ver_aba_financeiro'));
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const acesso = await vendaAutorizada(id);
  if (acesso instanceof NextResponse) return acesso;
  const corpo = await req.json().catch(() => null);
  try {
    const r = await emTransacao(e => lancarAvulsaDaVenda(e, acesso.tenantId, id, corpo, usuarioDa(acesso.sessao)));
    return NextResponse.json({ ...r, ficha: await montarFicha(pool as unknown as ExecutorSQL, acesso.tenantId, id, acesso.sessao) }, { status: 201 });
  } catch (e) {
    return respostaDeErroDaVenda(e);
  }
}
