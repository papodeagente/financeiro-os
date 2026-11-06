/**
 * O MODELO DA VENDA COMPLETA (E5, parte A, 05/11/2026).
 *
 * Uma venda de turismo vista pelo financeiro: produtos por tipo, passageiros
 * por produto, componentes de receita com os nomes do mercado (Comissão,
 * Over, Taxa DU, RAV, Fee, Markup, Desconto...), quem cobra cada item,
 * moeda e câmbio por produto, fornecedor e representante, e os pagamentos
 * do cliente por forma. A venda lançada à mão e a que chega do CRM
 * (VENDA_FECHADA v2) usam ESTE modelo e o mesmo gerador de contas
 * (`contasDaVenda`, em venda-contas.ts).
 *
 * Arquivo puro (sem banco). Dinheiro do modelo em CENTAVOS inteiros
 * (`Centavos`), na moeda do produto; os pagamentos em centavos de real.
 * A conversão para reais acontece só na borda (contas, telas).
 *
 * As contas de cada produto (a conta de chegada):
 *   tarifa      = soma das tarifas dos passageiros ativos (ou quantidade ×
 *                 valor unitário, no produto sem passageiro)
 *   taxas       = taxas + outras taxas (embarque etc.): passam ao fornecedor
 *   valor_cliente    = tarifa + taxas + Taxa DU + RAV + Fee + Markup − Desconto
 *   valor_fornecedor = tarifa + taxas − Comissão − Over + Taxa CC
 *   repasse          = Repasse ao intermediário
 *   receita (todos os componentes) = valor_cliente − valor_fornecedor − repasse
 * Quais componentes CONTAM como receita da agência é escolha dela
 * (`receitaDaVenda`, venda-receita.ts); o dinheiro que circula não muda.
 */

import { addDias, addMeses, num, round2 } from './money';

/** Dinheiro em centavos inteiros. */
export type Centavos = number;

// ============================================================
// Produtos
// ============================================================

export const TIPOS_PRODUTO = [
  'AEREO', 'AEREO_AGENCIA', 'HOSPEDAGEM', 'PACOTE', 'CRUZEIRO',
  'SEGURO', 'LOCACAO', 'RECEPTIVO', 'INGRESSO', 'OUTROS',
] as const;
export type TipoProduto = (typeof TIPOS_PRODUTO)[number];

export const ROTULO_TIPO_PRODUTO: Record<TipoProduto, string> = {
  AEREO: 'Aéreo',
  AEREO_AGENCIA: 'Aéreo emitido pela agência',
  HOSPEDAGEM: 'Hospedagem',
  PACOTE: 'Pacote',
  CRUZEIRO: 'Cruzeiro',
  SEGURO: 'Seguro viagem',
  LOCACAO: 'Locação de veículo',
  RECEPTIVO: 'Receptivo',
  INGRESSO: 'Ingresso',
  OUTROS: 'Outros',
};

/** Campos de identificação próprios de cada tipo (ficam em `detalhes`). */
export const CAMPOS_DO_TIPO: Record<TipoProduto, ReadonlyArray<{ chave: string; rotulo: string }>> = {
  AEREO: [{ chave: 'cia', rotulo: 'Companhia aérea' }, { chave: 'trechos', rotulo: 'Trechos' }, { chave: 'destino', rotulo: 'Destino' }],
  AEREO_AGENCIA: [{ chave: 'cia', rotulo: 'Companhia aérea' }, { chave: 'trechos', rotulo: 'Trechos' }, { chave: 'destino', rotulo: 'Destino' }],
  HOSPEDAGEM: [{ chave: 'hotel', rotulo: 'Hotel' }, { chave: 'acomodacao', rotulo: 'Acomodação' }, { chave: 'regime', rotulo: 'Regime' }, { chave: 'destino', rotulo: 'Destino' }],
  PACOTE: [{ chave: 'pacote', rotulo: 'Nome do pacote' }, { chave: 'destino', rotulo: 'Destino' }, { chave: 'transporte', rotulo: 'Transporte' }],
  CRUZEIRO: [{ chave: 'navio', rotulo: 'Navio' }, { chave: 'cabine', rotulo: 'Cabine' }, { chave: 'regime', rotulo: 'Regime' }, { chave: 'destino', rotulo: 'Roteiro' }],
  SEGURO: [{ chave: 'plano', rotulo: 'Plano' }, { chave: 'destino', rotulo: 'Destino' }],
  LOCACAO: [{ chave: 'retirada', rotulo: 'Retirada' }, { chave: 'devolucao', rotulo: 'Devolução' }, { chave: 'categoria', rotulo: 'Categoria' }],
  RECEPTIVO: [{ chave: 'servico', rotulo: 'Serviço' }, { chave: 'destino', rotulo: 'Destino' }],
  INGRESSO: [{ chave: 'evento', rotulo: 'Evento' }, { chave: 'local', rotulo: 'Local' }],
  OUTROS: [{ chave: 'produto', rotulo: 'Produto' }],
};

