/**
 * O cálculo da nota fiscal de serviço. Lógica pura, sem banco e sem rede.
 *
 * Aqui mora a especificidade que motiva o módulo inteiro: numa agência de
 * viagens o valor da venda NÃO é receita da agência. Uma viagem de R$ 20.000
 * com R$ 16.500 de fornecedores rende R$ 3.500. Emitir nota de R$ 20.000
 * quando a agência agenciou faz a agência pagar ISS sobre dinheiro que só
 * passou pela conta dela.
 *
 * O outro lado do erro é igualmente caro: quem vende pacote próprio e emite
 * nota só da margem está subdeclarando. Por isso o regime é uma escolha
 * explícita, com os dois números à vista antes de emitir.
 */

import { num, round2, divSegura } from './money';
import type {
  FormaBaseIntermediacao,
  RegimeNota,
} from './nfse-tipos';

export interface EntradaCalculoNota {
  regime: RegimeNota;
  forma_base: FormaBaseIntermediacao;
  /** Valor que o cliente pagou nesta parcela. A nota nasce dele. */
  valor_recebido: number;
  /** Valor total da venda, usado para achar a proporção da parcela. */
  valor_total_venda: number;
  /** Custo dos fornecedores da venda inteira (o repasse). */
  custo_fornecedores: number;
  /** Alíquota de ISS em %, por exemplo 2 para 2%. */
  aliquota_iss: number;
  iss_retido: boolean;
  desconto_incondicionado?: number;
  /** Dedução informada à mão, quando o município exige um valor específico. */
  deducao_manual?: number | null;
}

export interface ResultadoCalculoNota {
  /** O que vai no campo ValorServicos da nota. */
  valor_servicos: number;
  valor_deducoes: number;
  desconto_incondicionado: number;
  base_calculo: number;
  aliquota_iss: number;
  valor_iss: number;
  /** O que a agência recebe depois do ISS, quando retido pelo tomador. */
  valor_liquido: number;
  /** Comissão da agência proporcional a esta parcela. */
  comissao_da_parcela: number;
  /** Repasse aos fornecedores proporcional a esta parcela. */
  repasse_da_parcela: number;
  /** Avisos para quem vai emitir. Não impedem a emissão. */
  avisos: string[];
  /** Impedimentos reais. Com qualquer um deles a nota não pode ser emitida. */
  erros: string[];
}

/** Percentual de margem da venda, entre 0 e 1. Venda sem valor não tem margem. */
function proporcaoDeMargem(valorTotal: number, custo: number): number {
  const total = round2(num(valorTotal));
  if (total <= 0) return 0;
  const margem = round2(total - Math.max(0, round2(num(custo))));
  if (margem <= 0) return 0;
  return divSegura(margem, total);
}

/**
 * Monta os valores da nota a partir do que o cliente pagou.
 *
 * A parcela é sempre a origem: a nota acompanha o dinheiro que entrou, não o
 * que foi prometido. Numa venda parcelada, cada recebimento gera uma nota com
 * a fatia proporcional de comissão e de repasse.
 */
