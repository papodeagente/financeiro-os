/**
 * RECEITA DA VENDA, aberta por componente e configurável (E5, parte A).
 *
 * A agência escolhe quais componentes contam como receita dela (em
 * Configurações › Vendas): há quem trate a Taxa DU como repasse e não como
 * ganho, há quem não conte o Over até recebê-lo. A escolha muda SÓ a receita
 * mostrada e somada (painel, comissão "sobre a receita", nota fiscal); o
 * dinheiro que circula (contas a pagar e a receber) é o mesmo.
 *
 * Arquivo puro. Valores em centavos de real.
 */

import {
  COMPONENTES, TIPOS_COMPONENTE, ROTULO_TIPO_PRODUTO, componentesZerados, totaisDoProduto,
  type Centavos, type TipoComponente, type TipoProduto, type ValoresPorComponente, type Venda,
} from './venda-modelo';

export interface ConfigReceita {
  /** Componente → entra na receita da agência? */
  componentes: Record<TipoComponente, boolean>;
}

/** Padrão: todo componente conta (é a fórmula do mercado). */
export const CONFIG_RECEITA_PADRAO: ConfigReceita = {
  componentes: Object.fromEntries(TIPOS_COMPONENTE.map(t => [t, true])) as Record<TipoComponente, boolean>,
};

export function normalizarConfigReceita(v: unknown): ConfigReceita {
  const o = (v && typeof v === 'object' ? (v as Record<string, unknown>).componentes : null) as Record<string, unknown> | null;
  const componentes = { ...CONFIG_RECEITA_PADRAO.componentes };
  if (o && typeof o === 'object') {
    for (const t of TIPOS_COMPONENTE) if (typeof o[t] === 'boolean') componentes[t] = o[t] as boolean;
  }
  return { componentes };
}

export interface LinhaDeReceita {
  tipo: TipoComponente;
  rotulo: string;
  /** +1 soma, −1 tira. */
  sinal: 1 | -1;
  /** Valor do componente (sempre positivo); o sinal diz se soma ou tira. */
  valor: Centavos;
  /** A agência conta este componente como receita? */
  entra: boolean;
}

export interface ReceitaDoProduto {
  produto_id: string;
  sequencia: number;
  tipo: TipoProduto;
  rotulo_tipo: string;
  descricao: string;
  /** Valor que o cliente paga por este produto (faturamento). */
  faturamento: Centavos;
  componentes: ValoresPorComponente;
  receita: Centavos;
}

export interface ReceitaDaVenda {
  /** Uma linha por componente que tem valor na venda, na ordem do mercado. */
  linhas: LinhaDeReceita[];
  por_produto: ReceitaDoProduto[];
  /** Soma dos componentes que entram (com sinal). */
  receita: Centavos;
  /** Soma dos componentes que a agência deixou de fora (com sinal). */
  fora_da_receita: Centavos;
  /** Valor total que o cliente paga. */
  faturamento: Centavos;
  /** Receita ÷ faturamento × 100, duas casas. */
  percentual: number;
}

function receitaDe(comp: ValoresPorComponente, cfg: ConfigReceita, entra: boolean): Centavos {
  let r = 0;
  for (const t of TIPOS_COMPONENTE) if (cfg.componentes[t] === entra) r += COMPONENTES[t].sinal * comp[t];
  return r;
}

/**
 * A receita da venda, aberta por componente e por produto, com a escolha da
 * agência. A soma de `receita` e `fora_da_receita` é sempre a receita bruta
 * (cliente − fornecedor − repasse).
 */
export function receitaDaVenda(venda: Pick<Venda, 'produtos'>, config: ConfigReceita = CONFIG_RECEITA_PADRAO): ReceitaDaVenda {
  const total = componentesZerados();
  const por_produto: ReceitaDoProduto[] = [];
  let faturamento = 0;
  for (const p of venda.produtos) {
    const t = totaisDoProduto(p);
    for (const k of TIPOS_COMPONENTE) total[k] += t.brl.componentes[k];
    faturamento += t.brl.valor_cliente;
    por_produto.push({
      produto_id: p.id, sequencia: p.sequencia, tipo: p.tipo, rotulo_tipo: ROTULO_TIPO_PRODUTO[p.tipo],
      descricao: p.descricao, faturamento: t.brl.valor_cliente, componentes: t.brl.componentes,
      receita: receitaDe(t.brl.componentes, config, true),
    });
  }
  const linhas: LinhaDeReceita[] = TIPOS_COMPONENTE
    .filter(t => total[t] !== 0)
    .map(t => ({ tipo: t, rotulo: COMPONENTES[t].rotulo, sinal: COMPONENTES[t].sinal, valor: total[t], entra: config.componentes[t] }));
  const receita = receitaDe(total, config, true);
  return {
    linhas,
    por_produto,
    receita,
    fora_da_receita: receitaDe(total, config, false),
    faturamento,
    percentual: faturamento > 0 ? Math.round((receita / faturamento) * 10000) / 100 : 0,
  };
}
