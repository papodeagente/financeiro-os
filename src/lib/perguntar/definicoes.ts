/**
 * "Perguntar em texto": a parte PURA das ferramentas fixas (nomes, esquemas
 * para a IA, direitos, formato do resultado). As consultas em si moram em
 * ./ferramentas.ts (servidor); a tela e a orquestração usam só este arquivo.
 */
import type { EmpresasVisiveis } from '../empresas';

// ============================================================
// Direitos e contexto
// ============================================================

/** O que a pessoa pode, resolvido UMA vez pela rota (catálogo de ações). */
export interface DireitosDaPergunta {
  /** ver_financeiro: contas a pagar/receber, cobranças. */
  verFinanceiro: boolean;
  /** ver_conta_bancaria e resumo_saldo: saldo das contas. */
  verSaldos: boolean;
  /** acessar_relatorios: DRE e relatórios de vendas. */
  relatorios: boolean;
  /** ver_colunas_comissao: receita (ganho) da agência. */
  verReceita: boolean;
  /** Quem não vê as vendas da equipe: só as vendas desta pessoa. */
  vendedorId: string | null;
  /** Contas bancárias liberadas (null = todas). */
  contasLiberadas: string[] | null;
  /** Empresas no recorte (null = todas). */
  empresas: EmpresasVisiveis;
}

/** Algum direito que faça a caixa servir para alguma coisa. */
export function temAlgumDireito(d: DireitosDaPergunta): boolean {
  return d.verFinanceiro || d.verSaldos || d.relatorios;
}

// ============================================================
// Resultado
// ============================================================

export type TipoDoNumero = 'dinheiro' | 'contagem' | 'percentual';

export interface NumeroDaResposta {
  rotulo: string;
  valor: number;
  tipo: TipoDoNumero;
  /** Moeda quando não é real (saldo de conta em dólar...). */
  moeda?: string;
}

export interface ResultadoDaFerramenta {
  ferramenta: NomeDaFerramenta;
  titulo: string;
  /** Motivo da recusa (sem direito, parâmetro inválido): nenhum número sai. */
  recusado?: string;
  numeros: NumeroDaResposta[];
  /** O filtro usado, por extenso. */
  filtro: string[];
  /** A tela com o filtro aplicado. */
  link: string | null;
  /** Até 10 linhas de detalhe (as maiores ou as primeiras do filtro). */
  linhas: Array<{ texto: string; valor: number; moeda?: string }>;
}

export const NOMES_DAS_FERRAMENTAS = [
  'contas_a_pagar_e_receber', 'cobrancas', 'saldos_das_contas', 'resultado_do_mes', 'vendas_agrupadas',
] as const;
export type NomeDaFerramenta = (typeof NOMES_DAS_FERRAMENTAS)[number];

export function ehFerramenta(v: unknown): v is NomeDaFerramenta {
  return typeof v === 'string' && (NOMES_DAS_FERRAMENTAS as readonly string[]).includes(v);
}

// ============================================================
// Definições para a IA (JSON Schema)
// ============================================================

const PERIODO = {
  de: { type: 'string', description: 'Início do período, AAAA-MM-DD. Omita para não limitar.' },
  ate: { type: 'string', description: 'Fim do período, AAAA-MM-DD. Omita para não limitar.' },
} as const;

export const DEFINICOES_DAS_FERRAMENTAS = [
  {
    name: 'contas_a_pagar_e_receber',
    description: 'Contas a pagar e a receber da agência (o que pagar a fornecedores, o que receber de clientes e de operadoras, como comissão). Devolve totais em aberto, em atraso, já liquidados e as principais contas. Use para "quanto tenho a receber/pagar", "quais contas vencem", "o que está atrasado".',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tipo: { type: 'string', enum: ['pagar', 'receber', 'ambos'], description: 'Contas a pagar, a receber ou as duas.' },
        situacao: { type: 'string', enum: ['em_aberto', 'em_atraso', 'liquidado', 'todas'], description: 'em_aberto inclui as atrasadas; liquidado = já pagas/recebidas.' },
        data: { type: 'string', enum: ['vencimento', 'emissao', 'liquidacao'], description: 'A data que o período filtra.' },
        ...PERIODO,
        pessoa: { type: 'string', description: 'Parte do nome do cliente, fornecedor ou operadora (opcional).' },
        categoria: { type: 'string', description: 'Parte do nome da categoria (opcional; ignorada se houver pessoa).' },
      },
      required: ['tipo', 'situacao', 'data'],
    },
  },
  {
    name: 'cobrancas',
    description: 'Contas a receber pela situação da cobrança (boleto/Pix): emitida e aguardando, vencida sem pagamento, paga, que falhou ou ainda sem boleto.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        situacao_cobranca: { type: 'string', enum: ['emitida', 'vencida', 'paga', 'falhou', 'sem_boleto'] },
        ...PERIODO,
        pessoa: { type: 'string', description: 'Parte do nome do cliente (opcional).' },
      },
      required: ['situacao_cobranca'],
    },
  },
  {
    name: 'saldos_das_contas',
    description: 'Saldo atual de cada conta bancária e, com período, quanto entrou (contas recebidas) e saiu (contas pagas) nele.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        conta: { type: 'string', description: 'Parte do nome da conta bancária (opcional).' },
        ...PERIODO,
      },
    },
  },
  {
    name: 'resultado_do_mes',
    description: 'DRE (resultado) de um mês, por competência: receita bruta, receita líquida, despesas operacionais e lucro líquido, igual à tela DRE.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { mes: { type: 'string', description: 'Mês, AAAA-MM.' } },
      required: ['mes'],
    },
  },
  {
    name: 'vendas_agrupadas',
    description: 'Vendas de um período agrupadas por vendedor, fornecedor, cliente ou unidade: quantidade, faturamento e, quando pedido, a receita (ganho) da agência.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        agrupar_por: { type: 'string', enum: ['vendedor', 'fornecedor', 'cliente', 'unidade'] },
        medida: { type: 'string', enum: ['faturamento', 'receita'], description: 'receita = ganho da agência; faturamento = total vendido.' },
        ...PERIODO,
        fornecedor: { type: 'string', description: 'Parte do nome do fornecedor (opcional).' },
        vendedor: { type: 'string', description: 'Parte do nome do vendedor (opcional).' },
      },
      required: ['agrupar_por', 'medida'],
    },
  },
] as const;

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
export function dataBR(iso: string): string {
  return ISO_DATA.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
}

/** O que volta para a IA: só os números, o filtro e as linhas que a pessoa pode ver. */
export function resultadoParaIa(r: ResultadoDaFerramenta): string {
  if (r.recusado) return JSON.stringify({ recusado: true, motivo: r.recusado });
  return JSON.stringify({ titulo: r.titulo, filtro: r.filtro, numeros: r.numeros, linhas: r.linhas });
}
