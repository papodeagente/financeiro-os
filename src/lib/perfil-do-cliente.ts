/**
 * O retrato de um cliente: o que ele comprou, o que pagou e o que deve.
 *
 * TRÊS CUIDADOS QUE ESTE MÓDULO EXISTE PARA GARANTIR.
 *
 * 1. O DINHEIRO SAI DOS MESMOS HELPERS DO RESTO DO SISTEMA. `valorRealizado`,
 *    `valorEmAberto` e `ativas` são os mesmos que o contas a receber, o
 *    dashboard e o DRE usam. Recalcular aqui "só para esta tela" produziria um
 *    saldo do cliente que não bate com a lista de contas dele, e ninguém
 *    saberia qual acreditar.
 *
 * 2. VOLUME COMPRADO NÃO É RECEITA DA AGÊNCIA. O que o cliente paga é, em boa
 *    parte, repasse a fornecedor: a regra canônica do sistema é
 *    `receita_agencia = volume_liquido + comissões − custo`. Nesta tela o
 *    número certo é mesmo o volume — é o retrato do CLIENTE, não do resultado
 *    — e por isso ele se chama volume, nunca receita.
 *
 * 3. AUSÊNCIA NÃO É ZERO. Cliente que nunca comprou não tem "ticket médio
 *    R$ 0,00" nem "última compra há 0 dias": tem `null`, e a tela escreve que
 *    não há compra. Zero afirma um fato; null diz que não há fato.
 */
import {
  ativas, estaCancelada, valorEmAberto, valorRealizado,
  type ContaReceberMin,
} from './resultado-financeiro';
import { divSegura, hojeISO, num, round2, soma, somaPor } from './money';

/** O mínimo de uma venda para entrar no retrato. */
export interface VendaDoPerfil {
  id?: string;
  numero?: string | null;
  status?: string | null;
  data_venda?: string | null;
  valor_final?: number | null;
}

/** O mínimo de uma nota fiscal para entrar no retrato. */
export interface NotaDoPerfil {
  id?: string;
  numero?: string | null;
  status?: string | null;
  valor_servicos?: number | null;
  emitida_em?: string | null;
}

/**
 * Venda que virou compra.
 *
 * ORÇAMENTO e RESERVADO ainda são conversa; CANCELADO deixou de existir. Só
 * CONFIRMADO e CONCLUIDO são dinheiro que o cliente se comprometeu a pagar, e
 * é essa a definição que o resto do sistema usa para contar venda fechada.
 */
export function ehCompra(venda: VendaDoPerfil): boolean {
  const s = String(venda.status ?? '').toUpperCase();
  return s === 'CONFIRMADO' || s === 'CONCLUIDO';
}

/** Negociação viva ou morta, mas que existiu. Cancelada continua contando
 *  como negociação: ela aconteceu, e some do histórico seria apagar o fato. */
export function ehNegociacao(venda: VendaDoPerfil): boolean {
  return Boolean(String(venda.status ?? '').trim());
}

export interface PerfilDoCliente {
  // ── Relacionamento ──
  /** Quantas vezes houve conversa de venda, em qualquer desfecho. */
  negociacoes: number;
  /** Quantas viraram compra. */
  compras: number;
  /** compras ÷ negociações, em %. NULL quando nunca houve negociação. */
  taxa_de_conversao: number | null;

  // ── Volume (o que o cliente comprou, não o que a agência ganhou) ──
  volume_comprado: number;
  /** volume ÷ compras. NULL sem compra: média de nada não é zero. */
  ticket_medio: number | null;

  // ── Dinheiro ──
  /** O que já entrou, pelos mesmos helpers do contas a receber. */
  pago: number;
  /** O que falta entrar. */
  em_aberto: number;
  /** Parte do em aberto cujo vencimento já passou. */
  vencido: number;

  // ── Tempo ──
  /** Data civil da primeira compra. NULL quando nunca comprou. */
  primeira_compra: string | null;
  ultima_compra: string | null;
  /** Dias desde a última compra. NULL quando nunca comprou. */
  dias_desde_a_ultima_compra: number | null;

  // ── Notas fiscais ──
  notas_emitidas: number;
  valor_em_notas: number;
}

function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** Data civil 'YYYY-MM-DD' ou null. Nunca `new Date(string)`: no fuso do
 *  Brasil isso volta um dia e a compra aparece na véspera. */
function dataCivil(v: string | null | undefined): string | null {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function montarPerfilDoCliente(entrada: {
  vendas: readonly VendaDoPerfil[] | null | undefined;
  contas: readonly ContaReceberMin[] | null | undefined;
  notas: readonly NotaDoPerfil[] | null | undefined;
  /** Data civil de referência. Vem de fora para o teste não depender do relógio. */
  hoje?: string;
}): PerfilDoCliente {
  const hoje = entrada.hoje || hojeISO();

  const todas = (entrada.vendas ?? []).filter(ehNegociacao);
  const compras = todas.filter(ehCompra);

  const volume_comprado = somaPor(compras, v => num(v.valor_final));

  const datas = compras
    .map(v => dataCivil(v.data_venda))
    .filter((d): d is string => d !== null)
    .sort();

  // Contas canceladas não existem para número nenhum — mesma regra do resto.
  const contas = ativas(entrada.contas);
  const pago = somaPor(contas, c => valorRealizado(c, 'valor_recebido'));
  const em_aberto = somaPor(contas, c => valorEmAberto(c, 'valor_recebido'));
  const vencido = somaPor(
    contas.filter(c => {
      const venc = dataCivil(c.data_vencimento);
      return venc !== null && venc < hoje && valorEmAberto(c, 'valor_recebido') > 0;
    }),
    c => valorEmAberto(c, 'valor_recebido'),
  );

  // Nota cancelada não conta como emitida, e não soma valor.
  const notasVivas = (entrada.notas ?? []).filter(n => !estaCancelada(n));

  return {
    negociacoes: todas.length,
    compras: compras.length,
    taxa_de_conversao: todas.length === 0
      ? null
      : round2(divSegura(compras.length, todas.length) * 100),

    volume_comprado,
    ticket_medio: compras.length === 0
      ? null
      : round2(divSegura(volume_comprado, compras.length)),

    pago,
    em_aberto,
    vencido,

    primeira_compra: datas[0] ?? null,
    ultima_compra: datas[datas.length - 1] ?? null,
    dias_desde_a_ultima_compra: datas.length === 0
      ? null
      : diasEntre(datas[datas.length - 1], hoje),

    notas_emitidas: notasVivas.length,
    valor_em_notas: round2(soma(notasVivas.map(n => num(n.valor_servicos)))),
  };
}

/**
 * Como dizer "faz tanto tempo" sem mentir sobre a precisão.
 *
 * Dias viram meses porque "comprou há 428 dias" é um número que ninguém
 * converte de cabeça, e a precisão de dia não muda decisão nenhuma depois do
 * segundo mês.
 */
export function tempoDesdeAUltimaCompra(dias: number | null): string {
  if (dias === null) return 'Nunca comprou';
  if (dias <= 0) return 'Comprou hoje';
  if (dias === 1) return 'Comprou ontem';
  if (dias < 30) return `Comprou há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `Comprou há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  if (resto === 0) return `Comprou há ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
  return `Comprou há ${anos} ${anos === 1 ? 'ano' : 'anos'} e ${resto} ${resto === 1 ? 'mês' : 'meses'}`;
}
