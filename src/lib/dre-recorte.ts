/**
 * DRE por centro de custo e por rateio (E7, G3). Lógica pura.
 *
 * O DRE (resultado-dre.ts) continua o mesmo: este módulo só RECORTA as listas
 * que entram nele. Sem recorte, devolve as mesmas listas, sem tocar em nada
 * (o DRE de sempre, número por número).
 *
 * Com um centro escolhido, cada conta entra com a PARTE dela naquele centro
 * (e nos que estão abaixo dele): conta sem rateio entra inteira se o centro
 * dela é o escolhido; conta rateada entra com o percentual das linhas do
 * rateio que caem no centro (a mesma leitura das fatias de dimensoes.ts, que
 * os relatórios por centro de custo e por rateio usam). Os valores da conta
 * (valor, recebido/pago, taxa) e os encargos e a variação cambial da
 * liquidação são multiplicados pela mesma fração.
 *
 * Venda (volume e margem): entra na proporção das contas a receber dela que
 * caem no recorte (média pelo valor). Venda sem conta a receber usa o centro
 * de custo escrito na venda.
 *
 * Rateio: "Só rateadas" deixa só as contas com rateio; "Sem rateio", só as de
 * centro único. Combina com o centro.
 *
 * Tag (E7, frente C): a conta com a tag entra inteira (ou com a parte dela no
 * centro, quando há centro também); sem a tag, fica fora. A comparação ignora
 * acento e maiúscula, como o relatório por dimensão. Venda sem conta a
 * receber não tem tag: fica fora quando há tag escolhida.
 */
import { dimensoesDoLancamento, type CentroDoContexto } from './dimensoes';
import { num, round2 } from './money';
import type { EncargosDoTitulo } from './encargos-categorias';

export type FiltroDeRateio = 'todas' | 'rateadas' | 'sem_rateio';

export interface RecorteDRE {
  /** Centro de custo (e os de baixo). Vazio = todos. */
  centro_id?: string | null;
  rateio?: FiltroDeRateio;
  /** Tag do título (E7, frente C). Vazio = todas. */
  tag?: string | null;
}

export interface CentroDoRecorte extends CentroDoContexto {
  centro_pai_id?: string | null;
}

export function recorteVazio(r: RecorteDRE | null | undefined): boolean {
  return !r || (!r.centro_id && (!r.rateio || r.rateio === 'todas') && !chaveDaTag(r.tag));
}

/** Tag comparável: sem acento, sem maiúscula, sem espaço sobrando. */
export function chaveDaTag(tag: unknown): string {
  return String(tag ?? '').replace(/\s+/g, ' ').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

/** A conta tem a tag (sem acento e maiúscula)? */
export function contaTemTag(conta: { tags?: unknown }, tag: string): boolean {
  const alvo = chaveDaTag(tag);
  if (!alvo) return true;
  return Array.isArray(conta.tags) && conta.tags.some(t => chaveDaTag(t) === alvo);
}

/** Ids do centro e de todos abaixo dele. */
export function centrosAceitos(id: string, centros: readonly CentroDoRecorte[]): Set<string> {
  const saida = new Set<string>([id]);
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const c of centros) {
      if (c.centro_pai_id && saida.has(c.centro_pai_id) && !saida.has(c.id)) { saida.add(c.id); cresceu = true; }
    }
  }
  return saida;
}

type ContaComDimensao = {
  valor_final?: number | null;
  centro_custo?: string | null;
  centro_custo_id?: string | null;
  rateio?: unknown;
  categoria_id?: string | null;
  status?: string | null;
  tags?: unknown;
};

/** Fração (0 a 1) da conta que cai no recorte. */
export function fracaoNoRecorte(
  conta: ContaComDimensao, recorte: RecorteDRE, centros: readonly CentroDoRecorte[], lado: 'receber' | 'pagar',
): number {
  if (recorteVazio(recorte)) return 1;
  if (chaveDaTag(recorte.tag) && !contaTemTag(conta, String(recorte.tag))) return 0;
  const dim = dimensoesDoLancamento(conta as Parameters<typeof dimensoesDoLancamento>[0], { centros, lado });
  if (recorte.rateio === 'rateadas' && !dim.rateado) return 0;
  if (recorte.rateio === 'sem_rateio' && dim.rateado) return 0;
  if (!recorte.centro_id) return 1;
  const aceitos = centrosAceitos(recorte.centro_id, centros);
  const pct = dim.fatias.reduce((s, f) => s + (aceitos.has(f.centro_custo_id) ? num(f.percentual) : 0), 0);
  return Math.max(0, Math.min(1, round2(pct) / 100));
}

const escala = (v: unknown, f: number) => (v === null || v === undefined ? v : round2(num(v) * f));

const CAMPOS_RECEBER = ['valor_final', 'valor_original', 'valor_recebido', 'taxa'] as const;
const CAMPOS_PAGAR = ['valor_final', 'valor_original', 'valor_pago'] as const;

