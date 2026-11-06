/**
 * DRE e fluxo de caixa por CENTRO DE CUSTO e por TAG (E7, frente C). Lógica
 * pura: a tela calcula no navegador, com as mesmas listas que já carrega.
 *
 * Três peças:
 *  - `tagsDasContas`: as tags que existem nos títulos (opções do filtro).
 *  - `resultadoPorTag` (DRE): entradas (contas a receber), saídas (contas a
 *    pagar) e resultado por tag nos meses da visão. Competência: valor do
 *    título pelo vencimento. Caixa: o que se moveu, pela data da baixa. Título
 *    com várias tags conta em cada uma; sem tag vai para "Sem tag".
 *  - `fluxoPorDimensao` (fluxo de caixa): entrou, saiu (realizado, pela data
 *    da baixa) e a entrar, a sair (previsto, pelo vencimento; vencido em
 *    aberto, hoje) por centro ou por tag, com as datas do caderno
 *    (`lancamentosDoCaixa`). Conta rateada entra com a parte de cada centro.
 *  - `recortarContasDoFluxo`: as contas a receber e a pagar só com a parte do
 *    recorte (centro e os de baixo, tag), para o caderno e o Previsto ×
 *    Realizado do recorte. A mesma regra do DRE (dre-recorte.ts).
 *
 * Sem recorte nada aqui muda as telas: elas só chamam estas funções quando a
 * pessoa escolhe um filtro ou um agrupamento.
 */
import { dimensoesDoLancamento, normalizarTags, valorMovimentadoDaConta, type CentroDoContexto } from './dimensoes';
import { aplicarRecorteDRE, centrosAceitos, chaveDaTag, contaTemTag, type CentroDoRecorte } from './dre-recorte';
import type { Lancamento } from './caderno-caixa';
import { mesDe, num, ratearTotal, round2 } from './money';

export const SEM_TAG = '__sem_tag';
export const SEM_CENTRO = '__sem_centro';
export const ROTULO_SEM_TAG = 'Sem tag';
export const ROTULO_SEM_CENTRO = 'Sem centro de custo';

type ContaComTags = { tags?: unknown; status?: string | null };

