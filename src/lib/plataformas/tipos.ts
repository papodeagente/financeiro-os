/**
 * Integração com plataformas de venda e recebimento.
 *
 * O domínio conhece `plataforma: string` como opaco. Nenhuma regra de
 * negócio, rota ou tela pergunta "é Hotmart?": toda diferença vive dentro
 * do adapter. É isso que permite acrescentar a quarta plataforma sem
 * reabrir o financeiro.
 */

export type PlataformaId = 'hotmart' | 'asaas' | 'pagarme';

/** O que aconteceu, no vocabulário do financeiro e não no da plataforma. */
export type TipoEventoPlataforma =
  /** Dinheiro entrou. Gera venda e conta a receber já recebida. */
  | 'PAGAMENTO_CONFIRMADO'
  /** Dinheiro voltou. Estorna o que foi gerado. */
  | 'REEMBOLSO'
  /** Comprador contestou. Mesmo efeito de estorno, motivo diferente. */
  | 'CHARGEBACK'
  /** Chegou, é válido, e não interessa ao financeiro. Responde 200 e para. */
  | 'IGNORADO';

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
}

/** Evento já traduzido. Daqui para a frente o financeiro não sabe de qual
 *  plataforma veio. */
export interface EventoNormalizado {
  tipo: TipoEventoPlataforma;
  /** Id do evento NA PLATAFORMA. É a chave de idempotência: reenvio do
   *  mesmo evento não pode gerar segunda venda. */
  id_externo: string;
  /** Id da transação, para casar estorno com a venda original. */
  id_transacao: string;
  comprador: CompradorNormalizado;
  itens: ItemNormalizado[];
  /** Valor bruto que o comprador pagou. */
  valor_bruto: number;
  /** Taxa da plataforma. Vira despesa, nunca é descontada do bruto: o DRE
   *  precisa ver receita cheia e custo de adquirência separados. */
  valor_taxa: number;
  /** O que a plataforma promete depositar. */
  valor_liquido: number;
  moeda: string;
  /** Data civil do pagamento, 'YYYY-MM-DD'. */
  data_pagamento: string;
  /** Data civil em que o dinheiro cai na conta, quando a plataforma diz. */
  data_prevista_recebimento: string;
  forma_pagamento: string;
  parcelas: number;
  descricao: string;
  /** Payload cru, para auditoria e reprocessamento. */
  bruto: unknown;
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
}
