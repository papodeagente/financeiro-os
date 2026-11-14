// Pedidos de aprovação e alçadas no banco (05/11/2026).
//
// CONTRATO
//   criarPedidoAprovacao({ tenantId, tipo, alvo_tabela, alvo_id, descricao, payload,
//     valor_centavos, solicitante, motivo, aprovadores?, niveis? }, exec?)
//     → { pedido, jaExistia }. Um pedido aberto por (tipo, alvo): o duplo
//     clique devolve o mesmo. Avisa no sino quem aprova.
//   decidirPedido({ id, decisao: 'aprovar'|'recusar', motivo, sessao })
//     → quem pediu nunca decide o próprio; aprovação final REVALIDA a carga e
//     executa pelo executor registrado do tipo, na mesma transação.
//   registrarExecutorDeAprovacao(tipo, executar, { revalidar, aoRecusar, acaoAprovadora })
//     → registre em ./aprovacoes-executores (a rota /api/aprovacoes importa).
//   exigeAprovacaoDoPagamento(conta, { tenantId }) → a liquidação de conta a
//     pagar consulta antes de pagar; `liberado: false` = não pagar.
import { createHash } from 'node:crypto';
import pool from './db';
import { generateId } from './utils';
import { criarNotificacao } from './notificacoes';
import { emTransacao } from './caixa-atomico';
import { pode, tenantDaSessao, type ExecutorPermissoes, type SessaoPermissoes } from './permissoes-servidor';
import type { AcaoFinanceira } from './acoes-financeiras';
import {
  escolherAlcada, jsonCanonico, normalizarAprovadores, podeDecidirPedido, statusDepoisDaDecisao,
  STATUS_PEDIDO, type Alcada, type DecisaoRegistrada, type PedidoAprovacao, type StatusPedido,
} from './aprovacoes';
import { STATUS_DE_BAIXA } from './guarda-baixa';

export class ErroAprovacao extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type Executor = ExecutorPermissoes;

function executorPadrao(exec?: Executor): Executor {
  const e = exec ?? (pool as unknown as Executor | null);
  if (!e) throw new ErroAprovacao('Banco indisponível.', 503);
  return e;
}

// ---------------------------------------------------------------------------
// Registro de executores

export interface ContextoDeExecucao {
  exec: Executor;
  tenantId: string;
  pedido: PedidoAprovacao;
  aprovador: { id: string; nome: string };
}

export type Revalidacao = { ok: true } | { ok: false; motivo: string };

export type ExecutorDeAprovacao = (ctx: ContextoDeExecucao) => Promise<Record<string, unknown> | void>;

export interface OpcoesDoExecutor {
  /** Confere, no estado de AGORA, se a carga ainda vale (valor, situação do alvo). */
  revalidar?: (ctx: ContextoDeExecucao) => Promise<Revalidacao>;
  /** Efeito da recusa (ex.: marcar a conta como recusada). */
  aoRecusar?: (ctx: ContextoDeExecucao) => Promise<void>;
  /** Direito exigido de quem decide. Padrão: aprovar_pagamento. */
  acaoAprovadora?: AcaoFinanceira;
}

interface RegistroDeExecutor extends OpcoesDoExecutor { executar: ExecutorDeAprovacao }

const executores = new Map<string, RegistroDeExecutor>();

export function registrarExecutorDeAprovacao(tipo: string, executar: ExecutorDeAprovacao, opcoes: OpcoesDoExecutor = {}): void {
  if (!tipo || !/^[a-z0-9_.-]{1,60}$/.test(tipo)) throw new Error(`Tipo de aprovação inválido: ${tipo}`);
  executores.set(tipo, { ...opcoes, executar });
}

export function acaoAprovadoraDo(tipo: string): AcaoFinanceira {
  return executores.get(tipo)?.acaoAprovadora ?? 'aprovar_pagamento';
}

// ---------------------------------------------------------------------------
// Leitura

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const dataISO = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export function hashDaCarga(payload: unknown): string {
  return createHash('sha256').update(jsonCanonico(payload ?? {})).digest('hex');
}

