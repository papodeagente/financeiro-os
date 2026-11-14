/**
 * Envio agendado de relatório (E7, G3): o contrato das rotas e a porta de
 * entrada comum (sessão, direitos, agência).
 *
 *   GET    /api/relatorios/agendados                 lista + crm_ligado
 *   POST   /api/relatorios/agendados                 cria { nome, relatorio, consulta, frequencia, dia_semana, dia_mes, hora, periodo, formato, destinatarios, validade_dias, ativo }
 *   GET    /api/relatorios/agendados/[id]            o agendamento, o histórico dos envios e os links
 *   PUT    /api/relatorios/agendados/[id]            altera (mesmo corpo do POST)
 *   PATCH  /api/relatorios/agendados/[id]            { ativo } pausa ou retoma
 *   DELETE /api/relatorios/agendados/[id]            apaga e revoga os links
 *   POST   /api/relatorios/agendados/[id]/enviar     "Enviar agora" (devolve o link uma vez)
 *   POST   /api/relatorios/agendados/leituras/[id]/revogar
 *   GET    /api/leitura/[token]                      público: a cópia do relatório; ?formato=xlsx|pdf|imprimir baixa
 *
 * Relatórios: 'vendas' (consulta = a URL de /relatorios/vendas), 'dre'
 * (regime, centro, rateio, detalhe), 'fluxo' (conta, agrupamento, vista,
 * medida, folha) e 'visao_geral' (sem filtro; período 'posicao_do_dia').
 * DRE, fluxo e visão geral pedem também "Acessar o financeiro" para agendar,
 * e a cada envio conferem de novo os direitos de quem salvou
 * (financeiro-servidor.ts).
 *
 * Direitos: ver a lista com "Abrir relatórios"; criar, mudar, enviar e
 * revogar com "Abrir relatórios" + "Baixar em Excel e PDF" (o relatório sai
 * da agência). O envio usa os direitos de quem salvou por último: o ganho da
 * agência só se essa pessoa pode vê-lo; vendedor sem "ver vendas de todos"
 * agenda só as próprias vendas.
 */
import { NextResponse } from 'next/server';
import pool, { initDB } from '../db';
import { getSession, type SessionPayload } from '../auth';
import { getTenantId } from '../tenant';
import { pode } from '../permissoes-servidor';
import { podeVerTodasVendas } from '../permissoes';
import type { ExecutorSQL } from '../caixa-atomico';
import type { AutorDoAgendamento } from './servidor';

export const CABECALHOS = { 'Cache-Control': 'private, no-store' } as const;

export interface ContextoDaRota { sessao: SessionPayload; exec: ExecutorSQL; tenantId: string }

export async function entrada(modo: 'ler' | 'mudar'): Promise<ContextoDaRota | NextResponse> {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessão necessária.' }, { status: 401, headers: CABECALHOS });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível.' }, { status: 503, headers: CABECALHOS });
  const exec = pool as unknown as ExecutorSQL;
  if (!(await pode(sessao, 'acessar_relatorios', { exec }))) {
    return NextResponse.json({ error: 'Seu acesso não inclui relatórios.', codigo: 'SEM_DIREITO' }, { status: 403, headers: CABECALHOS });
  }
  if (modo === 'mudar' && !(await pode(sessao, 'exportar', { exec }))) {
    return NextResponse.json({ error: 'Agendar envio de relatório pede o direito de baixar em Excel e PDF.', codigo: 'SEM_DIREITO' }, { status: 403, headers: CABECALHOS });
  }
  const tenantId = await getTenantId();
  return { sessao, exec, tenantId };
}

export async function autorDaSessao(ctx: ContextoDaRota): Promise<AutorDoAgendamento> {
  return {
    id: ctx.sessao.userId,
    nome: ctx.sessao.nome,
    verReceita: await pode(ctx.sessao, 'ver_colunas_comissao', { exec: ctx.exec }),
    vendedorId: podeVerTodasVendas(ctx.sessao) ? null : ctx.sessao.userId,
  };
}

/**
 * DRE, fluxo de caixa e visão geral são do financeiro: quem agenda precisa
 * poder abrir o financeiro (além de relatórios e exportar, na `entrada`).
 */
export async function recusaDoRelatorio(ctx: ContextoDaRota, relatorio: string): Promise<NextResponse | null> {
  if (relatorio === 'vendas') return null;
  if (await pode(ctx.sessao, 'ver_financeiro', { exec: ctx.exec })) return null;
  return NextResponse.json({ error: 'Agendar este relatório pede acesso ao financeiro.', codigo: 'SEM_DIREITO' }, { status: 403, headers: CABECALHOS });
}

export function erroDaRota(e: unknown): NextResponse {
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 500;
  const codigo = typeof (e as { codigo?: unknown })?.codigo === 'string' ? (e as { codigo: string }).codigo : 'ERRO';
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro interno', codigo }, { status, headers: CABECALHOS });
}
