// Grupos OS - Core Types

export interface Periodo {
  check_in: string | null;
  check_out: string | null;
  destino: string;
  hotel: string;
}

export interface Trecho {
  data: string | null;
  qtd_adt: number;
  qtd_chd: number;
}

export interface NavioInfo {
  embarque: string | null;
  desembarque: string | null;
  cidade_embarque: string;
  cidade_desembarque: string;
  nome_cruzeiro: string;
}

export interface Params {
  markup: number;
  contrato: number;
  tx_ad_mp: number;
  tx_boleto: number;
  parcelas: number;
  qtd_min_pax: number;
  qtd_max_pax: number;
  cortesia: number;
  // Em qual tipo de apartamento a(s) vaga(s) de cortesia ficam. Usado
  // só quando GrupoViagem.tipo === 'GRUPO' e cortesia > 0. Default 'dbl'.
  cortesia_apto?: 'sgl' | 'dbl' | 'tpl' | 'qdp';
}

// Passageiros da proposta (mesmo quando não é grupo). Cada linha distingue
// adulto (ADT) ou criança (CHD) com idade 0-12. Usado para calcular o
// preço total por pessoa e gerar proposta detalhada — quando preenchido,
// alimenta automaticamente qtd_min_pax dos cálculos e qtd_adt/qtd_chd
// dos trechos aéreos.
export interface Passageiro {
  id: string;
  tipo: 'ADT' | 'CHD';
  idade?: number; // 0-12, obrigatório quando tipo === 'CHD'
  nome?: string;
}

export interface CambioItem {
  valor: number;
  moeda: string;
  deadline: string | null;
}

export interface TktFonte {
  nome: string;
  // Vincula à entidade fornecedores_crm. Quando preenchido, o sistema
  // sincroniza CNPJ + external_id com o CRM e agrupa por fornecedor
  // no resumo da proposta.
  fornecedor_id?: string;
  valor_adt: number | null;
  valor_chd: number | null;
  partida_chegada: string;
  valor_venda_adt?: number | null;
  valor_venda_chd?: number | null;
}

export interface TktTrecho {
  fontes: TktFonte[];
  deadline: string | null;
}

export interface HtlFonte {
  nome: string;
  fornecedor_id?: string;
  valor_sgl: number | null;
  valor_dbl: number | null;
  valor_tpl: number | null;
  valor_qdp: number | null;
  valor_chd: number | null;
  valor_venda_sgl?: number | null;
  valor_venda_dbl?: number | null;
  valor_venda_tpl?: number | null;
  valor_venda_qdp?: number | null;
  valor_venda_chd?: number | null;
}

export interface HtlInfo {
  deadline: string | null;
  check_in_hora: string;
  check_out_hora: string;
  pensao: string;
  estacionamento: string;
  politica_chd: string;
  politica_free: string;
  info_adicional: string;
  // API-sourced fields for proposta generation
  hotel_imagem?: string;
  hotel_galeria?: string[];
  hotel_estrelas?: number;
  hotel_link?: string;
  hotel_descricao?: string;
  hotel_lat?: number;
  hotel_lng?: number;
  hotel_rating?: number;
  hotel_reviews_count?: number;
  hotel_amenities?: string[];
  hotel_preco_noite?: number;
}

export interface HtlHotel {
  fontes: HtlFonte[];
  info: HtlInfo;
}

export interface RecFornecedor {
  nome: string;
  fornecedor_id?: string;
  valor_adt: number | null;
  valor_chd: number | null;
  deadline: string | null;
  info: string;
  valor_venda_adt?: number | null;
  valor_venda_chd?: number | null;
}

export interface RecPasseio {
  nome: string;
  data: string | null;
  fornecedores: RecFornecedor[];
}

export interface CarEmpresa {
  nome: string;
  fornecedor_id?: string;
  valor_veiculo: number | null;
  telefone: string;
  email: string;
  contato: string;
  deadline: string | null;
  valor_venda_veiculo?: number | null;
}

export interface CarTransporte {
  origem: string;
  destino: string;
  empresas: CarEmpresa[];
}

export interface GuiaFornecedor {
  nome: string;
  fornecedor_id?: string;
  valor_total: number | null;
  telefone: string;
  email: string;
  deadline: string | null;
  anotacoes: string;
  valor_venda_total?: number | null;
}

export interface GuiaDestino {
  fornecedores: GuiaFornecedor[];
  inicio: string | null;
  termino: string | null;
}

