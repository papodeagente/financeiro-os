import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { gravarCarne, hojeEmBrasilia, previaDoCarne, type PedidoDeCarneNaTela } from '@/lib/cobranca/servidor';
import {
  chaveDe, cobrancaParaTela, lerCorpo, previaDoCarneParaTela, quemEsta, respostaDeErroDaCobranca,
} from '@/lib/cobranca/rota';

// Carnê (E3, 05/11/2026): várias parcelas do MESMO cliente, mesmo valor, vencendo no mesmo dia de meses
// seguidos, num parcelamento do provedor (só onde existe: Asaas; senão 409 com codigo SEM_CARNE).
//   POST { modo: 'previa' | 'gravar', contas: string[] (ou conta_ids), provedor?, descricao?, assinatura? }
//        cabeçalho Idempotency-Key ao gravar
//        prévia → { provedor, capacidades, cliente_nome, parcelas: [{ conta_id, numero, valor, vencimento, ok, motivo }],
//                   erros, valor_parcela, primeiro_vencimento, total, assinatura }
//        gravar → { carne_id, url_carne (PDF: GET /api/cobrancas/<id de uma parcela>/carne), cobrancas: ids, parcelas }
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('cobranca');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return recusa;
  const corpo = await lerCorpo<Partial<PedidoDeCarneNaTela> & { contas?: string[]; modo?: string; assinatura?: string }>(req);
  const contas = Array.isArray(corpo?.contas) ? corpo!.contas : Array.isArray(corpo?.conta_ids) ? corpo!.conta_ids : null;
  if (!corpo || !contas) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const tenantId = await getTenantId();
  const pedido: PedidoDeCarneNaTela = { conta_ids: contas.map(String), provedor: corpo.provedor || undefined, descricao: corpo.descricao };
  try {
    const previa = await previaDoCarne(pool as unknown as ExecutorSQL, tenantId, pedido, hojeEmBrasilia());
    if (corpo.modo !== 'gravar') return NextResponse.json(previaDoCarneParaTela(previa));
    const recusaConta = await recusaAcao('gerar_boletos', { contaBancariaId: previa.conta_bancaria_id });
    if (recusaConta) return recusaConta;
    const r = await gravarCarne(tenantId, pedido, { assinatura: corpo.assinatura, quem: await quemEsta(), idempotencia: chaveDe(req) });
    const primeira = r.cobrancas.find(c => c.carne_id_externo);
    return NextResponse.json({
      carne_id: r.carne_id,
      url_carne: primeira ? `/api/cobrancas/${encodeURIComponent(primeira.id)}/carne` : null,
      cobrancas: r.cobrancas.map(c => c.id),
      parcelas: r.cobrancas.map(c => cobrancaParaTela(c)),
    });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'carnê');
  }
}
