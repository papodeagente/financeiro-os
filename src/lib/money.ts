/**
 * Aritmética de dinheiro e datas financeiras — fonte única da verdade.
 *
 * Regras do módulo financeiro (Entur OS FIN):
 *  1. Dinheiro é sempre arredondado a 2 casas ANTES de virar dado persistido.
 *     Somatórios longos usam `soma()`, que arredonda o acumulado a cada passo
 *     (evita 0.1 + 0.2 = 0.30000000000000004 propagando por centenas de itens).
 *  2. Datas de vencimento/pagamento são strings 'YYYY-MM-DD' (data civil, sem
 *     hora). NUNCA usar `new Date('YYYY-MM-DD')` — isso parseia como UTC e no
 *     BRT (UTC-3) volta um dia. Use os helpers daqui, que ancoram ao meio-dia.
 *  3. Comparação de datas civis é feita por string (ISO ordena lexicograficamente).
 */

// ============================================================
// Dinheiro
// ============================================================

/** Arredonda para 2 casas de forma estável (corrige o erro de representação
 *  binária que faz Math.round(1.005 * 100) devolver 100 em vez de 101). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON * Math.sign(n || 1)) * 100) / 100;
}

/** Converte qualquer entrada (string, null, NaN) num número de dinheiro seguro. */
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const p = parseMoneyBR(v);
    return p ?? 0;
  }
  return 0;
}

/** Soma valores arredondando o acumulado — usar em TODO somatório de dinheiro. */
export function soma(valores: Array<number | null | undefined>): number {
  let acc = 0;
  for (const v of valores) acc = round2(acc + num(v));
  return acc;
}

/** Soma por projeção, com a mesma garantia de `soma`. */
export function somaPor<T>(itens: readonly T[], get: (item: T) => number | null | undefined): number {
  let acc = 0;
  for (const it of itens) acc = round2(acc + num(get(it)));
  return acc;
}

/** Aplica percentual sobre uma base, com arredondamento de dinheiro. */
export function percentual(base: number, pct: number): number {
  return round2(num(base) * num(pct) / 100);
}

/** Divisão segura: devolve 0 quando o divisor é 0/NaN (evita Infinity/NaN em KPIs). */
export function divSegura(a: number, b: number): number {
  const d = num(b);
  if (d === 0) return 0;
  return num(a) / d;
}

/** Variação percentual entre dois períodos, protegida contra base 0/negativa. */
export function variacaoPct(atual: number, anterior: number): number | null {
  const ant = num(anterior);
  if (ant === 0) return null;          // sem base de comparação
  return round2(((num(atual) - ant) / Math.abs(ant)) * 100);
}

/**
 * Divide um total em N parcelas cujo somatório é EXATAMENTE o total.
 * O resíduo dos centavos vai na última parcela (padrão do mercado).
 */
export function dividirParcelas(total: number, n: number): number[] {
  const t = round2(total);
  const qtd = Math.max(1, Math.floor(n) || 1);
  const base = round2(t / qtd);
  const out: number[] = [];
  for (let i = 1; i < qtd; i++) out.push(base);
  out.push(round2(t - round2(base * (qtd - 1))));
  return out;
}

/**
 * Rateia um desconto (ou acréscimo) proporcionalmente sobre valores,
 * garantindo que a soma do resultado seja exatamente `total - desconto`.
 */
export function ratearDesconto(valores: number[], desconto: number): number[] {
  const total = soma(valores);
  const d = round2(desconto);
  if (d === 0 || total <= 0) return valores.map(round2);
  const alvo = round2(total - d);
  const out = valores.map(v => round2(num(v) * divSegura(alvo, total)));
  // resíduo no maior item, pra não distorcer os pequenos
  const diff = round2(alvo - soma(out));
  if (diff !== 0 && out.length > 0) {
    let maiorIdx = 0;
    for (let i = 1; i < out.length; i++) if (out[i] > out[maiorIdx]) maiorIdx = i;
    out[maiorIdx] = round2(out[maiorIdx] + diff);
  }
  return out;
}

/** Converte um valor de moeda estrangeira para BRL. Câmbio ausente/0 = 1 (já BRL). */
export function paraBRL(valor: number | null | undefined, moeda?: string | null, cambio?: number | null): number {
  const v = num(valor);
  if (!moeda || moeda === 'BRL') return round2(v);
  const c = num(cambio);
  return round2(v * (c > 0 ? c : 1));
}

