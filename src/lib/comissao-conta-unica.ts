/**
 * UMA CONTA A PAGAR POR COMISSÃO: as regras puras, sem banco.
 *
 * Existe porque a tela de comissões e o gancho do servidor criavam, cada um,
 * a sua conta para a mesma comissão. O gancho (`comissao-conta.ts`) grava
 * `cp-comissao-<id>` a cada gravação da comissão; a tela gravava também
 * `pagar-<id>` ao aprovar e ao pagar. Resultado: duas contas por comissão. O
 * pagamento baixava `pagar-<id>` e `cp-comissao-<id>` ficava pendente para
 * sempre, e o fluxo de caixa e o total a pagar contavam a comissão em dobro.
 * O índice único de contas a pagar não pegava: `origem_item_id` é nulo nas
 * duas, e nulo nunca colide.
 *
 * A regra a partir daqui:
 *  - a conta da comissão é `cp-comissao-<id>`, e quem a cria é o gancho;
 *  - a `pagar-<id>` que já existe (de antes desta correção) e não foi
 *    cancelada É a conta da comissão: ela é mantida e a gêmea
 *    `cp-comissao-<id>` em aberto é cancelada;
 *  - conta já baixada (PAGO, PARCIAL) nunca é tocada.
 *
 * Este arquivo não importa o banco, para a tela poder usá-lo.
 */
import { num, round2 } from './money';

export const PREFIXO_CONTA_COMISSAO = 'cp-comissao-';
/** Prefixo da conta que a tela de comissões criava antes desta correção. */
export const PREFIXO_CONTA_LEGADA = 'pagar-';

/** Id da conta a pagar de uma comissão. Determinístico: recalcular não duplica. */
export function idDaContaDaComissao(comissaoId: string): string {
  return `${PREFIXO_CONTA_COMISSAO}${comissaoId}`;
}

/** Id da conta antiga, criada pela aprovação na tela. */
export function idDaContaLegada(comissaoId: string): string {
  return `${PREFIXO_CONTA_LEGADA}${comissaoId}`;
}

interface ComStatus {
  status?: unknown;
}

/** O status da conta em maiúsculas ('' quando não há conta). */
export function estadoDaConta(conta: ComStatus | null | undefined): string {
  return String(conta?.status ?? '').trim().toUpperCase();
}

/** Baixada: já moveu caixa e não pode ser regravada nem cancelada. */
export function contaBaixada(conta: ComStatus | null | undefined): boolean {
  const s = estadoDaConta(conta);
  return s === 'PAGO' || s === 'PARCIAL';
}

/** Existe e não foi cancelada. */
export function contaViva(conta: ComStatus | null | undefined): boolean {
  return !!conta && estadoDaConta(conta) !== 'CANCELADO';
}

/**
 * Qual conta o pagamento da comissão deve baixar.
 *
 * A antiga, se ainda estiver viva: ela é a conta da comissão desde antes, e
 * baixar a nova deixaria a antiga pendente (o mesmo dobro, ao contrário).
 * Senão a do gancho. Nenhuma das duas: quem chama cria a do gancho.
 */
export function contaParaBaixar<T extends ComStatus>(
  legada: T | null | undefined,
  nova: T | null | undefined,
): { conta: T; qual: 'legada' | 'nova' } | null {
  if (contaViva(legada)) return { conta: legada as T, qual: 'legada' };
  if (contaViva(nova)) return { conta: nova as T, qual: 'nova' };
  return null;
}

/**
 * A conta como ela fica depois da baixa, ou null quando já está paga (pagar
 * de novo é nada, não um segundo débito). O valor baixado é o da conta.
 */
export function baixaDaConta<T extends ComStatus & { valor_final?: unknown }>(
  conta: T,
  hoje: string,
): (T & { status: 'PAGO'; data_pagamento: string; valor_pago: number }) | null {
  if (estadoDaConta(conta) === 'PAGO') return null;
  return { ...conta, status: 'PAGO', data_pagamento: hoje, valor_pago: round2(num(conta.valor_final)) };
}

// ──────────────────────────────────────────────────────────────────────
// Os três gestos da tela de comissões, com a entrada e saída injetadas.
// A tela passa as rotas HTTP; o teste passa as MESMAS rotas, chamadas
// direto contra um Postgres de teste. A regra fica num lugar só.
// ──────────────────────────────────────────────────────────────────────

interface ComissaoDaTela {
  id: string;
  status: string;
}

interface ContaDaTela {
  id: string;
  status?: unknown;
  valor_final?: unknown;
}

export interface PortasDaComissao<C extends ComissaoDaTela, K extends ContaDaTela> {
  /** PUT da comissão: o servidor grava e o gancho programa a conta a pagar. */
  gravarComissao: (c: C) => Promise<void>;
  /** A conta como está no banco agora, ou null. */
  lerConta: (id: string) => Promise<K | null>;
  /** POST de conta a pagar (não move caixa). */
  criarConta: (conta: K) => Promise<void>;
  /** PUT de conta a pagar: o único caminho que move caixa. */
  atualizarConta: (conta: K) => Promise<void>;
}

/** Aprovar só aprova: a conta a pagar já existe, programada pelo gancho. */
export async function aprovarComissao<C extends ComissaoDaTela, K extends ContaDaTela>(
  c: C,
  hoje: string,
  portas: PortasDaComissao<C, K>,
): Promise<void> {
  await portas.gravarComissao({ ...c, status: 'APROVADA', data_aprovacao: hoje });
}

/**
 * Pagar: grava a comissão como paga e baixa UMA conta, a que `contaParaBaixar`
 * escolhe, lida depois da gravação (o gancho acabou de mexer nela). Sem conta
 * nenhuma (o gancho falhou), cria a de reserva com o id da conta única e
 * baixa essa. Conta já paga não é baixada de novo.
 */
export async function pagarComissao<C extends ComissaoDaTela, K extends ContaDaTela>(
  c: C,
  hoje: string,
  portas: PortasDaComissao<C, K>,
  contaDeReserva: () => K,
): Promise<{ conta: string; qual: 'legada' | 'nova' | 'criada'; baixou: boolean }> {
  await portas.gravarComissao({ ...c, status: 'PAGA', data_pagamento: hoje });
  const [legada, nova] = await Promise.all([
    portas.lerConta(idDaContaLegada(c.id)),
    portas.lerConta(idDaContaDaComissao(c.id)),
  ]);
  const escolhida = contaParaBaixar(legada, nova);
  let conta: K;
  let qual: 'legada' | 'nova' | 'criada';
  if (escolhida) {
    conta = escolhida.conta;
    qual = escolhida.qual;
  } else {
    conta = contaDeReserva();
    qual = 'criada';
    await portas.criarConta(conta);
  }
  const baixa = baixaDaConta(conta, hoje);
  if (baixa) await portas.atualizarConta(baixa);
  return { conta: conta.id, qual, baixou: !!baixa };
}

/**
 * Cancelar passa pelo gancho, que cancela a conta da comissão ainda não paga
 * (inclusive a antiga). Conferir a antiga aqui é a segunda barreira.
 */
export async function cancelarComissao<C extends ComissaoDaTela, K extends ContaDaTela>(
  c: C,
  portas: PortasDaComissao<C, K>,
): Promise<void> {
  await portas.gravarComissao({ ...c, status: 'CANCELADA' });
  const legada = await portas.lerConta(idDaContaLegada(c.id));
  if (legada && contaViva(legada) && !contaBaixada(legada)) {
    await portas.atualizarConta({ ...legada, status: 'CANCELADO' });
  }
}
