import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao, type ExecutorSQL } from '@/lib/caixa-atomico';
import {
  adicionarItens, corrigirValor, faturarAvulso, marcarConferido, moverItens, responderContestacao, tirarItens,
} from '@/lib/fatura-servidor';
import { lerJson, montarFichaDaFatura, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// Ações nos itens da fatura:
//   { acao: 'mover', conta_ids, vencimento }        → outra fatura do pagante com esse vencimento (cria, se não houver)
//   { acao: 'avulso', conta_ids, vencimento? }      → uma fatura só com estes itens
//   { acao: 'adicionar', conta_ids }                → itens soltos do mesmo pagante entram nesta
//   { acao: 'tirar', conta_ids }                    → voltam a ser contas soltas (e não entram sozinhos de novo)
//   { acao: 'corrigir', conta_id, valor_centavos, motivo } → nota de crédito/débito escrita (nunca reescreve o item)
//   { acao: 'conferido', conta_id, conferido }      → marca à mão
//   { acao: 'responder', conta_id, resposta }       → resposta à contestação do cliente
// Devolve a ficha da fatura (no mover/avulso, também `destino_id`).
export const dynamic = 'force-dynamic';

type Corpo = {
  acao?: string; conta_ids?: unknown; conta_id?: string; vencimento?: string; valor_centavos?: number;
  motivo?: string; conferido?: boolean; resposta?: string;
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('escrever');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await ctx.params;
  const corpo = await lerJson<Corpo>(req);
  if (!corpo?.acao) return NextResponse.json({ error: 'Diga o que fazer com os itens.', codigo: 'DADOS' }, { status: 400 });
  const sessao = await getSession();
  const tenantId = await getTenantId();
  const usuario = usuarioDaFatura(sessao);
  const ids = Array.isArray(corpo.conta_ids) ? corpo.conta_ids.map(String) : corpo.conta_id ? [String(corpo.conta_id)] : [];
  try {
    let destino_id: string | null = null;
    await emTransacao(async e => {
      switch (corpo.acao) {
        case 'mover': destino_id = (await moverItens(e, tenantId, id, ids, String(corpo.vencimento ?? ''), { usuario })).destino.id; break;
        case 'avulso': destino_id = (await faturarAvulso(e, tenantId, id, ids, { usuario, vencimento: corpo.vencimento })).avulsa.id; break;
        case 'adicionar': await adicionarItens(e, tenantId, id, ids, { usuario }); break;
        case 'tirar': await tirarItens(e, tenantId, id, ids, { usuario }); break;
        case 'corrigir': await corrigirValor(e, tenantId, id, String(corpo.conta_id ?? ids[0] ?? ''), Number(corpo.valor_centavos), { usuario, motivo: String(corpo.motivo ?? '') }); break;
        case 'conferido': await marcarConferido(e, tenantId, id, String(corpo.conta_id ?? ids[0] ?? ''), corpo.conferido === true, { usuario }); break;
        case 'responder': await responderContestacao(e, tenantId, id, String(corpo.conta_id ?? ids[0] ?? ''), String(corpo.resposta ?? ''), { usuario }); break;
        default: throw Object.assign(new Error('acao'), { desconhecida: true });
      }
    });
    const ficha = await montarFichaDaFatura(pool as unknown as ExecutorSQL, tenantId, id, sessao);
    return NextResponse.json({ ...ficha, destino_id });
  } catch (e) {
    if (e && typeof e === 'object' && 'desconhecida' in e) return NextResponse.json({ error: 'Ação desconhecida.', codigo: 'DADOS' }, { status: 400 });
    return respostaDeErroDaFatura(e);
  }
}