function escalarConta<T extends object>(c: T, campos: readonly string[], f: number): T {
  if (f === 1) return c;
  const copia = { ...c } as Record<string, unknown>;
  for (const k of campos) if (k in copia) copia[k] = escala(copia[k], f);
  return copia as T;
}

export interface EntradaDoRecorte<CR, CP, V> {
  receber: readonly CR[];
  pagar: readonly CP[];
  vendas: readonly V[];
  encargos?: ReadonlyMap<string, EncargosDoTitulo>;
  variacoes?: ReadonlyMap<string, number>;
}

export interface SaidaDoRecorte<CR, CP, V> {
  receber: CR[];
  pagar: CP[];
  vendas: V[];
  encargos?: ReadonlyMap<string, EncargosDoTitulo>;
  variacoes?: ReadonlyMap<string, number>;
}

type CRDoRecorte = ContaComDimensao & { id: string; origem?: string | null; origem_venda_id?: string | null; venda_id?: string | null };
type CPDoRecorte = ContaComDimensao & { id: string };
type VendaDoRecorte = { id: string; valor_final?: number | null; valor_total_custo?: number | null; centro_custo?: string | null };

/** As listas do DRE já recortadas. Sem recorte, as mesmas listas. */
export function aplicarRecorteDRE<CR extends CRDoRecorte, CP extends CPDoRecorte, V extends VendaDoRecorte>(
  e: EntradaDoRecorte<CR, CP, V>, recorte: RecorteDRE | null | undefined, centros: readonly CentroDoRecorte[],
): SaidaDoRecorte<CR, CP, V> {
  if (!recorte || recorteVazio(recorte)) {
    return { receber: [...e.receber], pagar: [...e.pagar], vendas: [...e.vendas], encargos: e.encargos, variacoes: e.variacoes };
  }
  const fracoes = new Map<string, number>();
  const receber: CR[] = [];
  // Venda: média pelo valor das frações das suas contas a receber.
  const pesoDaVenda = new Map<string, { peso: number; dentro: number }>();
  for (const cr of e.receber) {
    const f = fracaoNoRecorte(cr, recorte, centros, 'receber');
    fracoes.set(`contas_receber:${cr.id}`, f);
    const vendaId = String(cr.origem_venda_id || cr.venda_id || '').trim();
    if (vendaId && (cr.origem ?? 'VENDA') === 'VENDA' && cr.status !== 'CANCELADO') {
      const p = pesoDaVenda.get(vendaId) ?? { peso: 0, dentro: 0 };
      const v = Math.abs(num(cr.valor_final));
      p.peso += v;
      p.dentro += v * f;
      pesoDaVenda.set(vendaId, p);
    }
    if (f > 0) receber.push(escalarConta(cr, CAMPOS_RECEBER, f));
  }
  const pagar: CP[] = [];
  for (const cp of e.pagar) {
    const f = fracaoNoRecorte(cp, recorte, centros, 'pagar');
    fracoes.set(`contas_pagar:${cp.id}`, f);
    if (f > 0) pagar.push(escalarConta(cp, CAMPOS_PAGAR, f));
  }
  const aceitos = recorte.centro_id ? centrosAceitos(recorte.centro_id, centros) : null;
  const vendas: V[] = [];
  for (const v of e.vendas) {
    const p = pesoDaVenda.get(v.id);
    let f: number;
    if (p && p.peso > 0) f = Math.max(0, Math.min(1, p.dentro / p.peso));
    else if (recorte.rateio === 'rateadas' || chaveDaTag(recorte.tag)) f = 0;
    else if (!aceitos) f = 1;
    else {
      const nome = String(v.centro_custo ?? '').trim().toLocaleLowerCase('pt-BR');
      const centro = nome ? centros.find(c => c.id === v.centro_custo || (c.nome ?? '').trim().toLocaleLowerCase('pt-BR') === nome) : undefined;
      f = centro && aceitos.has(centro.id) ? 1 : 0;
    }
    if (f > 0) vendas.push(escalarConta(v, ['valor_final', 'valor_total_custo'], f));
  }
  let encargos: Map<string, EncargosDoTitulo> | undefined;
  if (e.encargos) {
    encargos = new Map();
    for (const [k, enc] of e.encargos) {
      const f = fracoes.get(k) ?? 1;
      if (f <= 0) continue;
      encargos.set(k, f === 1 ? enc : { juros: round2(enc.juros * f), multa: round2(enc.multa * f), desconto: round2(enc.desconto * f), taxa: round2(enc.taxa * f) });
    }
  }
  let variacoes: Map<string, number> | undefined;
  if (e.variacoes) {
    variacoes = new Map();
    for (const [k, v] of e.variacoes) {
      const f = fracoes.get(k) ?? 1;
      if (f > 0) variacoes.set(k, f === 1 ? v : round2(v * f));
    }
  }
  return { receber, pagar, vendas, encargos, variacoes };
}