function linhaParaPedido(r: Record<string, unknown>): PedidoAprovacao {
  const status = STATUS_PEDIDO.includes(r.status as StatusPedido) ? r.status as StatusPedido : 'PENDENTE';
  return {
    id: texto(r.id), tipo: texto(r.tipo), alvo_tabela: texto(r.alvo_tabela), alvo_id: texto(r.alvo_id),
    descricao: texto(r.descricao),
    payload: r.payload && typeof r.payload === 'object' ? r.payload as Record<string, unknown> : {},
    valor_centavos: Number(r.valor_centavos ?? 0),
    solicitante_id: texto(r.solicitante_id), solicitante_nome: texto(r.solicitante_nome),
    status, alcada_id: r.alcada_id ? texto(r.alcada_id) : null,
    aprovadores: normalizarAprovadores(r.aprovadores), niveis: Number(r.niveis ?? 1) || 1,
    decisoes: Array.isArray(r.decisoes) ? r.decisoes as DecisaoRegistrada[] : [],
    motivo: texto(r.motivo), motivo_decisao: texto(r.motivo_decisao), erro_execucao: texto(r.erro_execucao),
    resultado: r.resultado && typeof r.resultado === 'object' ? r.resultado as Record<string, unknown> : null,
    expira_em: dataISO(r.expira_em) ?? '', created_at: dataISO(r.created_at) ?? '',
    decidido_em: dataISO(r.decidido_em), executado_em: dataISO(r.executado_em),
  };
}

/** Marca como expirados os pedidos abertos que passaram do prazo. Fora de transação. */
export async function expirarVencidos(exec: Executor, tenantId: string): Promise<number> {
  const r = await exec.query(
    `UPDATE pedidos_aprovacao SET status = 'EXPIRADO', erro_execucao = 'Passou do prazo sem decisão.', updated_at = NOW()
      WHERE tenant_id = $1 AND status = 'PENDENTE' AND expira_em <= NOW()`, [tenantId]);
  return r.rowCount ?? 0;
}

export async function lerPedido(exec: Executor, tenantId: string, id: string, travar = false): Promise<PedidoAprovacao | null> {
  const { rows } = await exec.query(
    `SELECT * FROM pedidos_aprovacao WHERE tenant_id = $1 AND id = $2${travar ? ' FOR UPDATE' : ''}`, [tenantId, id]);
  return rows[0] ? linhaParaPedido(rows[0]) : null;
}

export async function listarPedidos(
  exec: Executor, tenantId: string, filtro: { status?: StatusPedido | 'TODOS'; limite?: number } = {},
): Promise<PedidoAprovacao[]> {
  const limite = Math.min(Math.max(filtro.limite ?? 200, 1), 500);
  const porStatus = filtro.status && filtro.status !== 'TODOS';
  const { rows } = await exec.query(
    `SELECT * FROM pedidos_aprovacao WHERE tenant_id = $1 ${porStatus ? 'AND status = $3' : ''}
      ORDER BY (status = 'PENDENTE') DESC, created_at DESC LIMIT $2`,
    porStatus ? [tenantId, limite, filtro.status] : [tenantId, limite]);
  return rows.map(linhaParaPedido);
}

async function gruposDe(exec: Executor, tenantId: string, usuarioId: string): Promise<string[]> {
  const { rows } = await exec.query(
    `SELECT grupo_id FROM grupo_usuario_membros WHERE tenant_id = $1 AND usuario_id = $2`, [tenantId, usuarioId]);
  return rows.map(r => String(r.grupo_id));
}

