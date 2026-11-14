/**
 * CARTEIRA DE CRÉDITO DO CLIENTE (E5, parte D, 05/11/2026). Arquivo puro.
 *
 * O crédito é dinheiro do cliente que ficou com a agência: a sobra de um
 * cancelamento, um pagamento a mais, um reembolso que o cliente preferiu
 * deixar para a próxima viagem. Cada crédito tem saldo, validade e origem; o
 * uso é parcial (uma venda futura paga com "Crédito do cliente", ou uma conta
 * a receber liquidada com ele) e sai sempre do que vence primeiro.
 *
 * Tudo em centavos. O extrato é a lista de movimentos (imutável no banco):
 * entrada, uso, devolução de um uso, vencimento e ajuste.
 */
import { addDias, addMeses } from './money';

export type Centavos = number;

export const ORIGENS_DO_CREDITO = ['CANCELAMENTO', 'SOBRA_DE_PAGAMENTO', 'REEMBOLSO_CONVERTIDO', 'AJUSTE'] as const;
export type OrigemDoCredito = (typeof ORIGENS_DO_CREDITO)[number];

export const ROTULO_ORIGEM_DO_CREDITO: Record<OrigemDoCredito, string> = {
  CANCELAMENTO: 'Cancelamento',
  SOBRA_DE_PAGAMENTO: 'Pagamento a mais',
  REEMBOLSO_CONVERTIDO: 'Reembolso virou crédito',
  AJUSTE: 'Lançado à mão',
};

export type SituacaoDoCredito = 'ATIVO' | 'USADO' | 'VENCIDO' | 'CANCELADO';

export const ROTULO_SITUACAO_DO_CREDITO: Record<SituacaoDoCredito, string> = {
  ATIVO: 'Com saldo',
  USADO: 'Usado',
  VENCIDO: 'Vencido',
  CANCELADO: 'Cancelado',
};

export type TipoDeMovimento = 'ENTRADA' | 'USO' | 'DEVOLUCAO' | 'VENCIMENTO' | 'AJUSTE';

export const ROTULO_MOVIMENTO: Record<TipoDeMovimento, string> = {
  ENTRADA: 'Entrada',
  USO: 'Uso',
  DEVOLUCAO: 'Devolvido à carteira',
  VENCIMENTO: 'Venceu',
  AJUSTE: 'Ajuste',
};

/** Validade padrão do crédito: um ano. Dá para mudar crédito a crédito. */
export const MESES_DE_VALIDADE_PADRAO = 12;
/** Quantos dias antes de vencer o sino avisa (uma vez por crédito). */
export const DIAS_DE_AVISO_ANTES_DE_VENCER = 30;
/** Devolução de uso num crédito já vencido: ele ganha este prazo para o cliente usar. */
export const DIAS_DE_FOLGA_NA_DEVOLUCAO = 30;

export interface Credito {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  origem: OrigemDoCredito;
  /** Venda de onde o crédito saiu (cancelamento, sobra). */
  origem_venda_id: string;
  origem_venda_numero: string;
  valor_centavos: Centavos;
  saldo_centavos: Centavos;
  /** AAAA-MM-DD; vazio = sem validade. Vale até o fim deste dia. */
  validade: string;
  situacao: SituacaoDoCredito;
  descricao: string;
  criado_em: string;
}

export interface MovimentoDoCredito {
  id: string;
  credito_id: string;
  tipo: TipoDeMovimento;
  /** + entra no saldo, − sai. */
  valor_centavos: Centavos;
  saldo_depois_centavos: Centavos;
  ref_tipo: string;
  ref_id: string;
  ref_chave: string;
  venda_id: string;
  descricao: string;
  usuario: string;
  criado_em: string;
}

export function validadePadrao(data: string, meses = MESES_DE_VALIDADE_PADRAO): string {
  return addMeses(data, meses);
}

/** O crédito vale no dia `data`? */
export function creditoValeEm(c: Pick<Credito, 'validade' | 'situacao' | 'saldo_centavos'>, data: string): boolean {
  if (c.situacao === 'CANCELADO' || c.situacao === 'VENCIDO') return false;
  if (c.saldo_centavos <= 0) return false;
  return !c.validade || c.validade >= data;
}

/** Situação calculada (o banco guarda a última gravada; esta é a de hoje). */
export function situacaoEm(c: Pick<Credito, 'validade' | 'situacao' | 'saldo_centavos'>, hoje: string): SituacaoDoCredito {
  if (c.situacao === 'CANCELADO') return 'CANCELADO';
  if (c.saldo_centavos <= 0) return c.situacao === 'VENCIDO' ? 'VENCIDO' : 'USADO';
  if (c.validade && c.validade < hoje) return 'VENCIDO';
  return 'ATIVO';
}

export interface SaldoDoCliente {
  /** Usável hoje. */
  disponivel: Centavos;
  /** Usável que vence nos próximos dias de aviso. */
  vencendo: Centavos;
  proxima_validade: string;
  creditos_ativos: number;
}

