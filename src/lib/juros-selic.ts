/**
 * Juros da política pela Selic (E7, 06/11/2026).
 *
 * A política de cobrança (Configurações › Financeiro) guarda os juros ao
 * mês que a liquidação sugere. A agência pode usar a Selic como referência:
 * a tela OFERECE (botão), a pessoa escolhe, e o campo continua editável.
 * Nada troca sozinho: o valor só muda quando alguém clica.
 *
 * Duas referências, ambas do cache de índices da E6 (Banco Central, SGS):
 *   · Selic acumulada no mês (série 4390), do último mês FECHADO: já vem em
 *     % no mês, é a "Selic do período" — vai como está, em duas casas;
 *   · meta do Copom (série 432), em % ao ano, convertida para o mês por
 *     juros compostos: mensal = ((1 + anual/100)^(1/12) − 1) × 100.
 *
 * Fonte e data ficam guardadas junto do valor (`juros_referencia`) enquanto
 * o valor for o mesmo; quem digitar outro número desfaz a referência.
 *
 * Testado em scripts/test-juros-selic.ts.
 */
import { diaDeBrasilia, equivalenteMensalPct, mesPorExtenso, SERIES_SGS, ultimoDoIndice, type ValorDeIndice } from './cambio';
import { num } from './money';

export type IndiceDeJuros = 'selic_mes' | 'selic_meta';

export interface OpcaoDeJurosSelic {
  indice: IndiceDeJuros;
  /** "Selic de out/2026" / "Meta Selic (15,00% ao ano)". */
  rotulo: string;
  /** % ao mês, duas casas. */
  valor_am_pct: number;
  /** 'AAAA-MM' (mês fechado) ou 'AAAA-MM-DD' (dia da meta). */
  referencia: string;
  /** Valor original do índice, na unidade dele. */
  valor_indice: number;
  unidade: string;
  /** "Banco Central, série 4390". */
  fonte: string;
  /** Como o número saiu do índice, em uma frase. */
  conta: string;
}

/** A referência guardada na política junto do valor dos juros. */
export interface ReferenciaDeJurosGuardada {
  indice: IndiceDeJuros;
  referencia: string;
  valor_am_pct: number;
  fonte: string;
  /** Quando a pessoa escolheu (ISO). */
  usado_em: string;
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

/** % ao ano → % ao mês equivalente (juros compostos), duas casas. */
export function selicAnualParaMensal(anualPct: number): number {
  return equivalenteMensalPct(anualPct);
}

/** "dd/mm/aaaa" de 'AAAA-MM-DD'. */
function dataBr(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
}

/** As opções de juros pela Selic que o cache permite (vazia: o índice ainda não chegou). */
export function opcoesDeJurosPelaSelic(indices: readonly ValorDeIndice[]): OpcaoDeJurosSelic[] {
  const saida: OpcaoDeJurosSelic[] = [];
  const mes = ultimoDoIndice(indices, 'selic_mes', true);
  if (mes && Number.isFinite(mes.valor) && mes.valor >= 0) {
    saida.push({
      indice: 'selic_mes', rotulo: `Selic de ${mesPorExtenso(mes.referencia)}`,
      valor_am_pct: r2(mes.valor), referencia: mes.referencia, valor_indice: mes.valor, unidade: SERIES_SGS.selic_mes.unidade,
      fonte: `Banco Central, série ${SERIES_SGS.selic_mes.codigo}`,
      conta: `Selic acumulada em ${mesPorExtenso(mes.referencia)}: ${fmt(mes.valor)}% no mês, usada como está.`,
    });
  }
  const meta = ultimoDoIndice(indices, 'selic_meta');
  if (meta && Number.isFinite(meta.valor) && meta.valor > 0) {
    const m = selicAnualParaMensal(meta.valor);
    saida.push({
      indice: 'selic_meta', rotulo: `Meta Selic (${fmt(meta.valor)}% ao ano)`,
      valor_am_pct: m, referencia: meta.referencia, valor_indice: meta.valor, unidade: SERIES_SGS.selic_meta.unidade,
      fonte: `Banco Central, série ${SERIES_SGS.selic_meta.codigo}`,
      conta: `Meta de ${fmt(meta.valor)}% ao ano em ${dataBr(meta.referencia)}: (1 + ${fmt(meta.valor)}%)^(1/12) − 1 = ${fmt(m)}% ao mês.`,
    });
  }
  return saida;
}

/** O que guardar quando a pessoa escolhe uma opção. */
export function referenciaDaOpcao(o: OpcaoDeJurosSelic, agora: Date = new Date()): ReferenciaDeJurosGuardada {
  return { indice: o.indice, referencia: o.referencia, valor_am_pct: o.valor_am_pct, fonte: o.fonte, usado_em: agora.toISOString() };
}

/**
 * A referência só vale enquanto os juros forem o número dela. Outro número
 * (a pessoa editou) ou formato estranho: some (null).
 */
export function referenciaValida(ref: unknown, jurosAmPct: unknown): ReferenciaDeJurosGuardada | null {
  if (!ref || typeof ref !== 'object') return null;
  const r = ref as Record<string, unknown>;
  if (r.indice !== 'selic_mes' && r.indice !== 'selic_meta') return null;
  const valor = num(r.valor_am_pct);
  if (!(valor >= 0) || Math.abs(valor - num(jurosAmPct)) > 0.0001) return null;
  const referencia = String(r.referencia ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(referencia)) return null;
  const usado = String(r.usado_em ?? '');
  return {
    indice: r.indice, referencia, valor_am_pct: r2(valor),
    fonte: String(r.fonte ?? '').slice(0, 80) || 'Banco Central',
    usado_em: Number.isFinite(Date.parse(usado)) ? new Date(usado).toISOString() : '',
  };
}

/** Frase da tela: "Selic de out/2026 (Banco Central, série 4390), escolhida em 06/11/2026." */
export function textoDaReferencia(r: ReferenciaDeJurosGuardada): string {
  const quando = r.usado_em ? `, escolhida em ${dataBr(diaDeBrasilia(new Date(r.usado_em)))}` : '';
  const qual = r.indice === 'selic_mes' ? `Selic de ${mesPorExtenso(r.referencia)}` : `Meta Selic de ${dataBr(r.referencia)}`;
  return `${qual} (${r.fonte})${quando}.`;
}
