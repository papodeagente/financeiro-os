import { NextResponse } from 'next/server';
import { registrarEventoAuditoria } from '@/lib/audit';
import { revogarLeitura } from '@/lib/relatorios-agendados/servidor';
import { CABECALHOS, entrada, erroDaRota } from '@/lib/relatorios-agendados/rota';
import { recusaModulo } from '@/lib/guarda-rota';

/** Desliga um link de leitura de relatório (E7, G3). Quem abrir depois vê "este link não abre mais". */
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('relatorios');
  if (semModulo) return semModulo;
  const ctx = await entrada('mudar');
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  try {
    const ok = await revogarLeitura(ctx.exec, ctx.tenantId, id, ctx.sessao.userId);
    if (!ok) return NextResponse.json({ error: 'Link não encontrado ou já desligado.', codigo: 'NAO_ACHOU' }, { status: 404, headers: CABECALHOS });
    await registrarEventoAuditoria({ session: ctx.sessao, acao: 'CANCELAR', modulo: 'Financeiro', entidade: 'relatorios_leituras', entidadeId: id, descricao: 'Desligou um link de leitura de relatório.' }).catch(() => undefined);
    return NextResponse.json({ ok: true }, { headers: CABECALHOS });
  } catch (e) {
    return erroDaRota(e);
  }
}
