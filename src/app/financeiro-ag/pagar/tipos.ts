import type { ContaPagar, LinhaRateio, NaturezaCusto } from '@/lib/crm-types';
import { REPETICAO_PADRAO, type EstadoRepeticao } from '@/lib/recorrencia';
import type { LeituraNoFormulario } from './leitura';
import type { CarimboDoCambio } from '@/lib/cambio';

/** Recorte de período do filtro. Mesmas chaves de sempre. */
export type FiltroPeriodo =
  | 'TODOS' | 'MES_ATUAL' | 'PROX_30D' | 'PROX_90D' | 'VENCIDOS' | 'MES_PASSADO' | 'CUSTOM';

export type FormState = {
  origem: ContaPagar['origem'];
  fornecedor_nome: string;
  descricao: string;
  categoria_id: string;
  valor_original: number;
  moeda: ContaPagar['moeda'];
  cambio: number;
  /** De onde veio o câmbio (sugestão usada ou digitado), guardado na conta (05/11/2026, E6). */
  cambio_carimbo: CarimboDoCambio | null;
  data_vencimento: string;
  /** Emissão (06/11/2026, E7): editável, nunca depois do vencimento. */
  data_emissao: string;
  /** Conta bancária onde se espera pagar (06/11/2026, E7). Vazia = a padrão da agência. */
  conta_previsao_id: string;
  /** Campos que a agência criou para os títulos (06/11/2026, E7). */
  campos_personalizados: Record<string, unknown>;
  forma_pagamento: ContaPagar['forma_pagamento'];
  cartao_id: string;
  natureza_custo: NaturezaCusto | null;
  is_custo_comercial: boolean;
  observacoes: string;
  // Centro, rateio e tags (05/11/2026). Centro único = rateio vazio.
  centro_custo_id: string;
  centro_custo: string;
  rateio: LinhaRateio[];
  tags: string[];
  // Bloco "Repetir" (05/11/2026): Recorrente/Parcelado, quantidade,
  // periodicidade e mais opções. Só na criação; nunca vai para o título.
  repeticao: EstadoRepeticao;
  // "Ler boleto ou nota" (05/11/2026). Vão para o título: o cadastro do
  // fornecedor, o CNPJ lido, os dados de pagamento e o arquivo como anexo.
  fornecedor_id: string;
  fornecedor_cnpj: string;
  numero_documento: string;
  linha_digitavel: string;
  chave_pix: string;
  anexos: Array<{ nome: string; url: string }>;
  // A leitura e a origem de cada campo, só para a tela; nunca vai para o título.
  leitura: LeituraNoFormulario | null;
};

export const EMPTY_FORM: FormState = {
  origem: 'OUTROS',
  fornecedor_nome: '',
  descricao: '',
  categoria_id: '',
  valor_original: 0,
  moeda: 'BRL',
  cambio: 1,
  cambio_carimbo: null,
  data_vencimento: '',
  data_emissao: '',
  conta_previsao_id: '',
  campos_personalizados: {},
  forma_pagamento: '',
  cartao_id: '',
  natureza_custo: null,
  is_custo_comercial: false,
  observacoes: '',
  centro_custo_id: '',
  centro_custo: '',
  rateio: [],
  tags: [],
  repeticao: REPETICAO_PADRAO,
  fornecedor_id: '',
  fornecedor_cnpj: '',
  numero_documento: '',
  linha_digitavel: '',
  chave_pix: '',
  anexos: [],
  leitura: null,
};

/** Erros por campo, espelho das validações de handleSave. Só apresentação. */
export type ErrosDoFormulario = {
  fornecedor: string | null;
  descricao: string | null;
  vencimento: string | null;
  emissao: string | null;
  valor: string | null;
  cambio: string | null;
};

export const SEM_ERRO: ErrosDoFormulario = {
  fornecedor: null,
  descricao: null,
  vencimento: null,
  emissao: null,
  valor: null,
  cambio: null,
};
