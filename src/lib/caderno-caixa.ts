/**
 * Caderno de fluxo de caixa.
 *
 * Pedido do Bruno (07/10/2026): "simples como um caderno de fluxo de caixa",
 * com o fluxo do mês, dia a dia, e também por bimestre, trimestre, semestre
 * e ano.
 *
 * O caderno é a conta mais velha do mundo: saldo anterior, mais o que entrou,
 * menos o que saiu, igual ao saldo de hoje. Este módulo faz essa conta para
 * qualquer período e devolve as linhas prontas para a tela, sem React e sem
 * banco.
 *
 * TRÊS DECISÕES QUE NÃO DEVEM SER DESFEITAS
 *
 * 1) A entrada realizada vale o que CAIU NO BANCO (entradaLiquidaNoBanco), não
 *    o valor cheio da conta. É a mesma regra do "Saldo atual": sem ela o
 *    caderno ficava acima do banco pelo valor das taxas das plataformas e a
 *    linha de hoje nunca batia com o saldo da conta.
 *
 * 2) Cada lançamento tem UMA data no caderno:
 *      · realizado → a data da baixa;
 *      · em aberto → o vencimento, ou HOJE se já venceu.
 *    Conta vencida e não paga não é dinheiro do passado: é o que se espera
 *    resolver agora. Com essa regra só, o saldo de abertura de qualquer
 *    período é saldo inicial das contas + tudo o que tem data antes dele, e
 *    ela serve igual para o mês passado (só fatos), o atual e os futuros.
 *
 * 3) Status é ENUM exato (valorMovimentado), sem normalizar caixa, como no
 *    resto do financeiro.
 *
 * Datas são civis 'YYYY-MM-DD'. Nunca new Date('YYYY-MM-DD').
 */
import type { ContaBancaria, ContaPagar, ContaReceber } from './crm-types';
import { addDias, addMeses, dataLocal, mesDe, num, round2, somaPor, ultimoDiaDoMes } from './money';
import { entradaLiquidaNoBanco, valorMovimentado } from './saldo-bancario';
import { taxaRealizada } from './taxa-plataforma';
import { descricaoSemPlataforma, nomeDaPlataforma, plataformaDaConta } from './plataformas/rotulo';

// ─── Períodos ───────────────────────────────────────────────────────────────

export type TipoDePeriodo = 'mes' | 'bimestre' | 'trimestre' | 'semestre' | 'ano';

export const TIPOS_DE_PERIODO: ReadonlyArray<{ id: TipoDePeriodo; rotulo: string; meses: number }> = [
  { id: 'mes', rotulo: 'Mês', meses: 1 },
  { id: 'bimestre', rotulo: 'Bimestre', meses: 2 },
  { id: 'trimestre', rotulo: 'Trimestre', meses: 3 },
  { id: 'semestre', rotulo: 'Semestre', meses: 6 },
  { id: 'ano', rotulo: 'Ano', meses: 12 },
];