/** Quem recebe o dinheiro do cliente por este item. */
export type QuemCobra = 'AGENCIA' | 'FORNECEDOR';
export const ROTULO_QUEM_COBRA: Record<QuemCobra, string> = {
  AGENCIA: 'A agência cobra do cliente',
  FORNECEDOR: 'O fornecedor cobra direto do cliente',
};

export type TipoPassageiro = 'ADT' | 'CHD' | 'INF';
export const ROTULO_TIPO_PASSAGEIRO: Record<TipoPassageiro, string> = { ADT: 'Adulto', CHD: 'Criança', INF: 'Bebê' };

/** Pessoa ligada à venda: cliente, vendedor, fornecedor, representante, pagante. */
export interface ParteDaVenda {
  /** Id do cadastro no financeiro. Vazio quando ainda não há cadastro. */
  id: string;
  nome: string;
  documento?: string;
  /** Id do cadastro no CRM, quando veio de lá. */
  id_externo?: string;
}

// ============================================================
// Componentes de receita
// ============================================================

export const TIPOS_COMPONENTE = [
  'COMISSAO', 'OVER', 'TAXA_DU', 'RAV', 'FEE', 'MARKUP', 'DESCONTO', 'TAXA_CC', 'REPASSE_INTERMEDIARIO',
] as const;
export type TipoComponente = (typeof TIPOS_COMPONENTE)[number];

/**
 * Como o componente mexe no dinheiro:
 *  - devolvido_pelo_fornecedor: está dentro da tarifa e volta para a agência
 *    (o fornecedor fica com menos);
 *  - cobrado_do_cliente: soma ao que o cliente paga;
 *  - abatido_do_cliente: tira do que o cliente paga;
 *  - custo_da_receita: sai da receita para outra pessoa (fornecedor ou
 *    intermediário).
 */
export type NaturezaDoComponente = 'devolvido_pelo_fornecedor' | 'cobrado_do_cliente' | 'abatido_do_cliente' | 'custo_da_receita';

export interface InfoDoComponente {
  rotulo: string;
  ajuda: string;
  natureza: NaturezaDoComponente;
  /** +1 soma à receita, −1 tira. */
  sinal: 1 | -1;
}

export const COMPONENTES: Record<TipoComponente, InfoDoComponente> = {
  COMISSAO: { rotulo: 'Comissão', ajuda: 'O que o fornecedor paga à agência sobre a tarifa.', natureza: 'devolvido_pelo_fornecedor', sinal: 1 },
  OVER: { rotulo: 'Over', ajuda: 'Incentivo do fornecedor além da comissão.', natureza: 'devolvido_pelo_fornecedor', sinal: 1 },
  TAXA_DU: { rotulo: 'Taxa DU', ajuda: 'Taxa de serviço do aéreo cobrada do cliente.', natureza: 'cobrado_do_cliente', sinal: 1 },
  RAV: { rotulo: 'RAV', ajuda: 'Remuneração da agência cobrada do cliente.', natureza: 'cobrado_do_cliente', sinal: 1 },
  FEE: { rotulo: 'Fee', ajuda: 'Taxa da agência mostrada ao cliente.', natureza: 'cobrado_do_cliente', sinal: 1 },
  MARKUP: { rotulo: 'Markup', ajuda: 'Margem da agência somada ao preço, sem aparecer em separado.', natureza: 'cobrado_do_cliente', sinal: 1 },
  DESCONTO: { rotulo: 'Desconto', ajuda: 'Desconto dado ao cliente; sai da receita.', natureza: 'abatido_do_cliente', sinal: -1 },
  TAXA_CC: { rotulo: 'Taxa CC (DU/RAV)', ajuda: 'Custo de cartão que o fornecedor cobra sobre DU/RAV; sai da receita.', natureza: 'custo_da_receita', sinal: -1 },
  REPASSE_INTERMEDIARIO: { rotulo: 'Repasse ao intermediário', ajuda: 'Parte da receita de quem trouxe a venda.', natureza: 'custo_da_receita', sinal: -1 },
};

