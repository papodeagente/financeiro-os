/**
 * Monta os títulos (contas a pagar/receber) de uma série (05/11/2026).
 *
 * Puro: recebe o modelo que veio da tela, a ocorrência e o valor, e devolve
 * o objeto que vai para a coluna `data`. Os campos do título são os mesmos
 * que a despesa fixa sempre gravou (descrição "(3/12 — mensal)", parcela
 * i de N, valor em BRL em valor_final); a série acrescenta serie_id,
 * serie_ordem e serie_modo.
 */
import { createContaPagar, createContaReceber, type ContaPagar, type ContaReceber } from './crm-types';
import { validarRateio } from './dimensoes';
import { deCentavos, num, paraBRL, round2 } from './money';
import { separarSufixo, sufixoDaDescricao, type ModoSerie, type RegraRecorrencia, type TabelaAlvo } from './recorrencia';

/** Campos do título que a série copia do modelo. O resto nasce limpo. */
export const CAMPOS_DO_MODELO: Record<TabelaAlvo, readonly string[]> = {
  contas_pagar: [
    'origem', 'fornecedor_id', 'fornecedor_nome', 'descricao', 'categoria_id', 'centro_custo',
    'moeda', 'cambio', 'forma_pagamento', 'cartao_id', 'natureza_custo', 'is_custo_comercial', 'observacoes',
    'centro_custo_id', 'rateio', 'tags',
    // E7, frente D: a tela já mandava e a série descartava.
    'conta_previsao_id', 'campos_personalizados',
  ],
  contas_receber: [
    'origem', 'cliente_id', 'cliente_nome', 'descricao', 'categoria_id', 'centro_custo',
    'forma_recebimento', 'taxa', 'taxa_plataforma', 'observacoes',
    'centro_custo_id', 'rateio', 'tags',
    // E7, frente D: conta a receber em moeda estrangeira também se repete (na
    // moeda; o câmbio de cada parcela vem na liquidação), e a série guarda a
    // conta prevista e os campos personalizados que a tela manda.
    'moeda', 'cambio', 'conta_previsao_id', 'campos_personalizados',
  ],
};

/** Código de moeda de três letras (o catálogo da agência é conferido na rota). */
function moedaDoModelo(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(s) ? s : 'BRL';
}

/** Só os campos permitidos, sem dinheiro nem situação (esses a série decide). */
export function limparModelo(tabela: TabelaAlvo, bruto: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!bruto || typeof bruto !== 'object') return out;
  const b = bruto as Record<string, unknown>;
  for (const c of CAMPOS_DO_MODELO[tabela]) if (b[c] !== undefined) out[c] = b[c];
  if (typeof out.descricao === 'string') out.descricao = out.descricao.trim();
  // Moedas da agência (E7, frente D): qualquer código de três letras; a rota
  // confere no catálogo da agência. Antes só BRL, USD e EUR (o resto virava real).
  if (tabela === 'contas_pagar' || out.moeda !== undefined) out.moeda = moedaDoModelo(out.moeda);
  if (tabela === 'contas_receber' && out.moeda === 'BRL') { delete out.moeda; delete out.cambio; }
  if (tabela === 'contas_pagar' && !out.origem) out.origem = 'OUTROS';
  return out;
}

/** Quem é a pessoa do título (para mensagens). */
export function pessoaDoModelo(tabela: TabelaAlvo, modelo: Record<string, unknown>): string {
  return String((tabela === 'contas_pagar' ? modelo.fornecedor_nome : modelo.cliente_nome) ?? '').trim();
}

export interface DadosDoTitulo {
  tabela: TabelaAlvo;
  serieId: string;
  modo: ModoSerie;
  regra: RegraRecorrencia;
  modelo: Record<string, unknown>;
  ordem: number;
  total: number | null;
  vencimento: string;
  /** Data pela regra, antes do ajuste de feriado (padrão: o vencimento). */
  nominal?: string;
  /** Valor da ocorrência na moeda do título (centavos). */
  valorCentavos: number;
  /** Valor em reais da ocorrência (centavos). No BRL é igual ao anterior. */
  valorBrlCentavos: number;
  /** Taxa da plataforma (receber), em centavos, já repartida. */
  taxaCentavos?: number;
  emissao: string;
  id: string;
}

