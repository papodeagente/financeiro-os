import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { acessoDaPlataforma } from '@/lib/plataforma-servidor';
import { situacaoDaDemo, type BancoDaDemo } from '@/lib/demo/agencia-demo';
import { semearDemo, apagarDadosDaDemo, ErroDeDemonstracao } from '@/lib/demo/semear-demo';

// Dados da agência de demonstração (14/11/2026). Só o super admin, e só na
// agência marcada `demo` (o id vem do banco, nunca do pedido).
//  POST { acao: 'criar' }   cria os dados (com os dados já criados, nada muda)
//  POST { acao: 'recriar' } apaga e cria de novo
//  DELETE                   apaga os dados (fica o administrador)
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function agenciaDemo(): Promise<string | NextResponse> {
  const acesso = await acessoDaPlataforma('gerir_agencias');
  if (acesso instanceof NextResponse) return acesso;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
  const s = await situacaoDaDemo(pool as unknown as BancoDaDemo);
  if (!s.tenant) return NextResponse.json({ error: 'Crie a agência de demonstração primeiro.' }, { status: 409 });
  return s.tenant.id;
}

function falha(e: unknown) {
  if (e instanceof ErroDeDemonstracao) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error('[demo] dados:', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'Não foi possível agora. Nada da agência real foi tocado.' }, { status: 500 });
}

export async function POST(req: Request) {
  const t = await agenciaDemo();
  if (t instanceof NextResponse) return t;
  const corpo = await req.json().catch(() => ({})) as { acao?: string };
  try {
    if (corpo.acao === 'recriar') await apagarDadosDaDemo(t);
    return NextResponse.json(await semearDemo(t));
  } catch (e) {
    return falha(e);
  }
}

export async function DELETE() {
  const t = await agenciaDemo();
  if (t instanceof NextResponse) return t;
  try {
    return NextResponse.json(await apagarDadosDaDemo(t));
  } catch (e) {
    return falha(e);
  }
}