export interface ComponenteDeReceita {
  id: string;
  tipo: TipoComponente;
  /** Valor na moeda do produto. É ele que vale; o percentual é só a origem. */
  valor_centavos: Centavos;
  /** Percentual informado (sobre a tarifa do produto ou do passageiro). */
  percentual: number | null;
  /** Componente de um passageiro só (Taxa DU, RAV, Fee por passageiro). */
  passageiro_id: string | null;
  descricao: string;
}

export interface Passageiro {
  id: string;
  nome: string;
  tipo: TipoPassageiro;
  documento: string;
  /** Valor do produto para este passageiro (tarifa), na moeda do produto. */
  tarifa_centavos: Centavos;
  /** Taxa de embarque ou taxas do produto. */
  taxas_centavos: Centavos;
  outras_taxas_centavos: Centavos;
  /** Data do cancelamento (parte D); passageiro cancelado não entra nas contas. */
  cancelado_em: string | null;
}

export interface ProdutoDaVenda {
  id: string;
  sequencia: number;
  tipo: TipoProduto;
  descricao: string;
  fornecedor: ParteDaVenda | null;
  /** Representante/consolidador por onde o produto foi comprado: quando há, é com ele o acerto. */
  representante: ParteDaVenda | null;
  quem_cobra: QuemCobra;
  /** Código ISO de 3 letras (BRL, USD, EUR...). */
  moeda: string;
  /** Reais por unidade da moeda (1 em BRL). Sempre digitável. */
  cambio: number;
  localizador: string;
  data_inicio: string;
  data_fim: string;
  /** Quando pagar o fornecedor. Vazio: prazo do cadastro dele. */
  data_pagamento_fornecedor: string;
  /** Produto sem passageiro: quantidade × valor unitário + taxas. */
  quantidade: number;
  valor_unitario_centavos: Centavos;
  taxas_centavos: Centavos;
  passageiros: Passageiro[];
  componentes: ComponenteDeReceita[];
  /** Campos de identificação do tipo (CAMPOS_DO_TIPO). */
  detalhes: Record<string, string>;
  cancelado_em: string | null;
  /** O produto no catálogo do CRM, quando veio de lá (regra de comissão por produto). */
  produto_crm_id: string;
}

// ============================================================
// Pagamentos por forma
// ============================================================

export const FORMAS_DA_VENDA = [
  'DINHEIRO', 'CHEQUE', 'BOLETO', 'CARTAO', 'DEPOSITO', 'PIX', 'FATURAR', 'OUTROS',
  'CREDITO_CLIENTE', 'CREDITO_FORNECEDOR', 'RETIDO_INTERMEDIARIO', 'PAGO_DIRETO_FORNECEDOR',
] as const;
export type FormaDaVenda = (typeof FORMAS_DA_VENDA)[number];

/**
 * O que a forma faz, sozinha, nas contas:
 *  - receber_do_cliente: conta a receber do pagante, em parcelas;
 *  - faturar_ao_cliente: conta a receber marcada para a fatura (parte B);
 *  - credito_do_cliente: usa crédito do cliente: nenhuma conta, uma pendência
 *    para a carteira de crédito (parte D) baixar o saldo;
 *  - abate_do_fornecedor: o cliente pagou o fornecedor (direto ou com crédito
 *    que tinha lá): nada a receber, e o que a agência deve ao fornecedor cai;
 *  - receber_do_intermediario: o intermediário recebeu e ficou com o dinheiro:
 *    a conta a receber é dele, já descontado o repasse que lhe cabe.
 */
export type EfeitoDaForma = 'receber_do_cliente' | 'faturar_ao_cliente' | 'credito_do_cliente' | 'abate_do_fornecedor' | 'receber_do_intermediario';

export interface InfoDaForma {
  rotulo: string;
  ajuda: string;
  efeito: EfeitoDaForma;
  /** Código da forma no cadastro de formas de pagamento (src/lib/formas-pagamento.ts). */
  codigo: string;
  /** Vence no dia da venda quando a pessoa não diz outra data. */
  a_vista: boolean;
}

