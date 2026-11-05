/**
 * Ações em lote da lista Contas a Pagar/Receber (05/11/2026): Reagendar
 * vencimento, Recategorizar (categoria e centro de custo) e Excluir.
 * A liquidação em lote NÃO passa por aqui: é sempre `POST /api/baixas`.
 *
 * Sempre em dois tempos:
 *   1. prévia: diz, conta por conta, o que vai mudar e o que fica de fora
 *      (com o motivo), e devolve a `assinatura` das contas que vão mudar;
 *   2. gravar: recebe SÓ as contas que a prévia aprovou e a assinatura. Tudo
 *      numa transação: ou todas mudam, ou nenhuma. Se uma conta mudou desde a
 *      prévia, nada é gravado (409); se o caixa foi fechado no meio, 423.
 *
 * As regras são as das rotas de hoje, conta por conta:
 *   - reagendar: só conta em aberto e sem baixa; a data nova não pode cair em
 *     período fechado (Fechar Caixa) e respeita os limites de vencimento da
 *     agência (Limites e aprovação), como a edição;
 *   - recategorizar: categoria do mesmo tipo (despesa para pagar, receita para
 *     receber); conta dividida por rateio muda na própria conta; conta já
 *     baixada pede o direito "Alterar lançamento já baixado"; categoria e
 *     centro não são dinheiro, então o período fechado não trava (como hoje);
 *   - excluir: as mesmas guardas do DELETE de hoje (perfil que exclui, estorno
 *     do que já foi baixado na conta que pagou/recebeu, período fechado pelo
 *     gatilho do banco). Conta já baixada pede "Alterar lançamento já
 *     baixado"; conta que nasceu de venda/fatura pede "Excluir lançamento
 *     ligado a venda ou fatura".
 */
import { createHash } from 'node:crypto';
import type { ExecutorSQL } from './caixa-atomico';
import { estornarBaixaDaConta } from './caixa-atomico';
import { addDias, num, round2 } from './money';
import { mensagemPeriodoFechado } from './periodo-fechado';
import { verificarBloqueios } from './bloqueios-financeiros';
import { lerBloqueios } from './bloqueios-servidor';
import type { ExecutorPermissoes } from './permissoes-servidor';
import type { AcaoFinanceira } from './acoes-financeiras';
import { STATUS_DE_BAIXA } from './guarda-baixa';
import { tituloGeradoPeloSistema, tituloSemBaixa } from './recorrencia';
import { baixadoDaConta, valorDaConta, type TabelaDaConta } from './contas-pagar-receber';

export const ACOES_DE_LOTE = ['reagendar', 'recategorizar', 'excluir'] as const;
export type AcaoDeLote = (typeof ACOES_DE_LOTE)[number];
export const LOTE_MAX = 500;

export interface ItemDoLote { tabela: TabelaDaConta; id: string }

export interface PedidoDeLote {
  acao: AcaoDeLote;
  itens: ItemDoLote[];
  /** Reagendar: data nova para todas... */
  nova_data?: string;
  /** ...ou mover N dias (negativo adianta). */
  dias?: number;
  /** Recategorizar: undefined = não mexe. */
  categoria_id?: string;
  /** Recategorizar: undefined = não mexe; '' = sem centro. */
  centro_custo_id?: string;
}

export type MotivoDeFora = 'periodo' | 'regra' | 'permissao' | 'nao_encontrada';

export interface ResultadoDoItem {
  tabela: TabelaDaConta;
  id: string;
  descricao: string;
  pessoa: string;
  valor: number;
  ok: boolean;
  /** Por que fica de fora (ok = false). */
  motivo?: string;
  tipo_motivo?: MotivoDeFora;
  /** Como está e como fica, por extenso. */
  antes?: string;
  depois?: string;
  /** Consequência que a pessoa precisa saber (ex.: o pago volta para a conta). */
  aviso?: string;
}

export interface ResultadoDoLote {
  acao: AcaoDeLote;
  itens: ResultadoDoItem[];
  prontos: number;
  fora: number;
  /** Assinatura das contas prontas, no estado em que foram lidas. */
  assinatura: string;
  gravado: boolean;
}

