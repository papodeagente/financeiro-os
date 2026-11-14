import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { recusaFinanceira, recusaModulo } from '@/lib/guarda-rota';
import { escopoDaSessao, salvarSelecao, type ExecutorEmpresas } from '@/lib/empresas-servidor';
import { respostaDeErroDaEmpresa } from '@/lib/empresas-rota';

// O seletor de empresas (E7): o que cada pessoa marcou fica guardado para
// ela e vale em todas as listas e relatórios até ela mudar.
//   PUT { empresas: string[] } → { selecao, visiveis }   (vazio = todas)
export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const semModulo = await recusaModulo('empresas');
  if (semModulo) return semModulo;
  const recusa = await recusaFinanceira('ler');
  if (recusa) return recusa;
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
  const corpo = (await req.json().catch(() => null)) as { empresas?: unknown } | null;
  if (!corpo || !Array.isArray(corpo.empresas)) return NextResponse.json({ error: 'Envie a lista de empresas.' }, { status: 400 });
  try {
    const sessao = await getSession();
    if (!sessao) return NextResponse.json({ error: 'Sessao necessaria' }, { status: 401 });
    const exec = pool as unknown as ExecutorEmpresas;
    const selecao = await salvarSelecao(exec, sessao, corpo.empresas);
    const { visiveis } = await escopoDaSessao(sessao, exec);
    return NextResponse.json({ selecao, visiveis });
  } catch (e) {
    return respostaDeErroDaEmpresa(e);
  }
}