export const FORMAS: Record<FormaDaVenda, InfoDaForma> = {
  DINHEIRO: { rotulo: 'Dinheiro', ajuda: 'O cliente paga em espécie.', efeito: 'receber_do_cliente', codigo: 'DINHEIRO', a_vista: true },
  CHEQUE: { rotulo: 'Cheque', ajuda: 'Um ou mais cheques, cada um com seu vencimento.', efeito: 'receber_do_cliente', codigo: 'CHEQUE', a_vista: false },
  BOLETO: { rotulo: 'Boleto', ajuda: 'Uma conta a receber por parcela, pronta para emitir boleto ou carnê.', efeito: 'receber_do_cliente', codigo: 'BOLETO', a_vista: false },
  CARTAO: { rotulo: 'Cartão', ajuda: 'Cartão de crédito ou débito recebido pela agência.', efeito: 'receber_do_cliente', codigo: 'CARTAO_CREDITO', a_vista: false },
  DEPOSITO: { rotulo: 'Depósito em conta', ajuda: 'O cliente deposita ou transfere para a conta da agência.', efeito: 'receber_do_cliente', codigo: 'TED', a_vista: true },
  PIX: { rotulo: 'Pix', ajuda: 'O cliente paga por Pix.', efeito: 'receber_do_cliente', codigo: 'PIX', a_vista: true },
  FATURAR: { rotulo: 'Faturar', ajuda: 'Entra na fatura do cliente, pelas regras de faturamento dele.', efeito: 'faturar_ao_cliente', codigo: 'FATURAR', a_vista: false },
  OUTROS: { rotulo: 'Outros', ajuda: 'Qualquer outra forma combinada com o cliente.', efeito: 'receber_do_cliente', codigo: 'OUTROS', a_vista: false },
  CREDITO_CLIENTE: { rotulo: 'Crédito do cliente', ajuda: 'O cliente usa um crédito que tem com a agência. Não entra dinheiro.', efeito: 'credito_do_cliente', codigo: '', a_vista: true },
  CREDITO_FORNECEDOR: { rotulo: 'Crédito no fornecedor', ajuda: 'O cliente usa um crédito que tem com o fornecedor. Abate o que a agência deve a ele.', efeito: 'abate_do_fornecedor', codigo: '', a_vista: true },
  RETIDO_INTERMEDIARIO: { rotulo: 'Retido pelo intermediário', ajuda: 'O intermediário recebeu do cliente e ficou com o dinheiro. Ele passa a dever à agência, menos o repasse dele.', efeito: 'receber_do_intermediario', codigo: '', a_vista: false },
  PAGO_DIRETO_FORNECEDOR: { rotulo: 'Pago direto ao fornecedor', ajuda: 'O cliente pagou o fornecedor (cartão dele na operadora, por exemplo). Abate o que a agência deve ao fornecedor.', efeito: 'abate_do_fornecedor', codigo: '', a_vista: true },
};

export interface PagamentoDaVenda {
  id: string;
  forma: FormaDaVenda;
  /** Em centavos de REAL. */
  valor_centavos: Centavos;
  parcelas: number;
  /** Vencimento da 1ª parcela. Vazio: no dia da venda (à vista) ou um mês depois. */
  primeiro_vencimento: string;
  /** Dias entre parcelas. 0 = de mês em mês. */
  intervalo_dias: number;
  /** Quem paga. Vazio = o cliente da venda. */
  pagante: ParteDaVenda | null;
  /** O fornecedor que recebeu (Pago direto / Crédito no fornecedor). */
  fornecedor: ParteDaVenda | null;
  /** Conta bancária prevista para o dinheiro cair. */
  conta_bancaria_id: string | null;
  /** Só no cartão. */
  cartao_tipo: 'credito' | 'debito' | null;
  /** Banco e número do cheque, autorização do cartão, observação. Nunca número de cartão. */
  detalhe: string;
  /** Crédito: a venda que originou o crédito, quando a pessoa sabe. */
  venda_origem_credito: string;
}

// ============================================================
// Venda
// ============================================================

export type SituacaoDaVenda = 'ABERTA' | 'FECHADA';
export type OrigemDaVenda = 'manual' | 'crm';

export interface Venda {
  /** Mesmo id da linha em vendas_crm (o cabeçalho que as telas antigas leem). */
  id: string;
  numero: string;
  data_venda: string;
  cliente: ParteDaVenda;
  vendedor: ParteDaVenda | null;
  /** Quem trouxe a venda (agência parceira, consolidador): recebe o repasse. */
  intermediario: ParteDaVenda | null;
  grupo_id: string | null;
  centro_custo: string;
  origem: OrigemDaVenda;
  situacao: SituacaoDaVenda;
  produtos: ProdutoDaVenda[];
  pagamentos: PagamentoDaVenda[];
  observacoes: string;
  /** Negócio no CRM (vazio na venda lançada à mão). */
  crm_venda_id: string;
}

