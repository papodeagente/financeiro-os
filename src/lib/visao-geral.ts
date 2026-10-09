/**
 * Visão geral do Financeiro (protótipo aprovado pelo Bruno em 08/10/2026).
 *
 * Responde, nesta ordem: quanto tem em caixa hoje, quanto entra e sai, o que
 * vence nos próximos 30 dias, o que precisa de uma pessoa, e como vai o mês.
 *
 * Mesmas regras do resto do financeiro, para os números baterem entre telas:
 *   - caixa de hoje = calcularSaldoBancario (entrada já sem a taxa da plataforma);
 *   - status é enum exato; receber usa ATRASADO, pagar usa VENCIDO;
 *   - "em aberto" é valor_final menos o que já se moveu (baixa parcial conta);
 *   - o caixa previsto é SOMA do que está lançado, não previsão estatística.
 *
 * Datas civis 'YYYY-MM-DD'. Nunca new Date('YYYY-MM-DD'). Módulo puro.
 */
import type { ContaBancaria, ContaPagar, ContaReceber } from './crm-types';
import { addDias, dataLocal, num, round2, somaPor, ultimoDiaDoMes } from './money';
import { calcularSaldoBancario, entradaLiquidaNoBanco, valorMovimentado } from './saldo-bancario';
import { descricaoSemPlataforma, nomeDaPlataforma, plataformaDaConta } from './plataformas/rotulo';

export const JANELA_AGENDA_DIAS = 30;

const EM_ABERTO_RECEBER = new Set(['PENDENTE', 'PARCIAL', 'ATRASADO']);
const EM_ABERTO_PAGAR = new Set(['PENDENTE', 'PARCIAL', 'VENCIDO']);
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function emAbertoReceber(c: ContaReceber): number {
  if (!EM_ABERTO_RECEBER.has(String(c.status ?? ''))) return 0;
  return Math.max(0, round2(num(c.valor_final) - valorMovimentado(c, 'valor_recebido')));
}

export function emAbertoPagar(c: ContaPagar): number {
  if (!EM_ABERTO_PAGAR.has(String(c.status ?? ''))) return 0;
  return Math.max(0, round2(num(c.valor_final) - valorMovimentado(c, 'valor_pago')));
}

/** "dd/mm". */
export function diaMes(iso: string): string {
  const [, m, d] = String(iso).slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : '';
}

