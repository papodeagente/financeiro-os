import { NextResponse, type NextRequest } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { lerPainelDeCambio } from '@/lib/cambio-servidor';
import { recusaModulo } from '@/lib/guarda-rota';

// Câmbio e índices (05/11/2026, E6). Só leitura do cache global que a tarefa
// de 15 min grava: esta rota NUNCA chama a AwesomeAPI nem o Banco Central.
// Qualquer pessoa logada lê (o campo de câmbio aparece na venda, que o
// vendedor também usa); as cotações são públicas e iguais para todas as
// agências. ?historico=1 (&moeda=USD) traz o histórico curto.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const semModulo = await recusaModulo('cambio');
  if (semModulo) return semModulo;
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
  await initDB();
  if (!pool) return NextResponse.json({ cotacoes: [], indices: [], fontes: [], agora: new Date().toISOString() });
  const q = req.nextUrl.searchParams;
  const historico = q.get('historico') === '1'
    ? { moeda: q.get('moeda') || undefined, por_moeda: Number(q.get('por_moeda') || 12) }
    : undefined;
  try {
    const painel = await lerPainelDeCambio(pool, { historico });
    return NextResponse.json(painel, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[cambio] leitura do cache falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Não foi possível ler as cotações agora.' }, { status: 500 });
  }
}
