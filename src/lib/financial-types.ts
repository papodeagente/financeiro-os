// Grupos OS - Financial Module Types

export type TipoApto = 'SGL' | 'DBL' | 'TPL' | 'QDP';
export type TipoPax = 'ADT' | 'CHD';
export type FormaPagamento = 'AVISTA_PIX' | 'CARTAO' | 'BOLETO';
export type StatusVenda = 'RESERVADO' | 'CONFIRMADO' | 'CANCELADO';
export type StatusParcela = 'PENDENTE' | 'RECEBIDO' | 'ATRASADO' | 'CANCELADO';
export type StatusFornecedor = 'PENDENTE' | 'PARCIAL' | 'PAGO' | 'CANCELADO' | 'VENCIDO';
export type CategoriaFornecedor = 'TKT' | 'HTL' | 'REC' | 'CAR' | 'GUIA' | 'SEG' | 'NAVIO' | 'ING' | 'BRINDE' | 'OUTRO';
export type TipoCusto = 'POR_PAX' | 'POR_APTO' | 'POR_CABINE' | 'FIXO_GRUPO' | 'POR_VEICULO';

export interface Passageiro {
  nome: string;
  tipo: TipoPax;
  documento: string;
  data_nascimento: string;
}

export interface ChdExtra {
  nome: string;
  documento: string;
  data_nascimento: string;
  forma_pagamento: FormaPagamento;
  valor: number;
  desconto: number;
  valor_final: number;
}

export interface Venda {
  id: string;
  data_venda: string;
  cliente_nome: string;
  cliente_cpf: string;
  cliente_telefone: string;
  cliente_email: string;
  tipo_apto: TipoApto;
  passageiros: Passageiro[];
  forma_pagamento: FormaPagamento;
  valor_total_apto: number;
  desconto_concedido: number;
  valor_final: number;
  qtd_parcelas: number;
  valor_parcela: number;
  chds_extras: ChdExtra[];
  status: StatusVenda;
  observacoes: string;
  vendedor: string;
  is_cortesia: boolean;
}

export interface Parcela {
  id: string;
  venda_id: string;
  cliente_nome: string;
  numero_parcela: number;
  total_parcelas: number;
  data_vencimento: string;
  valor: number;
  status: StatusParcela;
  data_recebimento: string | null;
  valor_recebido: number | null;
  forma_recebimento: string | null;
  observacoes: string;
}

export interface ParcelaFornecedor {
  numero: number;
  valor: number;
  vencimento: string;
  status: 'PENDENTE' | 'PAGO' | 'VENCIDO';
  data_pagamento: string | null;
}

export interface DadosBancarios {
  banco: string;
  agencia: string;
  conta: string;
  pix: string;
  titular: string;
  cnpj: string;
}

export interface PagamentoFornecedor {
  id: string;
  categoria: CategoriaFornecedor;
  fornecedor_nome: string;
  descricao: string;
  valor_cotado: number;
  valor_negociado: number;
  valor_pago: number;
  moeda: 'BRL' | 'USD' | 'EUR';
  cambio_cotacao: number;
  cambio_pagamento: number | null;
  valor_brl_cotado: number;
  valor_brl_pago: number;
  deadline: string | null;
  data_vencimento: string | null;
  data_pagamento: string | null;
  tipo_custo: TipoCusto;
  quantidade: number;
  valor_unitario: number;
  status: StatusFornecedor;
  forma_pagamento: string | null;
  comprovante: string | null;
  parcelas_fornecedor: ParcelaFornecedor[];
  contato_nome: string;
  contato_telefone: string;
  contato_email: string;
  dados_bancarios: DadosBancarios;
  observacoes: string;
}

export interface CustoExtra {
  id: string;
  descricao: string;
  valor: number;
  data: string;
  categoria: string;
}

export interface NotaFinanceira {
  id: string;
  data: string;
  texto: string;
  prioridade: 'NORMAL' | 'URGENTE';
}

export interface FinanceiroConfig {
  aliquota_imposto: number;
  custos_administrativos: number;
  taxa_conversao_estimada: number;
  perc_entrada_htl_seg: number;
}

export interface FinanceiroGrupo {
  vendas: Venda[];
  parcelas: Parcela[];
  pagamentos_fornecedores: PagamentoFornecedor[];
  config: FinanceiroConfig;
  custos_extras: CustoExtra[];
  notas: NotaFinanceira[];
}

export type AbaFinanceiraType = 'painel' | 'vendas' | 'recebimentos' | 'fornecedores' | 'fluxo_caixa' | 'dre' | 'indicadores';

export const ABA_FINANCEIRA_LABELS: Record<AbaFinanceiraType, string> = {
  painel: 'PAINEL',
  vendas: 'VENDAS',
  recebimentos: 'RECEBIM.',
  fornecedores: 'FORNEC.',
  fluxo_caixa: 'FLUXO CX',
  dre: 'DRE',
  indicadores: 'INDICAD.',
};

export const PAX_PER_APTO: Record<TipoApto, number> = { SGL: 1, DBL: 2, TPL: 3, QDP: 4 };
