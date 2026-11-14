/**
 * Assistente inicial do Financeiro (E7, frente D, 06/11/2026) — regra pura.
 *
 * Objetivo: nenhuma conta que o sistema gera (venda, fornecedor, reembolso,
 * restituição) nasce sem categoria, e nenhum encargo da liquidação fica sem
 * lugar no resultado.
 *
 *   - Agência nova (sem plano de contas próprio e sem nenhuma conta lançada):
 *     o assistente roda sozinho, cria o plano padrão e liga as categorias
 *     padrão de cada conta gerada.
 *   - Agência que já tem dados: o assistente só OFERECE, num clique. Ele cria
 *     apenas o que falta e liga apenas o que não está escolhido: nada que já
 *     está gravado muda (categoria, escolha, conta).
 *
 * As categorias criadas levam a marca `padrao_titulo` (como `padrao_encargo`
 * nas dos encargos): rodar de novo reaproveita, não duplica.
 */
import type { ChaveCategoriaDoTitulo, CategoriasDosTitulos } from './categorias-padrao-titulos';
import { CHAVES_DOS_TITULOS } from './categorias-padrao-titulos';

export interface CategoriaPadraoDoTitulo {
  codigo: string;
  /** Código da categoria-mãe no plano padrão (sem ela, fica na raiz). */
  pai: string;
  nome: string;
  tipo: 'RECEITA' | 'DESPESA';
}

export const CATEGORIAS_PADRAO_DOS_TITULOS: Readonly<Record<ChaveCategoriaDoTitulo, CategoriaPadraoDoTitulo>> = {
  receita_venda: { codigo: '1.7', pai: '1', nome: 'Recebimentos de vendas', tipo: 'RECEITA' },
  reembolso_receber: { codigo: '1.5.01', pai: '1.5', nome: 'Reembolsos de fornecedores', tipo: 'RECEITA' },
  restituicao: { codigo: '1.5.02', pai: '1.5', nome: 'Restituição de comissão', tipo: 'RECEITA' },
  pagamento_fornecedor: { codigo: '2.1.10', pai: '2.1', nome: 'Pagamentos a fornecedores', tipo: 'DESPESA' },
  fatura_fornecedor: { codigo: '2.1.11', pai: '2.1', nome: 'Faturas de fornecedores', tipo: 'DESPESA' },
  reembolso_pagar: { codigo: '2.5.01', pai: '2.5', nome: 'Reembolsos a clientes', tipo: 'DESPESA' },
};

/** Uma linha do plano, como o assistente precisa ler. */
export interface LinhaDoPlanoParaAssistente {
  id: string;
  codigo: string;
  tipo: string;
  ativo: boolean;
  /** Marca de categoria criada pelo sistema (encargo ou conta gerada). */
  marca_encargo?: string;
  marca_titulo?: string;
}

/** O plano é "da agência" quando tem categoria que não foi o sistema que criou. */
export function planoTemCategoriasProprias(plano: readonly LinhaDoPlanoParaAssistente[]): boolean {
  return plano.some(p => !p.marca_encargo && !p.marca_titulo);
}

/** As contas geradas que ainda não têm categoria escolhida (ou a escolhida sumiu ou foi desativada). */
export function chavesSemCategoria(
  escolha: CategoriasDosTitulos, plano: readonly LinhaDoPlanoParaAssistente[],
): ChaveCategoriaDoTitulo[] {
  const ativas = new Set(plano.filter(p => p.ativo).map(p => p.id));
  return CHAVES_DOS_TITULOS.filter(k => !escolha[k] || !ativas.has(escolha[k]!));
}

export type ModoDoAssistente = 'automatico' | 'oferecer' | 'pronto';

/**
 * O que fazer: agência nova roda sozinho; agência com dados recebe a oferta
 * quando falta alguma categoria; com tudo ligado, nada.
 */
export function modoDoAssistente(p: {
  planoProprio: boolean;
  temContas: boolean;
  faltam: number;
  encargosFaltam: number;
}): ModoDoAssistente {
  if (p.faltam === 0 && p.encargosFaltam === 0) return 'pronto';
  if (!p.planoProprio && !p.temContas) return 'automatico';
  return 'oferecer';
}

/**
 * Para cada conta gerada sem categoria: a marcada já existente (ativa e do
 * tipo certo) ou uma nova a criar. As escolhas que já valem não entram.
 */
export function planoDeLigacao(
  faltam: readonly ChaveCategoriaDoTitulo[], plano: readonly LinhaDoPlanoParaAssistente[],
): Array<{ chave: ChaveCategoriaDoTitulo; reaproveitar: string | null }> {
  return faltam.map(chave => {
    const tipo = CATEGORIAS_PADRAO_DOS_TITULOS[chave].tipo;
    const marcada = plano.find(p => p.marca_titulo === chave && p.ativo && (!p.tipo || p.tipo.toUpperCase() === tipo));
    return { chave, reaproveitar: marcada?.id ?? null };
  });
}

/**
 * O plano padrão com ids novos e as mães ligadas pelos ids novos (o plano
 * padrão numera de 1 em diante e liga a mãe por esse número).
 */
export function planoPadraoComIdsNovos<T extends { id: string; categoria_pai_id: string | null }>(
  padrao: readonly T[], novoId: () => string,
): T[] {
  const mapa = new Map(padrao.map(c => [c.id, novoId()]));
  return padrao.map(c => ({
    ...c,
    id: mapa.get(c.id)!,
    categoria_pai_id: c.categoria_pai_id ? (mapa.get(c.categoria_pai_id) ?? null) : null,
  }));
}
