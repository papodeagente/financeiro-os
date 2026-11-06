import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaFinanceira } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { recalcularVencimentos } from '@/lib/fatura-servidor';
import { lerJson, respostaDeErroDaFatura, usuarioDaFatura } from '@/lib/fatura-rota';

// "Recalcular vencimentos": { pessoa_id, aplicar? }. Sem aplicar, só mostra o que muda (item a item, de → para).
// Com aplicar, realoca os itens das faturas ABERTAS montadas pela regra (fechadas, recebidas, movidas e avulsas ficam).
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const corpo = await lerJson<{ pessoa_id?: string; aplicar?: boolean }>(req);
  const recusa = await recusaFinanceira(corpo?.aplicar === true ? 'escrever' : 'ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  if (!corpo?.pessoa_id) return NextResponse.json({ error: 'Diga de quem são as regras.', codigo: 'DADOS' }, { status: 400 });
  const tenantId = await getTenantId();
  const usuario = usuarioDaFatura(await getSession());
  try {
    const r = await emTransacao(e => recalcularVencimentos(e, tenantId, String(corpo.pessoa_id), { aplicar: corpo.aplicar === true, usuario }));
    return NextResponse.json(r);
  } catch (e) {
    return respostaDeErroDaFatura(e);
  }
}
