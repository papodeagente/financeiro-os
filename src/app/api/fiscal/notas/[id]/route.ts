import { NextResponse } from 'next/server';
import { initDB } from '@/lib/db';
import { getTenantId } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { bloqueioFinanceiro } from '@/lib/permissoes';
import { atualizarStatus, cancelarNota } from '@/lib/nfse-servico';
import { ErroFiscal } from '@/lib/nfse-emissor';

/** Consulta o gateway e atualiza a nota que ficou processando. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'ler');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const { id } = await params;
    const nota = await atualizarStatus(await getTenantId(), id);
    if (!nota) return NextResponse.json({ error: 'Nota não encontrada' }, { status: 404 });
    return NextResponse.json(nota);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Cancela a nota na prefeitura.
 *
 * É DELETE na rota, mas nada é apagado: nota fiscal vira CANCELADA, com
 * motivo e data, e continua no histórico. A prefeitura tem o documento do
 * outro lado; sumir com a linha aqui só faria o sistema mentir.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initDB();
    const bloqueio = bloqueioFinanceiro(await getSession(), 'escrever');
    if (bloqueio) return NextResponse.json({ error: bloqueio.erro }, { status: bloqueio.status });
    const { id } = await params;
    let motivo = '';
    try {
      const corpo = await req.json();
      motivo = String(corpo?.motivo ?? '');
    } catch {
      motivo = '';
    }
    const nota = await cancelarNota(await getTenantId(), id, motivo);
    return NextResponse.json(nota);
  } catch (e) {
    const msg = e instanceof ErroFiscal
      ? e.message
      : e instanceof Error ? e.message : 'Erro ao cancelar a nota.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
