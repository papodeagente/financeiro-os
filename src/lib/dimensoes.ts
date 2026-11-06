/**
 * Categoria, centro de custo, tags e repasse de um lançamento, já rateados
 * (05/11/2026). Lógica pura: não toca banco nem rede.
 *
 * Uma conta a pagar ou a receber vira uma ou mais FATIAS. Sem rateio é uma
 * fatia só, de 100%, com a categoria e o centro da conta (o "centro único"
 * de sempre). Com rateio, cada linha é uma fatia, e as fatias fecham o valor
 * da conta em centavos. Os relatórios por categoria, por centro de custo e por rateio, e
 * depois a DRE e o fluxo, leem as fatias daqui: uma regra só.
 */
import type { LinhaRateio } from './crm-types';
import { num, ratearTotal, round2, soma } from './money';

// ---------------------------------------------------------------------------
// Rateio
// ---------------------------------------------------------------------------

export type ResultadoRateio =
  | { ok: true; linhas: LinhaRateio[] }
  | { ok: false; erro: string };

const formatoPct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/**
 * Confere e normaliza o rateio de um lançamento de `total` reais.
 *
 * Vazio é válido (centro único). Preenchido, precisa fechar exatamente 100%
 * (o sistema anterior aceitava ficar abaixo, e parte do valor sumia "sem
 * centro"). O valor de cada linha é recalculado aqui com `ratearTotal`: a
 * soma das linhas é o total da conta, centavo por centavo. O valor que veio
 * da tela é ignorado.
 */
export function validarRateio(total: number, linhas: unknown): ResultadoRateio {
  if (linhas == null) return { ok: true, linhas: [] };
  if (!Array.isArray(linhas)) return { ok: false, erro: 'O rateio precisa ser uma lista de linhas.' };
  if (linhas.length === 0) return { ok: true, linhas: [] };
  if (linhas.length > 50) return { ok: false, erro: 'O rateio aceita no máximo 50 linhas.' };

  const limpas: Array<{ centro_custo_id: string; categoria_id?: string; percentual: number }> = [];
  const vistas = new Set<string>();
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i] as Record<string, unknown> | null;
    const n = i + 1;
    if (!l || typeof l !== 'object') return { ok: false, erro: `A linha ${n} do rateio está vazia.` };
    const centro = String(l.centro_custo_id ?? '').trim();
    const categoria = String(l.categoria_id ?? '').trim();
    // Várias categorias no mesmo título (06/11/2026, E7): a linha com
    // categoria pode ficar sem centro. Sem nenhum dos dois, a linha não diz
    // nada e continua recusada como antes.
    if (!centro && !categoria) return { ok: false, erro: `Escolha o centro de custo da linha ${n} do rateio.` };
    const pct = Number(l.percentual);
    if (!Number.isFinite(pct) || pct <= 0) {
      return { ok: false, erro: `O percentual da linha ${n} do rateio precisa ser maior que zero.` };
    }
    if (pct > 100) return { ok: false, erro: `O percentual da linha ${n} do rateio passa de 100%.` };
    const chave = `${centro}|${categoria}`;
    if (vistas.has(chave)) {
      return {
        ok: false,
        erro: centro
          ? `A linha ${n} repete centro e categoria de outra linha. Junte as duas.`
          : `A linha ${n} repete a categoria de outra linha sem centro. Junte as duas.`,
      };
    }
    vistas.add(chave);
    limpas.push({ centro_custo_id: centro, ...(categoria ? { categoria_id: categoria } : {}), percentual: round2(pct) });
  }

  const somaPct = round2(soma(limpas.map(l => l.percentual)));
  if (somaPct !== 100) {
    const dif = round2(100 - somaPct);
    return {
      ok: false,
      erro: dif > 0
        ? `O rateio soma ${formatoPct(somaPct)}%. Faltam ${formatoPct(dif)}% para fechar 100%.`
        : `O rateio soma ${formatoPct(somaPct)}%. Passou ${formatoPct(-dif)}% de 100%.`,
    };
  }

  const valores = ratearTotal(round2(num(total)), limpas.map(l => l.percentual));
  return { ok: true, linhas: limpas.map((l, i) => ({ ...l, valor: valores[i] })) };
}

