/**
 * Integração com plataformas de venda e recebimento.
 *
 * O domínio conhece `plataforma: string` como opaco. Nenhuma regra de
 * negócio, rota ou tela pergunta "é Hotmart?": toda diferença vive dentro
 * do adapter. É isso que permite acrescentar a quarta plataforma sem
 * reabrir o financeiro.
 *
 * O contrato tem duas metades e elas não se misturam:
 *
 * - `EventoNormalizado` é o que ACONTECEU (um aviso, um momento).
 * - `TransacaoNormalizada` é o ESTADO ATUAL da venda na plataforma, com
 *   todas as parcelas. Webhook e importação por API produzem a mesma
 *   coisa, e é isso que permite reprocessar o histórico sem inventar um
 *   segundo caminho de escrita no financeiro.
 */

export type PlataformaId = 'hotmart' | 'asaas' | 'pagarme';

/** O que aconteceu, no vocabulário do financeiro e não no da plataforma. */
export type TipoEventoPlataforma =
  /** Cobrança criada. Nasce a conta a receber, ainda sem dinheiro. */
  | 'PAGAMENTO_CRIADO'
  /** Pago pelo comprador. O dinheiro é certo, mas pode não estar liberado. */
  | 'PAGAMENTO_CONFIRMADO'
  /** Liquidado: caiu na conta. É aqui, e só aqui, que o caixa se move. */
  | 'PAGAMENTO_RECEBIDO'
  /** Venceu sem pagamento. */
  | 'PAGAMENTO_ATRASADO'
  /** Cobrança cancelada antes de pagar. Não é estorno: não houve dinheiro. */
  | 'PAGAMENTO_CANCELADO'
  /** Dinheiro voltou por decisão do vendedor ou do comprador. */
  | 'REEMBOLSO'
  /** Comprador contestou no cartão. Mesmo efeito de caixa, motivo diferente. */
  | 'CHARGEBACK'
  /** A plataforma antecipou o repasse: muda a data prevista, não o valor devido. */
  | 'ANTECIPACAO'
  /** Chegou, é válido, e não interessa ao financeiro. Responde 200 e para. */
  | 'IGNORADO';

/** Estado de uma parcela. É o que a tela e o DRE leem. */
export type StatusParcelaPlataforma =
  | 'PENDENTE'
  | 'CONFIRMADO'
  | 'RECEBIDO'
  | 'ATRASADO'
  | 'CANCELADO'
  | 'ESTORNADO'
  | 'CHARGEBACK';

/** Estados em que a parcela representa dinheiro que ainda vai entrar. */
export const STATUS_A_RECEBER: readonly StatusParcelaPlataforma[] = ['PENDENTE', 'CONFIRMADO', 'ATRASADO'];
/** Estados em que a parcela já não vale nada: não entra em receita nem em previsão. */
export const STATUS_MORTO: readonly StatusParcelaPlataforma[] = ['CANCELADO', 'ESTORNADO', 'CHARGEBACK'];

export interface CompradorNormalizado {
  nome: string;
  email: string;
  documento: string;
  telefone: string;
}

export interface ItemNormalizado {
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  /** Id do produto NA PLATAFORMA, quando existe. Serve de filtro e de chave. */
  id_externo: string;
}

/**
 * Uma parcela da venda.
 *
 * Invariante de dinheiro: a soma de `valor_bruto` das parcelas é igual ao
 * bruto da transação. Quem monta parcela usa `ratearTotal`, nunca divide
 * na mão: centavo perdido em divisão é a origem clássica de conta a
 * receber que nunca fecha.
 */
export interface ParcelaNormalizada {
  numero: number;
  total: number;
  /** Id da parcela na plataforma (cobrança), quando ela tem um. */
  id_externo: string;
  valor_bruto: number;
  /** Taxa da plataforma NESTA parcela. Vira despesa, nunca desconta o bruto. */
  valor_taxa: number;
  /** O que a plataforma promete depositar desta parcela. */
  valor_liquido: number;
  /** Desconto concedido ao comprador. */
  desconto: number;
  /** Juros e multa cobrados do comprador por atraso. */
  juros: number;
  status: StatusParcelaPlataforma;
  /** Data civil 'YYYY-MM-DD' em que a parcela vence. */
  data_vencimento: string;
  /** Quando a plataforma promete liberar o dinheiro. Antecipação muda isto. */
  data_prevista_recebimento: string;
  /** Quando o comprador pagou. Vazio enquanto não pagou. */
  data_pagamento: string;
  /** Quando o dinheiro caiu na conta. Vazio enquanto não liquidou. */
  data_recebimento: string;
  /** Preenchido quando a parcela foi antecipada pela plataforma. */
  antecipada: boolean;
}