/** As tags que existem nas contas (uma por grafia sem acento), em ordem alfabética. */
export function tagsDasContas(...listas: ReadonlyArray<readonly ContaComTags[]>): Array<{ valor: string; rotulo: string }> {
  const vistas = new Map<string, string>();
  for (const lista of listas) {
    for (const c of lista) {
      for (const t of normalizarTags(c.tags)) {
        const k = chaveDaTag(t);
        if (k && (!vistas.has(k) || melhorGrafia(vistas.get(k)!, t) === t)) vistas.set(k, t);
      }
    }
  }
  return [...vistas.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(t => ({ valor: t, rotulo: t }));
}

/**
 * Entre duas grafias da mesma tag ("promocao", "Promoção"), a que tem acento
 * ou maiúscula: é a que a pessoa escreveu com cuidado.
 */
function melhorGrafia(atual: string, nova: string): string {
  const cuidado = (t: string) => (t !== t.toLocaleLowerCase('pt-BR') ? 1 : 0) + (t !== t.normalize('NFD').replace(/[\u0300-\u036f]/g, '') ? 1 : 0);
  return cuidado(nova) > cuidado(atual) ? nova : atual;
}

/** Grafia de cada tag nas listas (a mais cuidada), pela chave sem acento. */
export function grafiasDasTags(...listas: ReadonlyArray<readonly ContaComTags[]>): Map<string, string> {
  return new Map(tagsDasContas(...listas).map(t => [chaveDaTag(t.valor), t.valor]));
}

/** Grupos de uma conta pela tag: cada tag (grafia da conta) ou "Sem tag". */
function gruposDeTag(conta: ContaComTags, grafias?: ReadonlyMap<string, string>): Array<{ chave: string; rotulo: string }> {
  const tags = normalizarTags(conta.tags);
  if (!tags.length) return [{ chave: SEM_TAG, rotulo: ROTULO_SEM_TAG }];
  const vistas = new Set<string>();
  return tags.flatMap(t => {
    const chave = chaveDaTag(t);
    if (vistas.has(chave)) return [];
    vistas.add(chave);
    return [{ chave, rotulo: grafias?.get(chave) ?? t }];
  });
}

// ---------------------------------------------------------------------------
// DRE: resultado por tag
// ---------------------------------------------------------------------------

export interface LinhaPorTag {
  chave: string;
  rotulo: string;
  entradas: number;
  saidas: number;
  resultado: number;
  /** Títulos que caíram nesta tag. */
  titulos: number;
}

export interface ResultadoPorTag {
  linhas: LinhaPorTag[];
  /** Soma dos títulos (cada título uma vez, mesmo com várias tags). */
  totais: { entradas: number; saidas: number; resultado: number };
  /** Títulos com mais de uma tag (contam em cada uma). */
  com_varias_tags: number;
}

type ContaDRE = ContaComTags & {
  id: string;
  valor_final?: number | null;
  data_vencimento?: string | null;
  data_recebimento?: string | null;
  data_pagamento?: string | null;
  valor_recebido?: number | null;
  valor_pago?: number | null;
};

/**
 * Entradas, saídas e resultado por tag nos `meses` (AAAA-MM). Use as listas já
 * recortadas da tela (empresa, centro, rateio): o valor de cada conta já vem
 * com a parte do recorte.
 */
export function resultadoPorTag(e: {
  receber: readonly ContaDRE[];
  pagar: readonly ContaDRE[];
  meses: readonly string[];
  regime: 'competencia' | 'caixa';
}): ResultadoPorTag {
  const meses = new Set(e.meses);
  const grafias = grafiasDasTags(e.receber, e.pagar);
  const grupos = new Map<string, LinhaPorTag>();
  const totais = { entradas: 0, saidas: 0, resultado: 0 };
  let varias = 0;
  const somar = (c: ContaDRE, lado: 'receber' | 'pagar') => {
    if (String(c.status ?? '') === 'CANCELADO') return;
    const data = e.regime === 'caixa'
      ? String((lado === 'receber' ? c.data_recebimento : c.data_pagamento) ?? '')
      : String(c.data_vencimento ?? '');
    if (!meses.has(mesDe(data))) return;
    const valor = e.regime === 'caixa' ? valorMovimentadoDaConta(c as Record<string, unknown>, lado) : round2(num(c.valor_final));
    if (valor === 0) return;
    const gs = gruposDeTag(c, grafias);
    if (gs.length > 1) varias++;
    for (const g of gs) {
      const l = grupos.get(g.chave) ?? { chave: g.chave, rotulo: g.rotulo, entradas: 0, saidas: 0, resultado: 0, titulos: 0 };
      if (lado === 'receber') l.entradas = round2(l.entradas + valor);
      else l.saidas = round2(l.saidas + valor);
      l.resultado = round2(l.entradas - l.saidas);
      l.titulos += 1;
      grupos.set(g.chave, l);
    }
    if (lado === 'receber') totais.entradas = round2(totais.entradas + valor);
    else totais.saidas = round2(totais.saidas + valor);
  };
  for (const c of e.receber) somar(c, 'receber');
  for (const c of e.pagar) somar(c, 'pagar');
  totais.resultado = round2(totais.entradas - totais.saidas);
  return { linhas: ordenarGrupos([...grupos.values()], SEM_TAG), totais, com_varias_tags: varias };
}

function ordenarGrupos<T extends { chave: string; rotulo: string }>(linhas: T[], sem: string): T[] {
  return linhas.sort((a, b) => (a.chave === sem ? 1 : 0) - (b.chave === sem ? 1 : 0) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Fluxo de caixa: recorte e visão por centro / tag
// ---------------------------------------------------------------------------

export interface RecorteDoFluxo {
  /** Centro (e os de baixo). Vazio = todos. */
  centro_id?: string | null;
  /** Tag. Vazio = todas. */
  tag?: string | null;
}

export function recorteDoFluxoVazio(r: RecorteDoFluxo | null | undefined): boolean {
  return !r || (!r.centro_id && !chaveDaTag(r.tag));
}

type ContaDoFluxo = ContaComTags & { id: string; valor_final?: number | null };

/**
 * As contas com a parte do recorte (valor, recebido/pago e taxa na mesma
 * fração). Sem recorte, as mesmas listas.
 */
export function recortarContasDoFluxo<CR extends ContaDoFluxo, CP extends ContaDoFluxo>(
  e: { receber: readonly CR[]; pagar: readonly CP[] }, recorte: RecorteDoFluxo | null | undefined, centros: readonly CentroDoRecorte[],
): { receber: CR[]; pagar: CP[] } {
  if (recorteDoFluxoVazio(recorte)) return { receber: [...e.receber], pagar: [...e.pagar] };
  const r = aplicarRecorteDRE(
    { receber: e.receber as unknown as Array<CR & { id: string }>, pagar: e.pagar as unknown as Array<CP & { id: string }>, vendas: [] },
    { centro_id: recorte?.centro_id || null, tag: recorte?.tag || null },
    centros,
  );
  return { receber: r.receber as CR[], pagar: r.pagar as CP[] };
}

export type DimensaoDoFluxo = 'centro' | 'tag';

export interface LinhaDoFluxoPorDimensao {
  chave: string;
  rotulo: string;
  /** Recuo na árvore de centros (0 na tag). */
  nivel: number;
  entrou: number;
  saiu: number;
  a_entrar: number;
  a_sair: number;
  /** (entrou + a entrar) − (saiu + a sair). */
  resultado: number;
}

export interface FluxoPorDimensao {
  linhas: LinhaDoFluxoPorDimensao[];
  totais: Omit<LinhaDoFluxoPorDimensao, 'chave' | 'rotulo' | 'nivel'>;
  /** Títulos com mais de uma tag no período (contam em cada uma; só na visão por tag). */
  com_varias_tags: number;
}

const ID_DO_LANCAMENTO = /^(cr|cp)-(.+)-(baixa|aberto)$/;

/**
 * Entrou, saiu, a entrar e a sair por centro de custo ou por tag, no período,
 * com os lançamentos do caderno (`lancamentosDoCaixa` ou `lancamentosDaConta`
 * das MESMAS listas `receber`/`pagar`, sem recorte). O recorte escolhido vale
 * aqui também: com centro, só as partes nele e nos de baixo; com tag, só as
 * contas com a tag. Sem recorte, a soma bate com o caderno (a folha ainda não
 * lançada entra em "Sem centro de custo" / "Sem tag").
 */
export function fluxoPorDimensao(e: {
  lancamentos: readonly Lancamento[];
  receber: readonly ContaDoFluxo[];
  pagar: readonly ContaDoFluxo[];
  periodo: { inicio: string; fim: string };
  dimensao: DimensaoDoFluxo;
  centros: readonly (CentroDoRecorte & { ativo?: boolean })[];
  recorte?: RecorteDoFluxo | null;
}): FluxoPorDimensao {
  const vazio = recorteDoFluxoVazio(e.recorte);
  const aceitos = e.recorte?.centro_id ? centrosAceitos(e.recorte.centro_id, e.centros) : null;
  const tagDoRecorte = chaveDaTag(e.recorte?.tag);
  const cr = new Map(e.receber.map(c => [c.id, c]));
  const cp = new Map(e.pagar.map(c => [c.id, c]));
  const grupos = new Map<string, LinhaDoFluxoPorDimensao>();
  const varias = new Set<string>();
  const grafias = grafiasDasTags(e.receber, e.pagar);
  const nomeDoCentro = new Map(e.centros.map(c => [c.id, `${c.codigo ? `${c.codigo} ` : ''}${c.nome ?? ''}`.trim()]));

  const somar = (chave: string, rotulo: string, l: Lancamento, valor: number) => {
    if (valor === 0) return;
    const g = grupos.get(chave) ?? { chave, rotulo, nivel: 0, entrou: 0, saiu: 0, a_entrar: 0, a_sair: 0, resultado: 0 };
    const realizado = l.situacao === 'realizado';
    if (l.tipo === 'entrada') {
      if (realizado) g.entrou = round2(g.entrou + valor); else g.a_entrar = round2(g.a_entrar + valor);
    } else if (realizado) g.saiu = round2(g.saiu + valor); else g.a_sair = round2(g.a_sair + valor);
    g.resultado = round2(g.entrou + g.a_entrar - g.saiu - g.a_sair);
    grupos.set(chave, g);
  };

  for (const l of e.lancamentos) {
    if (!l.data || l.data < e.periodo.inicio || l.data > e.periodo.fim) continue;
    const m = ID_DO_LANCAMENTO.exec(l.id);
    const conta = m ? (m[1] === 'cr' ? cr.get(m[2]) : cp.get(m[2])) : undefined;
    if (!conta) {
      // Folha ainda não lançada (e qualquer coisa sem título): sem centro e sem tag.
      if (!vazio) continue;
      if (e.dimensao === 'centro') somar(SEM_CENTRO, ROTULO_SEM_CENTRO, l, l.valor);
      else somar(SEM_TAG, ROTULO_SEM_TAG, l, l.valor);
      continue;
    }
    if (tagDoRecorte && !contaTemTag(conta, tagDoRecorte)) continue;
    const dim = dimensoesDoLancamento(conta as Record<string, unknown>, { centros: e.centros as readonly CentroDoContexto[], lado: m![1] === 'cr' ? 'receber' : 'pagar' });
    // A parte de cada fatia no lançamento (centavo por centavo).
    const partes = ratearTotal(l.valor, dim.fatias.map(f => num(f.percentual)));
    const dentro = dim.fatias.map((f, i) => ({ f, valor: partes[i] })).filter(x => !aceitos || aceitos.has(x.f.centro_custo_id));
    if (e.dimensao === 'centro') {
      for (const { f, valor } of dentro) {
        const id = f.centro_custo_id;
        if (!id) somar(SEM_CENTRO, ROTULO_SEM_CENTRO, l, valor);
        else somar(id, nomeDoCentro.get(id) || f.centro_custo_nome || 'Centro sem nome', l, valor);
      }
    } else {
      const valor = round2(dentro.reduce((a, x) => a + x.valor, 0));
      const gs = gruposDeTag(conta, grafias);
      if (gs.length > 1) varias.add(`${m![1]}:${conta.id}`);
      for (const g of gs) somar(g.chave, g.rotulo, l, valor);
    }
  }

  let linhas = [...grupos.values()];
  if (e.dimensao === 'centro') {
    // Na ordem da árvore de centros, com o recuo; os desconhecidos no fim.
    const nivel = new Map<string, number>();
    const ordem = new Map<string, number>();
    arvore(e.centros).forEach((c, i) => { nivel.set(c.id, c.nivel); ordem.set(c.id, i); });
    linhas = linhas
      .map(l => ({ ...l, nivel: nivel.get(l.chave) ?? 0 }))
      .sort((a, b) => (ordem.get(a.chave) ?? Number.MAX_SAFE_INTEGER) - (ordem.get(b.chave) ?? Number.MAX_SAFE_INTEGER)
        || (a.chave === SEM_CENTRO ? 1 : 0) - (b.chave === SEM_CENTRO ? 1 : 0) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
  } else {
    linhas = ordenarGrupos(linhas, SEM_TAG);
  }

  // Totais: cada lançamento uma vez (na visão por tag, a soma das linhas pode passar disso).
  const totais = { entrou: 0, saiu: 0, a_entrar: 0, a_sair: 0, resultado: 0 };
  if (e.dimensao === 'centro') {
    for (const l of linhas) {
      totais.entrou = round2(totais.entrou + l.entrou); totais.saiu = round2(totais.saiu + l.saiu);
      totais.a_entrar = round2(totais.a_entrar + l.a_entrar); totais.a_sair = round2(totais.a_sair + l.a_sair);
    }
  } else {
    const unica = fluxoPorDimensao({ ...e, dimensao: 'centro' });
    Object.assign(totais, unica.totais);
  }
  totais.resultado = round2(totais.entrou + totais.a_entrar - totais.saiu - totais.a_sair);
  return { linhas, totais, com_varias_tags: varias.size };
}

/** Centros em ordem de árvore com o nível (pai antes dos filhos). */
function arvore(centros: readonly CentroDoRecorte[]): Array<{ id: string; nivel: number }> {
  const ids = new Set(centros.map(c => c.id));
  const filhos = new Map<string, CentroDoRecorte[]>();
  const raizes: CentroDoRecorte[] = [];
  for (const c of centros) {
    const pai = c.centro_pai_id && ids.has(c.centro_pai_id) && c.centro_pai_id !== c.id ? c.centro_pai_id : null;
    if (pai) filhos.set(pai, [...(filhos.get(pai) ?? []), c]);
    else raizes.push(c);
  }
  const porNome = (a: CentroDoRecorte, b: CentroDoRecorte) => `${a.codigo ?? ''} ${a.nome ?? ''}`.localeCompare(`${b.codigo ?? ''} ${b.nome ?? ''}`, 'pt-BR');
  const saida: Array<{ id: string; nivel: number }> = [];
  const vistos = new Set<string>();
  const visitar = (c: CentroDoRecorte, nivel: number) => {
    if (vistos.has(c.id)) return;
    vistos.add(c.id);
    saida.push({ id: c.id, nivel });
    for (const f of [...(filhos.get(c.id) ?? [])].sort(porNome)) visitar(f, nivel + 1);
  };
  for (const r of [...raizes].sort(porNome)) visitar(r, 0);
  return saida;
}