/** Percentuais iguais para `n` linhas, fechando 100,00 (33,34 / 33,33 / 33,33). */
export function dividirIgual(n: number): number[] {
  if (n <= 0) return [];
  return ratearTotal(100, Array.from({ length: n }, () => 1));
}

/** Aplica uma regra salva a um lançamento de `total` reais. */
export function aplicarRegraDeRateio(
  regra: { linhas: ReadonlyArray<{ centro_custo_id: string; categoria_id?: string; percentual: number }> },
  total: number,
): ResultadoRateio {
  return validarRateio(total, regra.linhas.map(l => ({ ...l, valor: 0 })));
}

/** Tags sem espaço sobrando, sem repetição (ignora maiúsculas) e sem vazias. */
export function normalizarTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const saida: string[] = [];
  const vistas = new Set<string>();
  for (const t of tags) {
    const limpa = String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!limpa) continue;
    const chave = limpa.toLocaleLowerCase('pt-BR');
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push(limpa);
    if (saida.length >= 20) break;
  }
  return saida;
}

/**
 * Confere o rateio e as tags de uma conta antes de gravar (POST e PUT de
 * contas a pagar e a receber). Conta sem rateio e sem tags passa intocada:
 * nada muda para o que já funcionava. Com rateio, o valor de cada linha é
 * refeito sobre o `valor_final` que vai ser gravado. Devolve o erro ou null.
 */
export function prepararDimensoesDaConta(item: Record<string, unknown>): string | null {
  if (Array.isArray(item.rateio) && item.rateio.length > 0) {
    const r = validarRateio(num(item.valor_final), item.rateio);
    if (!r.ok) return r.erro;
    item.rateio = r.linhas;
  }
  if (item.tags !== undefined) item.tags = normalizarTags(item.tags);
  return null;
}

// ---------------------------------------------------------------------------
// Fatias do lançamento
// ---------------------------------------------------------------------------

export interface CategoriaDoContexto {
  id: string;
  codigo?: string;
  nome?: string;
  tipo?: string;
  categoria_pai_id?: string | null;
  repasse?: boolean;
}

export interface CentroDoContexto {
  id: string;
  nome?: string;
  codigo?: string;
}

export interface ContextoDimensoes {
  categorias?: readonly CategoriaDoContexto[];
  centros?: readonly CentroDoContexto[];
  /** Lado da conta. Sem ele, deduz pelos campos (fornecedor/valor_pago = pagar). */
  lado?: 'pagar' | 'receber';
}

export interface FatiaDoLancamento {
  categoria_id: string;
  categoria_codigo: string;
  categoria_nome: string;
  /** Categoria de cima na árvore (o "grupo de categoria"). */
  grupo_id: string;
  grupo_nome: string;
  centro_custo_id: string;
  centro_custo_nome: string;
  tags: string[];
  repasse: boolean;
  percentual: number;
  /** Parte do valor do lançamento (competência). */
  valor: number;
  /** Parte do que já foi pago/recebido (caixa, proporcional ao movimentado). */
  valor_caixa: number;
}

export interface DimensoesDoLancamento {
  lado: 'pagar' | 'receber';
  valor_total: number;
  valor_movimentado: number;
  rateado: boolean;
  fatias: FatiaDoLancamento[];
}

type ContaLike = Record<string, unknown>;

/** Lado da conta: o que ela tem de campos de pagar ou de receber. */
export function ladoDaConta(conta: ContaLike, lado?: 'pagar' | 'receber'): 'pagar' | 'receber' {
  if (lado) return lado;
  if ('valor_pago' in conta || 'fornecedor_nome' in conta || 'data_pagamento' in conta) return 'pagar';
  return 'receber';
}

const STATUS_BAIXADOS = ['RECEBIDO', 'PARCIAL', 'PAGO'];