/**
 * Parser de dinheiro tolerante a formato pt-BR e en-US.
 *   "1.234,56" → 1234.56   |  "1,234.56" → 1234.56
 *   "1.500"    → 1500      |  "1.50"     → 1.5
 *   "R$ 99,90" → 99.9      |  "-1.234,56" → -1234.56
 * Regra: o ÚLTIMO separador decide. Se for seguido de exatamente 1-2 dígitos
 * e não houver outro separador igual depois, é decimal; senão é milhar.
 */
export function parseMoneyBR(str: string | number | null | undefined): number | null {
  if (typeof str === 'number') return Number.isFinite(str) ? str : null;
  if (str === null || str === undefined) return null;
  let s = String(str).trim();
  if (!s || s === '—') return null;

  const negativo = /^\(.*\)$/.test(s) || s.includes('-');
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;

  const ultimaVirgula = s.lastIndexOf(',');
  const ultimoPonto = s.lastIndexOf('.');
  const ultimoSep = Math.max(ultimaVirgula, ultimoPonto);

  let inteiro: string;
  let decimal = '';
  if (ultimoSep === -1) {
    inteiro = s;
  } else {
    const casas = s.length - ultimoSep - 1;
    const sepChar = s[ultimoSep];
    // é decimal se tem 1-2 casas depois E não se repete adiante
    const ehDecimal = casas >= 1 && casas <= 2 && s.indexOf(sepChar, ultimoSep + 1) === -1;
    if (ehDecimal) {
      inteiro = s.slice(0, ultimoSep);
      decimal = s.slice(ultimoSep + 1);
    } else {
      inteiro = s;
    }
  }
  inteiro = inteiro.replace(/[.,]/g, '');
  if (!inteiro && !decimal) return null;
  const n = parseFloat(`${inteiro || '0'}.${decimal || '0'}`);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

// ============================================================
// Datas civis ('YYYY-MM-DD') — sem armadilha de fuso
// ============================================================

const TZ_TENANT = 'America/Sao_Paulo';

/** Hoje no fuso do tenant, como 'YYYY-MM-DD'. */
export function hojeISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ_TENANT });
}

/** Converte 'YYYY-MM-DD' num Date ancorado ao MEIO-DIA local (imune a fuso). */
export function dataLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const s = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [a, m, dd] = s.split('-').map(Number);
  return new Date(a, m - 1, dd, 12, 0, 0, 0);
}

/** Normaliza qualquer data (Date, ISO com hora) para a string civil 'YYYY-MM-DD'. */
export function paraISO(d: Date | string | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  const a = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${a}-${m}-${dd}`;
}

/** Soma dias a uma data civil. */
export function addDias(iso: string, dias: number): string {
  const d = dataLocal(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + dias);
  return paraISO(d);
}

/** Último dia do mês (1-12 humano). */
export function ultimoDiaDoMes(ano: number, mes1a12: number): number {
  return new Date(ano, mes1a12, 0).getDate();
}

/**
 * Soma meses a uma data civil COM CLAMP de dia — 31/01 + 1 mês = 28/02
 * (e não 03/03, que é o que setMonth faz sozinho).
 */
export function addMeses(iso: string, meses: number): string {
  const d = dataLocal(iso);
  if (!d) return iso;
  const diaOriginal = d.getDate();
  const alvoMes = d.getMonth() + meses;
  const ano = d.getFullYear() + Math.floor(alvoMes / 12);
  const mes = ((alvoMes % 12) + 12) % 12;
  const dia = Math.min(diaOriginal, ultimoDiaDoMes(ano, mes + 1));
  return paraISO(new Date(ano, mes, dia, 12, 0, 0, 0));
}

/** Monta uma data civil válida a partir de ano/mês/dia, clampando o dia. */
export function dataSegura(ano: number, mes1a12: number, dia: number): string {
  const m = Math.min(12, Math.max(1, mes1a12));
  const d = Math.min(Math.max(1, dia), ultimoDiaDoMes(ano, m));
  return `${ano}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Conta vencida? (data civil estritamente anterior a hoje) */
export function estaVencido(vencimento: string | null | undefined, hoje = hojeISO()): boolean {
  if (!vencimento) return false;
  return String(vencimento).slice(0, 10) < hoje;
}

/** 'YYYY-MM' de uma data civil — agrupamento mensal sem erro de fuso. */
export function mesDe(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 7) : '';
}

/** A data civil está dentro do intervalo (inclusivo nas duas pontas)? */
export function dentroDoPeriodo(iso: string | null | undefined, inicio: string, fim: string): boolean {
  if (!iso) return false;
  const d = String(iso).slice(0, 10);
  return d >= inicio && d <= fim;
}