/** Id do título da série: estável, para a mesma ocorrência nunca nascer duas vezes. */
export function idDoTitulo(serieId: string, ordem: number): string {
  return `${serieId}-${String(ordem).padStart(3, '0')}`;
}

/**
 * O rateio do modelo guarda percentuais; o valor de cada linha é refeito
 * sobre o valor DESTE título (parcelas e reajustes mudam o total).
 */
function rateioDoTitulo(modelo: Record<string, unknown>, totalBrl: number) {
  const r = validarRateio(totalBrl, modelo.rateio);
  return r.ok ? r.linhas : [];
}

export function montarTitulo(d: DadosDoTitulo): ContaPagar | ContaReceber {
  const base = separarSufixo(String(d.modelo.descricao ?? ''));
  const descricao = `${base}${sufixoDaDescricao(d.modo, d.regra, d.ordem, d.total)}`;
  const parcela = d.total !== null ? { parcela_numero: d.ordem, total_parcelas: d.total } : { parcela_numero: 1, total_parcelas: 1 };
  const serie = { serie_id: d.serieId, serie_ordem: d.ordem, serie_modo: d.modo, serie_nominal: d.nominal ?? d.vencimento };
  const valor = deCentavos(d.valorCentavos);
  const valorBrl = deCentavos(d.valorBrlCentavos);

  if (d.tabela === 'contas_pagar') {
    const moeda = (d.modelo.moeda as ContaPagar['moeda']) || 'BRL';
    const forma = (d.modelo.forma_pagamento as ContaPagar['forma_pagamento']) || '';
    const conta: ContaPagar = {
      ...createContaPagar(),
      ...(d.modelo as Partial<ContaPagar>),
      id: d.id,
      descricao,
      data_emissao: d.emissao,
      data_vencimento: d.vencimento,
      moeda,
      cambio: moeda === 'BRL' ? 1 : num(d.modelo.cambio),
      cartao_id: forma === 'CARTAO_CORP' ? ((d.modelo.cartao_id as string) || null) : null,
      valor_original: valor,
      valor_final: valorBrl,
      valor_brl: valorBrl,
      rateio: rateioDoTitulo(d.modelo, valorBrl),
      ...parcela,
      ...serie,
    } as ContaPagar;
    return conta;
  }
  // Em moeda estrangeira (E7, frente D): valor na moeda em valor_original e
  // em reais pelo câmbio do lançamento em valor_final, como na conta avulsa.
  const moedaReceber = moedaDoModelo(d.modelo.moeda);
  const conta: ContaReceber = {
    ...createContaReceber(),
    ...(d.modelo as Partial<ContaReceber>),
    id: d.id,
    descricao,
    data_emissao: d.emissao,
    data_vencimento: d.vencimento,
    ...(moedaReceber !== 'BRL' ? { moeda: moedaReceber, cambio: num(d.modelo.cambio) } : {}),
    valor_original: valor,
    valor_final: valorBrl,
    taxa: deCentavos(d.taxaCentavos ?? 0),
    taxa_plataforma: String(d.modelo.taxa_plataforma ?? ''),
    rateio: rateioDoTitulo(d.modelo, valorBrl),
    ...parcela,
    ...serie,
  } as ContaReceber;
  return conta;
}

/** Valor em BRL (centavos) a partir do valor na moeda do título. */
export function brlEmCentavos(tabela: TabelaAlvo, modelo: Record<string, unknown>, valorCentavos: number): number {
  const moeda = String(modelo.moeda ?? 'BRL');
  // A receber em real: o mesmo número, como sempre.
  if (tabela !== 'contas_pagar' && moeda === 'BRL') return valorCentavos;
  return Math.round(round2(paraBRL(deCentavos(valorCentavos), moeda, num(modelo.cambio))) * 100);
}