/**
 * O que já saiu ou entrou no caixa por esta conta. Mesma regra de
 * `valorNoCaixa` (caixa-atomico.ts): parcial vale o acumulado; quitada vale o
 * campo de baixa ou, sem ele, o valor final; em aberto vale zero.
 */
export function valorMovimentadoDaConta(conta: ContaLike, lado?: 'pagar' | 'receber'): number {
  const campo = ladoDaConta(conta, lado) === 'pagar' ? 'valor_pago' : 'valor_recebido';
  const status = String(conta.status ?? '');
  if (!STATUS_BAIXADOS.includes(status)) return 0;
  if (status === 'PARCIAL') return round2(num(conta[campo]));
  return round2(num(conta[campo]) || num(conta.valor_final));
}

/** Data em que o dinheiro se moveu (última baixa). */
export function dataMovimentoDaConta(conta: ContaLike, lado?: 'pagar' | 'receber'): string {
  const campo = ladoDaConta(conta, lado) === 'pagar' ? 'data_pagamento' : 'data_recebimento';
  return String(conta[campo] ?? '').slice(0, 10);
}

function indice<T extends { id: string }>(itens: readonly T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  for (const i of itens ?? []) m.set(i.id, i);
  return m;
}

/** Acha a categoria pelo id ou, nas contas antigas a receber, pelo código digitado. */
export function resolverCategoria(
  ref: string,
  categorias: readonly CategoriaDoContexto[] | undefined,
): CategoriaDoContexto | null {
  if (!ref || !categorias) return null;
  return categorias.find(c => c.id === ref) ?? categorias.find(c => (c.codigo ?? '') !== '' && c.codigo === ref) ?? null;
}

/** A categoria de cima: pelo pai gravado ou, sem ele, pelo código sem o último nível. */
export function grupoDaCategoria(
  cat: CategoriaDoContexto | null,
  categorias: readonly CategoriaDoContexto[] | undefined,
): CategoriaDoContexto | null {
  if (!cat || !categorias) return null;
  const codigo = cat.codigo ?? '';
  if (codigo.includes('.')) {
    const paiCodigo = codigo.slice(0, codigo.lastIndexOf('.'));
    const porCodigo = categorias.find(c => c.codigo === paiCodigo);
    if (porCodigo) return porCodigo;
  }
  if (cat.categoria_pai_id) {
    const porId = categorias.find(c => c.id === cat.categoria_pai_id && c.id !== cat.id);
    if (porId) return porId;
  }
  return null;
}

function resolverCentro(
  id: string,
  texto: string,
  centros: readonly CentroDoContexto[] | undefined,
): { id: string; nome: string } {
  const porId = id ? centros?.find(c => c.id === id) : undefined;
  if (porId) return { id: porId.id, nome: porId.nome ?? '' };
  const t = texto.trim();
  if (t && centros) {
    const chave = t.toLocaleLowerCase('pt-BR');
    const porNome = centros.find(c => (c.nome ?? '').trim().toLocaleLowerCase('pt-BR') === chave);
    if (porNome) return { id: porNome.id, nome: porNome.nome ?? t };
  }
  return { id, nome: t };
}

/**
 * As dimensões do lançamento, já rateadas. É o contrato que os relatórios
 * gerenciais (DRE, fluxo) usam: some `valor` para competência e
 * `valor_caixa` para caixa, agrupando pela dimensão que quiser.
 *
 * Rateio inválido gravado por um caminho antigo não derruba o relatório:
 * vira uma fatia única de 100%, como uma conta sem rateio.
 */
