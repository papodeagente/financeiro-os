/**
 * Feriados nacionais e dia útil (05/11/2026).
 *
 * Calendário bancário brasileiro: feriados nacionais fixos, os móveis que
 * dependem da Páscoa (Sexta-feira Santa, Carnaval e Corpus Christi) e os
 * fins de semana. Carnaval e Corpus Christi são ponto facultativo pela lei,
 * mas os bancos não abrem: entram por padrão e podem ser desligados.
 *
 * Datas são strings civis 'AAAA-MM-DD' (mesma regra de src/lib/money.ts):
 * nada de `new Date('AAAA-MM-DD')`, que volta um dia no fuso de Brasília.
 * Puro: sem banco, sem relógio. Serve à recorrência e a quem precisar.
 */
import { addDias, dataLocal, ultimoDiaDoMes } from './money';

export type TipoFeriado = 'nacional' | 'facultativo';

export interface Feriado {
  data: string;
  nome: string;
  tipo: TipoFeriado;
}

export interface OpcoesDeFeriados {
  /** Segunda e terça de Carnaval (ponto facultativo; bancos fechados). Padrão: sim. */
  carnaval?: boolean;
  /** Corpus Christi (ponto facultativo; bancos fechados). Padrão: sim. */
  corpusChristi?: boolean;
  /** Feriados a mais da agência (municipais, estaduais), em 'AAAA-MM-DD'. */
  extras?: readonly string[];
}

/** Calendário pronto para consultar: o que é feriado e o que é dia útil. */
export interface Calendario {
  ehFeriado: (iso: string) => boolean;
  /** Nome do feriado daquele dia, ou null. */
  nomeDoFeriado: (iso: string) => string | null;
}

const FIXOS: ReadonlyArray<{ mmdd: string; nome: string }> = [
  { mmdd: '01-01', nome: 'Confraternização Universal' },
  { mmdd: '04-21', nome: 'Tiradentes' },
  { mmdd: '05-01', nome: 'Dia do Trabalho' },
  { mmdd: '09-07', nome: 'Independência do Brasil' },
  { mmdd: '10-12', nome: 'Nossa Senhora Aparecida' },
  { mmdd: '11-02', nome: 'Finados' },
  { mmdd: '11-15', nome: 'Proclamação da República' },
  // Feriado nacional desde 2024 (Lei 14.759/2023).
  { mmdd: '11-20', nome: 'Dia Nacional de Zumbi e da Consciência Negra' },
  { mmdd: '12-25', nome: 'Natal' },
];

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

/** Feriados de um ano, em ordem de data. Um dia aparece uma vez só. */
export function feriadosDoAno(ano: number, opcoes: OpcoesDeFeriados = {}): Feriado[] {
  const carnaval = opcoes.carnaval ?? true;
  const corpus = opcoes.corpusChristi ?? true;
  const p = pascoa(ano);
  const lista: Feriado[] = FIXOS.map(f => ({ data: `${ano}-${f.mmdd}`, nome: f.nome, tipo: 'nacional' as const }));
  lista.push({ data: addDias(p, -2), nome: 'Sexta-feira Santa', tipo: 'nacional' });
  if (carnaval) {
    lista.push({ data: addDias(p, -48), nome: 'Carnaval (segunda-feira)', tipo: 'facultativo' });
    lista.push({ data: addDias(p, -47), nome: 'Carnaval (terça-feira)', tipo: 'facultativo' });
  }
  if (corpus) lista.push({ data: addDias(p, 60), nome: 'Corpus Christi', tipo: 'facultativo' });
  for (const extra of opcoes.extras ?? []) {
    if (extra.startsWith(`${ano}-`)) lista.push({ data: extra.slice(0, 10), nome: 'Feriado da agência', tipo: 'nacional' });
  }
  // Tiradentes e Páscoa coincidem em 2030, por exemplo: o primeiro nome fica.
  const vistos = new Set<string>();
  return lista
    .sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0))
    .filter(f => (vistos.has(f.data) ? false : (vistos.add(f.data), true)));
}

/** Monta um calendário com cache por ano. */
export function criarCalendario(opcoes: OpcoesDeFeriados = {}): Calendario {
  const porAno = new Map<number, Map<string, string>>();
  const doAno = (ano: number) => {
    let m = porAno.get(ano);
    if (!m) {
      m = new Map(feriadosDoAno(ano, opcoes).map(f => [f.data, f.nome]));
      porAno.set(ano, m);
    }
    return m;
  };
  const nomeDoFeriado = (iso: string) => {
    const s = String(iso).slice(0, 10);
    const ano = Number(s.slice(0, 4));
    if (!Number.isFinite(ano)) return null;
    return doAno(ano).get(s) ?? null;
  };
  return { ehFeriado: iso => nomeDoFeriado(iso) !== null, nomeDoFeriado };
}

/** Calendário nacional padrão (com Carnaval e Corpus Christi). */
export const CALENDARIO_NACIONAL: Calendario = criarCalendario();

/** 0 = domingo … 6 = sábado. */
export function diaDaSemana(iso: string): number {
  const d = dataLocal(iso);
  return d ? d.getDay() : -1;
}

export function ehFimDeSemana(iso: string): boolean {
  const s = diaDaSemana(iso);
  return s === 0 || s === 6;
}

/** Dia útil = não é sábado, domingo nem feriado do calendário. */
export function ehDiaUtil(iso: string, cal: Calendario = CALENDARIO_NACIONAL): boolean {
  return !ehFimDeSemana(iso) && !cal.ehFeriado(iso);
}

/**
 * O próprio dia, se for útil; senão o primeiro dia útil DEPOIS dele.
 * (É o "adiar para o próximo dia útil" do vencimento.)
 */
export function proximoDiaUtil(iso: string, cal: Calendario = CALENDARIO_NACIONAL): string {
  let d = String(iso).slice(0, 10);
  for (let i = 0; i < 31 && !ehDiaUtil(d, cal); i++) d = addDias(d, 1);
  return d;
}

/**
 * O próprio dia, se for útil; senão o último dia útil ANTES dele.
 * (É o "antecipar para o dia útil anterior" do vencimento.)
 */
export function diaUtilAnterior(iso: string, cal: Calendario = CALENDARIO_NACIONAL): string {
  let d = String(iso).slice(0, 10);
  for (let i = 0; i < 31 && !ehDiaUtil(d, cal); i++) d = addDias(d, -1);
  return d;
}

/** Último dia útil de um mês (mês de 1 a 12). */
export function ultimoDiaUtilDoMes(ano: number, mes1a12: number, cal: Calendario = CALENDARIO_NACIONAL): string {
  const ultimo = `${ano}-${doisDigitos(mes1a12)}-${doisDigitos(ultimoDiaDoMes(ano, mes1a12))}`;
  return diaUtilAnterior(ultimo, cal);
}

/** Por que o dia não é útil ("sábado", "domingo", "Carnaval (terça-feira)"), ou null. */
export function motivoDeNaoSerUtil(iso: string, cal: Calendario = CALENDARIO_NACIONAL): string | null {
  const feriado = cal.nomeDoFeriado(iso);
  if (feriado) return feriado;
  const s = diaDaSemana(iso);
  if (s === 6) return 'sábado';
  if (s === 0) return 'domingo';
  return null;
}
