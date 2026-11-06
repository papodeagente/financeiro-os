import { NextResponse } from 'next/server';
import { registrarEventoAuditoria } from '@/lib/audit';
import { pode } from '@/lib/permissoes-servidor';
import { validarAgendamento } from '@/lib/relatorios-agendados/regras';
import {
  alterarAtivo, apagarAgendamento, historicoDeEnvios, lerAgendamento, listarLeituras, salvarAgendamento,
} from '@/lib/relatorios-agendados/servidor';
import { CABECALHOS, autorDaSessao, entrada, erroDaRota, recusaDoRelatorio } from '@/lib/relatorios-agendados/rota';

/** Um envio agendado (E7, G3). Contrato em src/lib/relatorios-agendados/rota.ts. */
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };
const naoAchou = () => NextResponse.json({ error: 'Envio agendado não encontrado.', codigo: 'NAO_ACHOU' }, { status: 404, headers: CABECALHOS });

export async function GET(_req: Request, { params }: Params) {
  const ctx = await entrada('ler');
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  try {
    const a = await lerAgendamento(ctx.exec, ctx.tenantId, id);
    if (!a) return naoAchou();
    const [envios, leituras] = await Promise.all([historicoDeEnvios(ctx.exec, ctx.tenantId, id), listarLeituras(ctx.exec, ctx.tenantId, id, new Date(), await pode(ctx.sessao, 'exportar', { exec: ctx.exec }))]);
    return NextResponse.json({ agendamento: a, envios, leituras }, { headers: CABECALHOS });
  } catch (e) {
    return erroDaRota(e);
  }
}

export async function PUT(req: Request, { params }: Params) {
  const ctx = await entrada('mudar');
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400, headers: CABECALHOS }); }
  const v = validarAgendamento(corpo);
  if (!v.ok) return NextResponse.json({ error: 'Confira os campos marcados.', erros: v.erros, codigo: 'DADOS' }, { status: 422, headers: CABECALHOS });
  const recusa = await recusaDoRelatorio(ctx, v.dados.relatorio);
  if (recusa) return recusa;
  try {
    const a = await salvarAgendamento(ctx.exec, ctx.tenantId, id, v.dados, await autorDaSessao(ctx), new Date());
    await registrarEventoAuditoria({ session: ctx.sessao, acao: 'EDITAR', modulo: 'Financeiro', entidade: 'relatorios_agendados', entidadeId: a.id, descricao: `Alterou o envio agendado "${a.nome}".` }).catch(() => undefined);
    return NextResponse.json({ agendamento: a }, { headers: CABECALHOS });
  } catch (e) {
    return erroDaRota(e);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await entrada('mudar');
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const corpo = await req.json().catch(() => null) as { ativo?: unknown } | null;
  if (typeof corpo?.ativo !== 'boolean') return NextResponse.json({ error: 'Diga se o envio fica ligado ou pausado.' }, { status: 400, headers: CABECALHOS });
  try {
    const a = await alterarAtivo(ctx.exec, ctx.tenantId, id, corpo.ativo, new Date());
    await registrarEventoAuditoria({ session: ctx.sessao, acao: 'EDITAR', modulo: 'Financeiro', entidade: 'relatorios_agendados', entidadeId: a.id, descricao: `${a.ativo ? 'Retomou' : 'Pausou'} o envio agendado "${a.nome}".` }).catch(() => undefined);
    return NextResponse.json({ agendamento: a }, { headers: CABECALHOS });
  } catch (e) {
    return erroDaRota(e);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await entrada('mudar');
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  try {
    const a = await lerAgendamento(ctx.exec, ctx.tenantId, id);
    if (!a) return naoAchou();
    await apagarAgendamento(ctx.exec, ctx.tenantId, id, ctx.sessao.userId);
    await registrarEventoAuditoria({ session: ctx.sessao, acao: 'EXCLUIR', modulo: 'Financeiro', entidade: 'relatorios_agendados', entidadeId: id, descricao: `Apagou o envio agendado "${a.nome}" e desligou os links dele.` }).catch(() => undefined);
    return NextResponse.json({ ok: true }, { headers: CABECALHOS });
  } catch (e) {
    return erroDaRota(e);
  }
}
