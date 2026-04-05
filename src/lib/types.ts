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
}

export interface CambioItem {
  valor: number;
  moeda: string;
  deadline: string | null;
}

export interface TktFonte {
  nome: string;
  valor_adt: number | null;
  valor_chd: number | null;
  partida_chegada: string;
}

export interface TktTrecho {
  fontes: TktFonte[];
  deadline: string | null;
}

export interface HtlFonte {
  nome: string;
  valor_sgl: number | null;
  valor_dbl: number | null;
  valor_tpl: number | null;
  valor_qdp: number | null;
  valor_chd: number | null;
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
}

export interface HtlHotel {
  fontes: HtlFonte[];
  info: HtlInfo;
}

export interface RecFornecedor {
  nome: string;
  valor_adt: number | null;
  valor_chd: number | null;
  deadline: string | null;
  info: string;
}

export interface RecPasseio {
  nome: string;
  data: string | null;
  fornecedores: RecFornecedor[];
}

export interface CarEmpresa {
  nome: string;
  valor_veiculo: number | null;
  telefone: string;
  email: string;
  contato: string;
  deadline: string | null;
}

export interface CarTransporte {
  origem: string;
  destino: string;
  empresas: CarEmpresa[];
}

export interface GuiaFornecedor {
  nome: string;
  valor_total: number | null;
  telefone: string;
  email: string;
  deadline: string | null;
  anotacoes: string;
}

export interface GuiaDestino {
  fornecedores: GuiaFornecedor[];
  inicio: string | null;
  termino: string | null;
}

export interface SegSeguradora {
  nome: string;
  valor_sgl: number | null;
  valor_dbl: number | null;
  valor_tpl: number | null;
  valor_qdp: number | null;
  deadline: string | null;
  descricao: string;
}

export interface NavioFornecedor {
  nome: string;
  valor_sgl: number | null;
  valor_dbl: number | null;
  valor_tpl: number | null;
  valor_qdp: number | null;
  valor_chd: number | null;
}

export interface IngFonte {
  nome: string;
  valor_adt: number | null;
  valor_chd: number | null;
  valor_inf: number | null;
  valor_meia: number | null;
  info: string;
}

export interface IngAtrativo {
  nome: string;
  data: string | null;
  fontes: IngFonte[];
}

export interface BrindeFornecedor {
  nome: string;
  valor_unidade: number | null;
  descricao: string;
  contato: string;
  deadline: string | null;
  prazo_entrega: string;
}

import { FinanceiroGrupo } from './financial-types';

export interface GrupoViagem {
  id: string;
  grp_id: string;
  origem_destino: string;
  created_at: string;
  updated_at: string;

  periodos: Periodo[];
  trechos: Trecho[];
  navio_info: NavioInfo;
  params: Params;
  cambio: Record<string, CambioItem>;
  links: Record<string, string>;
  descricao_orcamento: string;

  tkt: { trechos: TktTrecho[] };
  htl: { hoteis: HtlHotel[] };
  rec: { passeios: RecPasseio[] };
  car: { transportes: CarTransporte[] };
  guia: { destinos: GuiaDestino[] };
  seg: { seguradoras: SegSeguradora[] };
  navio: { fornecedores: NavioFornecedor[]; deadline: string | null; info_adicional: string };
  ing: { atrativos: IngAtrativo[] };
  brinde: { fornecedores: BrindeFornecedor[] };

  financeiro?: FinanceiroGrupo;
}

export type AbaType = 'inf' | 'tkt' | 'htl' | 'rec' | 'car' | 'guia' | 'seg' | 'navio' | 'ing' | 'brinde' | 'proposta' | 'htl_seg' | 'painel' | 'vendas' | 'recebimentos' | 'fornecedores' | 'fluxo_caixa' | 'dre' | 'indicadores';

export const ABA_LABELS: Record<AbaType, string> = {
  inf: 'Info',
  tkt: 'Aéreo',
  htl: 'Hotel',
  rec: 'Receptivo',
  car: 'Carro',
  guia: 'Guia',
  seg: 'Seguro',
  navio: 'Navio',
  ing: 'Ingresso',
  brinde: 'Brinde',
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

export const SERVICOS = ['tkt', 'htl', 'rec', 'car', 'guia', 'seg', 'navio', 'ing', 'brinde'] as const;

export const MOEDAS = ['BRL', 'USD', 'EUR', 'GBP', 'ARS', 'CLP', 'PEN'] as const;
