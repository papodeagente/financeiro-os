/**
 * POSIÇÃO DA VENDA (E5, parte A): quanto o cliente já pagou, quanto falta,
 * quanto a agência deve e já pagou a cada fornecedor, a receita aberta por
 * componente e os alertas, a começar por "pagar o fornecedor antes de o
 * cliente pagar".
 *
 * Lê as contas de verdade (com baixa parcial, estorno, cobrança emitida),
 * não o que a venda previa. Arquivo puro; valores em centavos de real.
 */
import { paraCentavos, num } from './money';
import { FORMAS, totaisDaVenda, type Centavos, type Venda } from './venda-modelo';
import { receitaDaVenda, CONFIG_RECEITA_PADRAO, type ConfigReceita, type ReceitaDaVenda } from './venda-receita';

export type SituacaoDoLado = 'PAGO' | 'PARCIAL' | 'PENDENTE' | 'SEM_VALOR';

/** Cobrança (E3) ligada a uma conta a receber da venda. */
export interface CobrancaDaPosicao {
  titulo_id: string;
  status: string;
  valor_centavos: Centavos;
  vencimento: string | null;
}

export interface PendenciaDaPosicao {
  tipo: string;
  valor_centavos: Centavos;
  /** 'ABERTA' até a outra parte resolver. */
  situacao: string;
}

export interface EntradaDaPosicao {
  venda: Venda;
  /** O JSON (`data`) das contas da venda, como estão no banco. */
  contas_receber: ReadonlyArray<Record<string, unknown>>;
  contas_pagar: ReadonlyArray<Record<string, unknown>>;
  cobrancas?: ReadonlyArray<CobrancaDaPosicao>;
  pendencias?: ReadonlyArray<PendenciaDaPosicao>;
  config?: ConfigReceita;
  /** AAAA-MM-DD; padrão: hoje no fuso do Brasil. */
  hoje: string;
}

export interface LadoDoCliente {
  /** Total que o cliente paga pela venda. */
  total: Centavos;
  /** O que ele pagou ou paga direto ao fornecedor (itens que o fornecedor cobra, Pago direto, Crédito no fornecedor). */
  coberto_pelo_fornecedor: Centavos;
  coberto_por_credito: Centavos;
  retido_pelo_intermediario: Centavos;
  /** Contas a receber do cliente (vivas). */
  a_receber: Centavos;
  recebido: Centavos;
  em_aberto: Centavos;
  em_atraso: Centavos;
  proximo_vencimento: string | null;
  /** Último vencimento em aberto: quando o cliente termina de pagar. */
  ultimo_vencimento: string | null;
  situacao: SituacaoDoLado;
  cobrancas_abertas: { quantidade: number; valor: Centavos; vencidas: number };
}

export interface LadoDoFornecedor {
  parte_id: string;
  nome: string;
  papel: 'fornecedor' | 'intermediario';
  a_pagar: Centavos;
  pago: Centavos;
  em_aberto: Centavos;
  /** Comissão que ele deve à agência. */
  a_receber: Centavos;
  recebido: Centavos;
  proximo_vencimento: string | null;
  situacao: SituacaoDoLado;
}

export type TipoDeAlerta =
  | 'FORNECEDOR_PAGO_ANTES' | 'FORNECEDOR_VENCE_ANTES' | 'SALDO_SEM_FORMA'
  | 'PAGAMENTOS_ACIMA_DO_TOTAL' | 'CREDITO_PENDENTE' | 'CLIENTE_EM_ATRASO';

export interface AlertaDaPosicao {
  tipo: TipoDeAlerta;
  gravidade: 'aviso' | 'atencao';
  mensagem: string;
  valor?: Centavos;
  parte_id?: string;
  data?: string;
}

export interface PosicaoDaVenda {
  cliente: LadoDoCliente;
  fornecedores: LadoDoFornecedor[];
  /** Soma de todos os fornecedores e intermediários. */
  fornecedor: { a_pagar: Centavos; pago: Centavos; em_aberto: Centavos; a_receber: Centavos; recebido: Centavos; situacao: SituacaoDoLado };
  receita: ReceitaDaVenda;
  alertas: AlertaDaPosicao[];
}

const VIVA = (d: Record<string, unknown>) => String(d.status ?? '') !== 'CANCELADO';
const brl = (v: unknown) => paraCentavos(num(v));

/** O que já se moveu numa conta (mesma regra de `valorNoCaixa`). */
function baixado(d: Record<string, unknown>, campo: 'valor_recebido' | 'valor_pago'): Centavos {
  const s = String(d.status ?? '');
  if (s === 'PARCIAL') return brl(d[campo]);
  if (s === 'RECEBIDO' || s === 'PAGO') return brl(num(d[campo]) || num(d.valor_final));
  return 0;
}

