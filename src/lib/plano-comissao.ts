import type { PlanoComissao, TipoBaseComissao } from './crm-types';

export const ROTULOS_BASE_COMISSAO: Record<TipoBaseComissao, string> = {
  RECEITA_AGENCIA: 'Receita da Agência (Comissão)',
  MARKUP: 'Markup (Venda - Custo)',
  VALOR_VENDA: 'Valor Total da Venda',
  COMISSAO_FORNECEDOR: 'Comissão do Fornecedor',
  LUCRO: 'Lucro Líquido',
  MRR_GERADO: 'MRR gerado',
};

const BASES = new Set<TipoBaseComissao>(Object.keys(ROTULOS_BASE_COMISSAO) as TipoBaseComissao[]);

export function planoUsaMrr(plano: Pick<PlanoComissao, 'base_calculo'> | null | undefined): boolean {
  return plano?.base_calculo === 'MRR_GERADO';
}

/**
 * A base MRR é exclusiva da conta do ecossistema. A interface esconde a
 * opção das agências, mas esta validação também protege POST e PUT diretos.
 */
export function validarBaseDoPlano(base: unknown, perfil: 'agencia' | 'ecossistema'): string | null {
  if (typeof base !== 'string' || !BASES.has(base as TipoBaseComissao)) {
    return 'Base de cálculo inválida.';
  }
  if (base === 'MRR_GERADO' && perfil !== 'ecossistema') {
    return 'A base MRR gerado está disponível somente no financeiro do ecossistema Entur OS.';
  }
  return null;
}
