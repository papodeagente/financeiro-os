/**
 * Peças das rotas das comissões por função (/api/comissoes-por-funcao/*) e
 * dos relatórios de vendas. Arquivo de rota só exporta handlers; o resto mora
 * aqui.
 *
 * Contrato (dinheiro em centavos de real):
 *   GET|PUT  /config                 ConfigComissao
 *   GET      /cadastro               { funcoes, pessoas, planos, metas, equipe, intermediarios, unidades, config }
 *   PUT      /funcoes                { funcao, pessoas? }   DELETE /funcoes?id=
 *   PUT      /planos                 { plano }              DELETE /planos?id=
 *   PUT      /metas                  { pessoa_funcao_id, ano, meses: number[12] }  ou a grade: { ano, linhas: [{ pessoa_funcao_id, meses }] }
 *   POST     /recalcular             o cálculo do dia, agora
 *   GET      /previa?ate=&funcao_id= PreviaDoFechamento (só as suas, sem ver a equipe; sem as funções que outra pessoa fecha)
 *   POST     /fechar                 { ate, participantes: string[], assinatura? } → ResultadoDoFechamento
 *   GET      /a-pagar                PessoaAPagar[]
 *   POST     /pagar                  { modo: 'TOTAL'|'PARCIAL', pessoas: string[], valor_centavos? } → ResultadoDoPagamento
 *   GET      /painel?mes=&pessoa_id= PainelDoVendedor (a própria; outra pessoa só com "ver a comissão da equipe")
 *   GET      /manuais?venda_id=      { regra, pode_lancar, base_centavos, situacao_venda, manuais, pessoas }
 *   POST     /manuais                { venda_id, pessoa_funcao_id, descricao, tipo: 'PERCENTUAL'|'VALOR', percentual?, valor_centavos? }
 *   DELETE   /manuais?venda_id=&id=  exclui a que ainda não foi fechada
 * Erros: { error, codigo, detalhes? } com 400, 401, 403, 404, 409, 423.
 */
import { NextResponse } from 'next/server';
import pool, { initDB } from './db';
import { getSession, type SessionPayload } from './auth';
import { getTenantId } from './tenant';
import { pode } from './permissoes-servidor';
import { respostaPeriodoFechado } from './guarda-rota';
import type { ExecutorSQL } from './caixa-atomico';
import { ErroComissao, gruposDaPessoa, type QuemFecha, type UsuarioDaAcao } from './comissao-funcoes-servidor';
import { nuncaRestringido, type AcaoFinanceira } from './acoes-financeiras';

export interface ContextoDaComissao {
  sessao: SessionPayload;
  tenantId: string;
  exec: ExecutorSQL;
  usuario: UsuarioDaAcao;
  /** Vê a comissão de todos (senão, só a própria). */
  ver_todos: boolean;
  ver_proprias: boolean;
}

/** Sessão, agência e direitos. `exigir` recusa quem não tem a ação. */
export async function contextoDaComissao(exigir: AcaoFinanceira[] = []): Promise<ContextoDaComissao | NextResponse> {
  const sessao = await getSession();
  if (!sessao) return NextResponse.json({ error: 'Sessao necessaria', codigo: 'SESSAO' }, { status: 401 });
  await initDB();
  if (!pool) return NextResponse.json({ error: 'Banco indisponível', codigo: 'BANCO' }, { status: 503 });
  const exec = pool as unknown as ExecutorSQL;
  for (const a of exigir) {
    if (!(await pode(sessao, a, { exec }))) {
      return NextResponse.json({ error: 'Seu acesso não inclui isto nas comissões.', codigo: 'SEM_DIREITO', acao: a }, { status: 403 });
    }
  }
  const tenantId = await getTenantId();
  const [ver_todos, ver_proprias] = await Promise.all([pode(sessao, 'ver_comissoes_todos', { exec }), pode(sessao, 'ver_proprias_comissoes', { exec })]);
  return { sessao, tenantId, exec, usuario: { id: sessao.userId ?? '', nome: sessao.nome ?? '' }, ver_todos, ver_proprias };
}

/** Quem está pedindo, para a lista "quem fecha" de cada função. */
export async function quemFechaDo(ctx: ContextoDaComissao): Promise<QuemFecha> {
  return {
    usuario_id: ctx.usuario.id,
    grupos: await gruposDaPessoa(ctx.exec, ctx.tenantId, ctx.usuario.id),
    admin: nuncaRestringido(ctx.sessao),
  };
}

export function respostaDeErroDaComissao(e: unknown): NextResponse {
  if (e instanceof ErroComissao) {
    return NextResponse.json({ error: e.message, codigo: e.codigo, ...(e.detalhes ? { detalhes: e.detalhes } : {}) }, { status: e.status });
  }
  const periodo = respostaPeriodoFechado(e);
  if (periodo) return periodo;
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro interno', codigo: 'ERRO' }, { status: 500 });
}

export const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_MES = /^\d{4}-\d{2}$/;
