/**
 * Cobrança pelo Asaas ou Pagar.me da própria agência (E3, 05/11/2026).
 *
 * O resto do financeiro conhece `AdapterCobranca` e nada mais: nenhuma rota
 * ou tela pergunta "é Asaas?". O que cada provedor faz ou não faz está em
 * `capacidades`, e a tela lê de lá o que oferecer (Boleto com Pix e Carnê só
 * onde existem). Prometer o que o provedor não faz é o erro que este
 * contrato existe para evitar.
 *
 * Dinheiro aqui é sempre em CENTAVOS inteiros (o Pagar.me fala em centavos,
 * o Asaas em reais: a conversão mora dentro de cada adapter).
 */

export type ProvedorCobranca = 'asaas' | 'pagarme';

export const PROVEDORES_COBRANCA: readonly ProvedorCobranca[] = ['asaas', 'pagarme'];

export function ehProvedorCobranca(v: unknown): v is ProvedorCobranca {
  return v === 'asaas' || v === 'pagarme';
}

/** O que o cliente recebe para pagar. */
export type TipoCobranca = 'boleto' | 'pix' | 'boleto_pix' | 'link' | 'carne';
/** Os tipos que nascem de uma emissão simples (carnê e link têm caminho próprio). */
export type TipoEmissao = 'boleto' | 'pix' | 'boleto_pix';

export type StatusCobranca = 'emitindo' | 'aberta' | 'vencida' | 'paga' | 'cancelada' | 'estornada' | 'falhou';

/** Situações em que a conta tem uma cobrança valendo (uma só por conta). */
export const STATUS_EM_ABERTO: readonly StatusCobranca[] = ['emitindo', 'aberta', 'vencida'];

export interface CapacidadesCobranca {
  boleto: boolean;
  pix: boolean;
  /** O mesmo documento traz o boleto e o QR do Pix. */
  boletoComPix: boolean;
  carne: boolean;
  /** Juros e multa por atraso enviados ao provedor. */
  jurosMulta: boolean;
  /** Desconto por pagamento adiantado enviado ao provedor. */
  desconto: boolean;
  link: boolean;
  /** Devolver um Pix já pago pela API. */
  estornoPix: boolean;
  /** Mudar o valor de uma cobrança já emitida (senão: cancela e emite outra). */
  alterarValor: boolean;
  /** Mudar o vencimento de uma cobrança já emitida (senão: cancela e emite outra). */
  alterarVencimento: boolean;
  /** Mudar o vencimento de um Pix já emitido (senão: cancela e emite outro). */
  alterarVencimentoPix: boolean;
  /**
   * O provedor avisa à parte quando o dinheiro fica disponível. Quando avisa,
   * a baixa espera esse aviso (o caixa só se move quando o dinheiro cai);
   * quando não avisa, a baixa acontece no aviso de pagamento.
   */
  avisaCredito: boolean;
  /** Frases curtas para a tela explicar o que muda neste provedor. */
  observacoes: string[];
}

export interface EnderecoDoCliente {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
}

/** O pagador, lido do cadastro de clientes do financeiro. */
export interface ClienteDaCobranca {
  /** Id no financeiro (vai como referência do cliente no provedor). */
  id: string;
  nome: string;
  /** Só dígitos. */
  documento: string;
  email: string;
  /** Só dígitos, com DDD. */
  telefone: string;
  endereco: EnderecoDoCliente | null;
}

/** Juros, multa e desconto que vão no documento (todos em %). */
export interface EncargosDaCobranca {
  juros_am_pct: number;
  multa_pct: number;
  /** Dias depois do vencimento sem cobrar nada (só onde o provedor aceita). */
  tolerancia_dias: number;
  desconto: { pct: number; dias: number } | null;
}

export interface PedidoDeCobranca {
  /** Referência própria `f1;<agência>;<cobrança>`, gravada no provedor. */
  referencia: string;
  tipo: TipoEmissao;
  valor_centavos: number;
  /** AAAA-MM-DD. */
  vencimento: string;
  descricao: string;
  encargos: EncargosDaCobranca | null;
}

/** A cobrança como o provedor a vê, já no nosso vocabulário. */
export interface CobrancaNoProvedor {
  id_externo: string;
  status: StatusCobranca;
  valor_centavos: number;
  vencimento: string;
  referencia: string;
  /** Id do parcelamento (carnê) a que pertence, quando pertence. */
  id_carne: string;
  numero_parcela: number;
  url_boleto: string;
  url_fatura: string;
  bruto: unknown;
}

export interface DadosDePagamento {
  linha_digitavel: string;
  codigo_barras: string;
  pix_copia_cola: string;
  /** Imagem do QR do Pix, quando o provedor dá um endereço para ela. */
  pix_qrcode_url: string;
  url_boleto: string;
  url_fatura: string;
}

export interface PedidoDeCarne {
  referencia: string;
  /** Valor de CADA parcela (todas iguais). */
  valor_parcela_centavos: number;
  parcelas: number;
  /** Vencimento da primeira; as outras no mesmo dia dos meses seguintes. */
  primeiro_vencimento: string;
  descricao: string;
  encargos: EncargosDaCobranca | null;
}

