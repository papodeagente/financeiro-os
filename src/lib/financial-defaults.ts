import { FinanceiroGrupo, FinanceiroConfig } from './financial-types';

export function createFinanceiroConfig(): FinanceiroConfig {
  return {
    aliquota_imposto: 6,
    custos_administrativos: 0,
    taxa_conversao_estimada: 30,
    perc_entrada_htl_seg: 10,
  };
}

export function createFinanceiroGrupo(): FinanceiroGrupo {
  return {
    vendas: [],
    parcelas: [],
    pagamentos_fornecedores: [],
    config: createFinanceiroConfig(),
    custos_extras: [],
    notas: [],
  };
}
