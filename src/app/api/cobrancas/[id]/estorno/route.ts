import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import type { ExecutorSQL } from '@/lib/caixa-atomico';
import { carregarCobranca, pedirEstorno } from '@/lib/cobranca/servidor';
import { cobrancaParaTela, lerCorpo, quemEsta, respostaDeErroDaCobranca } from '@/lib/cobranca/rota';

// Devolve ao cliente um Pix pago (E3, 05/11/2026).
//   POST { motivo } → a cobrança como estava; o provedor devolve o dinheiro e, quando avisa o estorno,
//   a baixa é desfeita sozinha (status "estornada"). Boleto: 409 (devolver por transferência e estornar a baixa).
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('cobranca');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('estornar_baixa');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const { id } = await params;
  const tenantId = await getTenantId();
  const c = await carregarCobranca(pool as unknown as ExecutorSQL, tenantId, id);
  if (!c) return NextResponse.json({ error: 'Cobrança não encontrada.' }, { status: 404 });
  const recusaConta = await recusaAcao('estornar_baixa', { contaBancariaId: c.conta_bancaria_id });
  if (recusaConta) return recusaConta;
  const corpo = await lerCorpo<{ motivo?: string }>(req);
  try {
    const r = await pedirEstorno(tenantId, id, { motivo: corpo?.motivo ?? '', quem: await quemEsta() });
    return NextResponse.json({ ...cobrancaParaTela(r), devolucao_pedida: true });
  } catch (e) {
    return respostaDeErroDaCobranca(e, 'estorno');
  }
}