export interface SegSeguradora {
  nome: string;
  fornecedor_id?: string;
  valor_sgl: number | null;
  valor_dbl: number | null;
  valor_tpl: number | null;
  valor_qdp: number | null;
  deadline: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  descricao: string;
  valor_venda_sgl?: number | null;
  valor_venda_dbl?: number | null;
  valor_venda_tpl?: number | null;
  valor_venda_qdp?: number | null;
}

export interface NavioFornecedor {
  nome: string;
  fornecedor_id?: string;
  valor_sgl: number | null;
  valor_dbl: number | null;
  valor_tpl: number | null;
  valor_qdp: number | null;
  valor_chd: number | null;
  valor_venda_sgl?: number | null;
  valor_venda_dbl?: number | null;
  valor_venda_tpl?: number | null;
  valor_venda_qdp?: number | null;
  valor_venda_chd?: number | null;
}

export interface IngFonte {
  nome: string;
  fornecedor_id?: string;
  valor_adt: number | null;
  valor_chd: number | null;
  valor_inf: number | null;
  valor_meia: number | null;
  info: string;
  valor_venda_adt?: number | null;
  valor_venda_chd?: number | null;
  valor_venda_inf?: number | null;
  valor_venda_meia?: number | null;
}

export interface IngAtrativo {
  nome: string;
  data: string | null;
  fontes: IngFonte[];
}

export interface BrindeFornecedor {
  nome: string;
  fornecedor_id?: string;
  valor_unidade: number | null;
  descricao: string;
  contato: string;
  deadline: string | null;
  prazo_entrega: string;
  valor_venda_unidade?: number | null;
}

export interface DivulgacaoFornecedor {
  nome: string;
  fornecedor_id?: string;
  valor_total: number | null;
  canal: string;
  descricao: string;
  contato: string;
  deadline: string | null;
  periodo: string;
  valor_venda_total?: number | null;
}

import { FinanceiroGrupo } from './financial-types';

// 4 estagios do fluxo (PRODUTO/PROPOSTA no Entur OS, ORCAMENTO/VENDA no CRM).
// 'RESERVA' aceito apenas para retrocompatibilidade — registros legados sao
// tratados como ORCAMENTO na UI ao serem abertos.
export type StatusPipeline = 'PRODUTO' | 'PROPOSTA' | 'ORCAMENTO' | 'VENDA' | 'RESERVA';

// Três tipos de produto que a agência opera:
//
// 'GRUPO'     — viagem em grupo (vários pax). Libera SGL/DBL/TPL/QDP/CHD
//               com cortesia e detalhamento por fornecedor em cada
//               categoria (Aéreo/Hotel/Receptivo/etc.).
//
// 'PROPOSTA'  — produto personalizado (cotação pontual). Mesmo motor
//               de SGL/DBL/etc. mas geralmente 1 pax. Label público:
//               "Personalizado". Mantido como 'PROPOSTA' no banco por
//               retrocompat com registros existentes.
//
// 'OPERADORA' — pacote pronto de fornecedor único (operadora terceira).
//               NÃO abre precificação por item — apenas lista descritiva
//               do que está incluso + 3 campos finais (custo/venda/margem).
//
// Default 'GRUPO' para compatibilidade com registros legados.
export type TipoProduto = 'GRUPO' | 'PROPOSTA' | 'OPERADORA';

export const TIPO_PRODUTO_LABEL: Record<TipoProduto, string> = {
  GRUPO: 'Grupo',
  PROPOSTA: 'Personalizado',
  OPERADORA: 'Operadora',
};

// Item descritivo de um pacote OPERADORA.
// SEM precificação — pacote tem preço único no final.
export type ItemPacoteTipo =
  | 'AEREO' | 'HOTEL' | 'TRANSFER' | 'RECEPTIVO' | 'PASSEIO'
  | 'CRUZEIRO' | 'INGRESSO' | 'SEGURO' | 'GUIA' | 'OUTROS';

export const ITEM_PACOTE_LABEL: Record<ItemPacoteTipo, string> = {
  AEREO: 'Aéreo',
  HOTEL: 'Hotel',
  TRANSFER: 'Transfer',
  RECEPTIVO: 'Receptivo',
  PASSEIO: 'Passeio',
  CRUZEIRO: 'Cruzeiro',
  INGRESSO: 'Ingresso',
  SEGURO: 'Seguro',
  GUIA: 'Guia',
  OUTROS: 'Outros',
};

export interface ItemPacote {
  id: string;
  tipo: ItemPacoteTipo;
  descricao: string;
  quantidade: number;
  exibir_na_proposta: boolean;       // se sai na proposta visual do cliente
  valor_individual?: number;         // opcional — só pra exibir, não soma
  observacoes?: string;
}

