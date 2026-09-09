/**
 * Monta as linhas de custo de uma venda importada do CRM.
 *
 * Lógica pura: recebe os fornecedores já resolvidos (upsert feito), o custo
 * total e o valor total da venda, devolve os itens que viram contas.
 *
 * As três regras que este módulo garante:
 *
 *  1. CADA FORNECEDOR É UMA LINHA DE CUSTO. A agência vende ao cliente e paga
 *     o fornecedor. Conta a receber = valor da venda, conta a pagar = custo.
 *  2. CUSTO SEM DONO VIRA LINHA PRÓPRIA, MARCADA. O CRM soma em custo_total o
 *     custo de produto sem fornecedor preenchido, mas não o detalha em
 *     `fornecedores`. Esse dinheiro sai do caixa do mesmo jeito: a dívida
 *     nasce marcada como sem fornecedor, para o financeiro dizer a quem pagar.
 *  3. O VALOR DA VENDA É RATEADO PELO CUSTO. O CRM manda o valor total do
 *     negócio, nunca o preço de venda por fornecedor. A soma dos itens fecha
 *     exatamente com valor_total.
 */

import { num, ratearTotal, round2, somaPor } from './money';
import type { TipoProdutoVenda } from './crm-types';

const TIPOS_VALIDOS: TipoProdutoVenda[] = [
  'AEREO', 'HOTEL', 'PACOTE', 'SEGURO', 'RECEPTIVO',
  'CRUZEIRO', 'CARRO', 'INGRESSO', 'GRUPO', 'OUTROS',
];

/** Texto que o financeiro lê quando o CRM não disse a quem pagar. */
export const DESCRICAO_SEM_FORNECEDOR = 'Serviços sem fornecedor informado no CRM';
export const OBSERVACAO_SEM_FORNECEDOR =
  'Sem fornecedor no CRM. Informe a quem pagar no financeiro.';

/** Receita que não vem de fornecedor: serviço da própria agência, milhas, margem. */
export const DESCRICAO_PROPRIO = 'Serviços da própria agência';

/** Fornecedor do payload do CRM já resolvido para um cadastro do financeiro. */
export interface FornecedorResolvido {
  /** Id interno no financeiro. Vazio quando não há cadastro. */
  fornecedor_id: string;
  fornecedor_nome: string;
  /** Serviço prestado — vira o tipo do item quando bate com a lista. */
  servico?: string;
  descricao?: string;
  valor_custo: number;
  /**
   * O que entra por causa deste fornecedor.
   *
   * Desde 09/09/2026 o CRM manda a venda já atribuída: a venda de cada serviço
   * pertence a quem o prestou. Quando vem, ela manda; quando não vem (venda
   * antiga, ou outro emissor), continua valendo o rateio proporcional ao custo
   * que sempre existiu aqui.
   */
  valor_venda?: number;
  localizador?: string;
  data_inicio?: string;
  data_fim?: string;
}

export interface LinhaCusto {
  fornecedor_id: string;
  fornecedor_nome: string;
  tipo: TipoProdutoVenda;
  descricao: string;
  valor_custo: number;
  valor_venda: number;
  localizador: string;
  data_inicio: string;
  data_fim: string;
  observacoes: string;
  /** true = o CRM mandou o custo mas não disse de quem é. */
  sem_fornecedor: boolean;
}

function tipoDoServico(servico: string | undefined): TipoProdutoVenda {
  const t = (servico || '').trim().toUpperCase() as TipoProdutoVenda;
  return TIPOS_VALIDOS.includes(t) ? t : 'OUTROS';
}

/** Soma das vendas que o emissor atribuiu, quando ele atribuiu alguma. */
function vendaInformada(fornecedores: FornecedorResolvido[]): number | null {
  const comValor = fornecedores.filter((f) => num(f.valor_venda) > 0);
  if (comValor.length === 0) return null;
  return round2(somaPor(comValor, (f) => num(f.valor_venda)));
}

