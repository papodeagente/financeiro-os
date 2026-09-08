/**
 * Faixa de comissão pelo ACUMULADO DO MÊS, não pela venda individual.
 *
 * O defeito que isto corrige: a faixa era escolhida com a base de cada
 * venda isolada. Um vendedor que fez R$ 10.000 numa venda e R$ 200 em
 * outra caía em duas faixas diferentes (10% e o percentual padrão), quando
 * o acumulado de R$ 10.200 já o tinha colocado na faixa de 13,5%.
 *
 * Modelo adotado, que é o de escada retroativa e o mais usado em agência:
 * o acumulado do mês define UMA alíquota, e ela vale para TODO o mês, não
 * só para o excedente. Atingiu a faixa, o mês inteiro sobe para ela.
 *
 * O total do mês é então distribuído entre as vendas proporcionalmente à
 * base de cada uma, com o resíduo de centavo no maior item, para a soma
 * das comissões bater exatamente com o total do mês.
 */
import { round2, num, soma, divSegura, ratearDesconto } from './money';
import type { FaixaComissao, PlanoComissao } from './crm-types';

export interface VendaParaComissao {
  venda_id: string;
  /** Base já calculada pela regra do plano (markup, receita, etc). */
  base: number;
  /** Percentual que as regras de produto e o padrão do plano dariam.
   *  Só é usado quando NENHUMA faixa casa com o acumulado. */
  pct_fallback: number;
}

export interface ComissaoDistribuida {
  venda_id: string;
  base: number;
  /** Alíquota do mês. Igual para todas as vendas do mesmo vendedor no mês. */
  percentual: number;
  valor: number;
}

export interface ResultadoMes {
  base_acumulada: number;
  percentual: number;
  total: number;
  /** De onde veio a alíquota, para a tela poder explicar o número. */
  origem: 'FAIXA' | 'PADRAO';
  faixa: FaixaComissao | null;
  itens: ComissaoDistribuida[];
}

/**
 * Acha a faixa que contém o valor. `ate` igual a 0 significa "sem teto",
 * que é como o cadastro representa a última faixa aberta.
 */
export function faixaDoValor(faixas: FaixaComissao[], valor: number): FaixaComissao | null {
  const v = round2(valor);
  const ordenadas = [...(faixas ?? [])].sort((a, b) => num(a.de) - num(b.de));
  for (const f of ordenadas) {
    const de = num(f.de);
    const ate = num(f.ate);
    if (v >= de && (ate === 0 || v <= ate)) return f;
  }
  // Acima da última faixa fechada: vale a de maior teto, senão não há faixa.
  // Sem isto, quem vende MAIS que o topo da tabela cairia no percentual
  // padrão e ganharia MENOS que quem vendeu menos.
  const ultima = ordenadas[ordenadas.length - 1];
  if (ultima && v > num(ultima.ate) && num(ultima.ate) !== 0) return ultima;
  return null;
}

/**
 * Calcula a comissão do mês de UM vendedor sob UM plano.
 *
 * `vendas` são todas as vendas elegíveis daquele vendedor no mês, com a
 * base já apurada. A ordem não importa para o total; importa apenas para o
 * resíduo de centavo, que vai para o item de maior base.
 */
export function calcularComissaoDoMes(
  vendas: VendaParaComissao[],
  plano: Pick<PlanoComissao, 'faixas' | 'percentual_padrao'>,
): ResultadoMes {
  const itensValidos = (vendas ?? []).filter(v => v && Number.isFinite(num(v.base)));
  const bases = itensValidos.map(v => round2(num(v.base)));
  const base_acumulada = soma(bases);

  const faixa = faixaDoValor(plano?.faixas ?? [], base_acumulada);

  // Sem faixa que case, cada venda mantém o percentual que as regras de
  // produto lhe deram. Nesse caso não há alíquota única do mês, e o
  // percentual devolvido é o médio ponderado, só para exibição.
  if (!faixa) {
    const itens = itensValidos.map((v, i) => {
      const pct = round2(num(v.pct_fallback));
      return {
        venda_id: v.venda_id,
        base: bases[i],
        percentual: pct,
        valor: round2(bases[i] * pct / 100),
      };
    });
    const total = soma(itens.map(i => i.valor));
    return {
      base_acumulada,
      percentual: base_acumulada > 0 ? round2(divSegura(total, base_acumulada) * 100) : 0,
      total,
      origem: 'PADRAO',
      faixa: null,
      itens,
    };
  }

  const percentual = round2(num(faixa.percentual));
  const total = round2(base_acumulada * percentual / 100);

  // Distribui o total proporcionalmente à base. ratearDesconto devolve
  // valores cuja soma é exatamente (soma - desconto); passando o desconto
  // como (soma das bases - total) o resultado soma exatamente `total`,
  // com o resíduo de centavo no maior item.
  const valores = bases.length > 0
    ? ratearDesconto(bases, round2(base_acumulada - total))
    : [];

  return {
    base_acumulada,
    percentual,
    total,
    origem: 'FAIXA',
    faixa,
    itens: itensValidos.map((v, i) => ({
      venda_id: v.venda_id,
      base: bases[i],
      percentual,
      valor: valores[i] ?? 0,
    })),
  };
}

/** Chave de agrupamento: um acumulado por vendedor e por mês. */
export function chaveAcumulado(vendedorId: string, mes: string): string {
  return `${vendedorId}::${mes}`;
}

export interface PosicaoNaEscala {
  /** 1 a N. Zero quando o acumulado ainda não alcançou faixa nenhuma. */
  indice: number;
  total: number;
  atual: FaixaComissao | null;
  proxima: FaixaComissao | null;
  /** Quanto falta de base para entrar na próxima faixa. Null no topo. */
  falta_para_proxima: number | null;
  /** Quanto a mais o mês inteiro renderia ao cruzar a próxima faixa.
   *  Como a escada é retroativa, o salto vale para todo o acumulado. */
  ganho_na_proxima: number | null;
}

/**
 * Onde o vendedor está na escada de comissão e o que falta para subir.
 *
 * Existe porque "13,5%" sozinho não diz nada: o que motiva é saber que
 * faltam R$ 800 para o mês inteiro passar a valer 16%.
 */
export function posicaoNaEscala(
  faixas: FaixaComissao[],
  baseAcumulada: number,
): PosicaoNaEscala {
  const ordenadas = [...(faixas ?? [])].sort((a, b) => num(a.de) - num(b.de));
  const total = ordenadas.length;
  if (total === 0) {
    return { indice: 0, total: 0, atual: null, proxima: null, falta_para_proxima: null, ganho_na_proxima: null };
  }

  const base = round2(baseAcumulada);
  const atual = faixaDoValor(ordenadas, base);
  const indice = atual ? ordenadas.findIndex(f => f === atual) + 1 : 0;

  // A próxima é a primeira faixa que começa acima do acumulado de hoje.
  const proxima = ordenadas.find(f => num(f.de) > base) ?? null;

  if (!proxima) {
    return { indice, total, atual, proxima: null, falta_para_proxima: null, ganho_na_proxima: null };
  }

  const falta = round2(num(proxima.de) - base);
  const pctAtual = atual ? num(atual.percentual) : 0;
  const baseNaProxima = round2(num(proxima.de));
  const ganho = round2(
    baseNaProxima * num(proxima.percentual) / 100 - base * pctAtual / 100,
  );

  return {
    indice,
    total,
    atual,
    proxima,
    falta_para_proxima: falta > 0 ? falta : 0,
    ganho_na_proxima: ganho,
  };
}