export interface Periodo {
  tipo: TipoDePeriodo;
  /** Primeiro dia, 'YYYY-MM-DD'. */
  inicio: string;
  /** Último dia, inclusive. */
  fim: string;
  /** "Outubro de 2026", "4º trimestre de 2026". */
  rotulo: string;
  /** "out a dez" — os meses, quando o período tem mais de um. */
  meses: string;
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS_DA_SEMANA_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_DA_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function mesesDoTipo(tipo: TipoDePeriodo): number {
  return TIPOS_DE_PERIODO.find(t => t.id === tipo)?.meses ?? 1;
}

function ultimoDia(ym: string): string {
  const [a, m] = ym.split('-').map(Number);
  return `${ym}-${String(ultimoDiaDoMes(a, m)).padStart(2, '0')}`;
}

function maiuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * O período do tipo pedido que contém a data. Bimestre, trimestre e semestre
 * são os do calendário (out está no 5º bimestre, set e out), que é como a
 * contabilidade e o fisco os contam: o mesmo "3º trimestre" para todo mundo.
 */
export function periodoQueContem(tipo: TipoDePeriodo, data: string): Periodo {
  const [ano, mes] = String(data).slice(0, 7).split('-').map(Number);
  const tamanho = mesesDoTipo(tipo);
  const indice = Math.floor((mes - 1) / tamanho); // 0-based dentro do ano
  const mesInicial = indice * tamanho + 1;
  const ymInicio = `${ano}-${String(mesInicial).padStart(2, '0')}`;
  const ymFim = `${ano}-${String(mesInicial + tamanho - 1).padStart(2, '0')}`;
  const inicio = `${ymInicio}-01`;
  const fim = ultimoDia(ymFim);
  const meses = tamanho === 1 ? '' : `${MESES_CURTOS[mesInicial - 1]} a ${MESES_CURTOS[mesInicial + tamanho - 2]}`;

  const rotulo =
    tipo === 'mes' ? `${maiuscula(MESES[mes - 1])} de ${ano}`
      : tipo === 'ano' ? String(ano)
        : `${indice + 1}º ${tipo} de ${ano}`;

  return { tipo, inicio, fim, rotulo, meses };
}

/** O período anterior (-1) ou seguinte (+1) do mesmo tipo. */
export function periodoVizinho(p: Periodo, passo: number): Periodo {
  return periodoQueContem(p.tipo, addMeses(p.inicio, mesesDoTipo(p.tipo) * passo));
}

export function periodoContem(p: Periodo, data: string): boolean {
  return data >= p.inicio && data <= p.fim;
}

// ─── Lançamentos ────────────────────────────────────────────────────────────

export type Situacao = 'realizado' | 'previsto' | 'atrasado';

export interface Lancamento {
  id: string;
  tipo: 'entrada' | 'saida';
  /** Cliente ou fornecedor. */
  quem: string;
  descricao: string;
  /** Nome da plataforma de onde a conta veio ("Hotmart"), se veio de integração. */
  plataforma: string | null;
  /** O que mexe no banco. Entrada realizada já sem a taxa. Sempre positivo. */
  valor: number;
  /** Taxa retida pela plataforma nesta entrada (só realizadas). */
  taxa: number;
  /** A data do lançamento NO CADERNO (ver regra 2 do topo). */
  data: string;
  /** Vencimento, para dizer "venceu em 02/10" quando está atrasado. */
  vencimento: string;
  situacao: Situacao;
  origem: 'receber' | 'pagar' | 'folha';
}

export interface EventoDeFolha {
  descricao: string;
  valor: number;
  data_pagamento: string;
  competencia: string;
}

function dataEmAberto(vencimento: string, hoje: string): { data: string; situacao: Situacao } {
  // Sem vencimento não há como prever: tratamos como esperado para hoje,
  // que é o lugar onde alguém vai olhar.
  if (!vencimento || vencimento < hoje) return { data: hoje, situacao: vencimento ? 'atrasado' : 'previsto' };
  return { data: vencimento, situacao: 'previsto' };
}

/**
 * Cada conta vira até dois lançamentos: o que já foi baixado (na data da
 * baixa) e o que continua em aberto (no vencimento, ou hoje se venceu).
 * Conta PARCIAL gera os dois.
 */
export function lancamentosDoCaixa(entrada: {
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  folha?: readonly EventoDeFolha[];
  hoje: string;
}): Lancamento[] {
  const { hoje } = entrada;
  const saida: Lancamento[] = [];

  for (const cr of entrada.receber) {
    if (cr.status === 'CANCELADO') continue;
    const idPlataforma = plataformaDaConta(cr);
    const base = {
      tipo: 'entrada' as const,
      quem: String(cr.cliente_nome ?? '').trim(),
      descricao: descricaoSemPlataforma(String(cr.descricao ?? ''), idPlataforma),
      plataforma: idPlataforma ? nomeDaPlataforma(idPlataforma) : null,
      vencimento: String(cr.data_vencimento ?? ''),
      origem: 'receber' as const,
    };
    const caiuNoBanco = entradaLiquidaNoBanco(cr);
    if (valorMovimentado(cr, 'valor_recebido') > 0) {
      saida.push({
        ...base,
        id: `cr-${cr.id}-baixa`,
        valor: caiuNoBanco,
        taxa: taxaRealizada(cr),
        data: String(cr.data_recebimento || cr.data_vencimento || ''),
        situacao: 'realizado',
      });
    }
    const emAberto = cr.status === 'RECEBIDO' ? 0 : round2(num(cr.valor_final) - num(cr.valor_recebido));
    if (emAberto > 0) {
      saida.push({ ...base, id: `cr-${cr.id}-aberto`, valor: emAberto, taxa: 0, ...dataEmAberto(base.vencimento, hoje) });
    }
  }

  for (const cp of entrada.pagar) {
    if (cp.status === 'CANCELADO') continue;
    const base = {
      tipo: 'saida' as const,
      quem: String(cp.fornecedor_nome ?? '').trim(),
      descricao: String(cp.descricao ?? ''),
      plataforma: null,
      taxa: 0,
      vencimento: String(cp.data_vencimento ?? ''),
      origem: 'pagar' as const,
    };
    const pago = valorMovimentado(cp, 'valor_pago');
    if (pago > 0) {
      saida.push({
        ...base,
        id: `cp-${cp.id}-baixa`,
        valor: pago,
        data: String(cp.data_pagamento || cp.data_vencimento || ''),
        situacao: 'realizado',
      });
    }
    const emAberto = cp.status === 'PAGO' ? 0 : round2(num(cp.valor_final) - num(cp.valor_pago));
    if (emAberto > 0) {
      saida.push({ ...base, id: `cp-${cp.id}-aberto`, valor: emAberto, ...dataEmAberto(base.vencimento, hoje) });
    }
  }

  // Folha ainda não lançada como conta: compromisso assumido, sempre previsto.
  for (const f of entrada.folha ?? []) {
    if (num(f.valor) <= 0) continue;
    saida.push({
      id: `folha-${f.competencia}`,
      tipo: 'saida',
      quem: 'Folha de pagamento',
      descricao: f.descricao,
      plataforma: null,
      valor: round2(num(f.valor)),
      taxa: 0,
      vencimento: f.data_pagamento,
      origem: 'folha',
      ...dataEmAberto(f.data_pagamento, hoje),
    });
  }

  return saida;
}

/**
 * Competências da folha que podem pagar algo de hoje até o fim do período. O
 * mês anterior entra porque a folha dele sai no mês seguinte; nada antes
 * disso, porque folha antiga não lançada não é previsão, é lacuna de cadastro.
 */
export function competenciasDaFolha(periodo: Periodo, hoje: string): string[] {
  if (periodo.fim < hoje) return [];
  const saida: string[] = [];
  let atual = mesDe(addMeses(`${mesDe(hoje)}-01`, -1));
  const ultimo = mesDe(periodo.fim);
  while (atual <= ultimo && saida.length < 40) {
    saida.push(atual);
    atual = mesDe(addMeses(`${atual}-01`, 1));
  }
  return saida;
}

// ─── O caderno ──────────────────────────────────────────────────────────────

export type Agrupamento = 'dia' | 'semana' | 'mes';

export interface LinhaDoCaderno {
  chave: string;
  inicio: string;
  fim: string;
  /** "qua, 1 out" · "5 a 11 out" · "Outubro". */
  rotulo: string;
  entradas: number;
  saidas: number;
  /** Saldo no fim da linha (corrido). */
  saldo: number;
  lancamentos: Lancamento[];
  contemHoje: boolean;
  /** Linha inteira depois de hoje: tudo nela é previsão. */
  futura: boolean;
}

export interface PontoDaCurva {
  data: string;
  saldo: number;
}

export interface Caderno {
  periodo: Periodo;
  saldoInicial: number;
  entradas: number;
  saidas: number;
  saldoFinal: number;
  /** Das entradas e saídas, quanto já aconteceu. O resto é previsão. */
  jaEntrou: number;
  jaSaiu: number;
  linhas: LinhaDoCaderno[];
  /** Saldo no fim de cada dia do período. */
  curva: PontoDaCurva[];
  /** Saldo no fim de hoje, quando hoje está no período. */
  saldoDeHoje: number | null;
  /** Primeiro dia em que o saldo fica negativo, se ficar. */
  primeiroDiaNegativo: string | null;
  /** Contas que venceram NESTE período, seguem em aberto e por isso estão em hoje. */
  vencidasForaDoPeriodo: { quantidade: number; valor: number };
}

const ORDEM_SITUACAO: Record<Situacao, number> = { realizado: 0, atrasado: 1, previsto: 2 };

/** Ordem de caderno: data, o que já aconteceu antes do previsto, entradas antes das saídas. */
export function ordenarLancamentos(lista: readonly Lancamento[]): Lancamento[] {
  return [...lista].sort((a, b) =>
    a.data.localeCompare(b.data)
    || ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao]
    || (a.tipo === b.tipo ? 0 : a.tipo === 'entrada' ? -1 : 1)
    || (a.quem || a.descricao).localeCompare(b.quem || b.descricao, 'pt-BR'));
}

