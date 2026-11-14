import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { acessoDaPlataforma } from '@/lib/plataforma-servidor';
import { diagnosticoDaVolta, type Executor } from '@/lib/volta-saude';

// "Saúde da volta" (14/11/2026): o que a volta da versão completa pode ter
// deixado torto, por agência. Só leitura e só o super admin (o CS não vê:
// a lista cita integrações e o histórico de auditoria).
export const dynamic = 'force-dynamic';

export async function GET() {
  const acesso = await acessoDaPlataforma('gerir_agencias');
  if (acesso instanceof NextResponse) return acesso;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
  try {
    return NextResponse.json(await diagnosticoDaVolta(pool as unknown as Executor));
  } catch (e) {
    console.error('[saude-da-volta]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'O diagnóstico não pôde ser montado agora.' }, { status: 500 });
  }
}
