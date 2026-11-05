/**
 * Aviso de vencimento no sino (05/11/2026) — regra pura.
 *
 * Uma vez por dia, por agência, um aviso por assunto (nunca um por conta,
 * para o sino não virar uma lista de cobrança):
 *   - contas a pagar que vencem hoje      (ligado por padrão)
 *   - contas a pagar que vencem amanhã    (desligado por padrão)
 *   - contas a receber em atraso          (desligado por padrão)
 *
 * A chave de deduplicação leva o assunto e o dia: rodar de novo no mesmo dia
 * não repete o aviso.
 */
import { addDias, num, round2 } from './money';

const formatarBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface PreferenciaAvisos {
  pagar_hoje: boolean;
  pagar_amanha: boolean;
  receber_atrasadas: boolean;
}

export const AVISOS_PADRAO: PreferenciaAvisos = { pagar_hoje: true, pagar_amanha: false, receber_atrasadas: false };

export function normalizarAvisos(v: unknown): PreferenciaAvisos {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const b = (k: keyof PreferenciaAvisos) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : AVISOS_PADRAO[k]);
  return { pagar_hoje: b('pagar_hoje'), pagar_amanha: b('pagar_amanha'), receber_atrasadas: b('receber_atrasadas') };
}

export function algumAvisoLigado(p: PreferenciaAvisos): boolean {
  return p.pagar_hoje || p.pagar_amanha || p.receber_atrasadas;
}

/** Uma conta em aberto, já com o saldo que falta. */
export interface ContaEmAberto {
  tabela: 'contas_pagar' | 'contas_receber';
  id: string;
  descricao: string;
  pessoa: string;
  vencimento: string;
  saldo: number;
}

export type TipoDoAviso = 'CONTAS_A_PAGAR_VENCENDO' | 'CONTAS_A_RECEBER_ATRASADAS';

export interface Aviso {
  tipo: TipoDoAviso;
  titulo: string;
  descricao: string;
  link: string;
  chave: string;
  dados: Record<string, unknown>;
}

const status = (s: unknown) => String(s ?? '').toUpperCase();
const QUITADOS = new Set(['PAGO', 'RECEBIDO', 'CANCELADO', 'EXCLUIDO']);

/**
 * O que falta pagar/receber de uma conta, pela mesma regra das listas:
 * parcial pelo acumulado; quitada ou cancelada não tem saldo.
 */
export function saldoEmAberto(d: Record<string, unknown>, tabela: ContaEmAberto['tabela']): number {
  const s = status(d.status);
  if (QUITADOS.has(s)) return 0;
  const campo = tabela === 'contas_receber' ? 'valor_recebido' : 'valor_pago';
  const total = round2(num(d.valor_final) || num(d.valor_brl));
  const feito = s === 'PARCIAL' ? round2(num(d[campo])) : 0;
  return Math.max(0, round2(total - feito));
}

function nomeCurto(c: ContaEmAberto): string {
  const d = c.descricao.trim();
  const p = c.pessoa.trim();
  if (d && p && d.toLowerCase() !== p.toLowerCase()) return `${d} (${p})`;
  return d || p || 'Conta sem descrição';
}

function lista(contas: ContaEmAberto[]): string {
  const nomes = contas.slice(0, 3).map(nomeCurto);
  const resto = contas.length - nomes.length;
  if (resto > 0) return `${nomes.join(', ')} e mais ${resto}.`;
  if (nomes.length <= 1) return `${nomes[0] ?? ''}.`;
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}.`;
}

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

function somaDe(contas: ContaEmAberto[]): number {
  return round2(contas.reduce((a, c) => a + c.saldo, 0));
}

/**
 * Os avisos do dia. `hoje` é a data de Brasília (AAAA-MM-DD). Só entram
 * contas com saldo em aberto.
 */
export function montarAvisos(contas: readonly ContaEmAberto[], hoje: string, pref: PreferenciaAvisos): Aviso[] {
  const abertas = contas.filter(c => c.saldo > 0.004 && /^\d{4}-\d{2}-\d{2}/.test(c.vencimento));
  const ordem = (a: ContaEmAberto, b: ContaEmAberto) => b.saldo - a.saldo || a.descricao.localeCompare(b.descricao, 'pt-BR');
  const avisos: Aviso[] = [];
  const amanha = addDias(hoje, 1);

  const pagarNo = (dia: string, quando: 'hoje' | 'amanhã', chave: string) => {
    const doDia = abertas.filter(c => c.tabela === 'contas_pagar' && c.vencimento.slice(0, 10) === dia).sort(ordem);
    if (!doDia.length) return;
    const n = doDia.length;
    avisos.push({
      tipo: 'CONTAS_A_PAGAR_VENCENDO',
      titulo: n === 1 ? `1 conta a pagar vence ${quando}` : `${n} contas a pagar vencem ${quando}`,
      descricao: `${formatarBRL(somaDe(doDia))} no total. ${lista(doDia)}`,
      link: n === 1 ? `/financeiro-ag/pagar?abrir=${encodeURIComponent(doDia[0].id)}` : '/financeiro-ag/pagar',
      chave: `aviso-vencimento:${chave}:${hoje}`,
      dados: { quando: dia, quantidade: n, total: somaDe(doDia), contas: doDia.slice(0, 20).map(c => c.id) },
    });
  };
  if (pref.pagar_hoje) pagarNo(hoje, 'hoje', 'pagar-hoje');
  if (pref.pagar_amanha) pagarNo(amanha, 'amanhã', 'pagar-amanha');

  if (pref.receber_atrasadas) {
    const atrasadas = abertas.filter(c => c.tabela === 'contas_receber' && c.vencimento.slice(0, 10) < hoje).sort(ordem);
    if (atrasadas.length) {
      const n = atrasadas.length;
      const maisAntiga = atrasadas.reduce((m, c) => (c.vencimento < m ? c.vencimento : m), atrasadas[0].vencimento).slice(0, 10);
      const dias = diasEntre(maisAntiga, hoje);
      avisos.push({
        tipo: 'CONTAS_A_RECEBER_ATRASADAS',
        titulo: n === 1 ? '1 conta a receber em atraso' : `${n} contas a receber em atraso`,
        descricao: `${formatarBRL(somaDe(atrasadas))} a receber. A mais antiga venceu há ${dias} ${dias === 1 ? 'dia' : 'dias'}. ${lista(atrasadas)}`,
        link: '/financeiro-ag/receber?status=ATRASADO',
        chave: `aviso-vencimento:receber-atrasadas:${hoje}`,
        dados: { quantidade: n, total: somaDe(atrasadas), mais_antiga: maisAntiga, contas: atrasadas.slice(0, 20).map(c => c.id) },
      });
    }
  }
  return avisos;
}