/** "qua, 7 out". */
export function rotuloDoDia(data: string): string {
  const d = dataLocal(data);
  if (!d) return data;
  return `${DIAS_DA_SEMANA_CURTOS[d.getDay()]}, ${d.getDate()} ${MESES_CURTOS[d.getMonth()]}`;
}

/** "Terça-feira, 7 de outubro". */
export function dataPorExtenso(data: string): string {
  const d = dataLocal(data);
  if (!d) return data;
  return `${maiuscula(DIAS_DA_SEMANA[d.getDay()])}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

function rotuloDoIntervalo(inicio: string, fim: string): string {
  const a = dataLocal(inicio);
  const b = dataLocal(fim);
  if (!a || !b) return `${inicio} a ${fim}`;
  if (inicio === fim) return rotuloDoDia(inicio);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} a ${b.getDate()} ${MESES_CURTOS[b.getMonth()]}`;
  return `${a.getDate()} ${MESES_CURTOS[a.getMonth()]} a ${b.getDate()} ${MESES_CURTOS[b.getMonth()]}`;
}

/** Os intervalos das linhas. Semana vai de domingo a sábado, cortada nas pontas do período. */
function intervalos(periodo: Periodo, agrupamento: Agrupamento, diasComMovimento: Set<string>, hoje: string) {
  const saida: Array<{ inicio: string; fim: string; rotulo: string }> = [];
  if (agrupamento === 'mes') {
    let ym = mesDe(periodo.inicio);
    while (ym <= mesDe(periodo.fim)) {
      const [, m] = ym.split('-').map(Number);
      saida.push({ inicio: `${ym}-01`, fim: ultimoDia(ym), rotulo: maiuscula(MESES[m - 1]) });
      ym = mesDe(addMeses(`${ym}-01`, 1));
    }
    return saida;
  }
  if (agrupamento === 'semana') {
    let inicio = periodo.inicio;
    while (inicio <= periodo.fim) {
      const d = dataLocal(inicio)!;
      const sabado = addDias(inicio, 6 - d.getDay());
      const fim = sabado > periodo.fim ? periodo.fim : sabado;
      saida.push({ inicio, fim, rotulo: rotuloDoIntervalo(inicio, fim) });
      inicio = addDias(fim, 1);
    }
    return saida;
  }
  // Dia a dia: só os dias que têm movimento, como num caderno de verdade,
  // mais o dia de hoje para a pessoa se achar.
  const dias = new Set(diasComMovimento);
  if (periodoContem(periodo, hoje)) dias.add(hoje);
  for (const dia of [...dias].sort()) {
    if (dia >= periodo.inicio && dia <= periodo.fim) saida.push({ inicio: dia, fim: dia, rotulo: rotuloDoDia(dia) });
  }
  return saida;
}

