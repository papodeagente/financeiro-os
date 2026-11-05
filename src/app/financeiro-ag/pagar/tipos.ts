import type { ContaPagar, LinhaRateio, NaturezaCusto } from '@/lib/crm-types';
import { REPETICAO_PADRAO, type EstadoRepeticao } from '@/lib/recorrencia';

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
  data_vencimento: string;
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
};

export const EMPTY_FORM: FormState = {
  origem: 'OUTROS',
  fornecedor_nome: '',
  descricao: '',
  categoria_id: '',
  valor_original: 0,
  moeda: 'BRL',
  cambio: 1,
  data_vencimento: '',
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
};

/** Erros por campo, espelho das validações de handleSave. Só apresentação. */
export type ErrosDoFormulario = {
  fornecedor: string | null;
  descricao: string | null;
  vencimento: string | null;
  valor: string | null;
  cambio: string | null;
};

export const SEM_ERRO: ErrosDoFormulario = {
  fornecedor: null,
  descricao: null,
  vencimento: null,
  valor: null,
  cambio: null,
};