export function saldoDoCliente(creditos: Credito[], hoje: string, diasDeAviso = DIAS_DE_AVISO_ANTES_DE_VENCER): SaldoDoCliente {
  const limite = addDias(hoje, diasDeAviso);
  const ativos = creditos.filter(c => creditoValeEm(c, hoje));
  const datas = ativos.map(c => c.validade).filter(Boolean).sort();
  return {
    disponivel: ativos.reduce((a, c) => a + c.saldo_centavos, 0),
    vencendo: ativos.filter(c => c.validade && c.validade <= limite).reduce((a, c) => a + c.saldo_centavos, 0),
    proxima_validade: datas[0] ?? '',
    creditos_ativos: ativos.length,
  };
}

export interface ParteDoUso { credito_id: string; valor_centavos: Centavos }

/**
 * De quais créditos sai um uso de `valor`: primeiro os da venda indicada
 * (quando a pessoa disse de onde vem o crédito), depois o que vence antes, e
 * por último os sem validade. Devolve as partes e quanto faltou.
 */
export function planoDeUso(
  creditos: Credito[], valor: Centavos, data: string, opcoes: { preferirVenda?: string } = {},
): { partes: ParteDoUso[]; usado: Centavos; falta: Centavos } {
  const pref = (opcoes.preferirVenda ?? '').trim().toLowerCase();
  const usaveis = creditos.filter(c => creditoValeEm(c, data)).sort((a, b) => {
    const pa = pref && (a.origem_venda_id.toLowerCase() === pref || a.origem_venda_numero.toLowerCase() === pref) ? 0 : 1;
    const pb = pref && (b.origem_venda_id.toLowerCase() === pref || b.origem_venda_numero.toLowerCase() === pref) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const va = a.validade || '9999-12-31';
    const vb = b.validade || '9999-12-31';
    if (va !== vb) return va < vb ? -1 : 1;
    return a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : a.id.localeCompare(b.id);
  });
  const partes: ParteDoUso[] = [];
  let resta = Math.max(0, Math.round(valor));
  for (const c of usaveis) {
    if (resta <= 0) break;
    const tira = Math.min(c.saldo_centavos, resta);
    if (tira <= 0) continue;
    partes.push({ credito_id: c.id, valor_centavos: tira });
    resta -= tira;
  }
  const usado = partes.reduce((a, p) => a + p.valor_centavos, 0);
  return { partes, usado, falta: Math.max(0, Math.round(valor) - usado) };
}

/**
 * Devolver um uso (a venda tirou o pagamento com crédito, a baixa foi
 * estornada): volta para os MESMOS créditos, do último uso para o primeiro.
 * `usos` são os movimentos líquidos daquele uso por crédito (positivo = ainda
 * fora da carteira).
 */
export function planoDeDevolucao(usos: Array<{ credito_id: string; usado_centavos: Centavos; ordem: string }>, valor: Centavos): ParteDoUso[] {
  const partes: ParteDoUso[] = [];
  let resta = Math.max(0, Math.round(valor));
  for (const u of [...usos].sort((a, b) => (a.ordem < b.ordem ? 1 : a.ordem > b.ordem ? -1 : 0))) {
    if (resta <= 0) break;
    const volta = Math.min(u.usado_centavos, resta);
    if (volta <= 0) continue;
    partes.push({ credito_id: u.credito_id, valor_centavos: volta });
    resta -= volta;
  }
  return partes;
}

/** Créditos que ainda não foram avisados e vencem até `hoje + dias`. */
export function creditosParaAvisar(
  creditos: Array<Credito & { avisado_em?: string | null }>, hoje: string, dias = DIAS_DE_AVISO_ANTES_DE_VENCER,
): Credito[] {
  const limite = addDias(hoje, dias);
  return creditos.filter(c => !c.avisado_em && creditoValeEm(c, hoje) && c.validade && c.validade <= limite);
}

/** Créditos com saldo e validade já passada: vencem hoje. */
export function creditosParaVencer(creditos: Credito[], hoje: string): Credito[] {
  return creditos.filter(c => c.situacao === 'ATIVO' && c.saldo_centavos > 0 && c.validade && c.validade < hoje);
}

export interface LinhaDoExtrato extends MovimentoDoCredito {
  /** Saldo da carteira inteira do cliente depois deste movimento. */
  saldo_carteira_centavos: Centavos;
}

/** Extrato do cliente: todos os movimentos em ordem, com o saldo da carteira acumulado. */
export function extratoDoCliente(movimentos: MovimentoDoCredito[]): LinhaDoExtrato[] {
  const ordem = [...movimentos].sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : a.id.localeCompare(b.id)));
  let saldo = 0;
  return ordem.map(m => {
    saldo += m.valor_centavos;
    return { ...m, saldo_carteira_centavos: saldo };
  });
}

/** Texto curto para a validade ("vence em 12/03/2027", "sem validade", "venceu em ..."). */
export function fraseDaValidade(validade: string, hoje: string): string {
  if (!validade) return 'sem validade';
  const br = `${validade.slice(8, 10)}/${validade.slice(5, 7)}/${validade.slice(0, 4)}`;
  return validade < hoje ? `venceu em ${br}` : `vale até ${br}`;
}
