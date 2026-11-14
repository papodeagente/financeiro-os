import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { recusaAcao, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { registrarNotaEmitidaFora } from '@/lib/nota-externa';
import { respostaDeErroDaNota } from '@/lib/nota-regras-rota';

// Registrar uma nota emitida fora do sistema (E7): no portal da prefeitura
// ou no sistema anterior. Ela conta na venda e na lista de notas, e nunca vai
// ao emissor. Contrato em src/lib/nota-regras-rota.ts e src/lib/nota-externa.ts.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('notas');
  if (semModulo) return semModulo;
  const recusa = await recusaAcao('emitir_nota');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.', codigo: 'DADOS' }, { status: 400 });
  try {
    const tenantId = await getTenantId();
    const sessao = await getSession();
    const r = await emTransacao(exec => registrarNotaEmitidaFora(exec, tenantId, corpo, { id: sessao?.userId ?? '', nome: sessao?.nome ?? '' }, { origem: 'TELA' }));
    return NextResponse.json(r, { status: r.repetida ? 200 : 201 });
  } catch (e) {
    return respostaDeErroDaNota(e);
  }
}
