/**
 * Fluxo de Caixa: Previsto × Realizado × Desvio, por conta e saldo mínimo
 * (05/11/2026).
 *
 * Acrescenta ao caderno (caderno-caixa.ts) três perguntas que ele não
 * responde sozinho, sem mudar nenhum número dele:
 *
 * 1) PREVISTO × REALIZADO. Para cada linha (dia, semana ou mês):
 *      · Previsto  = valor_final das contas vivas com VENCIMENTO na linha
 *                    (o combinado, pago ou não);
 *      · Realizado = o que se moveu na DATA DA BAIXA: entrada pelo que caiu no
 *                    banco (entradaLiquidaNoBanco, já sem a taxa da
 *                    plataforma), saída pelo que foi pago (valorMovimentado);
 *      · Desvio    = Realizado − Previsto. Taxa de plataforma, atraso e
 *                    adiantamento aparecem aqui, e é para isso que ele existe.
 *    O saldo da linha é o líquido (entradas − saídas) de cada coluna.
 *
 * 2) POR CONTA. Escolher uma conta filtra os títulos pela conta deles: a
 *    baixa vale pela conta_bancaria_id (sem conta, cai na Caixa Geral, como
 *    em todo o resto do financeiro); o que está em aberto só entra quando já
 *    tem conta escolhida. Previsão sem conta não é inventada para nenhuma
 *    conta: ela fica de fora e é contada, para a tela dizer quanto ficou.
 *    "Todas as contas" (filtro nulo) devolve as listas intactas: o caderno é
 *    exatamente o de antes.
 *
 * 3) SALDO MÍNIMO. Sobre a curva do caderno, o primeiro dia (de hoje em
 *    diante) em que o saldo previsto fica abaixo do mínimo escolhido, e o
 *    primeiro dia negativo.
 *
 * Atrasados: a regra é a do caderno (lancamentosDoCaixa). Conta vencida e em
 * aberto é esperada HOJE; aqui ela também aparece somada em `atrasados`.
 *
 * Só cálculo: sem banco, sem React, sem relógio (hoje entra). Datas civis.
 */
import type { ContaPagar, ContaReceber } from './crm-types';
import {
  intervalos, lancamentosDoCaixa, periodoContem,
  type Agrupamento, type EventoDeFolha, type Lancamento, type Periodo, type PontoDaCurva,
} from './caderno-caixa';
import { addDias, num, round2, somaPor } from './money';
import { entradaLiquidaNoBanco, valorMovimentado } from './saldo-bancario';

// ─── Conta ──────────────────────────────────────────────────────────────────

/** Qual conta olhar. `contaId` nulo = todas as contas (o caderno de sempre). */
export interface FiltroDeConta {
  contaId: string | null;
  /** Id da Caixa Geral: baixa sem conta cai nela. */
  caixaGeralId?: string | null;
  /**
   * Conta previsão padrão da agência (06/11/2026, E7): o título em aberto sem
   * conta prevista nem conta escolhida é esperado nela. Ausente = como antes.
   */
  contaPrevisaoPadraoId?: string | null;
}

/** O que receber e pagar têm em comum para achar a conta. */
type Titulo = {
  status?: string | null;
  conta_bancaria_id?: string | null;
  /** Conta onde se espera pagar ou receber (06/11/2026, E7). */
  conta_previsao_id?: string | null;
  valor_final?: number | null;
  valor_recebido?: number | null;
  valor_pago?: number | null;
};

function movimentou(t: Titulo, lado: 'receber' | 'pagar'): number {
  return lado === 'receber'
    ? valorMovimentado(t as ContaReceber, 'valor_recebido')
    : valorMovimentado(t as ContaPagar, 'valor_pago');
}

/**
 * A conta de um título. O que já se moveu vale pela conta escolhida (sem
 * conta, a Caixa Geral, onde o saldo o contou). O que está em aberto vale
 * pela conta prevista do título (06/11/2026, E7); sem ela, pela conta
 * escolhida, como antes; sem nenhuma, pela conta previsão padrão da agência;
 * sem padrão, nenhuma.
 */
