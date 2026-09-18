/**
 * Lançamentos de cartão de crédito: identidade, parcelas e importação.
 *
 * O problema que este módulo resolve: a fatura do mês seguinte traz de novo
 * a MESMA compra parcelada ("NETFLIX PARC 03/12"). Sem identidade estável,
 * cada importação cria uma despesa nova e a dívida do cartão dobra a cada
 * mês. A chave natural aqui é o que impede isso.
 *
 * Dinheiro por round2/dividirParcelas. Datas civis, nunca new Date sobre
 * string de data.
 */
import { createHash } from 'crypto';
import { round2, num, soma, dividirParcelas, addMeses, mesDe } from './money';

/** Uma compra no cartão, como a pessoa pensa nela. */
export interface CompraCartao {
  cartao_id: string;
  descricao: string;
  /** Valor TOTAL da compra, não o da parcela. */
  valor_total: number;
  data_compra: string;
  categoria_id: string;
  fornecedor_nome: string;
  /** 1 é à vista. Máximo 24. */
  parcelas: number;
  observacoes: string;
}

export const MAX_PARCELAS = 24;

/**
 * Normaliza a descrição do estabelecimento para a identidade não depender
 * de detalhe que a fatura muda entre meses.
 *
 * A fatura escreve "NETFLIX.COM  03/12", "NETFLIX.COM 04/12" e às vezes
 * com espaçamento diferente. Tirar o sufixo de parcela e o espaço extra é
 * o que faz as duas virarem a mesma compra.
 */
