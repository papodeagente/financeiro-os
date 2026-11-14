import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { ajustarCredito } from '@/lib/credito-cliente-servidor';
import { centavosDe, lerJson, respostaDeErroDaParteD } from '@/lib/parte-d-rota';

// Ajuste à mão de um crédito do cliente, com motivo (E5, parte D).
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('venda');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('usar_credito_cliente');
  if (recusa) return recusa;
  await initDB();
  const { id } = await ctx.params;
  const tenantId = await getTenantId();
  const sessao = await getSession();
  const c = await lerJson<{ ajuste_centavos?: unknown; motivo?: string }>(req);
  const valor = centavosDe(c?.ajuste_centavos);
  if (!valor) return NextResponse.json({ error: 'Informe quanto somar ou tirar do crédito.', codigo: 'VALOR' }, { status: 400 });
  try {
    return NextResponse.json(await emTransacao(e => ajustarCredito(e, tenantId, id, valor, String(c?.motivo ?? ''), sessao?.nome || sessao?.userId || '')));
  } catch (e) {
    return respostaDeErroDaParteD(e);
  }
}