export function contaDoTitulo(
  t: Titulo, lado: 'receber' | 'pagar', caixaGeralId?: string | null, contaPrevisaoPadraoId?: string | null,
): string | null {
  const escolhida = String(t.conta_bancaria_id ?? '').trim();
  if (movimentou(t, lado) > 0) return escolhida || caixaGeralId || null;
  const prevista = String(t.conta_previsao_id ?? '').trim();
  if (prevista) return prevista;
  if (escolhida) return escolhida;
  return String(contaPrevisaoPadraoId ?? '').trim() || null;
}

export interface TitulosDaConta {
  receber: ContaReceber[];
  pagar: ContaPagar[];
  folha: EventoDeFolha[];
  /** Previsões (em aberto) que ficaram fora por não ter conta escolhida. */
  semConta: { quantidade: number; valor: number };
}

function emAberto(t: Titulo, lado: 'receber' | 'pagar'): number {
  if (t.status === 'CANCELADO') return 0;
  if (lado === 'receber' && t.status === 'RECEBIDO') return 0;
  if (lado === 'pagar' && t.status === 'PAGO') return 0;
  const baixa = lado === 'receber' ? num(t.valor_recebido) : num(t.valor_pago);
  return Math.max(0, round2(num(t.valor_final) - baixa));
}

/**
 * Os títulos de uma conta. Filtro nulo devolve tudo, sem tocar em nada.
 * A folha ainda não lançada não tem conta: com uma conta escolhida, sai e
 * entra na contagem de previsões sem conta.
 */
export function titulosDaConta(entrada: {
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  folha?: readonly EventoDeFolha[];
  filtro: FiltroDeConta;
}): TitulosDaConta {
  const { filtro } = entrada;
  if (!filtro.contaId) {
    return {
      receber: [...entrada.receber],
      pagar: [...entrada.pagar],
      folha: [...(entrada.folha ?? [])],
      semConta: { quantidade: 0, valor: 0 },
    };
  }
  let quantidade = 0;
  let valor = 0;
  const filtrar = <T extends Titulo>(lista: readonly T[], lado: 'receber' | 'pagar'): T[] => lista.filter(t => {
    if (t.status === 'CANCELADO') return false;
    const conta = contaDoTitulo(t, lado, filtro.caixaGeralId, filtro.contaPrevisaoPadraoId);
    if (conta === null) {
      const aberto = emAberto(t, lado);
      if (aberto > 0) { quantidade++; valor = round2(valor + aberto); }
      return false;
    }
    return conta === filtro.contaId;
  });
  const receber = filtrar(entrada.receber, 'receber');
  const pagar = filtrar(entrada.pagar, 'pagar');
  for (const f of entrada.folha ?? []) {
    if (num(f.valor) > 0) { quantidade++; valor = round2(valor + num(f.valor)); }
  }
  return { receber, pagar, folha: [], semConta: { quantidade, valor } };
}

/** Os lançamentos do caderno de uma conta (ou de todas). */
export function lancamentosDaConta(entrada: {
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  folha?: readonly EventoDeFolha[];
  filtro: FiltroDeConta;
  hoje: string;
}): { lancamentos: Lancamento[]; semConta: TitulosDaConta['semConta'] } {
  const t = titulosDaConta(entrada);
  return {
    lancamentos: lancamentosDoCaixa({ receber: t.receber, pagar: t.pagar, folha: t.folha, hoje: entrada.hoje }),
    semConta: t.semConta,
  };
}

// ─── Previsto × Realizado ───────────────────────────────────────────────────

export interface Tripla {
  previsto: number;
  realizado: number;
  /** Realizado − Previsto. */
  desvio: number;
}

export interface LinhaComparativa {
  chave: string;
  inicio: string;
  fim: string;
  rotulo: string;
  entradas: Tripla;
  saidas: Tripla;
  /** Entradas − saídas, em cada coluna. */
  saldo: Tripla;
  contemHoje: boolean;
  /** Linha inteira depois de hoje: o realizado ainda não aconteceu. */
  futura: boolean;
}

export interface ComparativoDoPeriodo {
  linhas: LinhaComparativa[];
  totais: { entradas: Tripla; saidas: Tripla; saldo: Tripla };
  /** Em aberto e vencido: o caderno espera hoje. */
  atrasados: { entradas: number; saidas: number; quantidade: number };
  semConta: { quantidade: number; valor: number };
}

