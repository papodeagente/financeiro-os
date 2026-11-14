// Juntar categorias (05/11/2026): leva tudo de uma categoria para outra e
// apaga a primeira. Só administrador. Corpo { origem_id, destino_id, modo }:
// 'previa' conta o que muda sem gravar; 'gravar' faz numa transação e audita.
import { NextResponse } from 'next/server';
import pool, { initDB } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { recusaAdmin, recusaModulo } from '@/lib/guarda-rota';
import { emTransacao } from '@/lib/caixa-atomico';
import { ErroCadastro, previaDaJuncao, juntarCategorias } from '@/lib/centros-custo-servidor';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const semModulo = await recusaModulo('nucleo');
  if (semModulo) return semModulo;
  try {
    const recusa = await recusaAdmin();
    if (recusa) return recusa;
    await initDB();
    const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const origemId = String(corpo?.origem_id ?? '').trim();
    const destinoId = String(corpo?.destino_id ?? '').trim();
    const modo = corpo?.modo === 'gravar' ? 'gravar' : 'previa';
    if (!origemId || !destinoId) {
      return NextResponse.json({ error: 'Escolha a categoria que sai e a que recebe os registros.' }, { status: 400 });
    }
    if (!pool) return NextResponse.json({ error: 'Banco indisponível' }, { status: 503 });
    const tenantId = await getTenantId();
    if (modo === 'previa') return NextResponse.json(await previaDaJuncao(pool, tenantId, origemId, destinoId));
    const sessao = await getSession();
    const feito = await emTransacao(exec => juntarCategorias(exec, tenantId, origemId, destinoId, {
      userId: sessao?.userId ?? '', nome: sessao?.nome ?? '', perfil: sessao?.perfil ?? '',
    }));
    return NextResponse.json({ ok: true, ...feito });
  } catch (e) {
    if (e instanceof ErroCadastro) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
