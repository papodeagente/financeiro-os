/**
 * Agenda de pagamento de comissão.
 *
 * A agência define em que dias do mês paga comissão (por exemplo dia 5 e
 * dia 20). Quando uma comissão é aprovada, ela vira conta a pagar com
 * vencimento na PRÓXIMA data dessa agenda, e não na data de hoje. É isso
 * que faz a comissão aparecer no fluxo de caixa antes de sair dinheiro.
 *
 * Todas as datas são civis 'YYYY-MM-DD', manipuladas pelos helpers de
 * money.ts, que ancoram ao meio-dia local. Nunca use new Date sobre string
 * de data aqui: no fuso de Brasília ela retrocede um dia.
 */
import { dataLocal, paraISO, ultimoDiaDoMes } from './money';

/** Dia 31 numa agenda vale "último dia do mês", não "mês que vem". */
export const DIA_ULTIMO = 31;

/**
 * Normaliza a lista de dias vinda da configuração: só inteiros de 1 a 31,
 * sem repetição, em ordem. Entrada suja não derruba o cálculo.
 */
export function normalizarDatas(datas: unknown): number[] {
  if (!Array.isArray(datas)) return [];
  const limpos = datas
    .map(d => Math.trunc(Number(d)))
    .filter(d => Number.isFinite(d) && d >= 1 && d <= 31);
  return [...new Set(limpos)].sort((a, b) => a - b);
}

/**
 * Converte um dia da agenda numa data real do mês informado, encurtando
 * para o último dia quando o mês é mais curto. Dia 31 em fevereiro vira
 * 28 ou 29, e não 3 de março.
 */
export function diaNoMes(ano: number, mes1a12: number, dia: number): string {
  const teto = ultimoDiaDoMes(ano, mes1a12);
  const real = Math.min(Math.max(dia, 1), teto);
  return `${ano}-${String(mes1a12).padStart(2, '0')}-${String(real).padStart(2, '0')}`;
}

/**
 * Próxima data de pagamento a partir de uma data de referência, inclusive.
 * Se a referência cai exatamente num dia de pagamento, é esse dia.
 *
 * Sem agenda configurada devolve null: quem chama decide o que fazer, e a
 * decisão nunca é inventar uma data.
 */
export function proximaDataPagamento(
  datasConfig: unknown,
  referenciaISO: string,
): string | null {
  const dias = normalizarDatas(datasConfig);
  if (dias.length === 0) return null;

  const ref = dataLocal(referenciaISO);
  if (!ref) return null;

  const refISO = paraISO(ref);
  const ano = ref.getFullYear();
  const mes = ref.getMonth() + 1;

  // Candidatas deste mês, já encurtadas ao tamanho real do mês.
  for (const dia of dias) {
    const candidata = diaNoMes(ano, mes, dia);
    if (candidata >= refISO) return candidata;
  }

  // Nenhuma serve: primeira data do mês seguinte.
  const proxAno = mes === 12 ? ano + 1 : ano;
  const proxMes = mes === 12 ? 1 : mes + 1;
  return diaNoMes(proxAno, proxMes, dias[0]);
}

/**
 * Texto curto da agenda para a interface, por exemplo "dia 5 e dia 20".
 * Vazio quando não há agenda, para a tela poder dizer isso com as próprias
 * palavras em vez de mostrar uma lista vazia.
 */
export function descreverAgenda(datasConfig: unknown): string {
  const dias = normalizarDatas(datasConfig);
  if (dias.length === 0) return '';
  const rotulo = (d: number) => (d === DIA_ULTIMO ? 'último dia do mês' : `dia ${d}`);
  if (dias.length === 1) return rotulo(dias[0]);
  const todos = dias.map(rotulo);
  return `${todos.slice(0, -1).join(', ')} e ${todos[todos.length - 1]}`;
}