/** Um fato da comparação: quanto, quando e de que coluna. */
interface Fato {
  data: string;
  tipo: 'entrada' | 'saida';
  coluna: 'previsto' | 'realizado';
  valor: number;
}

function tripla(previsto: number, realizado: number): Tripla {
  return { previsto: round2(previsto), realizado: round2(realizado), desvio: round2(realizado - previsto) };
}

function dataCivil(v: unknown): string {
  return String(v ?? '').slice(0, 10);
}

function fatosDosTitulos(receber: readonly ContaReceber[], pagar: readonly ContaPagar[], folha: readonly EventoDeFolha[]): Fato[] {
  const fatos: Fato[] = [];
  for (const cr of receber) {
    if (cr.status === 'CANCELADO') continue;
    const venc = dataCivil(cr.data_vencimento);
    if (venc && num(cr.valor_final) > 0) fatos.push({ data: venc, tipo: 'entrada', coluna: 'previsto', valor: round2(num(cr.valor_final)) });
    if (valorMovimentado(cr, 'valor_recebido') > 0) {
      fatos.push({
        data: dataCivil(cr.data_recebimento || cr.data_vencimento),
        tipo: 'entrada', coluna: 'realizado', valor: entradaLiquidaNoBanco(cr),
      });
    }
  }
  for (const cp of pagar) {
    if (cp.status === 'CANCELADO') continue;
    const venc = dataCivil(cp.data_vencimento);
    if (venc && num(cp.valor_final) > 0) fatos.push({ data: venc, tipo: 'saida', coluna: 'previsto', valor: round2(num(cp.valor_final)) });
    const pago = valorMovimentado(cp, 'valor_pago');
    if (pago > 0) {
      fatos.push({ data: dataCivil(cp.data_pagamento || cp.data_vencimento), tipo: 'saida', coluna: 'realizado', valor: pago });
    }
  }
  // Folha ainda não lançada: compromisso, só previsto.
  for (const f of folha) {
    if (num(f.valor) > 0) fatos.push({ data: dataCivil(f.data_pagamento), tipo: 'saida', coluna: 'previsto', valor: round2(num(f.valor)) });
  }
  return fatos;
}

export function comparativoDoPeriodo(entrada: {
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  folha?: readonly EventoDeFolha[];
  periodo: Periodo;
  visao: Agrupamento;
  filtro: FiltroDeConta;
  hoje: string;
}): ComparativoDoPeriodo {
  const { periodo, visao, hoje } = entrada;
  const t = titulosDaConta(entrada);
  const fatos = fatosDosTitulos(t.receber, t.pagar, t.folha).filter(f => f.data && periodoContem(periodo, f.data));

  const dias = new Set(fatos.map(f => f.data));
  const linhas: LinhaComparativa[] = intervalos(periodo, visao, dias, hoje).map(iv => {
    const daLinha = fatos.filter(f => f.data >= iv.inicio && f.data <= iv.fim);
    const s = (tipo: Fato['tipo'], coluna: Fato['coluna']) =>
      somaPor(daLinha.filter(f => f.tipo === tipo && f.coluna === coluna), f => f.valor);
    const ePrev = s('entrada', 'previsto');
    const eReal = s('entrada', 'realizado');
    const sPrev = s('saida', 'previsto');
    const sReal = s('saida', 'realizado');
    return {
      chave: iv.inicio,
      inicio: iv.inicio,
      fim: iv.fim,
      rotulo: iv.rotulo,
      entradas: tripla(ePrev, eReal),
      saidas: tripla(sPrev, sReal),
      saldo: tripla(ePrev - sPrev, eReal - sReal),
      contemHoje: hoje >= iv.inicio && hoje <= iv.fim,
      futura: iv.inicio > hoje,
    };
  });

  const soma = (tipo: Fato['tipo'], coluna: Fato['coluna']) =>
    somaPor(fatos.filter(f => f.tipo === tipo && f.coluna === coluna), f => f.valor);
  const ePrev = soma('entrada', 'previsto');
  const eReal = soma('entrada', 'realizado');
  const sPrev = soma('saida', 'previsto');
  const sReal = soma('saida', 'realizado');

  // Atrasados projetados para hoje: a mesma regra do caderno.
  const atrasados = lancamentosDoCaixa({ receber: t.receber, pagar: t.pagar, hoje })
    .filter(l => l.situacao === 'atrasado');

  return {
    linhas,
    totais: {
      entradas: tripla(ePrev, eReal),
      saidas: tripla(sPrev, sReal),
      saldo: tripla(ePrev - sPrev, eReal - sReal),
    },
    atrasados: {
      entradas: somaPor(atrasados.filter(l => l.tipo === 'entrada'), l => l.valor),
      saidas: somaPor(atrasados.filter(l => l.tipo === 'saida'), l => l.valor),
      quantidade: atrasados.length,
    },
    semConta: t.semConta,
  };
}