function situacao(total: Centavos, pago: Centavos): SituacaoDoLado {
  if (total <= 0) return 'SEM_VALOR';
  if (pago >= total) return 'PAGO';
  return pago > 0 ? 'PARCIAL' : 'PENDENTE';
}

const dataBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const reaisTxt = (c: Centavos) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function posicaoDaVenda(e: EntradaDaPosicao): PosicaoDaVenda {
  const { venda, hoje } = e;
  const totais = totaisDaVenda(venda);
  const crs = e.contas_receber.filter(VIVA);
  const cps = e.contas_pagar.filter(VIVA);

  // ---- Cliente ----
  const doCliente = crs.filter(d => String(d.origem ?? 'VENDA') === 'VENDA');
  let a_receber = 0, recebido = 0, em_atraso = 0;
  const vencAbertos: string[] = [];
  for (const d of doCliente) {
    const valor = brl(d.valor_final);
    const pago = Math.min(baixado(d, 'valor_recebido'), valor);
    a_receber += valor;
    recebido += pago;
    const venc = String(d.data_vencimento ?? '').slice(0, 10);
    if (pago < valor) {
      if (venc) vencAbertos.push(venc);
      if (venc && venc < hoje) em_atraso += valor - pago;
    }
  }
  vencAbertos.sort();
  const somaForma = (efeito: string) => venda.pagamentos.filter(p => FORMAS[p.forma].efeito === efeito).reduce((a, p) => a + p.valor_centavos, 0);
  const ids = new Set(doCliente.map(d => String(d.id ?? '')));
  const cobAbertas = (e.cobrancas ?? []).filter(c => ids.has(c.titulo_id) && ['emitindo', 'aberta', 'vencida'].includes(c.status));
  const coberto_pelo_fornecedor = totais.cobrado_pelo_fornecedor + somaForma('abate_do_fornecedor');
  const coberto_por_credito = somaForma('credito_do_cliente');
  const retido = somaForma('receber_do_intermediario');
  const total = venda.produtos.length > 0 ? totais.valor_cliente : a_receber;
  const cobertoForaDasContas = coberto_pelo_fornecedor + coberto_por_credito + retido;
  const cliente: LadoDoCliente = {
    total,
    coberto_pelo_fornecedor, coberto_por_credito, retido_pelo_intermediario: retido,
    a_receber, recebido, em_aberto: a_receber - recebido, em_atraso,
    proximo_vencimento: vencAbertos[0] ?? null,
    ultimo_vencimento: vencAbertos[vencAbertos.length - 1] ?? null,
    situacao: situacao(Math.max(total - cobertoForaDasContas, a_receber), recebido),
    cobrancas_abertas: {
      quantidade: cobAbertas.length,
      valor: cobAbertas.reduce((a, c) => a + c.valor_centavos, 0),
      vencidas: cobAbertas.filter(c => c.status === 'vencida' || (c.vencimento ?? '9999') < hoje).length,
    },
  };

  // ---- Fornecedores e intermediário ----
  const lados = new Map<string, LadoDoFornecedor & { _venc: string[] }>();
  const lado = (id: string, nome: string, papel: LadoDoFornecedor['papel']) => {
    const k = `${papel}:${id || nome.toLowerCase() || 'sem'}`;
    let l = lados.get(k);
    if (!l) {
      l = { parte_id: id, nome: nome || (papel === 'intermediario' ? 'Intermediário não informado' : 'Fornecedor não informado'), papel, a_pagar: 0, pago: 0, em_aberto: 0, a_receber: 0, recebido: 0, proximo_vencimento: null, situacao: 'SEM_VALOR', _venc: [] };
      lados.set(k, l);
    }
    return l;
  };
  for (const d of cps) {
    const papel = String(d.venda_chave ?? '').startsWith('v2:repasse') ? 'intermediario' : 'fornecedor';
    const l = lado(String(d.fornecedor_id ?? ''), String(d.fornecedor_nome ?? ''), papel);
    const valor = brl(d.valor_final);
    const pago = Math.min(baixado(d, 'valor_pago'), valor);
    l.a_pagar += valor;
    l.pago += pago;
    if (pago < valor && d.data_vencimento) l._venc.push(String(d.data_vencimento).slice(0, 10));
  }
  for (const d of crs) {
    const origem = String(d.origem ?? '');
    if (origem === 'COMISSAO_FORNECEDOR') {
      const l = lado(String(d.fornecedor_id ?? d.cliente_id ?? ''), String(d.fornecedor_nome ?? d.cliente_nome ?? ''), 'fornecedor');
      const valor = brl(d.valor_final);
      l.a_receber += valor;
      l.recebido += Math.min(baixado(d, 'valor_recebido'), valor);
    } else if (origem === 'OUTROS' && String(d.venda_forma ?? '') === 'RETIDO_INTERMEDIARIO') {
      const l = lado(String(d.cliente_id ?? ''), String(d.cliente_nome ?? ''), 'intermediario');
      const valor = brl(d.valor_final);
      l.a_receber += valor;
      l.recebido += Math.min(baixado(d, 'valor_recebido'), valor);
    }
  }
  const fornecedores: LadoDoFornecedor[] = [...lados.values()].map(({ _venc, ...l }) => {
    _venc.sort();
    return { ...l, em_aberto: l.a_pagar - l.pago, proximo_vencimento: _venc[0] ?? null, situacao: situacao(l.a_pagar, l.pago) };
  }).sort((a, b) => (a.papel === b.papel ? a.nome.localeCompare(b.nome) : a.papel === 'fornecedor' ? -1 : 1));
  const soma = (k: 'a_pagar' | 'pago' | 'a_receber' | 'recebido') => fornecedores.reduce((a, f) => a + f[k], 0);
  const fornecedor = {
    a_pagar: soma('a_pagar'), pago: soma('pago'), em_aberto: soma('a_pagar') - soma('pago'),
    a_receber: soma('a_receber'), recebido: soma('recebido'), situacao: situacao(soma('a_pagar'), soma('pago')),
  };

  // ---- Alertas ----
  const alertas: AlertaDaPosicao[] = [];
  const pagoFornecedores = fornecedores.filter(f => f.papel === 'fornecedor').reduce((a, f) => a + f.pago, 0);
  if (cliente.em_aberto > 0 && pagoFornecedores > recebido) {
    alertas.push({
      tipo: 'FORNECEDOR_PAGO_ANTES', gravidade: 'atencao', valor: pagoFornecedores - recebido,
      mensagem: `A agência já pagou ${reaisTxt(pagoFornecedores)} aos fornecedores e recebeu ${reaisTxt(recebido)} do cliente: ${reaisTxt(pagoFornecedores - recebido)} saíram do caixa antes de o cliente pagar.`,
    });
  }
  if (cliente.em_aberto > 0 && cliente.ultimo_vencimento) {
    for (const f of fornecedores) {
      if (f.papel !== 'fornecedor' || f.em_aberto <= 0 || !f.proximo_vencimento) continue;
      if (f.proximo_vencimento < cliente.ultimo_vencimento) {
        alertas.push({
          tipo: 'FORNECEDOR_VENCE_ANTES', gravidade: 'aviso', parte_id: f.parte_id, data: f.proximo_vencimento,
          valor: Math.min(f.em_aberto, cliente.em_aberto),
          mensagem: `${f.nome} vence em ${dataBR(f.proximo_vencimento)}, antes de o cliente terminar de pagar (${dataBR(cliente.ultimo_vencimento)}). Pagar no prazo tira ${reaisTxt(Math.min(f.em_aberto, cliente.em_aberto))} do caixa antes de o dinheiro do cliente entrar.`,
        });
      }
    }
  }
  if (cliente.em_atraso > 0) {
    alertas.push({ tipo: 'CLIENTE_EM_ATRASO', gravidade: 'atencao', valor: cliente.em_atraso, mensagem: `O cliente tem ${reaisTxt(cliente.em_atraso)} em atraso.` });
  }
  if (venda.produtos.length > 0 && venda.pagamentos.length > 0 && totais.saldo_sem_forma > 0) {
    alertas.push({ tipo: 'SALDO_SEM_FORMA', gravidade: 'aviso', valor: totais.saldo_sem_forma, mensagem: `Faltam ${reaisTxt(totais.saldo_sem_forma)} sem forma de pagamento.` });
  }
  if (totais.saldo_sem_forma < 0 && venda.pagamentos.length > 0) {
    alertas.push({ tipo: 'PAGAMENTOS_ACIMA_DO_TOTAL', gravidade: 'atencao', valor: -totais.saldo_sem_forma, mensagem: `Os pagamentos passam do total da venda em ${reaisTxt(-totais.saldo_sem_forma)}.` });
  }
  const creditoAberto = (e.pendencias ?? []).filter(p => p.tipo === 'CREDITO_CLIENTE' && p.situacao === 'ABERTA').reduce((a, p) => a + p.valor_centavos, 0);
  if (creditoAberto > 0) {
    alertas.push({ tipo: 'CREDITO_PENDENTE', gravidade: 'aviso', valor: creditoAberto, mensagem: `${reaisTxt(creditoAberto)} pagos com crédito do cliente ainda não saíram da carteira de crédito dele.` });
  }

  return {
    cliente, fornecedores, fornecedor,
    receita: receitaDaVenda(venda, e.config ?? CONFIG_RECEITA_PADRAO),
    alertas,
  };
}
