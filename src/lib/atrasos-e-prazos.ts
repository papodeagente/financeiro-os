/**
 * Atrasos, prazos e projeção do Financeiro (05/11/2026).
 *
 * Os números que quem vem do sistema anterior procura na entrada: a pagar e a
 * receber de HOJE e EM ATRASO e o saldo de cada conta. Por cima disso, o que
 * ajuda a decidir: faixas de atraso, prazo médio de recebimento (PMR) e de
 * pagamento (PMP) e o caixa projetado em 30, 60 e 90 dias.
 *
 * Mesmas regras de visao-geral.ts, para os números baterem entre as telas:
 *   - "em aberto" = emAbertoReceber / emAbertoPagar (status enum exato);
 *   - saldo = o do "Em caixa hoje" (entrada já sem a taxa da plataforma);
 *   - o projetado em 30 dias é o mesmo "Caixa previsto" da posição de hoje.
 *
 * Datas civis 'YYYY-MM-DD'. Módulo puro: sem banco, sem React.
 */
import type { ContaBancaria, ContaPagar, ContaReceber } from './crm-types';
import { addDias, num, round2, somaPor } from './money';
import { calcularSaldoBancario, entradaLiquidaNoBanco, valorMovimentado } from './saldo-bancario';
import { diasEntre, emAbertoPagar, emAbertoReceber } from './visao-geral';

export const CAIXA_GERAL = 'Caixa Geral';
/** Janela das baixas usadas no PMR/PMP. */
export const JANELA_PRAZO_MEDIO_DIAS = 90;
export const HORIZONTES_PROJECAO = [30, 60, 90] as const;

export type FaixaDoResumo = 'A_VENCER' | 'ATE_30' | 'ATE_60' | 'ATE_90' | 'ACIMA_90';

/** Faixas do Atrasos, prazos e projeção. Diferentes de FAIXAS_ATRASO (resultado-financeiro), que seguem valendo lá. */
export const FAIXAS_DO_RESUMO: ReadonlyArray<{ id: FaixaDoResumo; rotulo: string }> = [
  { id: 'A_VENCER', rotulo: 'A vencer' },
  { id: 'ATE_30', rotulo: '1 a 30 dias' },
  { id: 'ATE_60', rotulo: '31 a 60 dias' },
  { id: 'ATE_90', rotulo: '61 a 90 dias' },
  { id: 'ACIMA_90', rotulo: 'Mais de 90 dias' },
];

export interface Contagem { valor: number; quantidade: number }

export interface LadoDoResumo {
  hoje: Contagem;
  emAtraso: Contagem;
  emAberto: Contagem;
  faixas: Array<{ id: FaixaDoResumo; rotulo: string } & Contagem>;
}

export interface SaldoDaConta { id: string; nome: string; saldo: number }

export interface PrazoMedio {
  /** Dias, com uma casa. null quando não há baixa na janela. */
  dias: number | null;
  /** Quantas baixas entraram na média. */
  baixas: number;
  /** Quanto dinheiro elas somam (o peso da média). */
  valor: number;
}

export interface AtrasosEPrazos {
  receber: LadoDoResumo;
  pagar: LadoDoResumo;
  contas: SaldoDaConta[];
  /** Baixa sem conta (ou com conta que não existe mais) e sem Caixa Geral para cair. */
  semConta: number;
  saldoTotal: number;
  pmr: PrazoMedio;
  pmp: PrazoMedio;
  projetado: Array<{ dias: number; data: string; valor: number; entra: number; sai: number }>;
}

/** Transferência mínima para o saldo por conta. Só EFETIVADA move dinheiro. */
export interface TransferenciaDoResumo {
  conta_origem_id?: string | null;
  conta_destino_id?: string | null;
  valor?: number | string | null;
  status?: string | null;
}

/** Faixa de um vencimento. Vence hoje ou sem vencimento = a vencer. */
export function faixaDoResumo(vencimento: string | null | undefined, hoje: string): FaixaDoResumo {
  if (!vencimento) return 'A_VENCER';
  const atraso = diasEntre(String(vencimento).slice(0, 10), hoje);
  if (atraso <= 0) return 'A_VENCER';
  if (atraso <= 30) return 'ATE_30';
  if (atraso <= 60) return 'ATE_60';
  if (atraso <= 90) return 'ATE_90';
  return 'ACIMA_90';
}

function contar<T>(itens: readonly T[], valor: (t: T) => number): Contagem {
  return { valor: somaPor(itens, valor), quantidade: itens.length };
}

function lado<T extends { data_vencimento?: string | null }>(abertas: readonly T[], aberto: (t: T) => number, hoje: string): LadoDoResumo {
  const venc = (t: T) => String(t.data_vencimento ?? '').slice(0, 10);
  return {
    hoje: contar(abertas.filter(t => venc(t) === hoje), aberto),
    emAtraso: contar(abertas.filter(t => Boolean(venc(t)) && venc(t) < hoje), aberto),
    emAberto: contar(abertas, aberto),
    faixas: FAIXAS_DO_RESUMO.map(f => ({
      ...f,
      ...contar(abertas.filter(t => faixaDoResumo(venc(t), hoje) === f.id), aberto),
    })),
  };
}

