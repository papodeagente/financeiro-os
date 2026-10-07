/**
 * Taxa da plataforma de pagamento.
 *
 * O que a adquirente (Mercado Pago, Stripe, Asaas...) retém de uma venda.
 * O cliente paga o valor cheio da conta, a plataforma fica com uma parte e
 * só o resto cai na conta bancária da agência.
 *
 * A REGRA JÁ EXISTIA em resultado-financeiro.ts, que soma `taxa` das contas
 * a receber e calcula `resultado_final = margem_prevista - taxas`. O que
 * faltava era alguém gravar o campo. Este módulo é a porta de entrada dele:
 * como normalizar a plataforma, quando a taxa conta como dinheiro que saiu
 * e como agrupar tudo por plataforma para o relatório.
 *
 * O PERCENTUAL NÃO É GRAVADO em lugar nenhum. Ele é taxa ÷ base, derivado na
 * hora. Guardá-lo criaria uma segunda fonte de verdade para o mesmo fato:
 * bastaria editar o valor da conta e o percentual gravado passaria a mentir.
 *
 * Módulo puro: depende só de money.ts, sem banco e sem React.
 */
import { divSegura, num, percentual as aplicarPercentual, round2, somaPor } from './money';

/**
 * Adquirentes e plataformas de pagamento comuns no Brasil.
 *
 * É uma semente para o seletor, não uma lista fechada: quem usa outra digita
 * o nome e ele passa a aparecer nas próximas vezes. Serve para que o
 * relatório não se fragmente em "Mercado Pago", "mercado pago" e "MercadoPago"
 * só por causa de digitação.
 */
export const PLATAFORMAS_CONHECIDAS: readonly string[] = [
  'Asaas',
  'Cielo',
  'Getnet',
  'Hotmart',
  'InfinitePay',
  'Mercado Pago',
  'PagBank',
  'PagSeguro',
  'Pagar.me',
  'PayPal',
  'Rede',
  'Stone',
  'Stripe',
  'SumUp',
];

/**
 * Chave de comparação: sem acento, sem caixa, sem espaço sobrando e sem
 * pontuação. "Pagar.me", "PAGAR ME" e "pagarme" viram a mesma coisa.
 */
export function chaveDaPlataforma(nome: string | null | undefined): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/**
 * Nome de exibição canônico.
 *
 * Se casar com uma plataforma conhecida, devolve a grafia oficial dela — é o
 * que impede o relatório de rachar em várias linhas. Se não casar, devolve o
 * que a pessoa escreveu, só com os espaços arrumados: não é papel deste
 * módulo corrigir o nome de uma plataforma que ele não conhece.
 */
export function normalizarPlataforma(nome: string | null | undefined): string {
  const limpo = String(nome ?? '').replace(/\s+/g, ' ').trim();
  if (!limpo) return '';
  const chave = chaveDaPlataforma(limpo);
  const conhecida = PLATAFORMAS_CONHECIDAS.find(p => chaveDaPlataforma(p) === chave);
  return conhecida ?? limpo;
}

/**
 * Quanto a taxa representa da conta, em percentual.
 *
 * Base zero devolve NULL, nunca 0. Dizer "0%" quando não há base seria uma
 * afirmação que não temos como fazer — e na tela 0% se lê como "não houve
 * taxa", que é outra coisa.
 */
export function percentualDaTaxa(
  taxa: number | null | undefined,
  base: number | null | undefined,
): number | null {
  const b = num(base);
  if (b <= 0) return null;
  return round2(divSegura(num(taxa), b) * 100);
}

export type TaxaInvalida = 'negativa' | 'maior-que-a-conta';

/**
 * A taxa é um fato observado, não uma conta a fazer — então a validação é
 * só contra o que é impossível: reter menos que nada, ou reter mais do que o
 * cliente pagou. Base ausente não invalida nada (a conta ainda pode estar
 * sendo preenchida).
 */
export function validarTaxa(
  taxa: number | null | undefined,
  base: number | null | undefined,
): TaxaInvalida | null {
  const t = num(taxa);
  if (t < 0) return 'negativa';
  const b = num(base);
  if (b > 0 && round2(t) > round2(b)) return 'maior-que-a-conta';
  return null;
}

export function mensagemDaTaxaInvalida(motivo: TaxaInvalida): string {
  return motivo === 'negativa'
    ? 'A taxa não pode ser negativa.'
    : 'A taxa não pode ser maior do que o valor da conta.';
}

/** O mínimo que uma conta a receber precisa ter para entrar nestas contas. */
export interface ContaComTaxa {
  id?: string;
  status?: string | null;
  descricao?: string | null;
  cliente_nome?: string | null;
  valor_final?: number | null;
  valor_recebido?: number | null;
  data_recebimento?: string | null;
  data_vencimento?: string | null;
  taxa?: number | null;
  taxa_plataforma?: string | null;
}

/**
 * Status é ENUM exato em todo o sistema, comparado sem normalizar
 * (valorRealizado, valorMovimentado e o SQL do dashboard fazem assim). Ser
 * mais tolerante AQUI do que o cálculo da entrada abre um buraco: um status
 * fora do enum faria a entrada valer zero e a taxa ser descontada mesmo
 * assim, e a conta colocaria dinheiro NEGATIVO no banco.
 */