export function calcularNota(entrada: EntradaCalculoNota): ResultadoCalculoNota {
  const avisos: string[] = [];
  const erros: string[] = [];

  const recebido = round2(num(entrada.valor_recebido));
  const totalVenda = round2(num(entrada.valor_total_venda));
  const custo = Math.max(0, round2(num(entrada.custo_fornecedores)));
  const aliquota = Math.max(0, round2(num(entrada.aliquota_iss)));
  const desconto = Math.max(0, round2(num(entrada.desconto_incondicionado)));

  if (recebido <= 0) {
    erros.push('A nota precisa de um valor recebido maior que zero.');
  }
  if (aliquota > 100) {
    erros.push('Alíquota de ISS acima de 100%. Confira a configuração fiscal.');
  }
  if (aliquota === 0) {
    avisos.push('Alíquota de ISS zerada: a nota sai sem ISS destacado.');
  }

  // Fatia desta parcela dentro da venda. Sem valor de venda registrado, a
  // parcela É a referência: não dá para ratear contra um total que não existe.
  const proporcao = totalVenda > 0 ? Math.min(1, divSegura(recebido, totalVenda)) : 1;
  const margemPct = proporcaoDeMargem(totalVenda, custo);
  const comissaoParcela = round2(recebido * margemPct);
  const repasseParcela = round2(recebido - comissaoParcela);

  if (entrada.regime === 'INTERMEDIACAO') {
    if (totalVenda <= 0) {
      erros.push(
        'Sem valor de venda registrado não dá para separar comissão de repasse. '
        + 'Lance o valor da venda ou emita como prestação direta.',
      );
    } else if (custo <= 0) {
      avisos.push(
        'Esta venda não tem custo de fornecedor lançado, então a comissão é o valor inteiro. '
        + 'Se houve repasse, lance o custo antes de emitir.',
      );
    } else if (margemPct <= 0) {
      erros.push(
        'O custo dos fornecedores é maior ou igual ao valor da venda: não há comissão a tributar. '
        + 'Confira os valores da venda antes de emitir.',
      );
    }
    if (round2(custo * proporcao) > 0 && comissaoParcela <= 0 && margemPct > 0) {
      avisos.push('A comissão desta parcela arredondou para zero.');
    }
  }

  let valorServicos: number;
  let deducoes: number;

  if (entrada.regime === 'PRESTACAO_DIRETA') {
    // Serviço próprio: o valor inteiro é receita da agência.
    valorServicos = recebido;
    deducoes = Math.max(0, round2(num(entrada.deducao_manual)));
    if (deducoes > 0) {
      avisos.push('Dedução informada à mão numa nota de prestação direta. Confirme com a contabilidade.');
    }
  } else if (entrada.forma_base === 'TOTAL_COM_DEDUCAO') {
    // A nota mostra o valor cheio e o repasse como dedução. Alguns municípios
    // só aceitam a intermediação neste formato.
    valorServicos = recebido;
    deducoes = entrada.deducao_manual != null
      ? Math.max(0, round2(num(entrada.deducao_manual)))
      : repasseParcela;
  } else {
    // A nota é da comissão. Não há dedução a declarar: o repasse nem entra.
    valorServicos = comissaoParcela;
    deducoes = 0;
    if (entrada.deducao_manual != null && round2(num(entrada.deducao_manual)) > 0) {
      avisos.push(
        'A dedução informada foi ignorada: nesta forma a nota já sai com o valor da comissão.',
      );
    }
  }

  // A dedução não pode comer mais do que o serviço, senão a base fica negativa
  // e a prefeitura rejeita o XML.
  if (deducoes > valorServicos) {
    deducoes = valorServicos;
    avisos.push('A dedução foi limitada ao valor do serviço para a base não ficar negativa.');
  }

  let descontoAplicado = desconto;
  if (descontoAplicado > round2(valorServicos - deducoes)) {
    descontoAplicado = Math.max(0, round2(valorServicos - deducoes));
    avisos.push('O desconto foi limitado para a base de cálculo não ficar negativa.');
  }

  const base = Math.max(0, round2(valorServicos - deducoes - descontoAplicado));
  const valorIss = round2(base * (aliquota / 100));
  // Quando o tomador retém, ele paga o ISS à prefeitura e repassa o resto.
  const valorLiquido = entrada.iss_retido
    ? Math.max(0, round2(valorServicos - valorIss))
    : valorServicos;

  if (entrada.iss_retido) {
    avisos.push('ISS retido pelo tomador: a agência recebe o valor já descontado do imposto.');
  }

  return {
    valor_servicos: valorServicos,
    valor_deducoes: deducoes,
    desconto_incondicionado: descontoAplicado,
    base_calculo: base,
    aliquota_iss: aliquota,
    valor_iss: valorIss,
    valor_liquido: valorLiquido,
    comissao_da_parcela: comissaoParcela,
    repasse_da_parcela: repasseParcela,
    avisos,
    erros,
  };
}

/**
 * Sugere o regime a partir da própria venda.
 *
 * Venda com custo de fornecedor é agenciamento até prova em contrário: o
 * dinheiro do fornecedor passou pela agência. Venda sem custo é serviço da
 * própria agência. É só um palpite inicial — quem emite confirma.
 */
export function regimeSugerido(valorTotalVenda: number, custoFornecedores: number): RegimeNota {
  const total = round2(num(valorTotalVenda));
  const custo = round2(num(custoFornecedores));
  if (total <= 0) return 'PRESTACAO_DIRETA';
  if (custo <= 0) return 'PRESTACAO_DIRETA';
  if (custo >= total) return 'PRESTACAO_DIRETA';
  return 'INTERMEDIACAO';
}

