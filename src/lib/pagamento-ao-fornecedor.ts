/**
 * Como a agência paga cada fornecedor, vindo do CRM (14/11/2026).
 *
 * O Bruno pediu que, nos "Valores da proposta" da Cotação, cada fornecedor
 * tenha a sua forma de pagamento, "tudo organizado para o financeiro". O CRM
 * manda, em cada linha de `fornecedores[]` em que a agência paga o
 * fornecedor, o bloco opcional `pagamento_ao_fornecedor`:
 *
 *   { forma: 'BOLETO', vencimento: '2026-12-15',
 *     parcelas: [{ parcela: 1, valor: 475, vencimento: '2026-12-15' }, ...] }
 *
 * Aqui o bloco vira o plano das contas a pagar daquele fornecedor: uma conta
 * por parcela, com a forma, o número da parcela e o vencimento. O que esta
 * camada garante, venha o que vier:
 *  - forma só do enum da conta a pagar (PIX, BOLETO, CARTAO_CORP, TED,
 *    DEPOSITO); qualquer outra vira "não informada";
 *  - só boleto e cartão parcelam, até 12 vezes; as outras formas viram UMA
 *    conta no primeiro vencimento;
 *  - a soma das parcelas fecha SEMPRE com o custo da linha (o que o Financeiro
 *    deve de fato): se o CRM mandou outra soma, as parcelas são redivididas na
 *    mesma proporção, a última levando o resto dos centavos, e as datas ficam;
 *  - sem parcelas, mas com vencimento: uma conta, naquele dia;
 *  - sem nada utilizável: null (a conta nasce como sempre nasceu).
 *
 * Puro: sem banco e sem React.
 */

export type FormaDoPagamentoAoFornecedor = 'PIX' | 'BOLETO' | 'CARTAO_CORP' | 'TED' | 'DEPOSITO';

export interface PagamentoAoFornecedor {
  forma: FormaDoPagamentoAoFornecedor | null;
  vencimento: string;
  parcelas: Array<{ parcela: number; valor: number; vencimento: string }>;
}

export interface ParcelaAoFornecedor {
  numero: number;
  total: number;
  valor: number;
  vencimento: string;
}

const FORMAS = new Set<string>(['PIX', 'BOLETO', 'CARTAO_CORP', 'TED', 'DEPOSITO']);
const PARCELAVEIS = new Set<string>(['BOLETO', 'CARTAO_CORP']);
const MAX_PARCELAS = 12;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

const data = (v: unknown): string => {
  const s = String(v ?? '').slice(0, 10);
  return DATA.test(s) ? s : '';
};
const centavos = (v: unknown): number => Math.round((Number(v) || 0) * 100);

/** O bloco do payload, validado; null quando não veio ou não serve para nada. */
export function lerPagamentoAoFornecedor(bruto: unknown): PagamentoAoFornecedor | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const b = bruto as Record<string, unknown>;
  const forma = typeof b.forma === 'string' && FORMAS.has(b.forma.toUpperCase())
    ? (b.forma.toUpperCase() as FormaDoPagamentoAoFornecedor)
    : null;
  const parcelas = (Array.isArray(b.parcelas) ? b.parcelas : [])
    .map((p, i) => {
      const r = (p ?? {}) as Record<string, unknown>;
      return { parcela: Number(r.parcela) || i + 1, valor: centavos(r.valor) / 100, vencimento: data(r.vencimento) };
    })
    .filter(p => p.valor > 0 && p.vencimento)
    .sort((a, z) => a.parcela - z.parcela);
  const vencimento = data(b.vencimento) || parcelas[0]?.vencimento || '';
  if (!vencimento && parcelas.length === 0) return null;
  return { forma, vencimento, parcelas };
}

/**
 * As parcelas das contas a pagar deste fornecedor, fechando com `custo`
 * (em reais). null = sem plano: a conta nasce como sempre.
 */
export function planoDoPagamento(p: PagamentoAoFornecedor | null | undefined, custo: number): ParcelaAoFornecedor[] | null {
  const totalCentavos = centavos(custo);
  if (!p || totalCentavos <= 0) return null;
  const parcelavel = !!p.forma && PARCELAVEIS.has(p.forma);
  const lista = parcelavel ? p.parcelas.slice(0, MAX_PARCELAS) : [];

  if (lista.length <= 1) {
    const vencimento = p.parcelas[0]?.vencimento || p.vencimento;
    return vencimento ? [{ numero: 1, total: 1, valor: totalCentavos / 100, vencimento }] : null;
  }

  // Redivide na proporção do que o CRM mandou: a soma fecha com o custo.
  const pesos = lista.map(x => centavos(x.valor));
  const somaPesos = pesos.reduce((s, v) => s + v, 0);
  let distribuido = 0;
  return lista.map((x, i) => {
    const ultimo = i === lista.length - 1;
    const valor = ultimo ? totalCentavos - distribuido : Math.floor((totalCentavos * pesos[i]) / somaPesos);
    distribuido += valor;
    return { numero: i + 1, total: lista.length, valor: valor / 100, vencimento: x.vencimento };
  });
}