export function dimensoesDoLancamento(conta: ContaLike, ctx: ContextoDimensoes = {}): DimensoesDoLancamento {
  const lado = ladoDaConta(conta, ctx.lado);
  const total = round2(num(conta.valor_final));
  const movimentado = valorMovimentadoDaConta(conta, lado);
  const tags = normalizarTags(conta.tags);
  const categoriaDaConta = String(conta.categoria_id ?? '').trim();
  const rateio = validarRateio(total, conta.rateio);
  const linhas = rateio.ok ? rateio.linhas : [];
  const rateado = linhas.length > 0;

  const porId = indice(ctx.categorias);
  const base = rateado
    ? linhas.map(l => ({
      categoria: l.categoria_id || categoriaDaConta,
      centro: resolverCentro(l.centro_custo_id, '', ctx.centros),
      percentual: l.percentual,
      valor: l.valor,
    }))
    : [{
      categoria: categoriaDaConta,
      centro: resolverCentro(String(conta.centro_custo_id ?? ''), String(conta.centro_custo ?? ''), ctx.centros),
      percentual: 100,
      valor: total,
    }];

  const caixa = ratearTotal(movimentado, base.map(b => b.valor));
  const fatias = base.map((b, i): FatiaDoLancamento => {
    const cat = porId.get(b.categoria) ?? resolverCategoria(b.categoria, ctx.categorias);
    const grupo = grupoDaCategoria(cat, ctx.categorias);
    return {
      categoria_id: cat?.id ?? b.categoria,
      categoria_codigo: cat?.codigo ?? '',
      categoria_nome: cat?.nome ?? '',
      grupo_id: grupo?.id ?? '',
      grupo_nome: grupo?.nome ?? '',
      centro_custo_id: b.centro.id,
      centro_custo_nome: b.centro.nome,
      tags,
      repasse: cat?.repasse === true,
      percentual: b.percentual,
      valor: b.valor,
      valor_caixa: movimentado === 0 ? 0 : caixa[i],
    };
  });
  return { lado, valor_total: total, valor_movimentado: movimentado, rateado, fatias };
}

// ---------------------------------------------------------------------------
// Juntar categorias
// ---------------------------------------------------------------------------

export interface CategoriaParaJuntar {
  id: string;
  codigo?: string;
  nome?: string;
  tipo?: string;
  categoria_pai_id?: string | null;
}

/**
 * Recusa a junção que estragaria dados. Devolve a mensagem ou null.
 * As subcategorias ficam penduradas pelo código: juntar um grupo com
 * filhos deixaria a árvore órfã, então pede para resolver os filhos antes.
 */
export function recusaDaJuncao(
  origem: CategoriaParaJuntar | null,
  destino: CategoriaParaJuntar | null,
  todas: readonly CategoriaParaJuntar[],
): string | null {
  if (!origem) return 'A categoria que seria excluída não existe mais.';
  if (!destino) return 'Escolha a categoria que vai receber os registros.';
  if (origem.id === destino.id) {
    return 'Escolha outra categoria: uma categoria não pode ser juntada com ela mesma.';
  }
  if ((origem.tipo ?? '') !== (destino.tipo ?? '')) {
    return 'As duas categorias precisam ser do mesmo tipo (receita com receita, despesa com despesa).';
  }
  const codigo = origem.codigo ?? '';
  const temFilhas = todas.some(c => c.id !== origem.id && (
    c.categoria_pai_id === origem.id || (codigo !== '' && (c.codigo ?? '').startsWith(`${codigo}.`))
  ));
  if (temFilhas) {
    return 'Esta categoria tem subcategorias. Junte ou mova as subcategorias antes.';
  }
  return null;
}

/**
 * Troca a categoria `origem` por `destino` numa conta (no campo da conta e
 * nas linhas do rateio). Linhas que passam a repetir centro e categoria são
 * somadas numa só, para o rateio continuar válido. Devolve null quando nada
 * mudou.
 */