/** "Quinta-feira, 8 de outubro". */
export function hojePorExtenso(hoje: string): string {
  const d = dataLocal(hoje);
  if (!d) return '';
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

export function diasEntre(de: string, ate: string): number {
  const a = dataLocal(de), b = dataLocal(ate);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ─── Posição de hoje ────────────────────────────────────────────────────────

export interface PosicaoDeHoje {
  emCaixa: number;
  aReceber: { total: number; vencido: number; parcelas: number };
  aPagar: { total: number; vencido: number; contas: number; proximoVencimento: string };
  previsto: { data: string; valor: number; variacao: number };
}

export function posicaoDeHoje(entrada: {
  contasBancarias: readonly ContaBancaria[];
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  hoje: string;
}): PosicaoDeHoje {
  const { receber, pagar, hoje } = entrada;
  const emCaixa = calcularSaldoBancario([...entrada.contasBancarias], [...receber], [...pagar]);
  const abertasR = receber.filter(c => emAbertoReceber(c) > 0);
  const abertasP = pagar.filter(c => emAbertoPagar(c) > 0);
  const vencida = (venc: string | null | undefined) => Boolean(venc) && String(venc) < hoje;
  const limite = addDias(hoje, JANELA_AGENDA_DIAS);
  // Vencido entra na janela: é o que se espera resolver agora.
  const ate = (venc: string | null | undefined) => !venc || String(venc) <= limite;
  const entra = somaPor(abertasR.filter(c => ate(c.data_vencimento)), emAbertoReceber);
  const sai = somaPor(abertasP.filter(c => ate(c.data_vencimento)), emAbertoPagar);
  const proximas = abertasP.map(c => String(c.data_vencimento ?? '')).filter(d => d >= hoje).sort();
  return {
    emCaixa,
    aReceber: {
      total: somaPor(abertasR, emAbertoReceber),
      vencido: somaPor(abertasR.filter(c => vencida(c.data_vencimento)), emAbertoReceber),
      parcelas: abertasR.length,
    },
    aPagar: {
      total: somaPor(abertasP, emAbertoPagar),
      vencido: somaPor(abertasP.filter(c => vencida(c.data_vencimento)), emAbertoPagar),
      contas: abertasP.length,
      proximoVencimento: proximas[0] ?? '',
    },
    previsto: { data: limite, valor: round2(emCaixa + entra - sai), variacao: round2(entra - sai) },
  };
}

// ─── Agenda dos próximos 30 dias ───────────────────────────────────────────

export type GrupoDaAgenda = 'vencido' | 'semana' | 'proxima' | 'depois';

export interface LinhaDaAgenda {
  id: string;
  lado: 'receber' | 'pagar';
  grupo: GrupoDaAgenda;
  vencimento: string;
  /** "hoje", "seg", "qui". */
  diaDaSemana: string;
  quem: string;
  /** "Parcela 2 de 3 · Pacote Gramado". */
  detalhe: string;
  /** "Do CRM", "via Hotmart" ou vazio. */
  origem: string;
  valor: number;
  /** "vencida há 10 dias" (só receber vencido). */
  atraso: string;
  /** Conta a pagar sem fornecedor: dizer antes de pagar. */
  semFornecedor: boolean;
  /** O que o botão faz: "Cobrar", "Receber" ou "Pagar". */
  acao: 'Cobrar' | 'Receber' | 'Pagar';
}

export interface Agenda {
  ate: string;
  linhas: LinhaDaAgenda[];
  entradas: number;
  saidas: number;
  quantidade: { todas: number; receber: number; pagar: number };
}

/** Domingo da semana de hoje (semana de segunda a domingo). */
function domingoDaSemana(hoje: string): string {
  const d = dataLocal(hoje)!;
  const ate = (7 - d.getDay()) % 7;
  return addDias(hoje, ate);
}

export function grupoDoVencimento(venc: string, hoje: string): GrupoDaAgenda {
  if (venc < hoje) return 'vencido';
  const fimSemana = domingoDaSemana(hoje);
  if (venc <= fimSemana) return 'semana';
  if (venc <= addDias(fimSemana, 7)) return 'proxima';
  return 'depois';
}

const ORDEM_GRUPO: Record<GrupoDaAgenda, number> = { vencido: 0, semana: 1, proxima: 2, depois: 3 };

function origemDaConta(c: { venda_id?: string | null; auto_gerado?: boolean; plataforma_origem?: string }): string {
  const plat = plataformaDaConta(c);
  if (plat) return `via ${nomeDaPlataforma(plat)}`;
  if (c.venda_id || c.auto_gerado) return 'Do CRM';
  return '';
}

function detalheDaParcela(numero: unknown, total: unknown, descricao: string): string {
  const n = Math.trunc(num(numero)), t = Math.trunc(num(total));
  const parcela = t > 1 && n >= 1 ? `Parcela ${n} de ${t}` : '';
  return [parcela, descricao.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim()].filter(Boolean).join(' · ');
}

export function agendaDosProximosDias(entrada: {
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  hoje: string;
}): Agenda {
  const { hoje } = entrada;
  const ate = addDias(hoje, JANELA_AGENDA_DIAS);
  const linhas: LinhaDaAgenda[] = [];
  const diaDaSemana = (venc: string) => (venc === hoje ? 'hoje' : DIAS_CURTOS[dataLocal(venc)?.getDay() ?? 0]);

  for (const c of entrada.receber) {
    const valor = emAbertoReceber(c);
    const venc = String(c.data_vencimento ?? '');
    if (valor <= 0 || !venc || venc > ate) continue;
    const grupo = grupoDoVencimento(venc, hoje);
    const dias = grupo === 'vencido' ? diasEntre(venc, hoje) : 0;
    linhas.push({
      id: c.id, lado: 'receber', grupo, vencimento: venc, diaDaSemana: diaDaSemana(venc),
      quem: c.cliente_nome || 'Cliente não informado',
      detalhe: detalheDaParcela(c.parcela_numero, c.total_parcelas, descricaoSemPlataforma(c.descricao || '', plataformaDaConta(c))),
      origem: origemDaConta(c), valor,
      atraso: grupo === 'vencido' ? `vencida há ${dias} ${dias === 1 ? 'dia' : 'dias'}` : '',
      semFornecedor: false,
      acao: grupo === 'vencido' ? 'Cobrar' : 'Receber',
    });
  }
  for (const c of entrada.pagar) {
    const valor = emAbertoPagar(c);
    const venc = String(c.data_vencimento ?? '');
    if (valor <= 0 || !venc || venc > ate) continue;
    const grupo = grupoDoVencimento(venc, hoje);
    const semFornecedor = c.fornecedor_pendente === true || !String(c.fornecedor_nome ?? '').trim();
    linhas.push({
      id: c.id, lado: 'pagar', grupo, vencimento: venc, diaDaSemana: diaDaSemana(venc),
      quem: semFornecedor ? 'Fornecedor não informado' : c.fornecedor_nome,
      detalhe: detalheDaParcela(c.parcela_numero, c.total_parcelas, String(c.descricao ?? '')),
      origem: origemDaConta(c), valor, atraso: '', semFornecedor, acao: 'Pagar',
    });
  }
  // O que venceu e não se moveu vem primeiro; dentro do grupo, por data,
  // entradas antes das saídas no mesmo dia.
  linhas.sort((a, b) => ORDEM_GRUPO[a.grupo] - ORDEM_GRUPO[b.grupo]
    || a.vencimento.localeCompare(b.vencimento)
    || (a.lado === b.lado ? 0 : a.lado === 'receber' ? -1 : 1)
    || a.quem.localeCompare(b.quem, 'pt-BR'));

  const receber = linhas.filter(l => l.lado === 'receber');
  const pagar = linhas.filter(l => l.lado === 'pagar');
  return {
    ate,
    linhas,
    entradas: somaPor(receber, l => l.valor),
    saidas: somaPor(pagar, l => l.valor),
    quantidade: { todas: linhas.length, receber: receber.length, pagar: pagar.length },
  };
}

/** Rótulo do grupo: "Vencidos", "Esta semana", "Próxima semana", "Até 07/11". */
export function rotuloDoGrupo(g: GrupoDaAgenda, ate: string): string {
  return g === 'vencido' ? 'Vencidos' : g === 'semana' ? 'Esta semana' : g === 'proxima' ? 'Próxima semana' : `Até ${diaMes(ate)}`;
}

// ─── Precisa de você ───────────────────────────────────────────────────────

export interface Pendencia {
  chave: 'receber-vencido' | 'pagar-vencido' | 'extrato' | 'sem-fornecedor' | 'plataformas';
  titulo: string;
  detalhe: string;
  acao: string;
  href: string;
  tom: 'negativo' | 'aviso' | 'info';
}

export function pendencias(entrada: {
  receber: readonly ContaReceber[];
  pagar: readonly ContaPagar[];
  extratoPendente: ReadonlyArray<{ conta_bancaria_id?: string; data?: string }>;
  nomesDasContas: Record<string, string>;
  plataformasParaConferir: number;
  hoje: string;
  formatar: (v: number) => string;
}): Pendencia[] {
  const { hoje, formatar } = entrada;
  const saida: Pendencia[] = [];
  const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

  const rVencidas = entrada.receber.filter(c => emAbertoReceber(c) > 0 && c.data_vencimento && c.data_vencimento < hoje);
  if (rVencidas.length > 0) {
    const maisAntiga = rVencidas.map(c => String(c.data_vencimento)).sort()[0];
    const dias = diasEntre(maisAntiga, hoje);
    saida.push({
      chave: 'receber-vencido', tom: 'negativo', acao: 'Cobrar', href: '/financeiro-ag/receber?status=ATRASADO',
      titulo: `${plural(rVencidas.length, 'parcela', 'parcelas')} de clientes ${rVencidas.length === 1 ? 'vencida' : 'vencidas'}`,
      detalhe: `${formatar(somaPor(rVencidas, emAbertoReceber))} · ${rVencidas.length === 1 ? 'vencida' : 'a mais antiga'} há ${plural(dias, 'dia', 'dias')}`,
    });
  }

  const pVencidas = entrada.pagar.filter(c => emAbertoPagar(c) > 0 && c.data_vencimento && c.data_vencimento < hoje);
  if (pVencidas.length > 0) {
    saida.push({
      chave: 'pagar-vencido', tom: 'negativo', acao: 'Pagar', href: '/financeiro-ag/pagar?status=VENCIDO',
      titulo: `${plural(pVencidas.length, 'conta a pagar vencida', 'contas a pagar vencidas')}`,
      detalhe: `${formatar(somaPor(pVencidas, emAbertoPagar))} em aberto`,
    });
  }

  if (entrada.extratoPendente.length > 0) {
    const bancos = [...new Set(entrada.extratoPendente.map(l => entrada.nomesDasContas[String(l.conta_bancaria_id ?? '')] ?? '').filter(Boolean))];
    const desde = entrada.extratoPendente.map(l => String(l.data ?? '')).filter(Boolean).sort()[0] ?? '';
    const nomes = bancos.length === 0 ? '' : bancos.length === 1 ? bancos[0] : `${bancos.slice(0, -1).join(', ')} e ${bancos[bancos.length - 1]}`;
    saida.push({
      chave: 'extrato', tom: 'info', acao: 'Conciliar', href: '/financeiro-ag/conciliacao',
      titulo: `${plural(entrada.extratoPendente.length, 'movimento do extrato', 'movimentos do extrato')} sem conciliar`,
      detalhe: [nomes, desde ? `desde ${diaMes(desde)}` : ''].filter(Boolean).join(', '),
    });
  }

  const semFornecedor = entrada.pagar.filter(c => emAbertoPagar(c) > 0 && c.fornecedor_pendente === true);
  if (semFornecedor.length > 0) {
    const proxima = semFornecedor.map(c => String(c.data_vencimento ?? '')).filter(Boolean).sort()[0] ?? '';
    saida.push({
      chave: 'sem-fornecedor', tom: 'aviso', acao: 'Informar', href: '/financeiro-ag/pagar?sem_fornecedor=1',
      titulo: `${plural(semFornecedor.length, 'custo de venda', 'custos de venda')} sem fornecedor`,
      detalhe: [formatar(somaPor(semFornecedor, emAbertoPagar)), proxima ? `vence em ${diaMes(proxima)}` : ''].filter(Boolean).join(' · '),
    });
  }

  if (entrada.plataformasParaConferir > 0) {
    saida.push({
      chave: 'plataformas', tom: 'info', acao: 'Conferir', href: '/financeiro-ag/recebimentos?status=SUGERIDA',
      titulo: `${plural(entrada.plataformasParaConferir, 'pagamento de plataforma', 'pagamentos de plataformas')} sem venda ligada`,
      detalhe: 'Parecidos com vendas do CRM: confirme o vínculo',
    });
  }
  return saida;
}

// ─── O mês até hoje ────────────────────────────────────────────────────────

export interface MesAteHoje {
  entrou: number;
  saiu: number;
  resultado: number;
  /** Mesmos dias do mês anterior (1 a N). */
  anterior: { de: string; ate: string; resultado: number };
  nomeDoMes: string;
  nomeDoMesAnterior: string;
}

function movimentoNoPeriodo(
  receber: readonly ContaReceber[], pagar: readonly ContaPagar[], de: string, ate: string,
): { entrou: number; saiu: number } {
  const dentro = (d: string | null | undefined) => Boolean(d) && String(d) >= de && String(d) <= ate;
  return {
    entrou: somaPor(receber.filter(c => dentro(c.data_recebimento)), entradaLiquidaNoBanco),
    saiu: somaPor(pagar.filter(c => dentro(c.data_pagamento)), c => valorMovimentado(c, 'valor_pago')),
  };
}

/**
 * Pela data da BAIXA: o que de fato entrou e saiu do caixa no mês, até hoje.
 * A comparação é com os mesmos dias do mês anterior, não com o mês inteiro:
 * comparar 8 dias com 30 faria todo começo de mês parecer um desastre.
 */
export function mesAteHoje(receber: readonly ContaReceber[], pagar: readonly ContaPagar[], hoje: string): MesAteHoje {
  const [a, m, d] = hoje.split('-').map(Number);
  const inicio = `${hoje.slice(0, 7)}-01`;
  const atual = movimentoNoPeriodo(receber, pagar, inicio, hoje);
  const aAnt = m === 1 ? a - 1 : a;
  const mAnt = m === 1 ? 12 : m - 1;
  const ymAnt = `${aAnt}-${String(mAnt).padStart(2, '0')}`;
  const diaAnt = Math.min(d, ultimoDiaDoMes(aAnt, mAnt));
  const deAnt = `${ymAnt}-01`;
  const ateAnt = `${ymAnt}-${String(diaAnt).padStart(2, '0')}`;
  const ant = movimentoNoPeriodo(receber, pagar, deAnt, ateAnt);
  return {
    entrou: atual.entrou,
    saiu: atual.saiu,
    resultado: round2(atual.entrou - atual.saiu),
    anterior: { de: deAnt, ate: ateAnt, resultado: round2(ant.entrou - ant.saiu) },
    nomeDoMes: MESES[m - 1],
    nomeDoMesAnterior: MESES[mAnt - 1],
  };
}
