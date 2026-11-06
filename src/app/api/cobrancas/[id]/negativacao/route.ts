import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { carregarCobranca } from '@/lib/cobranca/servidor';
import {
  atualizarNegativacao, cancelarNegativacao, pedirNegativacao, previaDaNegativacao,
} from '@/lib/cobranca/negativacao-servidor';
import { chaveDe, lerCorpo, quemEsta, respostaDeErroDaCobranca } from '@/lib/cobranca/rota';

// Negativação (Serasa) de uma cobrança vencida do Asaas (E7, 06/11/2026). Nunca automática.
//   GET  → prévia: { pode, motivos, faltas, devedor, simulacao (taxa, início previsto), atual, assinatura }
//          (consulta a simulação no provedor; não pede nada).
//   POST { acao: 'negativar', assinatura }  (Idempotency-Key) → pede, com a assinatura da prévia.
//   POST { acao: 'atualizar' }                                → busca a situação no provedor.
//   POST { acao: 'cancelar', motivo }                         → cancela, quando o provedor deixa.
// Direito: gerar_boletos, na conta da cobrança.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

async function porteiro(id: string): Promise<{ tenantId: string } | { resposta: NextResponse }> {
  const recusa = await recusaAcao('gerar_boletos');
  if (recusa) return { resposta: recusa };
  await initDB();
  if (!pool) return { resposta: NextResponse.json({ error: 'Banco indisponível' }, { status: 503 }) };
  const tenantId = await getTenantId();
  const c = await carregarCobranca(pool as unknown as ExecutorSQL, tenantId, id);
  if (!c) return { resposta: NextResponse.json({ error: 'Cobrança não encontrada.' }, { status: 404 }) };
  const recusaConta = await recusaAcao('gerar_boletos', { contaBancariaId: c.conta_bancaria_id });
  if (recusaConta) return { resposta: recusaConta };
  return { tenantId };
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const p = await porteiro(id);
  if ('resposta' in p) return p.resposta;
  try {
    return NextResponse.json(await previaDaNegativacao(pool as unknown as ExecutorSQL, p.tenantId, id));
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'prévia da negativação');
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const p = await porteiro(id);
  if ('resposta' in p) return p.resposta;
  const corpo = await lerCorpo<{ acao?: string; assinatura?: string; motivo?: string }>(req);
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  try {
    const quem = await quemEsta();
    if (corpo.acao === 'negativar') {
      return NextResponse.json(await pedirNegativacao(p.tenantId, id, { assinatura: String(corpo.assinatura ?? ''), quem, idempotencia: chaveDe(req) }));
    }
    if (corpo.acao === 'atualizar') return NextResponse.json({ negativacao: await atualizarNegativacao(p.tenantId, id, { quem }) });
    if (corpo.acao === 'cancelar') return NextResponse.json({ negativacao: await cancelarNegativacao(p.tenantId, id, { motivo: String(corpo.motivo ?? ''), quem }) });
    return NextResponse.json({ error: 'Ação desconhecida. Use negativar, atualizar ou cancelar.' }, { status: 400 });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'negativação');
  }
}