// ─── Saldo mínimo ───────────────────────────────────────────────────────────

export interface AlertaDeSaldo {
  /** Primeiro dia, de hoje em diante, com saldo previsto abaixo do mínimo. */
  primeiroAbaixoDoMinimo: string | null;
  /** Primeiro dia, de hoje em diante, com saldo previsto negativo. */
  primeiroNegativo: string | null;
  /** O menor saldo previsto, de hoje em diante. */
  menor: PontoDaCurva | null;
}

/**
 * Lê a curva do caderno só do dia de hoje em diante (o passado é fato, não
 * previsão). Mínimo zero ou negativo não alerta nada além do negativo.
 */
export function alertaDeSaldo(curva: readonly PontoDaCurva[], minimo: number, hoje: string): AlertaDeSaldo {
  const previstos = curva.filter(p => p.data >= hoje);
  const min = round2(num(minimo));
  let menor: PontoDaCurva | null = null;
  for (const p of previstos) if (!menor || p.saldo < menor.saldo) menor = p;
  return {
    primeiroAbaixoDoMinimo: min > 0 ? (previstos.find(p => p.saldo < min)?.data ?? null) : null,
    primeiroNegativo: previstos.find(p => p.saldo < 0)?.data ?? null,
    menor,
  };
}

// ─── Grade conta × dia (E7, G3) ─────────────────────────────────────────────

export interface LinhaDaGrade {
  /** Id da conta bancária; SEM_CONTA e OUTRAS_CONTAS nas linhas sintéticas. */
  id: string;
  nome: string;
  tipo: 'conta' | 'sem_conta' | 'outras';
  saldoInicial: number;
  /** Saldo no fim de cada dia (na ordem de `dias`). */
  saldos: number[];
  /** Entradas − saídas de cada dia. */
  movimentos: number[];
  entradas: number[];
  saidas: number[];
  /** Os lançamentos de cada dia com movimento (para abrir o detalhe). */
  lancamentosPorDia: Record<string, Lancamento[]>;
}

export interface GradeContaDia {
  dias: string[];
  linhas: LinhaDaGrade[];
  total: Omit<LinhaDaGrade, 'id' | 'nome' | 'tipo' | 'lancamentosPorDia'>;
}

export const SEM_CONTA = '__sem_conta';
export const OUTRAS_CONTAS = '__outras';

/**
 * Cada conta bancária numa linha, cada dia do período numa coluna: o saldo no
 * fim do dia (ou o movimento do dia), pela regra do caderno (realizado na
 * data da baixa, em aberto no vencimento ou hoje se venceu). Baixa sem conta
 * vai para a Caixa Geral; previsão sem conta e folha ainda não lançada ficam
 * numa linha própria ("Previsto sem conta"), e título de conta que não está
 * na lista (excluída ou não liberada para a pessoa) em "Outras contas". Assim
 * a soma das linhas é exatamente o caderno de "Todas as contas".
 */
