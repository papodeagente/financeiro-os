import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { usarCreditoNaConta } from '@/lib/credito-cliente-servidor';
import { centavosDe, lerJson, respostaDeErroDaParteD } from '@/lib/parte-d-rota';

// Liquidar uma conta a receber com o crédito do cliente (E5, parte D). Nenhum
// dinheiro entra no caixa; a baixa fica no histórico e o estorno devolve o crédito.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semCredito = await recusaAcao('usar_credito_cliente');
  if (semCredito) return semCredito;
  const semBaixa = await recusaAcao('liquidar_receber');
  if (semBaixa) return semBaixa;
  await initDB();
  const tenantId = await getTenantId();
  const sessao = await getSession();
  const c = await lerJson<{ conta_receber_id?: string; valor_centavos?: unknown; data?: string }>(req);
  try {
    return NextResponse.json(await emTransacao(e => usarCreditoNaConta(e, tenantId, {
      conta_receber_id: String(c?.conta_receber_id ?? ''), valor_centavos: centavosDe(c?.valor_centavos), data: c?.data,
      usuario: { id: sessao?.userId ?? '', nome: sessao?.nome ?? '' },
    })));
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}
