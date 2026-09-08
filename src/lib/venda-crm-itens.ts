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

/** Fornecedor do payload do CRM já resolvido para um cadastro do financeiro. */
export interface FornecedorResolvido {
  /** Id interno no financeiro. Vazio quando não há cadastro. */
  fornecedor_id: string;
  fornecedor_nome: string;
  /** Serviço prestado — vira o tipo do item quando bate com a lista. */
  servico?: string;
  descricao?: string;
  valor_custo: number;
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

export function montarLinhasDeCusto(entrada: {
  fornecedores: FornecedorResolvido[];
  custo_total: number;
  valor_total: number;
  /** Identificação da venda no CRM, usada quando não há nada a descrever. */
  referencia?: string;
}): LinhaCusto[] {
  const valorTotal = round2(num(entrada.valor_total));
  const custoTotal = round2(num(entrada.custo_total));

  type Parcial = Omit<LinhaCusto, 'valor_venda'>;
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

  const valoresVenda = ratearTotal(valorTotal, linhas.map(l => l.valor_custo));
  return linhas.map((l, i) => ({ ...l, valor_venda: valoresVenda[i] }));
}
