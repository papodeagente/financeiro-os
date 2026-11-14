import { NextResponse } from 'next/server';
import { registrarEventoAuditoria } from '@/lib/audit';
import { enviarAgendamento, lerAgendamento } from '@/lib/relatorios-agendados/servidor';
import { CABECALHOS, entrada, erroDaRota } from '@/lib/relatorios-agendados/rota';
import { permitirChamada } from '@/lib/limite-publico';
import { recusaModulo } from '@/lib/guarda-rota';

/**
 * "Enviar agora" (E7, G3): monta o relatório do período do envio, cria o link
 * de leitura e manda pelo CRM (ou só devolve o link, sem CRM). O endereço do
 * link sai só nesta resposta (o banco guarda o hash).
 */
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const semModulo = await recusaModulo('relatorios');
  if (semModulo) return semModulo;
  const ctx = await entrada('mudar');
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!permitirChamada(`relatorio-enviar:${ctx.tenantId}:${id}`, 6, 10 * 60_000)) {
    return NextResponse.json({ error: 'Muitos envios seguidos deste relatório. Espere alguns minutos.' }, { status: 429, headers: CABECALHOS });
  }
  try {
    const a = await lerAgendamento(ctx.exec, ctx.tenantId, id);
    if (!a) return NextResponse.json({ error: 'Envio agendado não encontrado.', codigo: 'NAO_ACHOU' }, { status: 404, headers: CABECALHOS });
    const r = await enviarAgendamento(ctx.exec, a, new Date(), { manual: true });
    await registrarEventoAuditoria({
      session: ctx.sessao, acao: 'ENVIAR', modulo: 'Financeiro', entidade: 'relatorios_agendados', entidadeId: id,
      descricao: `Enviou agora "${a.nome}" (${r.situacao}${r.detalhe ? `: ${r.detalhe}` : ''}).`,
    }).catch(() => undefined);
    return NextResponse.json({ resultado: r }, { status: r.situacao === 'falhou' ? 500 : 200, headers: CABECALHOS });
  } catch (e) {
    return erroDaRota(e);
  }
}
