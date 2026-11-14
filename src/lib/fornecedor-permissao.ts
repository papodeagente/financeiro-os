// Quem cria e edita o cadastro de fornecedor (E7, 06/11/2026). Puro.
//
// O cadastro é compartilhado com o CRM e usado fora do financeiro: o vendedor
// escolhe e cria fornecedor na Nova venda e nas abas do planejamento. Mas o
// cadastro carrega as REGRAS DE FATURAMENTO (prazo, corte, vencimento,
// comissão padrão), que geram as contas a pagar, e os dados bancários.
//
// Regra:
//   - ler: qualquer pessoa logada da agência (como antes); quem não acessa o
//     financeiro não recebe os dados bancários;
//   - CRIAR: qualquer pessoa logada, como antes. Sem "Lançar e editar no
//     financeiro", os dados bancários não entram; sem "Montar fatura de
//     fornecedor", as regras de faturamento nascem no padrão;
//   - EDITAR um cadastro que já existe: exige "Lançar e editar no financeiro";
//     mudar as regras de faturamento exige também "Montar fatura de fornecedor".
//   - administrador nunca é barrado (o papel dele tem tudo).

/** As regras com que um cadastro novo nasce (iguais a createFornecedorCRM). */
export const REGRAS_PADRAO_DO_CADASTRO = Object.freeze({
  prazo_pagamento_dias: 30, dia_corte: 25, dia_vencimento: 10, comissao_padrao: 0, moeda_padrao: 'BRL',
});

export interface DireitosNoFornecedor {
  /** Lançar e editar no financeiro (editar_financeiro). */
  editar: boolean;
  /** Montar fatura de fornecedor (gerar_fatura_fornecedor): mexe nas regras. */
  regras: boolean;
}

export type DecisaoDoFornecedor =
  | { ok: true; item: Record<string, unknown> }
  | { ok: false; status: 403; error: string };

/** JSON com as chaves em ordem: comparar regras sem depender da ordem dos campos. */
function estavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${estavel(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function regrasMudaram(antes: Record<string, unknown> | null, depois: Record<string, unknown>): boolean {
  if (!('regras_faturamento' in depois)) return false;
  return estavel(antes?.regras_faturamento ?? null) !== estavel(depois.regras_faturamento ?? null);
}

export const MENSAGEM_EDITAR_FORNECEDOR =
  'Seu acesso não inclui alterar o cadastro de fornecedores. Peça a quem cuida do financeiro.';
export const MENSAGEM_REGRAS_FORNECEDOR =
  'Seu acesso não inclui mudar as regras de faturamento do fornecedor (prazo, corte, vencimento e comissão).';

/**
 * Decide a gravação. `antes` = o cadastro como está (null = novo). Devolve o
 * item a gravar (talvez sem os campos que a pessoa não pode definir) ou a recusa.
 */
export function decidirGravacaoDoFornecedor(
  antes: Record<string, unknown> | null, item: Record<string, unknown>, direitos: DireitosNoFornecedor,
): DecisaoDoFornecedor {
  if (antes) {
    if (!direitos.editar) return { ok: false, status: 403, error: MENSAGEM_EDITAR_FORNECEDOR };
    if (!direitos.regras && regrasMudaram(antes, item)) return { ok: false, status: 403, error: MENSAGEM_REGRAS_FORNECEDOR };
    return { ok: true, item };
  }
  const novo = { ...item };
  if (!direitos.editar) novo.dados_bancarios = [];
  if (!direitos.regras) novo.regras_faturamento = { ...REGRAS_PADRAO_DO_CADASTRO };
  return { ok: true, item: novo };
}

/** O que a leitura entrega a quem não acessa o financeiro. */
export function semDadosFinanceiros(f: Record<string, unknown>): Record<string, unknown> {
  if (!('dados_bancarios' in f)) return f;
  return { ...f, dados_bancarios: [] };
}