// ============================================================
// Normalização (a entrada vem de tela, do CRM ou do banco)
// ============================================================

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function txt(v: unknown, max = 500): string {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}
export function dataOuVazio(v: unknown): string {
  const s = txt(v).slice(0, 10);
  return ISO.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) ? s : '';
}
/** Inteiro de centavos a partir de centavos (inteiro) ou de reais (`reais`). */
export function centavos(v: unknown): Centavos {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
/** Reais (número ou texto "1.234,56"/"1234.56") → centavos inteiros. */
export function reaisParaCentavos(v: unknown): Centavos {
  return Math.round(round2(num(v)) * 100);
}
function naoNegativo(v: Centavos): Centavos { return v > 0 ? v : 0; }
function umDe<T extends string>(lista: readonly T[], v: unknown, padrao: T): T {
  const s = txt(v).toUpperCase() as T;
  return lista.includes(s) ? s : padrao;
}
export function normalizarMoeda(v: unknown): string {
  const s = txt(v).toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : 'BRL';
}
export function normalizarCambio(moeda: string, v: unknown): number {
  if (moeda === 'BRL') return 1;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) / 1e6 : 1;
}
export function normalizarParte(v: unknown): ParteDaVenda | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = txt(o.id, 200);
  const nome = txt(o.nome, 200);
  const id_externo = txt(o.id_externo, 200);
  if (!id && !nome && !id_externo) return null;
  const p: ParteDaVenda = { id, nome };
  const documento = txt(o.documento, 40);
  if (documento) p.documento = documento;
  if (id_externo) p.id_externo = id_externo;
  return p;
}

