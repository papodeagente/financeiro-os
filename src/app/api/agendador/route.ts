import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { executarAgendadorAgora } from '@/lib/agendador/tarefas';

// Agendador do Financeiro (05/11/2026). Chamado a cada 5 minutos pelo
// temporizador interno e, se configurado, pela tarefa agendada do Coolify:
//   curl -s -X POST -H "x-agendador-segredo: $AGENDADOR_SEGREDO" http://localhost:3000/api/agendador
// Sem o segredo certo, responde 401. Sem segredo configurado, a rota fica
// desligada (o temporizador interno não depende dela).
export const dynamic = 'force-dynamic';

function segredoConfere(recebido: string | null): boolean {
  const esperado = process.env.AGENDADOR_SEGREDO || '';
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!process.env.AGENDADOR_SEGREDO) {
    return NextResponse.json({ error: 'Agendador externo desligado' }, { status: 503 });
  }
  if (!segredoConfere(req.headers.get('x-agendador-segredo'))) {
    return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 });
  }
  try {
    const resumo = await executarAgendadorAgora();
    return NextResponse.json({ ok: true, resumo });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro no agendador' }, { status: 500 });
  }
}