export function montarLinhasDeCusto(entrada: {
  fornecedores: FornecedorResolvido[];
  custo_total: number;
  valor_total: number;
  /** Identificação da venda no CRM, usada quando não há nada a descrever. */
  referencia?: string;
}): LinhaCusto[] {
  const valorTotal = round2(num(entrada.valor_total));
  const custoTotal = round2(num(entrada.custo_total));

  type Parcial = Omit<LinhaCusto, 'valor_venda'> & { venda_informada?: number };
  const linhas: Parcial[] = [];

  for (const f of entrada.fornecedores) {
    const nome = (f.fornecedor_nome || '').trim();
    linhas.push({
      fornecedor_id: (f.fornecedor_id || '').trim(),
      fornecedor_nome: nome,
      tipo: tipoDoServico(f.servico),
      // A descrição legível vem primeiro. O CRM passou a mandar `servico` como
      // token fechado (AEREO, HOTEL, OUTROS...) só para tipar a conta, e o
      // texto que a pessoa lê em `descricao`. Ler `servico` antes deixaria toda
      // conta chamada "AEREO" ou "OUTROS", indistinguíveis na hora de pagar.
      // A ordem antiga sobrevive como fallback: venda gravada antes dessa
      // mudança não tem `descricao` e continua lendo o texto de `servico`.
      descricao: (f.descricao || '').trim() || (f.servico || '').trim() || nome || 'Serviço',
      // Custo negativo não vira crédito: fornecedor não devolve dinheiro por
      // linha de venda. Zero é o piso.
      valor_custo: Math.max(0, round2(num(f.valor_custo))),
      localizador: f.localizador || '',
      data_inicio: f.data_inicio || '',
      data_fim: f.data_fim || '',
      observacoes: '',
      sem_fornecedor: false,
      venda_informada: num(f.valor_venda) > 0 ? round2(num(f.valor_venda)) : undefined,
    });
  }

  // Custo que o CRM somou em custo_total mas não atribuiu a fornecedor nenhum.
  const custoSemFornecedor = round2(custoTotal - somaPor(linhas, l => l.valor_custo));
  if (custoSemFornecedor > 0) {
    linhas.push({
      fornecedor_id: '',
      fornecedor_nome: '',
      tipo: 'OUTROS',
      descricao: DESCRICAO_SEM_FORNECEDOR,
      valor_custo: custoSemFornecedor,
      localizador: '',
      data_inicio: '',
      data_fim: '',
      observacoes: OBSERVACAO_SEM_FORNECEDOR,
      sem_fornecedor: true,
    });
  }

  // Venda sem custo nenhum ainda precisa de um item para carregar o que o
  // cliente paga — sem item próprio não nasce conta a receber.
  if (linhas.length === 0) {
    linhas.push({
      fornecedor_id: '',
      fornecedor_nome: '',
      tipo: 'OUTROS',
      descricao: entrada.referencia ? `Venda ${entrada.referencia}` : 'Venda',
      valor_custo: 0,
      localizador: '',
      data_inicio: '',
      data_fim: '',
      observacoes: '',
      sem_fornecedor: false,
    });
  }

  // A VENDA ATRIBUÍDA PELO EMISSOR MANDA.
  //
  // Desde 09/09/2026 o CRM diz quanto entra por causa de cada fornecedor, em
  // vez de deixar o rateio proporcional ao custo adivinhar. A diferença
  // aparece quando as margens são desiguais: um aéreo comprado quase a preço de
  // custo e um passeio com margem alta rateados pelo custo dariam ao aéreo uma
  // receita que ele não trouxe.
  //
  // O que o emissor não atribuiu (linha sem fornecedor, ou venda antiga que não
  // manda o campo) continua no rateio proporcional ao custo, sobre o que sobra
  // do valor total. Assim a soma fecha com valor_total nos dois casos.
  const informada = vendaInformada(entrada.fornecedores);
  if (informada === null) {
    const valoresVenda = ratearTotal(valorTotal, linhas.map(l => l.valor_custo));
    return linhas.map((l, i) => ({ ...l, valor_venda: valoresVenda[i] }));
  }

  let semAtribuicao = linhas.filter(l => l.venda_informada === undefined);
  const sobra = round2(Math.max(0, valorTotal - Math.min(informada, valorTotal)));
  // A parte da venda que não pertence a fornecedor nenhum (serviço prestado
  // pela própria agência, milhas do estoque, margem que o CRM não atribuiu)
  // precisa de uma linha para carregar. Sem ela, a receita evaporava sempre que
  // o serviço próprio não tinha custo, e a soma das contas a receber ficava
  // menor que a venda: caixa a menos, em silêncio.
  if (sobra > 0 && semAtribuicao.length === 0) {
    linhas.push({
      fornecedor_id: '',
      fornecedor_nome: '',
      tipo: 'OUTROS',
      descricao: DESCRICAO_PROPRIO,
      valor_custo: 0,
      localizador: '',
      data_inicio: '',
      data_fim: '',
      observacoes: '',
      sem_fornecedor: false,
    });
    semAtribuicao = linhas.filter(l => l.venda_informada === undefined);
  }
  const valoresSobra = semAtribuicao.length > 0
    ? ratearTotal(sobra, semAtribuicao.map(l => l.valor_custo))
    : [];
  let k = 0;
  const comVenda = linhas.map((l) => {
    const { venda_informada, ...resto } = l;
    if (venda_informada !== undefined) return { ...resto, valor_venda: venda_informada };
    return { ...resto, valor_venda: valoresSobra[k++] ?? 0 };
  });

  // Piso de segurança: se o emissor atribuiu MAIS que o valor total (venda
  // editada no CRM depois de emitida, por exemplo), a soma é trazida de volta
  // para o total. Receita inventada distorce caixa e DRE em silêncio.
  const somaFinal = round2(somaPor(comVenda, l => l.valor_venda));
  if (somaFinal > valorTotal) {
    const ajustados = ratearTotal(valorTotal, comVenda.map(l => l.valor_venda));
    return comVenda.map((l, i) => ({ ...l, valor_venda: ajustados[i] }));
  }
  return comVenda;
}