let seqId = 0;
/** Id curto e estável o bastante para itens novos da tela (o banco guarda). */
export function novoIdDaVenda(prefixo: string): string {
  seqId = (seqId + 1) % 1_000_000;
  return `${prefixo}${Date.now().toString(36)}${seqId.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface ErroDaVenda { campo: string; mensagem: string }

/** Tarifa ativa base de um percentual: do passageiro ou do produto inteiro. */
function tarifaBase(p: Pick<ProdutoDaVenda, 'passageiros' | 'quantidade' | 'valor_unitario_centavos'>, passageiroId: string | null): Centavos {
  const ativos = p.passageiros.filter(x => !x.cancelado_em);
  if (passageiroId) return ativos.find(x => x.id === passageiroId)?.tarifa_centavos ?? 0;
  if (ativos.length > 0) return ativos.reduce((a, x) => a + x.tarifa_centavos, 0);
  return Math.round(p.quantidade * p.valor_unitario_centavos);
}

export function normalizarProduto(v: unknown, sequencia: number, erros: ErroDaVenda[] = []): ProdutoDaVenda {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const moeda = normalizarMoeda(o.moeda);
  const passageiros: Passageiro[] = (Array.isArray(o.passageiros) ? o.passageiros : []).slice(0, 200).map((x, i) => {
    const q = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    return {
      id: txt(q.id, 80) || novoIdDaVenda('px'),
      nome: txt(q.nome, 200) || `Passageiro ${i + 1}`,
      tipo: umDe(['ADT', 'CHD', 'INF'] as const, q.tipo, 'ADT'),
      documento: txt(q.documento, 40),
      tarifa_centavos: naoNegativo(centavos(q.tarifa_centavos)),
      taxas_centavos: naoNegativo(centavos(q.taxas_centavos)),
      outras_taxas_centavos: naoNegativo(centavos(q.outras_taxas_centavos)),
      cancelado_em: dataOuVazio(q.cancelado_em) || null,
    };
  });
  const quantidade = Math.max(1, Math.min(10_000, Math.floor(Number(o.quantidade) || 1)));
  const base = {
    passageiros, quantidade,
    valor_unitario_centavos: naoNegativo(centavos(o.valor_unitario_centavos)),
  };
  const idsPax = new Set(passageiros.map(x => x.id));
  const componentes: ComponenteDeReceita[] = (Array.isArray(o.componentes) ? o.componentes : []).slice(0, 200).flatMap(x => {
    const q = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const tipo = txt(q.tipo).toUpperCase() as TipoComponente;
    if (!TIPOS_COMPONENTE.includes(tipo)) {
      erros.push({ campo: `produtos[${sequencia - 1}].componentes`, mensagem: `Componente desconhecido: ${txt(q.tipo) || '(vazio)'}.` });
      return [];
    }
    const passageiro_id = txt(q.passageiro_id, 80) && idsPax.has(txt(q.passageiro_id, 80)) ? txt(q.passageiro_id, 80) : null;
    const pctBruto = q.percentual === null || q.percentual === undefined || q.percentual === '' ? null : Number(q.percentual);
    const percentual = pctBruto !== null && Number.isFinite(pctBruto) && pctBruto > 0 ? Math.round(pctBruto * 10000) / 10000 : null;
    let valor = naoNegativo(centavos(q.valor_centavos));
    if (valor === 0 && percentual !== null) valor = Math.round(tarifaBase(base, passageiro_id) * percentual / 100);
    return [{ id: txt(q.id, 80) || novoIdDaVenda('cp'), tipo, valor_centavos: valor, percentual, passageiro_id, descricao: txt(q.descricao, 200) }];
  });
  const detalhes: Record<string, string> = {};
  if (o.detalhes && typeof o.detalhes === 'object') {
    for (const [k, x] of Object.entries(o.detalhes as Record<string, unknown>).slice(0, 30)) {
      const s = txt(x, 300);
      if (s) detalhes[txt(k, 40)] = s;
    }
  }
  return {
    id: txt(o.id, 80) || novoIdDaVenda('pd'),
    sequencia,
    tipo: umDe(TIPOS_PRODUTO, o.tipo, 'OUTROS'),
    descricao: txt(o.descricao, 300),
    fornecedor: normalizarParte(o.fornecedor),
    representante: normalizarParte(o.representante),
    quem_cobra: umDe(['AGENCIA', 'FORNECEDOR'] as const, o.quem_cobra, 'AGENCIA'),
    moeda,
    cambio: normalizarCambio(moeda, o.cambio),
    localizador: txt(o.localizador, 80),
    data_inicio: dataOuVazio(o.data_inicio),
    data_fim: dataOuVazio(o.data_fim),
    data_pagamento_fornecedor: dataOuVazio(o.data_pagamento_fornecedor),
    quantidade,
    valor_unitario_centavos: base.valor_unitario_centavos,
    taxas_centavos: naoNegativo(centavos(o.taxas_centavos)),
    passageiros,
    componentes,
    detalhes,
    cancelado_em: dataOuVazio(o.cancelado_em) || null,
    produto_crm_id: txt(o.produto_crm_id, 120),
  };
}

export function normalizarPagamento(v: unknown, i: number, erros: ErroDaVenda[] = []): PagamentoDaVenda | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const forma = txt(o.forma).toUpperCase() as FormaDaVenda;
  if (!FORMAS_DA_VENDA.includes(forma)) {
    erros.push({ campo: `pagamentos[${i}].forma`, mensagem: `Forma de pagamento desconhecida: ${txt(o.forma) || '(vazia)'}.` });
    return null;
  }
  const valor = centavos(o.valor_centavos);
  if (!(valor > 0)) {
    erros.push({ campo: `pagamentos[${i}].valor_centavos`, mensagem: `O pagamento ${i + 1} (${FORMAS[forma].rotulo}) precisa de valor maior que zero.` });
    return null;
  }
  const cartao = txt(o.cartao_tipo).toLowerCase();
  return {
    id: txt(o.id, 80) || novoIdDaVenda('pg'),
    forma,
    valor_centavos: valor,
    parcelas: Math.max(1, Math.min(120, Math.floor(Number(o.parcelas) || 1))),
    primeiro_vencimento: dataOuVazio(o.primeiro_vencimento),
    intervalo_dias: Math.max(0, Math.min(365, Math.floor(Number(o.intervalo_dias) || 0))),
    pagante: normalizarParte(o.pagante),
    fornecedor: normalizarParte(o.fornecedor),
    conta_bancaria_id: txt(o.conta_bancaria_id, 80) || null,
    cartao_tipo: forma === 'CARTAO' ? (cartao === 'debito' ? 'debito' : 'credito') : null,
    // Número de cartão nunca é guardado: sequência longa de dígitos vira máscara.
    detalhe: txt(o.detalhe, 300).replace(/\d[\d .-]{11,}\d/g, m => `•••• ${m.replace(/\D/g, '').slice(-4)}`),
    venda_origem_credito: txt(o.venda_origem_credito, 80),
  };
}

/**
 * Lê uma venda de qualquer entrada (tela, CRM, banco) e devolve o modelo
 * limpo e os erros que impedem gravar. Percentual sem valor vira valor
 * (sobre a tarifa); câmbio de BRL é sempre 1; número de cartão é mascarado.
 */
export function normalizarVenda(v: unknown): { venda: Venda; erros: ErroDaVenda[] } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const erros: ErroDaVenda[] = [];
  const cliente = normalizarParte(o.cliente) ?? { id: '', nome: '' };
  if (!cliente.id && !cliente.nome) erros.push({ campo: 'cliente', mensagem: 'Informe o cliente da venda.' });
  const data_venda = dataOuVazio(o.data_venda);
  if (!data_venda) erros.push({ campo: 'data_venda', mensagem: 'Informe a data da venda.' });
  const produtos = (Array.isArray(o.produtos) ? o.produtos : []).slice(0, 300)
    .map((p, i) => normalizarProduto(p, i + 1, erros));
  const pagamentos = (Array.isArray(o.pagamentos) ? o.pagamentos : []).slice(0, 300)
    .map((p, i) => normalizarPagamento(p, i, erros))
    .filter((p): p is PagamentoDaVenda => p !== null);
  const situacao = txt(o.situacao).toUpperCase() === 'FECHADA' ? 'FECHADA' : 'ABERTA';
  return {
    venda: {
      id: txt(o.id, 200),
      numero: txt(o.numero, 40),
      data_venda,
      cliente,
      vendedor: normalizarParte(o.vendedor),
      intermediario: normalizarParte(o.intermediario),
      grupo_id: txt(o.grupo_id, 120) || null,
      centro_custo: txt(o.centro_custo, 120),
      origem: txt(o.origem) === 'crm' ? 'crm' : 'manual',
      situacao,
      produtos,
      pagamentos,
      observacoes: txt(o.observacoes, 2000),
      crm_venda_id: txt(o.crm_venda_id, 200),
    },
    erros,
  };
}

// ============================================================
// Totais
// ============================================================

export type ValoresPorComponente = Record<TipoComponente, Centavos>;

export function componentesZerados(): ValoresPorComponente {
  return Object.fromEntries(TIPOS_COMPONENTE.map(t => [t, 0])) as ValoresPorComponente;
}

/** Centavos na moeda do produto → centavos de real. */
export function emReais(valor: Centavos, moeda: string, cambio: number): Centavos {
  if (moeda === 'BRL') return valor;
  return Math.round(valor * (cambio > 0 ? cambio : 1));
}

export interface TotaisDoProduto {
  moeda: string;
  cambio: number;
  /** Na moeda do produto. */
  tarifa: Centavos;
  taxas: Centavos;
  componentes: ValoresPorComponente;
  valor_cliente: Centavos;
  valor_fornecedor: Centavos;
  repasse: Centavos;
  /** Receita com TODOS os componentes (a escolha da agência fica em receitaDaVenda). */
  receita_bruta: Centavos;
  /** Os mesmos números em centavos de real. */
  brl: {
    tarifa: Centavos;
    taxas: Centavos;
    componentes: ValoresPorComponente;
    valor_cliente: Centavos;
    valor_fornecedor: Centavos;
    repasse: Centavos;
    receita_bruta: Centavos;
  };
  passageiros_ativos: number;
}

/**
 * Os números de um produto. Passageiro e produto cancelados não entram (o
 * cancelamento com multa e reembolso é da parte D).
 */
export function totaisDoProduto(p: ProdutoDaVenda): TotaisDoProduto {
  const cancelado = Boolean(p.cancelado_em);
  const ativos = cancelado ? [] : p.passageiros.filter(x => !x.cancelado_em);
  const idsAtivos = new Set(ativos.map(x => x.id));
  let tarifa = 0;
  let taxas = 0;
  if (cancelado) {
    tarifa = 0;
  } else if (p.passageiros.length > 0) {
    for (const x of ativos) {
      tarifa += x.tarifa_centavos;
      taxas += x.taxas_centavos + x.outras_taxas_centavos;
    }
  } else {
    tarifa = Math.round(p.quantidade * p.valor_unitario_centavos);
    taxas = p.taxas_centavos;
  }
  const comp = componentesZerados();
  if (!cancelado) {
    for (const c of p.componentes) {
      if (c.passageiro_id && !idsAtivos.has(c.passageiro_id)) continue;
      comp[c.tipo] += c.valor_centavos;
    }
  }
  const valor_cliente = tarifa + taxas + comp.TAXA_DU + comp.RAV + comp.FEE + comp.MARKUP - comp.DESCONTO;
  const valor_fornecedor = tarifa + taxas - comp.COMISSAO - comp.OVER + comp.TAXA_CC;
  const repasse = comp.REPASSE_INTERMEDIARIO;
  const receita_bruta = valor_cliente - valor_fornecedor - repasse;
  const r = (x: Centavos) => emReais(x, p.moeda, p.cambio);
  const compBrl = componentesZerados();
  for (const t of TIPOS_COMPONENTE) compBrl[t] = r(comp[t]);
  const brlCliente = r(valor_cliente);
  const brlFornecedor = r(valor_fornecedor);
  const brlRepasse = r(repasse);
  return {
    moeda: p.moeda, cambio: p.cambio, tarifa, taxas, componentes: comp,
    valor_cliente, valor_fornecedor, repasse, receita_bruta,
    brl: {
      tarifa: r(tarifa), taxas: r(taxas), componentes: compBrl,
      valor_cliente: brlCliente, valor_fornecedor: brlFornecedor, repasse: brlRepasse,
      receita_bruta: brlCliente - brlFornecedor - brlRepasse,
    },
    passageiros_ativos: ativos.length,
  };
}

/** Chave da pessoa com quem o produto acerta: o representante, senão o fornecedor. */
export function parteDoAcerto(p: ProdutoDaVenda): { chave: string; parte: ParteDaVenda | null; via_representante: boolean } {
  const r = p.representante;
  if (r && (r.id || r.nome)) return { chave: r.id ? `id:${r.id}` : `nome:${r.nome.toLowerCase()}`, parte: r, via_representante: true };
  const f = p.fornecedor;
  if (f && (f.id || f.nome)) return { chave: f.id ? `id:${f.id}` : `nome:${f.nome.toLowerCase()}`, parte: f, via_representante: false };
  return { chave: `sem:${p.id}`, parte: null, via_representante: false };
}

export interface TotaisDaVenda {
  /** Tudo em centavos de real. */
  valor_cliente: Centavos;
  /** Parte que o fornecedor cobra direto do cliente (itens com quem_cobra FORNECEDOR). */
  cobrado_pelo_fornecedor: Centavos;
  /** O que os pagamentos informados cobrem. */
  pagamentos: Centavos;
  /** O que falta dizer como o cliente paga (negativo: pagamentos passam do total). */
  saldo_sem_forma: Centavos;
  valor_fornecedor: Centavos;
  repasse: Centavos;
  receita_bruta: Centavos;
  componentes: ValoresPorComponente;
  produtos_ativos: number;
}

export function totaisDaVenda(v: Pick<Venda, 'produtos' | 'pagamentos'>): TotaisDaVenda {
  const t: TotaisDaVenda = {
    valor_cliente: 0, cobrado_pelo_fornecedor: 0, pagamentos: 0, saldo_sem_forma: 0,
    valor_fornecedor: 0, repasse: 0, receita_bruta: 0, componentes: componentesZerados(), produtos_ativos: 0,
  };
  for (const p of v.produtos) {
    const tp = totaisDoProduto(p);
    if (!p.cancelado_em) t.produtos_ativos++;
    t.valor_cliente += tp.brl.valor_cliente;
    if (p.quem_cobra === 'FORNECEDOR') t.cobrado_pelo_fornecedor += tp.brl.valor_cliente;
    t.valor_fornecedor += tp.brl.valor_fornecedor;
    t.repasse += tp.brl.repasse;
    t.receita_bruta += tp.brl.receita_bruta;
    for (const k of TIPOS_COMPONENTE) t.componentes[k] += tp.brl.componentes[k];
  }
  t.pagamentos = v.pagamentos.reduce((a, p) => a + p.valor_centavos, 0);
  t.saldo_sem_forma = t.valor_cliente - t.cobrado_pelo_fornecedor - t.pagamentos;
  return t;
}

// ============================================================
// Datas das parcelas
// ============================================================

/** Vencimento da parcela `n` (1..N) de um pagamento. */
export function vencimentoDaParcela(pag: Pick<PagamentoDaVenda, 'forma' | 'primeiro_vencimento' | 'intervalo_dias'>, dataVenda: string, n: number): string {
  const info = FORMAS[pag.forma];
  const primeiro = pag.primeiro_vencimento
    || (info.efeito === 'faturar_ao_cliente' ? addDias(dataVenda, 30)
      : info.a_vista ? dataVenda : addMeses(dataVenda, 1));
  if (n <= 1) return primeiro;
  return pag.intervalo_dias > 0 ? addDias(primeiro, pag.intervalo_dias * (n - 1)) : addMeses(primeiro, n - 1);
}