/**
 * O estado atual de uma venda na plataforma.
 *
 * É o que o financeiro consome. Webhook e importação por API constroem
 * este mesmo objeto: um caminho de escrita só.
 */
export interface TransacaoNormalizada {
  /** Id da transação/pedido na plataforma. Chave natural junto do tenant. */
  id_transacao: string;
  /** Id da assinatura, quando a venda é recorrente. */
  id_assinatura: string;
  comprador: CompradorNormalizado;
  itens: ItemNormalizado[];
  /** Bruto que o comprador se comprometeu a pagar, somando as parcelas. */
  valor_bruto: number;
  valor_taxa: number;
  valor_liquido: number;
  desconto: number;
  juros: number;
  moeda: string;
  forma_pagamento: string;
  /** Bandeira do cartão, chave Pix, "boleto"... o que a plataforma informar. */
  detalhe_pagamento: string;
  parcelas: ParcelaNormalizada[];
  /** Data civil da venda (criação do pedido), não do pagamento. */
  data_venda: string;
  descricao: string;
  /** Payload cru, para auditoria e reprocessamento. */
  bruto: unknown;
}

/** Evento já traduzido: o que mudou, e o retrato completo depois da mudança. */
export interface EventoNormalizado {
  tipo: TipoEventoPlataforma;
  /** Id do evento NA PLATAFORMA. É a chave de idempotência: reenvio do
   *  mesmo evento não pode gerar segunda venda. */
  id_externo: string;
  transacao: TransacaoNormalizada;
  /** Quando o evento fala de UMA parcela (a 3ª venceu, a 2ª foi paga),
   *  o número dela. Zero quando o evento vale para a transação toda. */
  parcela_afetada: number;
}

export interface ResultadoVerificacao {
  valido: boolean;
  /** Por que recusou. Vai para o log e para a tela de diagnóstico, nunca
   *  para a resposta do webhook: quem forja não recebe dica. */
  motivo: string;
}

export interface CredenciaisPlataforma {
  api_key: string;
  segredo_webhook: string;
  extras: Record<string, string>;
}

export interface CampoCredencial {
  chave: string;
  rotulo: string;
  tipo: 'texto' | 'segredo';
  obrigatorio: boolean;
  ajuda: string;
}

export interface CapacidadesPlataforma {
  assinaturaNoCorpo: boolean;
  /** Precisa consultar a API para completar o evento. */
  exigeConsultaExtra: boolean;
  informaTaxa: boolean;
  informaPrevisaoDeRepasse: boolean;
  /** Dá para importar o histórico por API (backfill e ressincronização). */
  permiteImportacao: boolean;
}

export interface PeriodoImportacao {
  /** Data civil 'YYYY-MM-DD', inclusive. */
  de: string;
  /** Data civil 'YYYY-MM-DD', inclusive. */
  ate: string;
}

export interface AdapterPlataforma {
  readonly id: PlataformaId;
  readonly nome: string;
  readonly capacidades: CapacidadesPlataforma;

  camposCredencial(): CampoCredencial[];

  /**
   * O evento veio mesmo da plataforma?
   *
   * Recebe o corpo CRU, em texto, porque assinatura se confere sobre os
   * bytes recebidos: reserializar o JSON muda espaços e quebra a conta.
   */
  verificar(
    corpoCru: string,
    cabecalhos: Record<string, string>,
    cred: CredenciaisPlataforma,
  ): Promise<ResultadoVerificacao>;

  normalizar(corpo: unknown, cred: CredenciaisPlataforma): Promise<EventoNormalizado>;

  /** Chamada de teste no cadastro, para o erro aparecer na configuração e
   *  não na primeira venda de verdade. */
  testarCredencial(cred: CredenciaisPlataforma): Promise<{ ok: true; conta: string }>;

  /**
   * Importa o que aconteceu no período, para trazer histórico e para
   * fechar buraco de webhook perdido. Devolve o estado ATUAL de cada
   * transação, não o histórico de avisos.
   */
  importar?(cred: CredenciaisPlataforma, periodo: PeriodoImportacao): Promise<TransacaoNormalizada[]>;
}