export interface CarneNoProvedor {
  id_externo: string;
  parcelas: CobrancaNoProvedor[];
}

export interface PedidoDeLink {
  referencia: string;
  nome: string;
  descricao: string;
  valor_centavos: number;
  /** Até quando o link aceita pagamento (AAAA-MM-DD). */
  vence_em: string;
}

export interface LinkNoProvedor {
  id_externo: string;
  url: string;
}

export interface MudancaDeCobranca {
  valor_centavos?: number;
  vencimento?: string;
}

export interface AdapterCobranca {
  readonly provedor: ProvedorCobranca;
  readonly nome: string;
  readonly capacidades: CapacidadesCobranca;

  /** Id do pagador no provedor. Procura antes de criar (o provedor aceita duplicado). */
  acharOuCriarCliente(cliente: ClienteDaCobranca): Promise<string>;
  emitir(clienteExterno: string, cliente: ClienteDaCobranca, pedido: PedidoDeCobranca): Promise<CobrancaNoProvedor>;
  consultar(idExterno: string): Promise<CobrancaNoProvedor | null>;
  /** Antes de repetir uma emissão interrompida: o provedor já criou? */
  consultarPorReferencia(referencia: string): Promise<CobrancaNoProvedor | null>;
  dadosDePagamento(cobranca: CobrancaNoProvedor, tipo: TipoCobranca): Promise<DadosDePagamento>;
  /** 2ª via: novo valor e/ou vencimento. */
  alterar(idExterno: string, mudanca: MudancaDeCobranca, atual: PedidoDeCobranca): Promise<CobrancaNoProvedor>;
  cancelar(idExterno: string): Promise<void>;
  /** Devolve um pagamento já feito (Pix). */
  estornar?(idExterno: string, valorCentavos: number | null, motivo: string): Promise<void>;
  emitirCarne?(clienteExterno: string, cliente: ClienteDaCobranca, pedido: PedidoDeCarne): Promise<CarneNoProvedor>;
  consultarCarnePorReferencia?(referencia: string): Promise<CarneNoProvedor | null>;
  pdfDoCarne?(idCarne: string): Promise<{ conteudo: ArrayBuffer; tipo: string }>;
  criarLink?(pedido: PedidoDeLink): Promise<LinkNoProvedor>;
}

/**
 * Falha ao falar com o provedor. O `tipo` decide o que a fila faz:
 * - `recusa`: o provedor disse não (dado errado). Repetir não muda nada:
 *   a cobrança fica como "falhou", com a frase do provedor.
 * - `credencial`: chave recusada. Também não adianta repetir.
 * - `timeout` / `rede` / `servidor` / `limite`: passageiro. Volta para a
 *   fila, conta no disjuntor da agência × provedor, e a próxima tentativa
 *   consulta pela referência antes de criar de novo.
 */
export type TipoErroProvedor = 'recusa' | 'credencial' | 'timeout' | 'rede' | 'servidor' | 'limite' | 'nao_encontrado';

export class ErroProvedor extends Error {
  readonly tipo: TipoErroProvedor;
  readonly status: number | null;
  /** Segundos até o provedor liberar de novo (429 com RateLimit-Reset). */
  readonly esperarSegundos: number | null;
  constructor(tipo: TipoErroProvedor, mensagem: string, status: number | null = null, esperarSegundos: number | null = null) {
    super(mensagem);
    this.name = 'ErroProvedor';
    this.tipo = tipo;
    this.status = status;
    this.esperarSegundos = esperarSegundos;
  }

  /** Vale tentar de novo mais tarde? */
  get passageiro(): boolean {
    return this.tipo === 'timeout' || this.tipo === 'rede' || this.tipo === 'servidor' || this.tipo === 'limite';
  }
}

/**
 * Códigos que a tela entende (src/lib/cobranca/contrato-telas.ts, parte B):
 * com eles a tela explica sem mostrar a mensagem crua.
 */
export type CodigoErroCobranca =
  | 'SEM_PROVEDOR' | 'PROVEDOR_DESLIGADO' | 'CREDENCIAL_INVALIDA' | 'PROVEDOR_FORA' | 'LIMITE_DO_PROVEDOR'
  | 'CLIENTE_SEM_DOCUMENTO' | 'CLIENTE_SEM_CONTATO' | 'VALOR_MINIMO' | 'VENCIMENTO_INVALIDO'
  | 'JA_TEM_COBRANCA' | 'CONTA_QUITADA' | 'CONTA_CANCELADA' | 'SEM_CARNE' | 'NADA_SAI' | 'ASSINATURA_VENCIDA'
  | 'SEM_PERMISSAO';

/** Erro de regra do nosso lado, com o status HTTP que a rota devolve. */
export class ErroCobranca extends Error {
  readonly status: number;
  readonly codigo: CodigoErroCobranca | null;
  constructor(mensagem: string, status = 400, codigo: CodigoErroCobranca | null = null) {
    super(mensagem);
    this.name = 'ErroCobranca';
    this.status = status;
    this.codigo = codigo;
  }
}