function efeito(l: Lancamento): number {
  return l.tipo === 'entrada' ? l.valor : -l.valor;
}

export function montarCaderno(entrada: {
  lancamentos: readonly Lancamento[];
  contas: readonly Pick<ContaBancaria, 'saldo_inicial'>[];
  periodo: Periodo;
  agrupamento: Agrupamento;
  hoje: string;
}): Caderno {
  const { periodo, agrupamento, hoje } = entrada;
  const doPeriodo = ordenarLancamentos(entrada.lancamentos.filter(l => periodoContem(periodo, l.data)));
  // Data vazia conta como "antes de tudo": é dinheiro que já mexeu no banco
  // (o saldo atual conta), só não sabemos quando.
  const anteriores = entrada.lancamentos.filter(l => !l.data || l.data < periodo.inicio);

  const saldoInicial = round2(
    somaPor(entrada.contas, c => c.saldo_inicial) + somaPor(anteriores, efeito),
  );
  const entradas = somaPor(doPeriodo.filter(l => l.tipo === 'entrada'), l => l.valor);
  const saidas = somaPor(doPeriodo.filter(l => l.tipo === 'saida'), l => l.valor);

  const porDia = new Map<string, Lancamento[]>();
  for (const l of doPeriodo) porDia.set(l.data, [...(porDia.get(l.data) ?? []), l]);

  let corrido = saldoInicial;
  const linhas: LinhaDoCaderno[] = intervalos(periodo, agrupamento, new Set(porDia.keys()), hoje).map(iv => {
    const lancamentos = doPeriodo.filter(l => l.data >= iv.inicio && l.data <= iv.fim);
    const e = somaPor(lancamentos.filter(l => l.tipo === 'entrada'), l => l.valor);
    const s = somaPor(lancamentos.filter(l => l.tipo === 'saida'), l => l.valor);
    corrido = round2(corrido + e - s);
    return {
      chave: iv.inicio,
      inicio: iv.inicio,
      fim: iv.fim,
      rotulo: iv.rotulo,
      entradas: e,
      saidas: s,
      saldo: corrido,
      lancamentos,
      contemHoje: hoje >= iv.inicio && hoje <= iv.fim,
      futura: iv.inicio > hoje,
    };
  });

  // Curva: o saldo no fim de cada dia, de ponta a ponta do período.
  const curva: PontoDaCurva[] = [];
  let saldoDoDia = saldoInicial;
  let primeiroDiaNegativo: string | null = null;
  for (let dia = periodo.inicio; dia <= periodo.fim; dia = addDias(dia, 1)) {
    saldoDoDia = round2(saldoDoDia + somaPor(porDia.get(dia) ?? [], efeito));
    curva.push({ data: dia, saldo: saldoDoDia });
    if (primeiroDiaNegativo === null && saldoDoDia < 0) primeiroDiaNegativo = dia;
    if (curva.length > 400) break; // teto de segurança: um ano tem 366 dias
  }

  const vencidas = entrada.lancamentos.filter(l =>
    l.situacao === 'atrasado' && periodoContem(periodo, l.vencimento) && !periodoContem(periodo, l.data));

  return {
    periodo,
    saldoInicial,
    entradas,
    saidas,
    saldoFinal: round2(saldoInicial + entradas - saidas),
    jaEntrou: somaPor(doPeriodo.filter(l => l.tipo === 'entrada' && l.situacao === 'realizado'), l => l.valor),
    jaSaiu: somaPor(doPeriodo.filter(l => l.tipo === 'saida' && l.situacao === 'realizado'), l => l.valor),
    linhas,
    curva,
    saldoDeHoje: periodoContem(periodo, hoje) ? (curva.find(p => p.data === hoje)?.saldo ?? null) : null,
    primeiroDiaNegativo,
    vencidasForaDoPeriodo: { quantidade: vencidas.length, valor: somaPor(vencidas, l => l.valor) },
  };
}

/** Agrupamento que faz sentido abrir em cada período. */
export function agrupamentoPadrao(tipo: TipoDePeriodo): Agrupamento {
  if (tipo === 'mes') return 'dia';
  if (tipo === 'bimestre') return 'semana';
  return 'mes';
}

/** Quais agrupamentos o período oferece: "por mês" num mês só seria uma linha. */
export function agrupamentosDoPeriodo(tipo: TipoDePeriodo): Agrupamento[] {
  return tipo === 'mes' ? ['dia', 'semana'] : ['dia', 'semana', 'mes'];
}