export interface OperadoraData {
  fornecedor_id?: string;
  fornecedor_nome?: string;
  itens: ItemPacote[];
  valor_custo: number;               // total pago à operadora
  valor_venda: number;               // total cobrado do cliente
  observacoes_gerais?: string;
}

export interface GrupoViagem {
  id: string;
  grp_id: string;
  origem_destino: string;
  created_at: string;
  updated_at: string;
  tipo?: TipoProduto;

  // Pipeline
  status_pipeline: StatusPipeline;
  proposta_id: string | null;
  orcamento_id: string | null;
  venda_crm_id: string | null;

  tarifas_ativas: ('sgl' | 'dbl' | 'tpl' | 'qdp')[];
  // Moeda em que o produto é precificado. Quando definida, a proposta
  // final é apresentada nessa moeda sem conversão de câmbio (cambio
  // por serviço deixou de ser editável na UI). Default 'BRL' nos defaults.
  moeda?: typeof MOEDAS[number];
  periodos: Periodo[];
  trechos: Trecho[];
  navio_info: NavioInfo;
  params: Params;
  // Lista de passageiros da proposta (ADT/CHD + idade 0-12). Opcional —
  // quando vazio, qtd_min_pax e qtd_adt/qtd_chd dos trechos são editados
  // manualmente. Quando preenchido, é a fonte de verdade.
  passageiros?: Passageiro[];
  cambio: Record<string, CambioItem>;
  links: Record<string, string>;
  descricao_orcamento: string;

  // Pacote da operadora (preenchido só quando tipo === 'OPERADORA').
  // Tipos GRUPO/PROPOSTA seguem usando tkt/htl/rec/car/etc.
  operadora?: OperadoraData;

  tkt: { trechos: TktTrecho[] };
  htl: { hoteis: HtlHotel[] };
  rec: { passeios: RecPasseio[] };
  car: { transportes: CarTransporte[] };
  guia: { destinos: GuiaDestino[] };
  seg: { seguradoras: SegSeguradora[] };
  navio: { fornecedores: NavioFornecedor[]; deadline: string | null; info_adicional: string };
  ing: { atrativos: IngAtrativo[] };
  brinde: { fornecedores: BrindeFornecedor[] };
  divulgacao: { fornecedores: DivulgacaoFornecedor[] };

  financeiro?: FinanceiroGrupo;
}

export type AbaType = 'pipeline' | 'inf' | 'pacote' | 'tkt' | 'htl' | 'rec' | 'car' | 'guia' | 'seg' | 'navio' | 'ing' | 'brinde' | 'divulgacao' | 'proposta' | 'htl_seg' | 'painel' | 'vendas' | 'recebimentos' | 'fornecedores' | 'fluxo_caixa' | 'dre' | 'indicadores';

export const ABA_LABELS: Record<AbaType, string> = {
  pipeline: 'Pipeline',
  inf: 'Info',
  pacote: 'Pacote',
  tkt: 'Aéreo',
  htl: 'Hotel',
  rec: 'Receptivo',
  car: 'Carro',
  guia: 'Guia',
  seg: 'Seguro',
  navio: 'Navio',
  ing: 'Ingresso',
  brinde: 'Brinde',
  divulgacao: 'Divulgação',
  proposta: 'Proposta',
  htl_seg: 'HTL+SEG',
  painel: 'PAINEL',
  vendas: 'VENDAS',
  recebimentos: 'RECEBIM.',
  fornecedores: 'FORNEC.',
  fluxo_caixa: 'FLUXO CX',
  dre: 'DRE',
  indicadores: 'INDICAD.',
};

export const TKT_FONTES = [
  'Direto CIA', 'Consolidadora 1', 'Consolidadora 2', 'Consolidadora 3',
  'Consolidadora 4', 'Consolidadora 5', 'Decolar', '123 Milhas', 'Skyscanner',
];

export const HTL_FONTES = [
  'Direto HTL', 'Fornecedor 1', 'Fornecedor 2', 'Fornecedor 3',
  'Fornecedor 4', 'Fornecedor 5', 'Fornecedor 6', 'Fornecedor 7',
  'Fornecedor 8', 'Decolar', 'Trivago', 'Booking',
];

export const SERVICOS = ['tkt', 'htl', 'rec', 'car', 'guia', 'seg', 'navio', 'ing', 'brinde', 'divulgacao'] as const;

export const MOEDAS = ['BRL', 'USD', 'EUR', 'GBP', 'ARS', 'CLP', 'PEN'] as const;
