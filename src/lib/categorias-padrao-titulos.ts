/**
 * Categorias padrão das contas que o sistema cria sozinho (06/11/2026, E7) —
 * regra pura.
 *
 * Venda, fatura do fornecedor, sinal ao fornecedor, reembolso e estorno de
 * comissão criavam contas com a categoria vazia, e a agência tinha de
 * classificar uma por uma para o resultado ficar certo. Agora a agência
 * escolhe, em Configurações › Financeiro, a categoria de cada tipo, e a conta
 * NOVA já nasce classificada. Sem escolha, nasce vazia como antes. Conta já
 * gravada nunca muda (nem quando a venda é refeita: a regeração mantém a
 * categoria que a conta tem).
 *
 * Fica em agencia.data.categorias_dos_titulos.
 */

export type ChaveCategoriaDoTitulo =
  | 'receita_venda'
  | 'pagamento_fornecedor'
  | 'fatura_fornecedor'
  | 'reembolso_pagar'
  | 'reembolso_receber'
  | 'restituicao';

export const CHAVE_DA_AGENCIA = 'categorias_dos_titulos';

export interface DefinicaoDaCategoriaPadrao {
  chave: ChaveCategoriaDoTitulo;
  rotulo: string;
  explica: string;
  /** O tipo da categoria que serve (receita para contas a receber, despesa para a pagar). */
  tipo: 'RECEITA' | 'DESPESA';
}

export const CATEGORIAS_DOS_TITULOS: readonly DefinicaoDaCategoriaPadrao[] = [
  { chave: 'receita_venda', rotulo: 'Recebimento da venda', tipo: 'RECEITA', explica: 'Contas a receber do cliente que nascem da venda.' },
  { chave: 'pagamento_fornecedor', rotulo: 'Pagamento ao fornecedor', tipo: 'DESPESA', explica: 'Contas a pagar ao fornecedor que nascem da venda e o sinal pago adiantado.' },
  { chave: 'fatura_fornecedor', rotulo: 'Fatura do fornecedor', tipo: 'DESPESA', explica: 'A conta da fatura do fornecedor, quando os itens dela não têm categoria.' },
  { chave: 'reembolso_pagar', rotulo: 'Reembolso a pagar ao cliente', tipo: 'DESPESA', explica: 'O que a agência devolve ao cliente depois de um cancelamento.' },
  { chave: 'reembolso_receber', rotulo: 'Reembolso a receber do fornecedor', tipo: 'RECEITA', explica: 'O que o fornecedor devolve à agência.' },
  { chave: 'restituicao', rotulo: 'Restituição de comissão', tipo: 'RECEITA', explica: 'Comissão já paga que o vendedor devolve quando a venda é cancelada.' },
];

export const CHAVES_DOS_TITULOS: readonly ChaveCategoriaDoTitulo[] = CATEGORIAS_DOS_TITULOS.map(c => c.chave);

export type CategoriasDosTitulos = Partial<Record<ChaveCategoriaDoTitulo, string>>;

/** O mapa gravado, em forma segura (só chaves conhecidas, ids de texto). */
export function limparCategoriasDosTitulos(v: unknown): CategoriasDosTitulos {
  const m: CategoriasDosTitulos = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return m;
  for (const k of CHAVES_DOS_TITULOS) {
    const id = (v as Record<string, unknown>)[k];
    if (typeof id === 'string' && id.trim()) m[k] = id.trim().slice(0, 100);
  }
  return m;
}

export interface CategoriaDoPlano { id: string; nome: string; tipo: string; ativo: boolean }

/** O que está errado na escolha (null = pode gravar). */
export function problemaNaEscolha(escolha: CategoriasDosTitulos, plano: readonly CategoriaDoPlano[]): string | null {
  const porId = new Map(plano.map(p => [p.id, p]));
  for (const def of CATEGORIAS_DOS_TITULOS) {
    const id = escolha[def.chave];
    if (!id) continue;
    const c = porId.get(id);
    if (!c) return `A categoria escolhida para "${def.rotulo}" não existe mais. Escolha outra.`;
    if (!c.ativo) return `A categoria "${c.nome}" está desativada. Escolha outra para "${def.rotulo}".`;
    if (c.tipo && c.tipo.toUpperCase() !== def.tipo) {
      return `"${def.rotulo}" precisa de uma categoria de ${def.tipo === 'RECEITA' ? 'receita' : 'despesa'}; "${c.nome}" é de ${def.tipo === 'RECEITA' ? 'despesa' : 'receita'}.`;
    }
  }
  return null;
}

/** A categoria para a conta nova: a que veio, senão a padrão, senão vazia (como antes). */
export function categoriaParaContaNova(atual: unknown, escolha: CategoriasDosTitulos, chave: ChaveCategoriaDoTitulo): string {
  const v = typeof atual === 'string' ? atual.trim() : '';
  return v || escolha[chave] || '';
}

/** Qual padrão vale para uma conta gerada pela venda (pelo lado). */
export function chaveDaContaDaVenda(tabela: 'contas_pagar' | 'contas_receber'): ChaveCategoriaDoTitulo {
  return tabela === 'contas_receber' ? 'receita_venda' : 'pagamento_fornecedor';
}