/**
 * Prazo médio, ponderado pelo valor baixado: dias entre a emissão (ou o
 * vencimento, quando a conta não tem emissão) e a data da baixa, só das
 * baixas dos últimos 90 dias. Baixa antes da emissão conta zero dias. Sem
 * baixa na janela devolve null: "0 dias" diria que todo mundo paga na hora.
 * Baixa parcial entra pelo acumulado na data da última baixa (é o que o
 * título guarda).
 */
export function prazoMedio<T extends { data_emissao?: string | null; data_vencimento?: string | null }>(
  contas: readonly T[],
  dataDaBaixa: (t: T) => string | null | undefined,
  valorBaixado: (t: T) => number,
  hoje: string,
): PrazoMedio {
  const desde = addDias(hoje, -JANELA_PRAZO_MEDIO_DIAS);
  let peso = 0;
  let soma = 0;
  let baixas = 0;
  for (const c of contas) {
    const valor = valorBaixado(c);
    const baixa = String(dataDaBaixa(c) ?? '').slice(0, 10);
    const base = String(c.data_emissao || c.data_vencimento || '').slice(0, 10);
    if (valor <= 0 || !baixa || !base || baixa < desde || baixa > hoje) continue;
    soma += Math.max(0, diasEntre(base, baixa)) * valor;
    peso += valor;
    baixas += 1;
  }
  return {
    dias: peso > 0 ? Math.round((soma / peso) * 10) / 10 : null,
    baixas,
    valor: round2(peso),
  };
}

/**
 * Saldo de cada conta pela regra do "Em caixa hoje": saldo inicial + entradas
 * líquidas − saídas. Baixa sem conta cai na Caixa Geral, se existir; senão
 * fica em `semConta`, para a soma continuar igual a calcularSaldoBancario.
 * Transferência efetivada só move entre duas contas conhecidas (assim o total
 * não muda; a que aponta para conta apagada fica de fora).
 */
export function saldosPorConta(entrada: {
  contasBancarias: readonly ContaBancaria[];
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  transferencias?: readonly TransferenciaDoResumo[];
}): { contas: SaldoDaConta[]; semConta: number } {
  const saldos = new Map<string, number>();
  for (const c of entrada.contasBancarias) saldos.set(c.id, round2(num(c.saldo_inicial)));
  const caixaGeral = entrada.contasBancarias.find(c => String(c.nome ?? '') === CAIXA_GERAL)?.id ?? null;
  let semConta = 0;
  const mover = (contaId: string | null | undefined, delta: number) => {
    if (!delta) return;
    const id = contaId && saldos.has(contaId) ? contaId : (!contaId && caixaGeral ? caixaGeral : null);
    if (id) saldos.set(id, round2((saldos.get(id) ?? 0) + delta));
    else semConta = round2(semConta + delta);
  };
  for (const r of entrada.receber) mover(r.conta_bancaria_id, entradaLiquidaNoBanco(r));
  for (const p of entrada.pagar) mover(p.conta_bancaria_id, -valorMovimentado(p, 'valor_pago'));
  for (const t of entrada.transferencias ?? []) {
    const valor = round2(num(t.valor));
    const o = String(t.conta_origem_id ?? '');
    const d = String(t.conta_destino_id ?? '');
    if (String(t.status ?? '') !== 'EFETIVADA' || valor <= 0 || !saldos.has(o) || !saldos.has(d) || o === d) continue;
    saldos.set(o, round2((saldos.get(o) ?? 0) - valor));
    saldos.set(d, round2((saldos.get(d) ?? 0) + valor));
  }
  return {
    contas: entrada.contasBancarias.map(c => ({ id: c.id, nome: String(c.nome ?? ''), saldo: saldos.get(c.id) ?? 0 })),
    semConta,
  };
}

export function atrasosEPrazos(entrada: {
  contasBancarias: readonly ContaBancaria[];
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  transferencias?: readonly TransferenciaDoResumo[];
  hoje: string;
}): AtrasosEPrazos {
  const { receber, pagar, hoje } = entrada;
  const abertasR = receber.filter(c => emAbertoReceber(c) > 0);
  const abertasP = pagar.filter(c => emAbertoPagar(c) > 0);
  const { contas, semConta } = saldosPorConta(entrada);
  // O total é o mesmo número do "Em caixa hoje".
  const saldoTotal = calcularSaldoBancario([...entrada.contasBancarias], [...receber], [...pagar]);

  // Vencido conta como hoje; sem vencimento também (mesma regra da posição de hoje).
  const projetado = HORIZONTES_PROJECAO.map(dias => {
    const limite = addDias(hoje, dias);
    const ate = (venc: string | null | undefined) => !venc || String(venc) <= limite;
    const entra = somaPor(abertasR.filter(c => ate(c.data_vencimento)), emAbertoReceber);
    const sai = somaPor(abertasP.filter(c => ate(c.data_vencimento)), emAbertoPagar);
    return { dias, data: limite, entra, sai, valor: round2(saldoTotal + entra - sai) };
  });

  return {
    receber: lado(abertasR, emAbertoReceber, hoje),
    pagar: lado(abertasP, emAbertoPagar, hoje),
    contas,
    semConta,
    saldoTotal,
    pmr: prazoMedio(receber, c => c.data_recebimento, c => valorMovimentado(c, 'valor_recebido'), hoje),
    pmp: prazoMedio(pagar, c => c.data_pagamento, c => valorMovimentado(c, 'valor_pago'), hoje),
    projetado,
  };
}
