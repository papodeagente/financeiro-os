import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { acessoDaPlataforma } from '@/lib/plataforma-servidor';
import { emTransacao } from '@/lib/caixa-atomico';
import { prepararAgenciaNova } from '@/lib/assistente-inicial-servidor';
import { criarAgenciaDemo, situacaoDaDemo, ErroDaDemo, type BancoDaDemo } from '@/lib/demo/agencia-demo';
import { contarDados } from '@/lib/demo/semear-demo';
import type { ExecutorSQL } from '@/lib/caixa-atomico';

// Agência de demonstração (14/11/2026): a conta de teste do Fernando. Só o
// super admin. A senha do administrador volta UMA vez na resposta do POST
// que cria; nunca é gravada em texto nem vai para o log.
export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function GET() {
  const acesso = await acessoDaPlataforma('gerir_agencias');
  if (acesso instanceof NextResponse) return acesso;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
  const situacao = await situacaoDaDemo(pool as unknown as BancoDaDemo);
  const contagens = situacao.tenant ? await contarDados(pool as unknown as ExecutorSQL, situacao.tenant.id) : null;
  return NextResponse.json({ ...situacao, contagens }, { headers: SEM_CACHE });
}

export async function POST() {
  const acesso = await acessoDaPlataforma('gerir_agencias');
  if (acesso instanceof NextResponse) return acesso;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco de dados indisponivel' }, { status: 503 });
  try {
    const r = await criarAgenciaDemo(pool as unknown as BancoDaDemo, {
      hashPassword,
      prepararAgencia: async tenantId => { await emTransacao(exec => prepararAgenciaNova(exec, tenantId)); },
    });
    return NextResponse.json(r, { headers: SEM_CACHE });
  } catch (e) {
    if (e instanceof ErroDaDemo) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[demo] criar agência:', e instanceof Error ? e.message : 'erro');
    return NextResponse.json({ error: 'A agência de demonstração não pôde ser criada agora.' }, { status: 500 });
  }
}
