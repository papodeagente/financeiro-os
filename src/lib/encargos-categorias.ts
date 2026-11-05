/**
 * Encargos da liquidação no resultado (05/11/2026) — regra pura.
 *
 * Juros, multa, desconto e taxa registrados ao liquidar (tabela `baixas`)
 * entram no DRE em linhas próprias, cada uma ligada a uma categoria do
 * plano de contas (Configurações › Financeiro):
 *
 *   conta a RECEBER  juros + multa → receita financeira
 *                    desconto      → descontos concedidos
 *                    taxa          → taxas (cobrança, cartão, plataforma)
 *   conta a PAGAR    juros + multa → despesa financeira
 *                    desconto      → receita financeira (desconto obtido)
 *
 * Só contam as baixas gravadas pela liquidação nova (tipo 'baixa') e não
 * estornadas. Quem não tem baixa com encargo não vê número nenhum mudar.
 */
import { num, round2 } from './money';

export type ChaveEncargo = 'receita_financeira' | 'despesa_financeira' | 'descontos_concedidos' | 'taxas';

export const CHAVES_ENCARGO: readonly ChaveEncargo[] = ['receita_financeira', 'despesa_financeira', 'descontos_concedidos', 'taxas'];

/** As categorias que nascem no plano de contas quando a agência ainda não escolheu. */
export const CATEGORIAS_PADRAO_ENCARGOS: Readonly<Record<ChaveEncargo, {
  codigo: string; pai: string; nome: string; tipo: 'RECEITA' | 'DESPESA'; explica: string;
}>> = {
  receita_financeira: {
    codigo: '1.6', pai: '1', nome: 'Receitas financeiras', tipo: 'RECEITA',
    explica: 'Juros e multa que o cliente pagou pelo atraso e desconto que o fornecedor deu.',
  },
  despesa_financeira: {
    codigo: '2.4.05', pai: '2.4', nome: 'Juros e multas pagos', tipo: 'DESPESA',
    explica: 'Juros e multa que a agência pagou por atraso.',
  },
  descontos_concedidos: {
    codigo: '2.4.06', pai: '2.4', nome: 'Descontos concedidos', tipo: 'DESPESA',
    explica: 'Desconto dado ao cliente na hora de receber.',
  },
  taxas: {
    codigo: '2.4.07', pai: '2.4', nome: 'Taxas de cobrança', tipo: 'DESPESA',
    explica: 'Taxa de cartão, boleto ou plataforma descontada ao receber.',
  },
};

/** Categoria escolhida para cada encargo (agencia.data.categorias_encargos). */
export type CategoriasEncargos = Partial<Record<ChaveEncargo, string>>;

/** Nome e código mostrados na linha do DRE. */
export type RotulosEncargos = Partial<Record<ChaveEncargo, { codigo: string; nome: string }>>;

export interface EncargosDoTitulo {
  juros: number;
  multa: number;
  desconto: number;
  taxa: number;
}

export interface LinhaDeBaixaComEncargo {
  titulo_tabela: string;
  titulo_id: string;
  tipo: string;
  estornada: boolean;
  juros: number;
  multa: number;
  desconto: number;
  taxa: number;
}

/** Soma por título (`${tabela}:${id}`) das baixas que valem. */
export function encargosPorTitulo(linhas: readonly LinhaDeBaixaComEncargo[]): Map<string, EncargosDoTitulo> {
  const m = new Map<string, EncargosDoTitulo>();
  for (const l of linhas) {
    if (l.tipo !== 'baixa' || l.estornada) continue;
    if (l.titulo_tabela !== 'contas_receber' && l.titulo_tabela !== 'contas_pagar') continue;
    // Taxa só existe na conta a receber (é o que a plataforma reteve).
    const taxa = l.titulo_tabela === 'contas_receber' ? Math.max(0, num(l.taxa)) : 0;
    const e = { juros: Math.max(0, num(l.juros)), multa: Math.max(0, num(l.multa)), desconto: Math.max(0, num(l.desconto)), taxa };
    if (e.juros + e.multa + e.desconto + e.taxa <= 0) continue;
    const k = `${l.titulo_tabela}:${l.titulo_id}`;
    const a = m.get(k) ?? { juros: 0, multa: 0, desconto: 0, taxa: 0 };
    m.set(k, {
      juros: round2(a.juros + e.juros), multa: round2(a.multa + e.multa),
      desconto: round2(a.desconto + e.desconto), taxa: round2(a.taxa + e.taxa),
    });
  }
  return m;
}

/** Quanto de cada linha do resultado os encargos de um título formam. */
export function classificarEncargos(
  tabela: 'contas_receber' | 'contas_pagar',
  e: EncargosDoTitulo | undefined,
): Record<ChaveEncargo, number> {
  const zero = { receita_financeira: 0, despesa_financeira: 0, descontos_concedidos: 0, taxas: 0 };
  if (!e) return zero;
  const jm = round2(num(e.juros) + num(e.multa));
  if (tabela === 'contas_receber') {
    return { ...zero, receita_financeira: jm, descontos_concedidos: round2(num(e.desconto)), taxas: round2(num(e.taxa)) };
  }
  return { ...zero, despesa_financeira: jm, receita_financeira: round2(num(e.desconto)) };
}

/**
 * Quanto os encargos mudaram o valor da conta (juros + multa − desconto). É
 * o que sai da linha de origem da conta para as linhas próprias, para não
 * contar duas vezes.
 */
export function ajusteDoValor(e: EncargosDoTitulo | undefined): number {
  if (!e) return 0;
  return round2(num(e.juros) + num(e.multa) - num(e.desconto));
}

/** Nome e código de cada linha: a categoria escolhida ou a padrão. */
export function rotulosDasCategorias(
  escolhidas: CategoriasEncargos | null | undefined,
  plano: ReadonlyArray<{ id: string; codigo?: string; nome?: string }>,
): Record<ChaveEncargo, { codigo: string; nome: string }> {
  const porId = new Map(plano.map(p => [p.id, p]));
  const saida = {} as Record<ChaveEncargo, { codigo: string; nome: string }>;
  for (const k of CHAVES_ENCARGO) {
    const p = escolhidas?.[k] ? porId.get(escolhidas[k]!) : undefined;
    saida[k] = p && p.nome
      ? { codigo: String(p.codigo ?? ''), nome: String(p.nome) }
      : { codigo: CATEGORIAS_PADRAO_ENCARGOS[k].codigo, nome: CATEGORIAS_PADRAO_ENCARGOS[k].nome };
  }
  return saida;
}

/** Primeiro código livre: o padrão, ou o próximo irmão (2.4.05 → 2.4.08...). */
export function codigoLivre(padrao: string, usados: Iterable<string>): string {
  const ocupados = new Set(usados);
  if (!ocupados.has(padrao)) return padrao;
  const partes = padrao.split('.');
  const ultimo = partes.pop() ?? '0';
  const largura = ultimo.length;
  for (let n = Number(ultimo) + 1; n < 1000; n++) {
    const c = [...partes, String(n).padStart(largura, '0')].join('.');
    if (!ocupados.has(c)) return c;
  }
  return `${padrao}.${Date.now()}`;
}
