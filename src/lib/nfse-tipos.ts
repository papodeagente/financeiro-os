/**
 * Tipos da emissão de NFS-e (nota fiscal de serviço eletrônica).
 *
 * O emitente é a agência: os dados de razão social, CNPJ, inscrição municipal
 * e endereço vêm do cadastro em Configurações › Agência. Aqui ficam só as
 * informações que existem por causa da nota.
 */

/**
 * Como a agência tributa o serviço.
 *
 * INTERMEDIACAO — agenciamento. A agência aproxima o cliente do fornecedor e
 *   ganha comissão. O que o cliente paga para o hotel, a companhia aérea ou a
 *   operadora é REPASSE, não receita da agência: uma viagem de R$ 20.000 com
 *   R$ 16.500 de fornecedores rende R$ 3.500. O ISS incide sobre os R$ 3.500.
 *
 * PRESTACAO_DIRETA — a agência vende serviço próprio (pacote montado por ela,
 *   consultoria, taxa de serviço). O valor inteiro é receita e base do ISS.
 *
 * A escolha não é de gosto: ela muda quanto de ISS a agência paga, e o
 * enquadramento correto depende do contrato com o cliente e da legislação do
 * município. Por isso o padrão fica na configuração e pode ser trocado em
 * cada nota, com os números à vista antes de emitir.
 */
export type RegimeNota = 'INTERMEDIACAO' | 'PRESTACAO_DIRETA';

/**
 * Como a intermediação é escrita na nota. Os dois caminhos chegam à MESMA
 * base de cálculo; o que muda é o que aparece no documento, e municípios
 * diferentes exigem coisas diferentes.
 *
 * VALOR_COMISSAO — a nota sai com o valor da comissão. É o formato mais
 *   comum e o mais simples de conferir.
 *
 * TOTAL_COM_DEDUCAO — a nota sai com o valor cheio e o repasse aos
 *   fornecedores entra como dedução. Alguns municípios exigem esse formato
 *   para aceitar que o ISS não incida sobre o repasse.
 */
export type FormaBaseIntermediacao = 'VALOR_COMISSAO' | 'TOTAL_COM_DEDUCAO';

export type StatusNota =
  | 'RASCUNHO'
  | 'PROCESSANDO'
  | 'AUTORIZADA'
  | 'REJEITADA'
  | 'CANCELADA';

export type AmbienteFiscal = 'HOMOLOGACAO' | 'PRODUCAO';

/** Terceiro que intermediou a operação, quando existe (bloco Intermediario). */
export interface IntermediarioNota {
  cpf_cnpj: string;
  razao_social: string;
  inscricao_municipal: string;
}

/** Certificado digital A1, guardado no gateway — nunca neste banco. */
export interface CertificadoDigital {
  id: string;
  /** Identificador devolvido pelo gateway. É por ele que a nota é assinada. */
  referencia_gateway: string;
  nome_arquivo: string;
  /** CNPJ do titular, como veio do gateway. */
  cnpj: string;
  titular: string;
  /** ISO (YYYY-MM-DD). Vazio quando o gateway não informou. */
  validade_inicio: string;
  validade_fim: string;
  enviado_em: string;
  enviado_por: string;
}

export interface ConfigFiscal {
  id: string;
  /** Gateway de emissão. Hoje só 'plugnotas'; 'simulado' não transmite nada. */
  provedor: 'plugnotas' | 'simulado' | '';
  ambiente: AmbienteFiscal;
  /**
   * Token do gateway. NUNCA volta para o navegador: a API devolve só os
   * últimos dígitos em `token_mascarado`. Gravar vazio mantém o token atual.
   */
  token?: string;
  token_mascarado?: string;
  certificado: CertificadoDigital | null;

  // ---- Enquadramento do serviço ----
  /** Item da lista da LC 116. Agência de viagens costuma ser 9.02. */
  item_lista_servico: string;
  /** Código de tributação do município (varia de prefeitura para prefeitura). */
  codigo_tributacao_municipio: string;
  /** CNAE. Agência de viagens é 7911-2/00. */
  cnae: string;
  /** Alíquota de ISS em %, por exemplo 2 para 2%. */
  aliquota_iss: number;
  /** true quando quem retém o ISS é o tomador. */
  iss_retido_padrao: boolean;
  optante_simples_nacional: boolean;
  incentivador_cultural: boolean;
  natureza_operacao: string;

  // ---- Intermediação ----
  regime_padrao: RegimeNota;
  forma_base_intermediacao: FormaBaseIntermediacao;
  /** Terceiro intermediador fixo, quando a agência sempre opera por um. */
  intermediario_padrao: IntermediarioNota | null;

  // ---- Documento ----
  serie_rps: string;
  /**
   * Texto da discriminação. Aceita {cliente}, {venda}, {parcela},
   * {descricao} e {repasse}.
   */
  discriminacao_padrao: string;
  /** Emitir automaticamente ao confirmar o recebimento, sem passar pelo painel. */
  emissao_automatica: boolean;
}

/** Snapshot do tomador no momento da emissão. A nota não pode mudar depois. */
export interface TomadorNota {
  cpf_cnpj: string;
  razao_social: string;
  email: string;
  inscricao_municipal: string;
  endereco: {
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
  };
}

export interface NotaFiscal {
  id: string;
  /** Conta a receber que originou a nota. É a chave anti-duplicata. */
  conta_receber_id: string;
  venda_id: string;
  cliente_id: string;
  tomador: TomadorNota;

  regime: RegimeNota;
  forma_base: FormaBaseIntermediacao;
  intermediario: IntermediarioNota | null;

  /** Valor que o cliente pagou nesta parcela — a origem de todo o cálculo. */
  valor_recebido: number;
  valor_servicos: number;
  valor_deducoes: number;
  desconto_incondicionado: number;
  base_calculo: number;
  aliquota_iss: number;
  valor_iss: number;
  iss_retido: boolean;
  /** O que a agência recebe depois do ISS retido pelo tomador. */
  valor_liquido: number;

  discriminacao: string;
  item_lista_servico: string;
  codigo_tributacao_municipio: string;
  cnae: string;
  serie_rps: string;

  status: StatusNota;
  ambiente: AmbienteFiscal;
  /** Número da nota na prefeitura, quando autorizada. */
  numero: string;
  codigo_verificacao: string;
  protocolo: string;
  link_pdf: string;
  link_xml: string;
  /** Motivo da rejeição, em texto que o usuário entenda. */
  erro: string;

  emitida_em: string;
  autorizada_em: string;
  cancelada_em: string;
  motivo_cancelamento: string;
  emitida_por: string;
}