/** Para a caixa de pedidos: se esta sessão pode decidir cada um, e por quê não. */
export async function marcarQuemPodeDecidir(
  exec: Executor, sessao: SessaoPermissoes, pedidos: PedidoAprovacao[],
): Promise<(PedidoAprovacao & { posso_decidir: boolean; motivo_nao_posso: string })[]> {
  const tenantId = tenantDaSessao(sessao);
  const grupos = sessao.userId ? await gruposDe(exec, tenantId, sessao.userId) : [];
  const direito = new Map<string, boolean>();
  const saida = [];
  for (const p of pedidos) {
    const acao = acaoAprovadoraDo(p.tipo);
    if (!direito.has(acao)) direito.set(acao, await pode(sessao, acao));
    const r = podeDecidirPedido(p, { id: sessao.userId || '', perfil: sessao.perfil, isSuperAdmin: sessao.isSuperAdmin, grupos, temDireito: direito.get(acao)! });
    saida.push({ ...p, posso_decidir: r.ok, motivo_nao_posso: r.ok ? '' : r.motivo });
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Criar

export interface NovoPedido {
  tenantId: string;
  tipo: string;
  alvo_tabela?: string;
  alvo_id?: string;
  descricao: string;
  payload: Record<string, unknown>;
  valor_centavos?: number;
  solicitante: { id: string; nome: string };
  motivo?: string;
  aprovadores?: string[];
  niveis?: number;
  alcada_id?: string | null;
  expiraEmDias?: number;
  /** Padrão true. Dentro de transação de outra pessoa, avise depois do COMMIT. */
  notificar?: boolean;
}

export async function criarPedidoAprovacao(
  input: NovoPedido, exec?: Executor,
): Promise<{ pedido: PedidoAprovacao; jaExistia: boolean }> {
  const e = executorPadrao(exec);
  if (!input.tenantId || !input.tipo || !input.solicitante?.id) throw new ErroAprovacao('Pedido incompleto.');
  const alvoTabela = (input.alvo_tabela || '').slice(0, 60);
  const alvoId = (input.alvo_id || '').slice(0, 120);
  const niveis = Math.min(Math.max(Math.floor(input.niveis ?? 1), 1), 3);
  const dias = Math.min(Math.max(Math.floor(input.expiraEmDias ?? 7), 1), 60);
  const payload = input.payload ?? {};
  // Pedido aberto vencido não segura o novo.
  if (alvoId) {
    await e.query(
      `UPDATE pedidos_aprovacao SET status = 'EXPIRADO', erro_execucao = 'Passou do prazo sem decisão.', updated_at = NOW()
        WHERE tenant_id = $1 AND tipo = $2 AND alvo_tabela = $3 AND alvo_id = $4 AND status = 'PENDENTE' AND expira_em <= NOW()`,
      [input.tenantId, input.tipo, alvoTabela, alvoId]);
  }
  const id = `apr_${generateId()}`;
  const { rows } = await e.query(
    `INSERT INTO pedidos_aprovacao (tenant_id, id, tipo, alvo_tabela, alvo_id, descricao, payload, payload_hash,
       valor_centavos, solicitante_id, solicitante_nome, alcada_id, aprovadores, niveis, motivo, expira_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13::jsonb,$14,$15, NOW() + ($16::int * INTERVAL '1 day'))
     ON CONFLICT (tenant_id, tipo, alvo_tabela, alvo_id) WHERE status = 'PENDENTE' AND alvo_id <> '' DO NOTHING
     RETURNING *`,
    [input.tenantId, id, input.tipo, alvoTabela, alvoId, input.descricao.trim().slice(0, 300),
      JSON.stringify(payload), hashDaCarga(payload), Math.round(input.valor_centavos ?? 0),
      input.solicitante.id, (input.solicitante.nome || '').slice(0, 120), input.alcada_id ?? null,
      JSON.stringify(normalizarAprovadores(input.aprovadores ?? [])), niveis, (input.motivo || '').trim().slice(0, 1000), dias]);
  if (rows.length === 0) {
    const { rows: aberto } = await e.query(
      `SELECT * FROM pedidos_aprovacao WHERE tenant_id = $1 AND tipo = $2 AND alvo_tabela = $3 AND alvo_id = $4 AND status = 'PENDENTE'`,
      [input.tenantId, input.tipo, alvoTabela, alvoId]);
    if (!aberto[0]) throw new ErroAprovacao('Não foi possível abrir o pedido. Tente de novo.', 409);
    return { pedido: linhaParaPedido(aberto[0]), jaExistia: true };
  }
  const pedido = linhaParaPedido(rows[0]);
  if (input.notificar !== false) await avisarAprovadores(pedido, input.tenantId);
  return { pedido, jaExistia: false };
}

export async function avisarAprovadores(pedido: PedidoAprovacao, tenantId: string): Promise<void> {
  await criarNotificacao({
    tenantId, tipo: 'APROVACAO_PEDIDA',
    titulo: 'Pedido de aprovação',
    descricao: `${pedido.solicitante_nome || 'Alguém'} pede: ${pedido.descricao}`,
    link: '/financeiro-ag/aprovacoes', chaveDeduplicacao: `aprovacao:${pedido.id}`,
    data: { pedido_id: pedido.id },
  });
}

// ---------------------------------------------------------------------------
// Decidir

export interface EntradaDecisao {
  id: string;
  decisao: 'aprovar' | 'recusar';
  motivo?: string;
  sessao: SessaoPermissoes & { nome?: string };
}

export async function decidirPedido(input: EntradaDecisao): Promise<PedidoAprovacao> {
  const sessao = input.sessao;
  const tenantId = tenantDaSessao(sessao);
  if (!tenantId || !sessao.userId) throw new ErroAprovacao('Sessão necessária.', 401);
  if (input.decisao !== 'aprovar' && input.decisao !== 'recusar') throw new ErroAprovacao('Escolha aprovar ou recusar.');
  const motivo = (input.motivo || '').trim().slice(0, 1000);
  if (input.decisao === 'recusar' && motivo.length < 3) throw new ErroAprovacao('Diga o motivo da recusa.');

  const final = await emTransacao(async exec => {
    const pedido = await lerPedido(exec, tenantId, input.id, true);
    if (!pedido) throw new ErroAprovacao('Pedido não encontrado.', 404);
    const registro = executores.get(pedido.tipo);
    const temDireito = await pode(sessao, registro?.acaoAprovadora ?? 'aprovar_pagamento', { exec });
    const grupos = await gruposDe(exec, tenantId, sessao.userId!);
    const pode_ = podeDecidirPedido(pedido, { id: sessao.userId!, perfil: sessao.perfil, isSuperAdmin: sessao.isSuperAdmin, grupos, temDireito });
    if (!pode_.ok) throw new ErroAprovacao(pode_.motivo, 403);

    const decisao: DecisaoRegistrada = {
      usuario_id: sessao.userId!, usuario_nome: (sessao.nome || '').slice(0, 120),
      decisao: input.decisao, motivo, em: new Date().toISOString(),
    };
    const decisoes = [...pedido.decisoes, decisao];
    const status = statusDepoisDaDecisao(pedido, input.decisao);
    await exec.query(
      `UPDATE pedidos_aprovacao SET decisoes = $3::jsonb, status = $4, motivo_decisao = $5,
         decidido_em = CASE WHEN $4 = 'PENDENTE' THEN decidido_em ELSE NOW() END, updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, pedido.id, JSON.stringify(decisoes), status, motivo]);
    const atual: PedidoAprovacao = { ...pedido, decisoes, status, motivo_decisao: motivo };
    const ctx: ContextoDeExecucao = { exec, tenantId, pedido: atual, aprovador: { id: decisao.usuario_id, nome: decisao.usuario_nome } };

    if (status === 'RECUSADO' && registro?.aoRecusar) {
      await exec.query('SAVEPOINT aprovacao_recusa');
      try {
        await registro.aoRecusar(ctx);
        await exec.query('RELEASE SAVEPOINT aprovacao_recusa');
      } catch (e) {
        await exec.query('ROLLBACK TO SAVEPOINT aprovacao_recusa');
        await anotarErro(exec, tenantId, pedido.id, 'RECUSADO', e);
      }
    }
    if (status === 'APROVADO') await executarAprovado(ctx, registro);
    return (await lerPedido(exec, tenantId, pedido.id))!;
  });

  if (final.status !== 'PENDENTE') {
    await criarNotificacao({
      tenantId, tipo: 'APROVACAO_DECIDIDA',
      titulo: final.status === 'RECUSADO' ? 'Pedido recusado' : 'Pedido aprovado',
      descricao: `${final.descricao}${final.motivo_decisao ? ` — ${final.motivo_decisao}` : ''}`,
      link: '/financeiro-ag/aprovacoes', vendedorId: final.solicitante_id,
      chaveDeduplicacao: `aprovacao-decidida:${final.id}`, data: { pedido_id: final.id },
    });
  }
  return final;
}

async function anotarErro(exec: Executor, tenantId: string, id: string, status: StatusPedido, e: unknown) {
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  await exec.query(
    `UPDATE pedidos_aprovacao SET status = $3, erro_execucao = $4, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, status, msg]);
}

/** Revalida e executa. Erro do executor desfaz só o efeito, não a decisão. */
async function executarAprovado(ctx: ContextoDeExecucao, registro: RegistroDeExecutor | undefined): Promise<void> {
  const { exec, tenantId, pedido } = ctx;
  const { rows } = await exec.query(`SELECT payload, payload_hash FROM pedidos_aprovacao WHERE tenant_id = $1 AND id = $2`, [tenantId, pedido.id]);
  if (!rows[0] || hashDaCarga(rows[0].payload) !== String(rows[0].payload_hash)) {
    await anotarErro(exec, tenantId, pedido.id, 'EXPIRADO', new Error('O pedido foi alterado depois de criado. Peça de novo.'));
    return;
  }
  // Tipo sem executor: a aprovação fica registrada e quem pediu refaz a ação.
  if (!registro) return;
  await exec.query('SAVEPOINT aprovacao_execucao');
  try {
    const revalidado = registro.revalidar ? await registro.revalidar(ctx) : { ok: true as const };
    if (!revalidado.ok) {
      await exec.query('ROLLBACK TO SAVEPOINT aprovacao_execucao');
      await anotarErro(exec, tenantId, pedido.id, 'EXPIRADO', new Error(revalidado.motivo));
      return;
    }
    const resultado = await registro.executar(ctx);
    await exec.query('RELEASE SAVEPOINT aprovacao_execucao');
    await exec.query(
      `UPDATE pedidos_aprovacao SET status = 'EXECUTADO', resultado = $3::jsonb, executado_em = NOW(), erro_execucao = '', updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, pedido.id, JSON.stringify(resultado ?? {})]);
  } catch (e) {
    await exec.query('ROLLBACK TO SAVEPOINT aprovacao_execucao');
    await anotarErro(exec, tenantId, pedido.id, 'APROVADO', e);
  }
}

// ---------------------------------------------------------------------------
// Alçadas

function linhaParaAlcada(r: Record<string, unknown>): Alcada {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: texto(r.id), nome: texto(r.nome), prioridade: Number(r.prioridade ?? 100), ativo: r.ativo !== false,
    categoria_id: r.categoria_id ? texto(r.categoria_id) : null, centro_custo: r.centro_custo ? texto(r.centro_custo) : null,
    valor_min_centavos: n(r.valor_min_centavos), valor_max_centavos: n(r.valor_max_centavos),
    aprovadores: normalizarAprovadores(r.aprovadores), niveis: Number(r.niveis ?? 1) || 1,
  };
}

export async function listarAlcadas(exec: Executor, tenantId: string): Promise<Alcada[]> {
  const { rows } = await exec.query(
    `SELECT * FROM alcadas_aprovacao WHERE tenant_id = $1 ORDER BY prioridade, id`, [tenantId]);
  return rows.map(linhaParaAlcada);
}

/** Substitui a lista inteira de alçadas da agência (a tela grava tudo de uma vez). */
export async function salvarAlcadas(exec: Executor, tenantId: string, lista: unknown): Promise<Alcada[]> {
  if (!Array.isArray(lista) || lista.length > 50) throw new ErroAprovacao('Lista de alçadas inválida.');
  const limpas: Alcada[] = lista.map((bruto, i) => {
    const a = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
    const centavos = (v: unknown) => {
      if (v === null || v === undefined || v === '') return null;
      const x = Number(v);
      return Number.isFinite(x) && x >= 0 ? Math.round(x) : null;
    };
    const min = centavos(a.valor_min_centavos);
    const max = centavos(a.valor_max_centavos);
    if (min !== null && max !== null && min > max) throw new ErroAprovacao(`Na regra ${i + 1}, o valor mínimo é maior que o máximo.`);
    return {
      id: typeof a.id === 'string' && a.id.trim() ? a.id.trim().slice(0, 80) : `alc_${generateId()}`,
      nome: typeof a.nome === 'string' ? a.nome.trim().slice(0, 80) : '',
      prioridade: (i + 1) * 10,
      ativo: a.ativo !== false,
      categoria_id: typeof a.categoria_id === 'string' && a.categoria_id ? a.categoria_id.slice(0, 120) : null,
      centro_custo: typeof a.centro_custo === 'string' && a.centro_custo ? a.centro_custo.slice(0, 120) : null,
      valor_min_centavos: min, valor_max_centavos: max,
      aprovadores: normalizarAprovadores(a.aprovadores),
      niveis: Math.min(Math.max(Math.floor(Number(a.niveis) || 1), 1), 3),
    };
  });
  await exec.query(`DELETE FROM alcadas_aprovacao WHERE tenant_id = $1`, [tenantId]);
  for (const a of limpas) {
    await exec.query(
      `INSERT INTO alcadas_aprovacao (tenant_id, id, nome, prioridade, ativo, categoria_id, centro_custo,
         valor_min_centavos, valor_max_centavos, aprovadores, niveis)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
      [tenantId, a.id, a.nome, a.prioridade, a.ativo, a.categoria_id, a.centro_custo,
        a.valor_min_centavos, a.valor_max_centavos, JSON.stringify(a.aprovadores), a.niveis]);
  }
  return limpas;
}

// ---------------------------------------------------------------------------
// Aprovação de pagamento (contas a pagar)

export interface ContaPagarParaAprovacao {
  id: string;
  valor_final?: number | null;
  valor_brl?: number | null;
  categoria_id?: string | null;
  centro_custo?: string | null;
  descricao?: string | null;
  fornecedor_nome?: string | null;
  data_vencimento?: string | null;
}

export type SituacaoAprovacaoPagamento =
  | { exige: false; liberado: true }
  | { exige: true; liberado: boolean; alcada: Alcada; status: '' | 'PENDENTE' | 'APROVADO' | 'RECUSADO'; pedido_id: string | null; motivo: string };

export function valorDaContaEmCentavos(c: Pick<ContaPagarParaAprovacao, 'valor_final' | 'valor_brl'>): number {
  const brl = Number(c.valor_brl);
  const v = Number.isFinite(brl) && brl > 0 ? brl : Number(c.valor_final) || 0;
  return Math.round(v * 100);
}

/**
 * A conta precisa de aprovação para ser paga? Sem alçada cadastrada (o padrão),
 * nunca. Com alçada, só fica liberada depois de aprovada E com o mesmo valor
 * que foi aprovado. O status vem da coluna, nunca do JSON da tela.
 */
export async function exigeAprovacaoDoPagamento(
  conta: ContaPagarParaAprovacao, ctx: { tenantId: string; exec?: Executor },
): Promise<SituacaoAprovacaoPagamento> {
  const exec = executorPadrao(ctx.exec);
  const { rows: existe } = await exec.query(`SELECT to_regclass('public.alcadas_aprovacao') IS NOT NULL AS ok`);
  if (existe[0]?.ok !== true) return { exige: false, liberado: true };
  const alcadas = await listarAlcadas(exec, ctx.tenantId);
  const valor = valorDaContaEmCentavos(conta);
  const alcada = escolherAlcada(alcadas, { valor_centavos: valor, categoria_id: conta.categoria_id, centro_custo: conta.centro_custo });
  if (!alcada) return { exige: false, liberado: true };
  const { rows } = await exec.query(
    `SELECT c.aprovacao_status, c.aprovacao_pedido_id, p.valor_centavos, p.status AS pedido_status
       FROM contas_pagar c
       LEFT JOIN pedidos_aprovacao p ON p.tenant_id = c.tenant_id AND p.id = c.aprovacao_pedido_id
      WHERE c.tenant_id = $1 AND c.id = $2`, [ctx.tenantId, conta.id]);
  const linha = rows[0] ?? {};
  let status = (['PENDENTE', 'APROVADO', 'RECUSADO'].includes(String(linha.aprovacao_status)) ? linha.aprovacao_status : '') as '' | 'PENDENTE' | 'APROVADO' | 'RECUSADO';
  // Pedido que expirou (prazo ou revalidação) não deixa a conta presa em "aguardando".
  if (status === 'PENDENTE' && linha.pedido_status !== 'PENDENTE') status = '';
  const pedidoId = linha.aprovacao_pedido_id ? String(linha.aprovacao_pedido_id) : null;
  const mesmoValor = linha.valor_centavos !== null && linha.valor_centavos !== undefined && Number(linha.valor_centavos) === valor;
  const liberado = status === 'APROVADO' && mesmoValor;
  const motivo = liberado ? 'Pagamento aprovado.'
    : status === 'APROVADO' ? 'O valor mudou depois da aprovação. Peça aprovação de novo.'
    : status === 'PENDENTE' ? 'Aguardando aprovação.'
    : status === 'RECUSADO' ? 'Pagamento recusado. Peça de novo com o motivo.'
    : `Pagamento acima da alçada${alcada.nome ? ` "${alcada.nome}"` : ''}: precisa de aprovação.`;
  return { exige: true, liberado, alcada, status, pedido_id: pedidoId, motivo };
}

/** Abre (ou devolve o aberto) pedido de aprovação do pagamento de uma conta. */
export async function pedirAprovacaoDoPagamento(
  input: { tenantId: string; contaPagarId: string; solicitante: { id: string; nome: string }; motivo?: string },
): Promise<{ pedido: PedidoAprovacao; jaExistia: boolean }> {
  const r = await emTransacao(async exec => {
    const { rows } = await exec.query(
      `SELECT data, status FROM contas_pagar WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [input.tenantId, input.contaPagarId]);
    if (!rows[0]) throw new ErroAprovacao('Conta a pagar não encontrada.', 404);
    const data = { ...(rows[0].data as Record<string, unknown>), id: input.contaPagarId } as ContaPagarParaAprovacao & Record<string, unknown>;
    if (STATUS_DE_BAIXA.includes(String(rows[0].status || data.status || ''))) throw new ErroAprovacao('Esta conta já foi paga.', 409);
    const situacao = await exigeAprovacaoDoPagamento(data, { tenantId: input.tenantId, exec });
    if (!situacao.exige) throw new ErroAprovacao('Este pagamento não precisa de aprovação.', 409);
    if (situacao.liberado) throw new ErroAprovacao('Este pagamento já está aprovado.', 409);
    const valor = valorDaContaEmCentavos(data);
    const criado = await criarPedidoAprovacao({
      tenantId: input.tenantId, tipo: 'pagamento', alvo_tabela: 'contas_pagar', alvo_id: input.contaPagarId,
      descricao: `Pagar ${(valor / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} a ${data.fornecedor_nome || 'fornecedor'}${data.descricao ? ` (${data.descricao})` : ''}`,
      payload: { conta_pagar_id: input.contaPagarId, valor_centavos: valor, vencimento: data.data_vencimento ?? null },
      valor_centavos: valor, solicitante: input.solicitante, motivo: input.motivo,
      aprovadores: situacao.alcada.aprovadores, niveis: situacao.alcada.niveis, alcada_id: situacao.alcada.id,
      notificar: false,
    }, exec);
    await exec.query(
      `UPDATE contas_pagar SET aprovacao_status = 'PENDENTE', aprovacao_pedido_id = $3 WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.contaPagarId, criado.pedido.id]);
    return criado;
  });
  if (!r.jaExistia) await avisarAprovadores(r.pedido, input.tenantId);
  return r;
}

registrarExecutorDeAprovacao('pagamento', async ({ exec, tenantId, pedido }) => {
  await exec.query(
    `UPDATE contas_pagar SET aprovacao_status = 'APROVADO' WHERE tenant_id = $1 AND id = $2 AND aprovacao_pedido_id = $3`,
    [tenantId, pedido.alvo_id, pedido.id]);
  return { conta_pagar_id: pedido.alvo_id };
}, {
  acaoAprovadora: 'aprovar_pagamento',
  revalidar: async ({ exec, tenantId, pedido }) => {
    const { rows } = await exec.query(
      `SELECT data, status, aprovacao_pedido_id FROM contas_pagar WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, pedido.alvo_id]);
    if (!rows[0]) return { ok: false, motivo: 'A conta a pagar foi excluída.' };
    if (String(rows[0].aprovacao_pedido_id ?? '') !== pedido.id) return { ok: false, motivo: 'Há um pedido mais novo para esta conta.' };
    const data = rows[0].data as Record<string, unknown>;
    if (STATUS_DE_BAIXA.includes(String(rows[0].status || data.status || ''))) return { ok: false, motivo: 'A conta já foi paga.' };
    if (valorDaContaEmCentavos(data) !== Number(pedido.payload.valor_centavos)) return { ok: false, motivo: 'O valor da conta mudou depois do pedido. Peça de novo.' };
    return { ok: true };
  },
  aoRecusar: async ({ exec, tenantId, pedido }) => {
    await exec.query(
      `UPDATE contas_pagar SET aprovacao_status = 'RECUSADO' WHERE tenant_id = $1 AND id = $2 AND aprovacao_pedido_id = $3`,
      [tenantId, pedido.alvo_id, pedido.id]);
  },
});