function cancelada(conta: ContaComTaxa): boolean {
  return String(conta.status ?? '') === 'CANCELADO';
}

/**
 * Taxa que JÁ saiu do dinheiro da agência.
 *
 * A plataforma só retém quando o dinheiro passa por ela, então conta pendente
 * vale zero por mais que tenha taxa prevista. RECEBIDO e PARCIAL contam o
 * valor cheio do campo — e não uma fração dele — porque o que se grava ali é
 * "o valor real descontado", um fato já observado, não uma projeção a ratear.
 */
export function taxaRealizada(conta: ContaComTaxa): number {
  if (cancelada(conta)) return 0;
  const status = String(conta.status ?? '');
  if (status !== 'RECEBIDO' && status !== 'PARCIAL') return 0;
  return round2(Math.max(0, num(conta.taxa)));
}

/** Total já retido pelas plataformas no conjunto. */
export function totalDeTaxas(contas: readonly ContaComTaxa[] | null | undefined): number {
  return somaPor(contas ?? [], taxaRealizada);
}

/**
 * Nomes que o seletor deve oferecer: os conhecidos mais os que a agência já
 * usou, sem repetir e em ordem alfabética. É o que faz a lista aprender sem
 * exigir uma tela de cadastro.
 */
export function opcoesDePlataforma(
  contas: readonly ContaComTaxa[] | null | undefined,
  extras: readonly string[] = [],
): string[] {
  const porChave = new Map<string, string>();
  for (const nome of [...PLATAFORMAS_CONHECIDAS, ...extras]) {
    const canonico = normalizarPlataforma(nome);
    if (canonico) porChave.set(chaveDaPlataforma(canonico), canonico);
  }
  for (const c of contas ?? []) {
    const canonico = normalizarPlataforma(c.taxa_plataforma);
    if (canonico) porChave.set(chaveDaPlataforma(canonico), canonico);
  }
  return [...porChave.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Rótulo das contas com taxa que ninguém atribuiu a uma plataforma. */
export const SEM_PLATAFORMA = 'Não informada';

export interface LinhaDeTaxa {
  /** Nome canônico, ou SEM_PLATAFORMA quando a conta não diz qual foi. */
  plataforma: string;
  /** Quantas contas com taxa retida. */
  quantidade: number;
  /** Quanto o cliente pagou nessas contas. */
  bruto: number;
  /** Quanto a plataforma reteve. */
  taxa: number;
  /** Quanto sobrou para a agência. */
  liquido: number;
  /** taxa ÷ bruto. NULL quando não há base — nunca 0. */
  percentual: number | null;
}

export interface RelatorioDeTaxas {
  linhas: LinhaDeTaxa[];
  total: LinhaDeTaxa;
}

/**
 * Base de uma conta para efeito de taxa: o que de fato passou pela
 * plataforma. PARCIAL passou só o acumulado; RECEBIDO passou a conta inteira.
 */
export function brutoQuePassou(conta: ContaComTaxa): number {
  if (cancelada(conta)) return 0;
  const status = String(conta.status ?? '');
  if (status === 'PARCIAL') return round2(num(conta.valor_recebido));
  if (status === 'RECEBIDO') return round2(num(conta.valor_recebido) || num(conta.valor_final));
  return 0;
}

/**
 * O relatório: uma linha por plataforma, ordenada pela maior mordida.
 *
 * Só entram contas que realmente tiveram taxa retida — uma plataforma que
 * não cobrou nada não merece linha, e uma conta ainda pendente não teve
 * retenção nenhuma.
 */
export function agruparTaxasPorPlataforma(
  contas: readonly ContaComTaxa[] | null | undefined,
): RelatorioDeTaxas {
  const acumulado = new Map<string, LinhaDeTaxa>();

  for (const conta of contas ?? []) {
    const taxa = taxaRealizada(conta);
    if (taxa <= 0) continue;
    const plataforma = normalizarPlataforma(conta.taxa_plataforma) || SEM_PLATAFORMA;
    const atual = acumulado.get(plataforma) ?? {
      plataforma,
      quantidade: 0,
      bruto: 0,
      taxa: 0,
      liquido: 0,
      percentual: null,
    };
    atual.quantidade += 1;
    atual.bruto = round2(atual.bruto + brutoQuePassou(conta));
    atual.taxa = round2(atual.taxa + taxa);
    acumulado.set(plataforma, atual);
  }

  const linhas = [...acumulado.values()].map(l => ({
    ...l,
    liquido: round2(l.bruto - l.taxa),
    percentual: percentualDaTaxa(l.taxa, l.bruto),
  }));

  // Maior mordida primeiro; empate desempata pelo nome para a ordem não
  // dançar entre dois carregamentos iguais.
  linhas.sort((a, b) => b.taxa - a.taxa || a.plataforma.localeCompare(b.plataforma, 'pt-BR'));

  const bruto = round2(somaPor(linhas, l => l.bruto));
  const taxa = round2(somaPor(linhas, l => l.taxa));

  return {
    linhas,
    total: {
      plataforma: 'Total',
      quantidade: linhas.reduce((n, l) => n + l.quantidade, 0),
      bruto,
      taxa,
      liquido: round2(bruto - taxa),
      percentual: percentualDaTaxa(taxa, bruto),
    },
  };
}

// ─── Baixa pelo valor que caiu no banco ─────────────────────────────────────
//
// Pedido do Bruno (07/10/2026): "ao invés de colocar o valor do desconto, me
// permita colocar o valor total recebido já com desconto e o sistema calcula
// o valor descontado e percentual".
//
// Quem dá baixa está olhando o extrato, e no extrato aparece o LÍQUIDO. A
// taxa continua sendo o fato gravado na conta (é ela que o saldo, o DRE e o
// relatório de taxas leem); o líquido é só a forma de chegar nela sem conta
// de cabeça.

/** Quanto a plataforma descontou, dado o que o cliente pagou e o que caiu no banco. */
export function descontoPeloLiquido(
  bruto: number | null | undefined,
  liquido: number | null | undefined,
): number {
  return round2(Math.max(0, num(bruto) - num(liquido)));
}

export type LiquidoInvalido = 'vazio' | 'maior-que-o-pago';

/**
 * O que caiu no banco não pode passar do que o cliente pagou (a diferença
 * seria um desconto negativo) e não pode ser zero: uma plataforma que retém
 * 100% não fez um recebimento, e zero quase sempre é o campo ainda vazio.
 */
export function validarLiquido(
  bruto: number | null | undefined,
  liquido: number | null | undefined,
): LiquidoInvalido | null {
  const l = round2(num(liquido));
  if (l <= 0) return 'vazio';
  if (l > round2(num(bruto))) return 'maior-que-o-pago';
  return null;
}

export function mensagemDoLiquidoInvalido(motivo: LiquidoInvalido): string {
  return motivo === 'vazio'
    ? 'Informe quanto caiu no banco.'
    : 'O que caiu no banco não pode ser maior do que o cliente pagou.';
}

/**
 * O líquido que um desconto percentual deixa. O desconto é arredondado em
 * centavos primeiro e o líquido sai da subtração, para que líquido + desconto
 * dê exatamente o bruto (é assim que o extrato da plataforma fecha).
 */
export function liquidoPeloPercentual(
  bruto: number | null | undefined,
  percentual: number | null | undefined,
): number {
  const b = round2(num(bruto));
  return round2(b - aplicarPercentual(b, num(percentual)));
}

// ─── Desconto padrão por plataforma ─────────────────────────────────────────
//
// Uma CONFIGURAÇÃO da agência ("a Hotmart fica com 9,9%"), não o percentual
// de uma conta. A regra do topo continua valendo: a conta grava a taxa em
// reais e o percentual dela é sempre derivado. O padrão só serve para
// sugerir o líquido na baixa, e a pessoa pode corrigir antes de confirmar.

export interface DescontoPadrao {
  /** Nome canônico (normalizarPlataforma). */
  plataforma: string;
  /** Em pontos percentuais: 9.9 = 9,9%. */
  percentual: number;
}

export type PercentualInvalido = 'vazio' | 'fora-da-faixa';

/** Maior que zero e menor que cem. Zero é "sem padrão"; cem é a venda inteira. */
export function validarPercentualPadrao(percentual: number | null | undefined): PercentualInvalido | null {
  const p = Number(percentual);
  if (percentual === null || percentual === undefined || !Number.isFinite(p) || p === 0) return 'vazio';
  if (p < 0 || p >= 100) return 'fora-da-faixa';
  return null;
}

export function mensagemDoPercentualInvalido(motivo: PercentualInvalido): string {
  return motivo === 'vazio'
    ? 'Informe o percentual do desconto.'
    : 'O percentual precisa ficar entre 0% e 100%.';
}

/** O padrão cadastrado para a plataforma, comparando pela chave (caixa, acento e pontuação não importam). */
export function descontoPadraoDa(
  plataforma: string | null | undefined,
  padroes: readonly DescontoPadrao[] | null | undefined,
): DescontoPadrao | null {
  const chave = chaveDaPlataforma(plataforma);
  if (!chave) return null;
  return (padroes ?? []).find(p => chaveDaPlataforma(p.plataforma) === chave) ?? null;
}

/**
 * "9,9%", "4,99%", "10%". Percentual de configuração, sem zeros à direita:
 * a pessoa cadastrou 9,9 e é isso que ela espera ler.
 */
export function formatarPercentual(percentual: number | null | undefined): string {
  if (percentual === null || percentual === undefined || !Number.isFinite(Number(percentual))) return '—';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(round2(Number(percentual)))}%`;
}

/** "9,9", "9.9", "9,9 %" → 9.9. Vazio ou ilegível → null (a tela diz o que falta). */
export function lerPercentual(texto: string | null | undefined): number | null {
  const limpo = String(texto ?? '').replace(/%/g, '').replace(/\s+/g, '').replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(limpo)) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}