export function gradeContaPorDia(entrada: {
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  folha?: readonly EventoDeFolha[];
  contas: ReadonlyArray<{ id: string; nome?: string | null; saldo_inicial?: number | null }>;
  caixaGeralId?: string | null;
  /** Conta previsão padrão da agência: o que está em aberto sem conta prevista entra nela. */
  contaPrevisaoPadraoId?: string | null;
  periodo: Periodo;
  hoje: string;
}): GradeContaDia {
  const { periodo, hoje } = entrada;
  const dias: string[] = [];
  for (let d = periodo.inicio; d <= periodo.fim && dias.length < 400; d = addDias(d, 1)) dias.push(d);

  const conhecidas = new Set(entrada.contas.map(c => c.id));
  const grupos = new Map<string, { receber: ContaReceber[]; pagar: ContaPagar[] }>();
  const grupo = (id: string) => {
    let g = grupos.get(id);
    if (!g) { g = { receber: [], pagar: [] }; grupos.set(id, g); }
    return g;
  };
  const chaveDe = (conta: string | null) => (conta === null ? SEM_CONTA : conhecidas.has(conta) ? conta : OUTRAS_CONTAS);
  for (const cr of entrada.receber) {
    if (cr.status === 'CANCELADO') continue;
    grupo(chaveDe(contaDoTitulo(cr, 'receber', entrada.caixaGeralId, entrada.contaPrevisaoPadraoId))).receber.push(cr);
  }
  for (const cp of entrada.pagar) {
    if (cp.status === 'CANCELADO') continue;
    grupo(chaveDe(contaDoTitulo(cp, 'pagar', entrada.caixaGeralId, entrada.contaPrevisaoPadraoId))).pagar.push(cp);
  }

  const montar = (id: string, nome: string, tipo: LinhaDaGrade['tipo'], saldoInicialDaConta: number, folha: readonly EventoDeFolha[]): LinhaDaGrade => {
    const g = grupos.get(id) ?? { receber: [], pagar: [] };
    const lancs = lancamentosDoCaixa({ receber: g.receber, pagar: g.pagar, folha, hoje });
    const anteriores = lancs.filter(l => !l.data || l.data < periodo.inicio);
    const saldoInicial = round2(saldoInicialDaConta + somaPor(anteriores, l => (l.tipo === 'entrada' ? l.valor : -l.valor)));
    const porDia = new Map<string, Lancamento[]>();
    for (const l of lancs) if (l.data && periodoContem(periodo, l.data)) porDia.set(l.data, [...(porDia.get(l.data) ?? []), l]);
    const saldos: number[] = [];
    const movimentos: number[] = [];
    const entradas: number[] = [];
    const saidas: number[] = [];
    let corrido = saldoInicial;
    const lancamentosPorDia: Record<string, Lancamento[]> = {};
    for (const d of dias) {
      const ls = porDia.get(d) ?? [];
      const e = somaPor(ls.filter(l => l.tipo === 'entrada'), l => l.valor);
      const s = somaPor(ls.filter(l => l.tipo === 'saida'), l => l.valor);
      corrido = round2(corrido + e - s);
      entradas.push(e);
      saidas.push(s);
      movimentos.push(round2(e - s));
      saldos.push(corrido);
      if (ls.length) lancamentosPorDia[d] = ls;
    }
    return { id, nome, tipo, saldoInicial, saldos, movimentos, entradas, saidas, lancamentosPorDia };
  };

  const linhas: LinhaDaGrade[] = entrada.contas.map(c =>
    montar(c.id, String(c.nome ?? '').trim() || 'Conta sem nome', 'conta', round2(num(c.saldo_inicial)), []));
  const folha = (entrada.folha ?? []).filter(f => num(f.valor) > 0);
  if (grupos.has(SEM_CONTA) || folha.length) {
    const l = montar(SEM_CONTA, 'Previsto sem conta', 'sem_conta', 0, folha);
    if (l.saldoInicial !== 0 || l.movimentos.some(v => v !== 0)) linhas.push(l);
  }
  if (grupos.has(OUTRAS_CONTAS)) {
    const l = montar(OUTRAS_CONTAS, 'Outras contas', 'outras', 0, []);
    if (l.saldoInicial !== 0 || l.movimentos.some(v => v !== 0)) linhas.push(l);
  }

  const somaColuna = (k: 'saldos' | 'movimentos' | 'entradas' | 'saidas') =>
    dias.map((_, i) => round2(linhas.reduce((s, l) => s + l[k][i], 0)));
  return {
    dias,
    linhas,
    total: {
      saldoInicial: round2(linhas.reduce((s, l) => s + l.saldoInicial, 0)),
      saldos: somaColuna('saldos'),
      movimentos: somaColuna('movimentos'),
      entradas: somaColuna('entradas'),
      saidas: somaColuna('saidas'),
    },
  };
}
