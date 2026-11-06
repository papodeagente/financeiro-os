import { NextResponse } from 'next/server';
import { registrarEventoAuditoria } from '@/lib/audit';
import { crmLigado } from '@/lib/cobranca/crm';
import { validarAgendamento } from '@/lib/relatorios-agendados/regras';
import { listarAgendamentos, salvarAgendamento } from '@/lib/relatorios-agendados/servidor';
import { CABECALHOS, autorDaSessao, entrada, erroDaRota, recusaDoRelatorio } from '@/lib/relatorios-agendados/rota';

/** Envios agendados de relatório (E7, G3). Contrato em src/lib/relatorios-agendados/rota.ts. */
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await entrada('ler');
  if (ctx instanceof NextResponse) return ctx;
  try {
    const [agendamentos, crm] = await Promise.all([listarAgendamentos(ctx.exec, ctx.tenantId), crmLigado(ctx.exec, ctx.tenantId)]);
    return NextResponse.json({ agendamentos, crm_ligado: crm }, { headers: CABECALHOS });
  } catch (e) {
    return erroDaRota(e);
  }
}

export async function POST(req: Request) {
  const ctx = await entrada('mudar');
  if (ctx instanceof NextResponse) return ctx;
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400, headers: CABECALHOS }); }
  const v = validarAgendamento(corpo);
  if (!v.ok) return NextResponse.json({ error: 'Confira os campos marcados.', erros: v.erros, codigo: 'DADOS' }, { status: 422, headers: CABECALHOS });
  const recusa = await recusaDoRelatorio(ctx, v.dados.relatorio);
  if (recusa) return recusa;
  try {
    const a = await salvarAgendamento(ctx.exec, ctx.tenantId, null, v.dados, await autorDaSessao(ctx), new Date());
    await registrarEventoAuditoria({
      session: ctx.sessao, acao: 'CRIAR', modulo: 'Financeiro', entidade: 'relatorios_agendados', entidadeId: a.id,
      descricao: `Agendou o envio "${a.nome}" para ${a.destinatarios.length} ${a.destinatarios.length === 1 ? 'e-mail' : 'e-mails'} (${a.descricao}).`,
    }).catch(() => undefined);
    return NextResponse.json({ agendamento: a }, { status: 201, headers: CABECALHOS });
  } catch (e) {
    return erroDaRota(e);
  }
}
