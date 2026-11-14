import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarEmissao, hojeEmBrasilia, previaDaEmissao, type PedidoDeEmissao } from '@/lib/cobranca/servidor';
import { chaveDe, cobrancaParaTela, lerCorpo, previaParaTela, quemEsta, respostaDeErroDaCobranca } from '@/lib/cobranca/rota';

// Link de pagamento de UMA conta a receber (E3, 05/11/2026): o cliente escolhe como pagar na página do
// provedor. Vale pelos dias de "validade do link" em Configurações › Cobrança.
//   POST { modo: 'previa' | 'gravar', conta_id, provedor?, descricao?, assinatura? }
//        prévia → como em /api/cobrancas; gravar → a cobrança (tipo 'link', com `url_link`).
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  const corpo = await lerCorpo<{ modo?: string; conta_id?: string; provedor?: PedidoDeEmissao['provedor']; descricao?: string; assinatura?: string }>(req);
  if (!corpo?.conta_id) return NextResponse.json({ error: 'Informe a conta a receber.' }, { status: 400 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const tenantId = await getTenantId();
  const pedido: PedidoDeEmissao = { itens: [{ conta_id: corpo.conta_id }], provedor: corpo.provedor, tipo: 'link', descricao: corpo.descricao };
  try {
    const previa = await previaDaEmissao(pool as unknown as ExecutorSQL, tenantId, pedido, hojeEmBrasilia());
    if (corpo.modo !== 'gravar') return NextResponse.json(previaParaTela(previa));
    const recusaConta = await recusaAcao('gerar_boletos', { contaBancariaId: previa.conta_bancaria_id });
    if (recusaConta) return recusaConta;
    const r = await gravarEmissao(tenantId, pedido, { assinatura: corpo.assinatura, quem: await quemEsta(), idempotencia: chaveDe(req) });
    return NextResponse.json(cobrancaParaTela(r.cobrancas[0]));
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'link');
  }
}
