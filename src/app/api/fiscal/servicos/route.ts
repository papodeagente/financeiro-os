import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { buscarServicos } from '@/lib/lc116-servicos';

/**
 * Serviços da LC 116 que uma agência de viagens presta, com o código de
 * tributação nacional proposto para cada um.
 *
 * A agência procura pelo que faz ("agenciamento", "seguro", "evento") em vez
 * de digitar seis dígitos que ninguém decora.
 */
export async function GET(req: Request) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const termo = new URL(req.url).searchParams.get('busca') ?? '';
    return NextResponse.json({ servicos: buscarServicos(termo) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