/** Preenche a discriminação do serviço. Placeholder desconhecido some. */
export function montarDiscriminacao(
  modelo: string,
  valores: {
    cliente?: string;
    venda?: string;
    parcela?: string;
    descricao?: string;
    repasse?: string;
  },
): string {
  const mapa: Record<string, string> = {
    cliente: valores.cliente ?? '',
    venda: valores.venda ?? '',
    parcela: valores.parcela ?? '',
    descricao: valores.descricao ?? '',
    repasse: valores.repasse ?? '',
  };
  return modelo
    .replace(/\{(\w+)\}/g, (_todo, chave: string) => mapa[chave] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * O que impede a emissão antes mesmo de calcular: configuração incompleta.
 * Devolve a lista de pendências em linguagem de quem usa, não de quem programa.
 */
export function pendenciasParaEmitir(entrada: {
  provedor: string;
  temCertificado: boolean;
  certificadoValidoAte?: string;
  hoje?: string;
  item_lista_servico: string;
  cnae: string;
  aliquota_iss: number;
  emitente_cnpj: string;
  emitente_inscricao_municipal: string;
  tomador_documento: string;
  tomador_nome: string;
}): string[] {
  const faltas: string[] = [];
  if (!entrada.provedor) faltas.push('Escolha o emissor de nota em Configurações › Fiscal.');
  if (!entrada.temCertificado) faltas.push('Envie o certificado digital A1 da agência.');
  if (!String(entrada.emitente_cnpj || '').trim()) {
    faltas.push('Preencha o CNPJ da agência em Configurações › Agência.');
  }
  if (!String(entrada.emitente_inscricao_municipal || '').trim()) {
    faltas.push('Preencha a inscrição municipal da agência.');
  }
  if (!String(entrada.item_lista_servico || '').trim()) {
    faltas.push('Informe o item da lista de serviço (agência de viagens costuma ser 9.02).');
  }
  if (!String(entrada.cnae || '').trim()) faltas.push('Informe o CNAE da agência.');
  if (num(entrada.aliquota_iss) < 0) faltas.push('Informe a alíquota de ISS do município.');
  if (!String(entrada.tomador_documento || '').trim()) {
    faltas.push('O cliente desta venda está sem CPF ou CNPJ. A prefeitura exige o documento do tomador.');
  }
  if (!String(entrada.tomador_nome || '').trim()) {
    faltas.push('O cliente desta venda está sem nome.');
  }

  const validade = String(entrada.certificadoValidoAte || '');
  const hoje = entrada.hoje || '';
  if (entrada.temCertificado && validade && hoje && validade < hoje) {
    faltas.push(`O certificado digital venceu em ${validade.split('-').reverse().join('/')}. Envie um novo.`);
  }
  return faltas;
}

/**
 * O que a combinação escolhida tem de incompatível com o emissor.
 *
 * Existe porque emissores recebem campos diferentes. O padrão nacional (DPS)
 * não tem campo de dedução: pedir "valor cheio com o repasse como dedução" e
 * deixar passar faria a nota sair com um número que ninguém escolheu — ou o
 * valor cheio, tributando o repasse, ou a comissão, contrariando o formato
 * configurado. Nos dois casos é dinheiro errado, então isto BLOQUEIA em vez
 * de converter em silêncio.
 */
export function conflitosComEmissor(entrada: {
  regime: RegimeNota;
  forma_base: FormaBaseIntermediacao;
  tem_intermediario: boolean;
  capacidades: {
    deducoes: boolean;
    aliquota_por_nota: boolean;
    intermediario: boolean;
  };
}): string[] {
  const conflitos: string[] = [];
  if (
    entrada.regime === 'INTERMEDIACAO'
    && entrada.forma_base === 'TOTAL_COM_DEDUCAO'
    && !entrada.capacidades.deducoes
  ) {
    conflitos.push(
      'Este emissor não aceita dedução por nota, então não dá para emitir no formato '
      + '"valor cheio com o repasse como dedução". Troque para "nota do valor da comissão".',
    );
  }
  if (entrada.tem_intermediario && !entrada.capacidades.intermediario) {
    conflitos.push(
      'Este emissor não envia o bloco de terceiro intermediador. Ele será ignorado na nota.',
    );
  }
  return conflitos;
}

/**
 * A alíquota informada vira imposto na nota, ou é só estimativa?
 *
 * No padrão nacional quem calcula o ISS é a prefeitura, a partir do código de
 * tributação do prestador. Dizer isso na tela evita que alguém acredite que
 * mudar a alíquota aqui muda o imposto pago.
 */
export function issEhEstimativa(capacidades: { aliquota_por_nota: boolean }): boolean {
  return !capacidades.aliquota_por_nota;
}