/** Quem pede: o que pode e quais contas bancárias enxerga (null = todas). */
export interface QuemPedeLote {
  pode(acao: AcaoFinanceira): Promise<boolean>;
  contasLiberadas: readonly string[] | null;
}

export class ErroDoLote extends Error {
  constructor(message: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) { super(message); }
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const TABELAS = new Set<TabelaDaConta>(['contas_pagar', 'contas_receber']);

function dataBR(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : 'sem data';
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Confere a forma do pedido. Lança ErroDoLote (400). */
export function lerPedido(corpo: unknown): PedidoDeLote {
  const c = (corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? corpo : {}) as Record<string, unknown>;
  const acao = c.acao as AcaoDeLote;
  if (!ACOES_DE_LOTE.includes(acao)) throw new ErroDoLote('Ação inválida.');
  if (!Array.isArray(c.itens) || c.itens.length === 0) throw new ErroDoLote('Escolha ao menos uma conta.');
  if (c.itens.length > LOTE_MAX) throw new ErroDoLote(`Até ${LOTE_MAX} contas por vez.`);
  const vistos = new Set<string>();
  const itens: ItemDoLote[] = [];
  for (const i of c.itens as Array<Record<string, unknown>>) {
    const tabela = i?.tabela as TabelaDaConta;
    const id = typeof i?.id === 'string' ? i.id.trim() : '';
    if (!TABELAS.has(tabela) || !id || id.length > 120) throw new ErroDoLote('Conta inválida na seleção.');
    const chave = `${tabela}:${id}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push({ tabela, id });
  }
  const pedido: PedidoDeLote = { acao, itens };
  if (acao === 'reagendar') {
    const nova = typeof c.nova_data === 'string' ? c.nova_data.trim() : '';
    const dias = c.dias === undefined || c.dias === null || c.dias === '' ? null : Number(c.dias);
    if (nova) {
      if (!DATA.test(nova)) throw new ErroDoLote('Data inválida.');
      pedido.nova_data = nova;
    } else if (dias !== null) {
      if (!Number.isInteger(dias) || dias === 0 || Math.abs(dias) > 3650) throw new ErroDoLote('Informe quantos dias mover (até 3650).');
      pedido.dias = dias;
    } else {
      throw new ErroDoLote('Informe a data nova do vencimento.');
    }
  }
  if (acao === 'recategorizar') {
    if (typeof c.categoria_id === 'string' && c.categoria_id.trim()) pedido.categoria_id = c.categoria_id.trim().slice(0, 100);
    if (typeof c.centro_custo_id === 'string') pedido.centro_custo_id = c.centro_custo_id.trim().slice(0, 100);
    if (pedido.categoria_id === undefined && pedido.centro_custo_id === undefined) {
      throw new ErroDoLote('Escolha a categoria ou o centro de custo novo.');
    }
  }
  return pedido;
}

interface Linha { tabela: TabelaDaConta; id: string; d: Record<string, unknown>; v: string }

async function lerLinhas(exec: ExecutorSQL, tenantId: string, itens: ItemDoLote[], travar: boolean): Promise<Map<string, Linha>> {
  const mapa = new Map<string, Linha>();
  for (const tabela of ['contas_pagar', 'contas_receber'] as const) {
    const ids = itens.filter(i => i.tabela === tabela).map(i => i.id);
    if (!ids.length) continue;
    // Ordem fixa: dois lotes cruzados não travam um no outro.
    const { rows } = await exec.query(
      `SELECT id, data, updated_at::text AS v FROM ${tabela} WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY id${travar ? ' FOR UPDATE' : ''}`,
      [tenantId, ids],
    );
    for (const r of rows) mapa.set(`${tabela}:${r.id}`, { tabela, id: String(r.id), d: (r.data ?? {}) as Record<string, unknown>, v: String(r.v ?? '') });
  }
  return mapa;
}

/** A linha está visível para a pessoa (mesma regra da lista e do CRUD)? */
function visivel(d: Record<string, unknown>, contas: readonly string[] | null): boolean {
  if (contas === null) return true;
  if (!STATUS_DE_BAIXA.includes(String(d.status ?? ''))) return true;
  const conta = typeof d.conta_bancaria_id === 'string' ? d.conta_bancaria_id : '';
  return conta === '' || contas.includes(conta);
}

const temFechamento = async (exec: ExecutorSQL) =>
  (await exec.query(`SELECT to_regprocedure('fin_fechado_ate(text,text)') IS NOT NULL AS ok`)).rows[0]?.ok === true;

/** Até quando a conta (ou a agência) está fechada; cache por conta. */
function fechamentos(exec: ExecutorSQL, tenantId: string, existe: boolean) {
  const cache = new Map<string, Promise<string | null>>();
  return (conta: string) => {
    if (!existe) return Promise.resolve(null);
    if (!cache.has(conta)) {
      cache.set(conta, exec.query(`SELECT fin_fechado_ate($1, $2)::text AS d`, [tenantId, conta])
        .then(r => (r.rows[0]?.d as string | null) ?? null));
    }
    return cache.get(conta)!;
  };
}

/** O título tem dinheiro numa data já fechada? (a mesma pergunta do gatilho ao excluir) */
async function dinheiroEmPeriodoFechado(exec: ExecutorSQL, tenantId: string, l: Linha): Promise<string | null> {
  const { rows } = await exec.query(
    `SELECT CASE WHEN (fin_valor_baixado($2, $4::jsonb) <> 0
                       AND fin_periodo_fechado($1, $4::jsonb->>'conta_bancaria_id', fin_data_segura($4::jsonb->>$5)))
                   OR (to_regclass('public.baixas') IS NOT NULL AND EXISTS (
                        SELECT 1 FROM baixas b
                         WHERE b.tenant_id = $1 AND b.titulo_tabela = $2 AND b.titulo_id = $3
                           AND b.tipo IN ('baixa', 'anterior', 'legada')
                           AND NOT EXISTS (SELECT 1 FROM baixas e WHERE e.tenant_id = b.tenant_id AND e.estorna_baixa_id = b.id)
                           AND fin_periodo_fechado($1, b.conta_bancaria_id, b.data_baixa)))
                 THEN fin_fechado_ate($1, COALESCE($4::jsonb->>'conta_bancaria_id', ''))::text END AS ate`,
    [tenantId, l.tabela, l.id, JSON.stringify(l.d), l.tabela === 'contas_receber' ? 'data_recebimento' : 'data_pagamento'],
  );
  return (rows[0]?.ate as string | null) ?? null;
}

interface Contexto {
  categoria?: { id: string; nome: string; tipo: string; natureza_custo: unknown; is_custo_comercial: unknown } | null;
  centro?: { id: string; nome: string } | null;
}

async function carregarContexto(exec: ExecutorSQL, tenantId: string, p: PedidoDeLote): Promise<Contexto> {
  const ctx: Contexto = {};
  if (p.acao !== 'recategorizar') return ctx;
  if (p.categoria_id !== undefined) {
    const { rows } = await exec.query(`SELECT id, data, tipo FROM plano_contas WHERE tenant_id = $1 AND id = $2`, [tenantId, p.categoria_id]);
    if (!rows[0]) throw new ErroDoLote('A categoria escolhida não existe mais. Recarregue a tela.', 404);
    const d = (rows[0].data ?? {}) as Record<string, unknown>;
    if (d.ativo === false) throw new ErroDoLote('A categoria escolhida está desativada.');
    ctx.categoria = {
      id: String(rows[0].id), nome: String(d.nome ?? ''), tipo: String(d.tipo ?? rows[0].tipo ?? '').toUpperCase(),
      natureza_custo: d.natureza_custo, is_custo_comercial: d.is_custo_comercial,
    };
  }
  if (p.centro_custo_id) {
    const { rows } = await exec.query(`SELECT id, nome, data FROM centros_custo WHERE tenant_id = $1 AND id = $2`, [tenantId, p.centro_custo_id]);
    if (!rows[0]) throw new ErroDoLote('O centro de custo escolhido não existe mais. Recarregue a tela.', 404);
    const d = (rows[0].data ?? {}) as Record<string, unknown>;
    if (d.ativo === false) throw new ErroDoLote('O centro de custo escolhido está desativado.');
    ctx.centro = { id: String(rows[0].id), nome: String(rows[0].nome || d.nome || '') };
  } else if (p.centro_custo_id === '') {
    ctx.centro = null;
  }
  return ctx;
}

function assinar(p: PedidoDeLote, prontas: Array<{ chave: string; v: string }>): string {
  const partes = [p.acao, p.nova_data ?? null, p.dias ?? null, p.categoria_id ?? null, p.centro_custo_id ?? null,
    [...prontas].sort((a, b) => a.chave.localeCompare(b.chave)).map(x => [x.chave, x.v])];
  return createHash('sha256').update(JSON.stringify(partes)).digest('hex').slice(0, 32);
}

const RECUSA_TIPO_DA_CATEGORIA: Record<TabelaDaConta, string> = {
  contas_pagar: 'A categoria escolhida é de receita; esta é uma conta a pagar.',
  contas_receber: 'A categoria escolhida é de despesa; esta é uma conta a receber.',
};

/**
 * Prévia (gravar = false) ou gravação. Na gravação, `assinatura` é obrigatória
 * e todas as contas pedidas precisam estar prontas; tudo numa transação (o
 * chamador passa o executor da transação).
 */
export async function executarLote(
  exec: ExecutorSQL,
  tenantId: string,
  pedido: PedidoDeLote,
  quem: QuemPedeLote,
  hoje: string,
  opcoes: { gravar: boolean; assinatura?: string },
): Promise<ResultadoDoLote> {
  if (opcoes.gravar && !opcoes.assinatura) throw new ErroDoLote('Faça a prévia antes de confirmar.');
  const ctx = await carregarContexto(exec, tenantId, pedido);
  const linhas = await lerLinhas(exec, tenantId, pedido.itens, opcoes.gravar);
  const existeFechamento = await temFechamento(exec);
  const fechadoAte = fechamentos(exec, tenantId, existeFechamento);
  const permissoes = new Map<AcaoFinanceira, Promise<boolean>>();
  const pode = (a: AcaoFinanceira) => {
    if (!permissoes.has(a)) permissoes.set(a, quem.pode(a));
    return permissoes.get(a)!;
  };
  // Nome da categoria atual, para a prévia dizer "de → para".
  const nomesDeCategoria = new Map<string, string>();
  if (pedido.acao === 'recategorizar' && ctx.categoria) {
    const ids = [...new Set([...linhas.values()].map(l => String(l.d.categoria_id ?? '')).filter(Boolean))];
    if (ids.length) {
      const { rows } = await exec.query(`SELECT id, data FROM plano_contas WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, ids]);
      for (const c of rows) nomesDeCategoria.set(String(c.id), String((c.data as Record<string, unknown>)?.nome ?? ''));
    }
  }
  const bloqueios = pedido.acao === 'reagendar' ? await lerBloqueios(exec as unknown as ExecutorPermissoes, tenantId) : null;
  const dispensa = pedido.acao === 'reagendar' ? await pode('aprovar_excecao') : false;

  const itens: ResultadoDoItem[] = [];
  const prontas: Array<{ chave: string; v: string; linha: Linha; novo?: Record<string, unknown> }> = [];

  for (const it of pedido.itens) {
    const l = linhas.get(`${it.tabela}:${it.id}`);
    if (!l || !visivel(l.d, quem.contasLiberadas)) {
      itens.push({ tabela: it.tabela, id: it.id, descricao: '', pessoa: '', valor: 0, ok: false,
        motivo: 'Esta conta não existe mais ou não está liberada para você.', tipo_motivo: 'nao_encontrada' });
      continue;
    }
    const d = l.d;
    const status = String(d.status ?? '');
    const r: ResultadoDoItem = {
      tabela: l.tabela, id: l.id,
      descricao: String(d.descricao ?? ''),
      pessoa: String((l.tabela === 'contas_pagar' ? d.fornecedor_nome : d.cliente_nome) ?? ''),
      valor: valorDaConta(l.tabela, d),
      ok: false,
    };
    const fora = (motivo: string, tipo: MotivoDeFora) => { r.motivo = motivo; r.tipo_motivo = tipo; };
    const baixado = baixadoDaConta(l.tabela, d) > 0 || STATUS_DE_BAIXA.includes(status);
    let novo: Record<string, unknown> | undefined;

    if (pedido.acao === 'reagendar') {
      const atual = String(d.data_vencimento ?? '').slice(0, 10);
      const nova = pedido.nova_data ?? (DATA.test(atual) && pedido.dias ? addDias(atual, pedido.dias) : '');
      r.antes = atual ? dataBR(atual) : 'sem vencimento';
      r.depois = nova ? dataBR(nova) : undefined;
      if (status === 'CANCELADO') fora('Conta cancelada.', 'regra');
      else if (!tituloSemBaixa(l.tabela, d)) fora(l.tabela === 'contas_pagar' ? 'Já tem pagamento registrado: o vencimento fica como está.' : 'Já tem recebimento registrado: o vencimento fica como está.', 'regra');
      else if (!nova) fora('A conta não tem vencimento para mover.', 'regra');
      else if (nova === atual) fora('O vencimento já é esta data.', 'regra');
      else {
        const ate = await fechadoAte(String(d.conta_bancaria_id ?? ''));
        const v = verificarBloqueios({ config: bloqueios, hoje, dispensaAprovacao: dispensa, vencimento_atual: atual, vencimento_novo: nova });
        if (ate && nova <= ate) fora(mensagemPeriodoFechado(ate), 'periodo');
        else if (!v.ok) fora(`${v.motivo} Peça a quem aprova exceções ou ajuste o limite em Limites e aprovação.`, 'regra');
        else novo = { ...d, data_vencimento: nova };
      }
    } else if (pedido.acao === 'recategorizar') {
      const rateio = Array.isArray(d.rateio) ? d.rateio as Array<Record<string, unknown>> : [];
      const mudaCategoria = ctx.categoria !== undefined && ctx.categoria !== null && ctx.categoria.id !== String(d.categoria_id ?? '');
      const mudaCentro = ctx.centro !== undefined && (ctx.centro?.id ?? '') !== String(d.centro_custo_id ?? '');
      const partesAntes: string[] = [];
      const partesDepois: string[] = [];
      if (ctx.categoria) { partesAntes.push(nomesDeCategoria.get(String(d.categoria_id ?? '')) || 'sem categoria'); partesDepois.push(ctx.categoria.nome || 'categoria nova'); }
      if (ctx.centro !== undefined) { partesAntes.push(String(d.centro_custo ?? '') || 'sem centro'); partesDepois.push(ctx.centro?.nome || 'sem centro'); }
      r.antes = partesAntes.join(' · ');
      r.depois = partesDepois.join(' · ');
      const tipoEsperado = l.tabela === 'contas_pagar' ? 'DESPESA' : 'RECEITA';
      if (status === 'CANCELADO') fora('Conta cancelada.', 'regra');
      else if (ctx.categoria && ctx.categoria.tipo && ctx.categoria.tipo !== tipoEsperado) fora(RECUSA_TIPO_DA_CATEGORIA[l.tabela], 'regra');
      else if (!mudaCategoria && !mudaCentro) fora('Já está assim.', 'regra');
      else if (mudaCentro && rateio.length > 0) fora('Está dividida entre centros de custo (rateio): mude na própria conta.', 'regra');
      else if (mudaCategoria && rateio.some(x => typeof x?.categoria_id === 'string' && x.categoria_id)) fora('Está dividida entre categorias (rateio): mude na própria conta.', 'regra');
      else if (baixado && !(await pode('editar_liquidado'))) fora('Já foi baixada, e seu acesso não inclui alterar lançamento já baixado.', 'permissao');
      else {
        novo = { ...d };
        if (mudaCategoria && ctx.categoria) {
          novo.categoria_id = ctx.categoria.id;
          // O mesmo que a tela de contas a pagar faz ao trocar a categoria.
          if (l.tabela === 'contas_pagar') {
            if (ctx.categoria.natureza_custo !== undefined && ctx.categoria.natureza_custo !== null) novo.natureza_custo = ctx.categoria.natureza_custo;
            if (ctx.categoria.is_custo_comercial !== undefined && ctx.categoria.is_custo_comercial !== null) novo.is_custo_comercial = ctx.categoria.is_custo_comercial;
          }
        }
        if (mudaCentro) {
          novo.centro_custo_id = ctx.centro?.id ?? '';
          novo.centro_custo = ctx.centro?.nome ?? '';
        }
      }
    } else {
      // excluir
      const valorNoCaixa = baixadoDaConta(l.tabela, d) > 0 ? round2(num(l.tabela === 'contas_pagar' ? d.valor_pago : d.valor_recebido) || valorDaConta(l.tabela, d)) : 0;
      r.antes = valorNoCaixa > 0 ? `${l.tabela === 'contas_pagar' ? 'Pago' : 'Recebido'} ${brl(valorNoCaixa)}` : 'Sem baixa';
      r.depois = 'Excluída';
      const ate = existeFechamento && valorNoCaixa > 0 ? await dinheiroEmPeriodoFechado(exec, tenantId, l) : null;
      if (ate) fora(mensagemPeriodoFechado(ate), 'periodo');
      else if (baixado && !(await pode('editar_liquidado'))) fora('Já foi baixada, e seu acesso não inclui alterar lançamento já baixado.', 'permissao');
      else if (tituloGeradoPeloSistema(l.tabela, d) && !(await pode('excluir_com_vinculo'))) fora('Nasceu de uma venda ou fatura, e seu acesso não inclui excluir lançamento ligado a venda ou fatura.', 'permissao');
      else {
        if (valorNoCaixa > 0) {
          r.aviso = l.tabela === 'contas_pagar'
            ? `Os ${brl(valorNoCaixa)} pagos voltam para a conta bancária que pagou.`
            : `Os ${brl(valorNoCaixa)} recebidos saem da conta bancária que recebeu.`;
        }
        novo = d;
      }
    }

    if (!r.motivo) {
      r.ok = true;
      prontas.push({ chave: `${l.tabela}:${l.id}`, v: l.v, linha: l, novo });
    }
    itens.push(r);
  }

  const assinatura = assinar(pedido, prontas);
  const resultado: ResultadoDoLote = {
    acao: pedido.acao, itens, prontos: prontas.length, fora: itens.length - prontas.length, assinatura, gravado: false,
  };
  if (!opcoes.gravar) return resultado;

  // Gravar: tudo o que foi pedido precisa estar pronto, no mesmo estado da prévia.
  const periodo = itens.find(i => !i.ok && i.tipo_motivo === 'periodo');
  if (periodo) throw new ErroDoLote(periodo.motivo ?? 'Período fechado.', 423, { itens });
  if (prontas.length !== pedido.itens.length || assinatura !== opcoes.assinatura) {
    throw new ErroDoLote('Alguma conta mudou desde a prévia. Veja a prévia de novo antes de confirmar.', 409, { itens });
  }

  for (const p of prontas) {
    if (pedido.acao === 'excluir') {
      const { rows } = await exec.query(`DELETE FROM ${p.linha.tabela} WHERE id = $1 AND tenant_id = $2 RETURNING data`, [p.linha.id, tenantId]);
      const data = rows[0]?.data as Record<string, unknown> | undefined;
      if (data) await estornarBaixaDaConta(tenantId, p.linha.tabela, data, exec);
    } else {
      await exec.query(
        `UPDATE ${p.linha.tabela} SET data = $3::jsonb, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [p.linha.id, tenantId, JSON.stringify(p.novo)],
      );
    }
  }
  return { ...resultado, gravado: true };
}