export function trocarCategoriaNaConta(
  data: Record<string, unknown>,
  origem: { id: string; codigo?: string },
  destinoId: string,
): Record<string, unknown> | null {
  const casa = (v: unknown) => {
    const s = String(v ?? '');
    return s !== '' && (s === origem.id || ((origem.codigo ?? '') !== '' && s === origem.codigo));
  };
  let mudou = false;
  const saida: Record<string, unknown> = { ...data };
  if (casa(data.categoria_id)) { saida.categoria_id = destinoId; mudou = true; }
  if (Array.isArray(data.rateio) && data.rateio.some(l => casa((l as Record<string, unknown>)?.categoria_id))) {
    mudou = true;
    const juntas: Array<Record<string, unknown>> = [];
    for (const bruta of data.rateio as Array<Record<string, unknown>>) {
      const l: Record<string, unknown> = { ...bruta, ...(casa(bruta?.categoria_id) ? { categoria_id: destinoId } : {}) };
      const igual = juntas.find(j => j.centro_custo_id === l.centro_custo_id && (j.categoria_id ?? '') === (l.categoria_id ?? ''));
      if (igual) {
        igual.percentual = round2(num(igual.percentual) + num(l.percentual));
        igual.valor = round2(num(igual.valor) + num(l.valor));
      } else {
        juntas.push(l);
      }
    }
    saida.rateio = juntas;
  }
  return mudou ? saida : null;
}

/** Troca a categoria nas linhas de uma regra de rateio salva. */
export function trocarCategoriaNaRegra(
  linhas: ReadonlyArray<{ centro_custo_id: string; categoria_id?: string; percentual: number }>,
  origem: { id: string; codigo?: string },
  destinoId: string,
): Array<{ centro_custo_id: string; categoria_id?: string; percentual: number }> | null {
  const r = trocarCategoriaNaConta({ rateio: linhas.map(l => ({ ...l, valor: 0 })) }, origem, destinoId);
  if (!r) return null;
  return (r.rateio as Array<Record<string, unknown>>).map(l => ({
    centro_custo_id: String(l.centro_custo_id ?? ''),
    ...(l.categoria_id ? { categoria_id: String(l.categoria_id) } : {}),
    percentual: num(l.percentual),
  }));
}

// ---------------------------------------------------------------------------
// Árvore de centros
// ---------------------------------------------------------------------------

/** O pai escolhido criaria um ciclo (o centro dentro de si mesmo)? */
export function criaCiclo(
  id: string,
  paiId: string | null | undefined,
  centros: ReadonlyArray<{ id: string; centro_pai_id?: string | null }>,
): boolean {
  if (!paiId) return false;
  if (paiId === id) return true;
  const pai = new Map(centros.map(c => [c.id, c.centro_pai_id ?? null]));
  let atual: string | null = paiId;
  for (let passos = 0; atual && passos < 1000; passos++) {
    if (atual === id) return true;
    atual = pai.get(atual) ?? null;
  }
  return false;
}

/** Centros em ordem de árvore, com o nível de cada um (pai antes dos filhos). */
export function ordenarEmArvore<T extends { id: string; nome?: string; codigo?: string; centro_pai_id?: string | null }>(
  centros: readonly T[],
): Array<T & { nivel: number }> {
  const ids = new Set(centros.map(c => c.id));
  const filhos = new Map<string, T[]>();
  for (const c of centros) {
    const pai = c.centro_pai_id && ids.has(c.centro_pai_id) && c.centro_pai_id !== c.id ? c.centro_pai_id : '';
    const lista = filhos.get(pai) ?? [];
    lista.push(c);
    filhos.set(pai, lista);
  }
  const chave = (c: T) => `${c.codigo ?? ''}\u0000${c.nome ?? ''}`;
  for (const lista of filhos.values()) {
    lista.sort((a, b) => chave(a).localeCompare(chave(b), 'pt-BR', { numeric: true, sensitivity: 'base' }));
  }
  const saida: Array<T & { nivel: number }> = [];
  const vistos = new Set<string>();
  const visitar = (pai: string, nivel: number) => {
    for (const c of filhos.get(pai) ?? []) {
      if (vistos.has(c.id)) continue;
      vistos.add(c.id);
      saida.push({ ...c, nivel });
      visitar(c.id, nivel + 1);
    }
  };
  visitar('', 0);
  // Ciclo gravado por fora: ninguém some da lista.
  for (const c of centros) if (!vistos.has(c.id)) saida.push({ ...c, nivel: 0 });
  return saida;
}