export function normalizarEstabelecimento(descricao: string): string {
  return String(descricao ?? '')
    .toUpperCase()
    // Sufixos de parcela em todas as formas que as faturas usam.
    .replace(/\b(PARC(ELA)?\.?\s*)?\d{1,2}\s*[/de]{1,2}\s*\d{1,2}\b/g, ' ')
    .replace(/\bPARCELADO\b/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identidade da COMPRA, estável entre faturas.
 *
 * Não entra o número da parcela: a compra é a mesma nas 12 faturas. Entra
 * o total de parcelas porque duas compras iguais no mesmo dia, uma em 3x e
 * outra em 6x, são compras diferentes.
 *
 * Também não entra o valor da parcela, que arredonda diferente em cada
 * fatura: entra o valor TOTAL.
 */
export function idDaCompra(c: {
  cartao_id: string;
  descricao: string;
  valor_total: number;
  data_compra: string;
  parcelas: number;
}): string {
  const chave = [
    c.cartao_id,
    normalizarEstabelecimento(c.descricao),
    round2(num(c.valor_total)).toFixed(2),
    // Mês da compra, não o dia: a fatura às vezes registra a data de
    // processamento, um ou dois dias depois da compra.
    mesDe(c.data_compra),
    Math.max(1, Math.trunc(num(c.parcelas) || 1)),
  ].join('|');
  return `cc_${createHash('sha1').update(chave).digest('hex').slice(0, 16)}`;
}

/** Id determinístico da parcela. É a chave natural anti duplicata. */
export function idDaParcela(compraId: string, parcela: number): string {
  return `${compraId}_${String(Math.max(1, parcela)).padStart(2, '0')}`;
}

export interface ParcelaGerada {
  id: string;
  compra_id: string;
  parcela_numero: number;
  total_parcelas: number;
  valor: number;
  /** Mês em que esta parcela cai na fatura. */
  competencia: string;
  data_vencimento: string;
  descricao: string;
}

/**
 * Quebra a compra em parcelas.
 *
 * O resíduo de centavo vai na ÚLTIMA parcela: R$ 100 em 3x são 33,33 +
 * 33,33 + 33,34. A operadora costuma pôr na primeira, mas quem decide aqui
 * é `dividirParcelas`, o helper auditado que o resto do sistema usa em
 * venda e em conta. Divergir por um centavo criaria duas aritméticas de
 * parcela no mesmo produto, que é pior do que o centavo estar no fim. A
 * soma bate exatamente com o total nos dois casos.
 */
export function gerarParcelas(compra: CompraCartao, diaVencimento: number): ParcelaGerada[] {
  const total = Math.min(MAX_PARCELAS, Math.max(1, Math.trunc(num(compra.parcelas) || 1)));
  const valores = dividirParcelas(round2(num(compra.valor_total)), total);
  const compraId = idDaCompra({ ...compra, parcelas: total });

  return valores.map((valor, i) => {
    const competencia = mesDe(addMeses(compra.data_compra, i));
    const dia = Math.min(Math.max(Math.trunc(num(diaVencimento)) || 10, 1), 28);
    return {
      id: idDaParcela(compraId, i + 1),
      compra_id: compraId,
      parcela_numero: i + 1,
      total_parcelas: total,
      valor,
      competencia,
      data_vencimento: `${competencia}-${String(dia).padStart(2, '0')}`,
      descricao: total > 1
        ? `${compra.descricao} (${i + 1}/${total})`
        : compra.descricao,
    };
  });
}

/** Item lido da fatura em PDF, antes de virar despesa. */
export interface ItemDaFatura {
  descricao: string;
  valor: number;
  data: string;
  parcela_numero: number;
  total_parcelas: number;
}

export type SituacaoItem =
  /** Já existe no sistema: não lança de novo. */
  | 'JA_LANCADO'
  /** Parcela de uma compra que o sistema já conhece: continua a série. */
  | 'PARCELA_CONHECIDA'
  /** Compra nova. */
  | 'NOVO';

export interface ItemConciliado extends ItemDaFatura {
  compra_id: string;
  parcela_id: string;
  situacao: SituacaoItem;
  /** Por que o sistema decidiu assim. A tela mostra antes de gravar. */
  motivo: string;
}

/**
 * Compara o que veio da fatura com o que já está lançado.
 *
 * Esta é a função que responde ao problema do usuário: a fatura de
 * outubro traz a parcela 4/12 de uma compra cuja parcela 3/12 já foi paga.
 * O sistema precisa reconhecer a série, não criar uma despesa nova.
 *
 * `idsExistentes` são os ids de parcela já gravados; `comprasConhecidas`
 * são os ids de compra que já têm alguma parcela no sistema.
 */
export function conciliarFatura(
  itens: ItemDaFatura[],
  cartaoId: string,
  idsExistentes: Iterable<string>,
  comprasConhecidas: Iterable<string>,
): ItemConciliado[] {
  const existentes = new Set(idsExistentes);
  const compras = new Set(comprasConhecidas);

  return (itens ?? []).map(item => {
    const total = Math.max(1, Math.trunc(num(item.total_parcelas) || 1));
    const parcela = Math.min(total, Math.max(1, Math.trunc(num(item.parcela_numero) || 1)));

    // O valor da COMPRA é reconstruído a partir da parcela, porque a
    // fatura só mostra a parcela. Sem isso, a compra de 12x apareceria
    // como 12 compras diferentes, uma por mês.
    const valorTotal = round2(num(item.valor) * total);
    // A compra aconteceu (parcela - 1) meses antes desta fatura.
    const dataCompra = addMeses(item.data, -(parcela - 1));

    const compraId = idDaCompra({
      cartao_id: cartaoId,
      descricao: item.descricao,
      valor_total: valorTotal,
      data_compra: dataCompra,
      parcelas: total,
    });
    const parcelaId = idDaParcela(compraId, parcela);

    let situacao: SituacaoItem = 'NOVO';
    let motivo = 'Compra nova nesta fatura.';
    if (existentes.has(parcelaId)) {
      situacao = 'JA_LANCADO';
      motivo = total > 1
        ? `Parcela ${parcela} de ${total} já está lançada.`
        : 'Esta despesa já está lançada.';
    } else if (compras.has(compraId)) {
      situacao = 'PARCELA_CONHECIDA';
      motivo = `Parcela ${parcela} de ${total} de uma compra que o sistema já conhece.`;
    }

    return { ...item, valor: round2(num(item.valor)), compra_id: compraId, parcela_id: parcelaId, situacao, motivo };
  });
}

export interface ResumoImportacao {
  novos: number;
  ja_lancados: number;
  parcelas_conhecidas: number;
  total_a_lancar: number;
}

export function resumirImportacao(itens: ItemConciliado[]): ResumoImportacao {
  const aLancar = itens.filter(i => i.situacao !== 'JA_LANCADO');
  return {
    novos: itens.filter(i => i.situacao === 'NOVO').length,
    ja_lancados: itens.filter(i => i.situacao === 'JA_LANCADO').length,
    parcelas_conhecidas: itens.filter(i => i.situacao === 'PARCELA_CONHECIDA').length,
    total_a_lancar: soma(aLancar.map(i => i.valor)),
  };
}

export interface GastoPorGrupo {
  chave: string;
  rotulo: string;
  total: number;
  quantidade: number;
  share_pct: number;
}

/**
 * Onde o dinheiro do cartão está indo.
 *
 * Agrupa pelo estabelecimento NORMALIZADO, senão "UBER *TRIP 123" e
 * "UBER *TRIP 456" viram dois gastos diferentes e o relatório não diz nada.
 */
/**
 * Chave para AGRUPAR no relatório, mais agressiva que a de identidade.
 *
 * A distinção importa: a identidade da compra tem que ser conservadora,
 * senão duas compras diferentes viram a mesma e uma some do sistema. Já o
 * relatório precisa juntar "UBER *TRIP 123" e "UBER *TRIP 456", senão cada
 * corrida vira uma linha e o gráfico não responde onde o dinheiro vai.
 *
 * Aqui número solto no fim é código de transação e é descartado; em
 * `normalizarEstabelecimento` ele é preservado, porque lá errar custa caro.
 */
export function chaveDeAgrupamento(descricao: string): string {
  return normalizarEstabelecimento(descricao)
    // Código de transação no fim: "UBER TRIP 123", "PAG*LOJA 4455".
    .replace(/\s+\d{2,}\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function gastosPorEstabelecimento(
  lancamentos: Array<{ descricao: string; valor: number }>,
  limite = 10,
): GastoPorGrupo[] {
  const mapa = new Map<string, { total: number; quantidade: number; rotulo: string }>();
  for (const l of lancamentos ?? []) {
    const chave = chaveDeAgrupamento(l.descricao) || 'SEM DESCRICAO';
    const atual = mapa.get(chave) ?? { total: 0, quantidade: 0, rotulo: chave };
    atual.total = round2(atual.total + num(l.valor));
    atual.quantidade += 1;
    mapa.set(chave, atual);
  }
  const total = soma([...mapa.values()].map(v => v.total));
  return [...mapa.entries()]
    .map(([chave, v]) => ({
      chave,
      rotulo: v.rotulo,
      total: v.total,
      quantidade: v.quantidade,
      share_pct: total > 0 ? round2((v.total / total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limite);
}

/**
 * Quanto do limite já está comprometido nos próximos meses por parcelas
 * que ainda vão cair. É o número que ninguém calcula e que estoura o
 * cartão no mês seguinte.
 */
export function comprometidoFuturo(
  parcelas: Array<{ competencia: string; valor: number; pago: boolean }>,
  mesInicial: string,
  meses = 6,
): Array<{ competencia: string; total: number }> {
  const saida: Array<{ competencia: string; total: number }> = [];
  for (let i = 0; i < meses; i++) {
    const competencia = mesDe(addMeses(`${mesInicial}-01`, i));
    const total = soma(
      (parcelas ?? [])
        .filter(p => !p.pago && p.competencia === competencia)
        .map(p => num(p.valor)),
    );
    saida.push({ competencia, total });
  }
  return saida;
}
