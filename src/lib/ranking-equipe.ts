/**
 * Ranking e progresso de metas da equipe.
 *
 * A tela ficava em branco porque só olhava a tabela `metas`, que guarda a
 * meta de UM mês específico. Como a meta mensal agora vive no cadastro da
 * pessoa, o mês sem meta explícita passa a herdar a do cadastro, e a tela
 * só fica vazia quando realmente não há ninguém com meta.
 *
 * Dinheiro sempre por round2/soma. Mês sempre por mesDe, que é data civil.
 */
import { round2, num, soma, divSegura, mesDe } from './money';
import type { Membro, MetaVendedor, VendaCRM, ComissaoVenda } from './crm-types';

/** Status de venda que conta como realizado. Igual ao motor de comissão. */
export const STATUS_REALIZADO = ['CONFIRMADO', 'CONCLUIDO'] as const;

export type OrigemMeta = 'MES' | 'CADASTRO' | 'SEM_META';

export interface LinhaRanking {
  vendedor_id: string;
  vendedor_nome: string;
  meta_valor: number;
  meta_quantidade: number;
  realizado_valor: number;
  realizado_quantidade: number;
  pct_valor: number;
  pct_quantidade: number;
  comissao_mes: number;
  /** De onde veio a meta: do mês, do cadastro da pessoa, ou não existe. */
  origem_meta: OrigemMeta;
  /** 1 é o primeiro. Quem não tem meta nem venda não recebe posição. */
  posicao: number | null;
  /** Falso quando a pessoa não tem meta. A tela precisa disso para não
   *  pintar de vermelho quem vendeu bem e só não tem meta definida: sem
   *  meta, 0% não é desempenho ruim, é ausência de referência. */
  tem_meta: boolean;
}

export interface ResumoEquipe {
  linhas: LinhaRanking[];
  meta_total: number;
  realizado_total: number;
  pct_equipe: number;
  comissoes_mes: number;
  /** Pessoas sem meta que ainda assim venderam: entram no ranking, mas
   *  sem barra de progresso. */
  sem_meta_com_venda: number;
  /** Pessoas sem meta e sem venda: ficam fora do ranking. É esta lista que
   *  a tela deve oferecer para definir meta. */
  fora_do_ranking: string[];
  /** Vendas do mês cujo vendedor não está na equipe. */
  vendas_sem_vendedor: number;
}

/** Casa o vendedor da venda com a pessoa da equipe, cobrindo o id antigo. */
export function pessoaDaVenda(equipe: Membro[], vendedorId: string): Membro | undefined {
  if (!vendedorId) return undefined;
  return (
    equipe.find(p => p.id === vendedorId) ??
    equipe.find(p => (p.membro_ids_legado ?? []).includes(vendedorId))
  );
}

export function montarRanking(entrada: {
  equipe: Membro[];
  metas: MetaVendedor[];
  vendas: VendaCRM[];
  comissoes: ComissaoVenda[];
  mes: string; // 'YYYY-MM'
}): ResumoEquipe {
  const { equipe, metas, vendas, comissoes, mes } = entrada;

  const ativos = equipe.filter(p => p.status === 'ATIVO');
  const metasDoMes = metas.filter(m => m.mes_referencia === mes);

  const vendasDoMes = vendas.filter(
    v => (STATUS_REALIZADO as readonly string[]).includes(v.status) && mesDe(v.data_venda) === mes,
  );
  const comissoesDoMes = comissoes.filter(
    c => c.status !== 'CANCELADA' && mesDe(c.data_venda) === mes,
  );

  let vendasSemVendedor = 0;
  const realizadoPorPessoa = new Map<string, { valor: number; qtd: number }>();
  for (const v of vendasDoMes) {
    const pessoa = pessoaDaVenda(ativos, v.vendedor_id);
    if (!pessoa) { vendasSemVendedor++; continue; }
    const atual = realizadoPorPessoa.get(pessoa.id) ?? { valor: 0, qtd: 0 };
    // valor_final é o que a agência faturou na venda, já com desconto.
    // É a mesma base que o dashboard usa para faturamento do mês.
    atual.valor = round2(atual.valor + num(v.valor_final));
    atual.qtd += 1;
    realizadoPorPessoa.set(pessoa.id, atual);
  }

  const comissaoPorPessoa = new Map<string, number>();
  for (const c of comissoesDoMes) {
    const pessoa = pessoaDaVenda(ativos, c.vendedor_id);
    if (!pessoa) continue;
    comissaoPorPessoa.set(
      pessoa.id,
      round2((comissaoPorPessoa.get(pessoa.id) ?? 0) + num(c.valor_comissao)),
    );
  }

  const linhas: LinhaRanking[] = ativos.map(p => {
    const doMes = metasDoMes.find(m => m.vendedor_id === p.id);
    const metaCadastro = num(p.meta_mensal_vendas);

    let meta_valor = 0;
    let meta_quantidade = 0;
    let origem_meta: OrigemMeta = 'SEM_META';

    if (doMes) {
      meta_valor = round2(num(doMes.meta_valor));
      meta_quantidade = num(doMes.meta_quantidade);
      origem_meta = 'MES';
    } else if (metaCadastro > 0) {
      meta_valor = round2(metaCadastro);
      meta_quantidade = num(p.meta_mensal_quantidade);
      origem_meta = 'CADASTRO';
    }

    const real = realizadoPorPessoa.get(p.id) ?? { valor: 0, qtd: 0 };

    return {
      vendedor_id: p.id,
      vendedor_nome: p.nome,
      meta_valor,
      meta_quantidade,
      realizado_valor: real.valor,
      realizado_quantidade: real.qtd,
      // Sem meta o percentual é 0, nunca infinito nem 100 por acaso.
      pct_valor: meta_valor > 0 ? round2(divSegura(real.valor, meta_valor) * 100) : 0,
      pct_quantidade: meta_quantidade > 0 ? round2(divSegura(real.qtd, meta_quantidade) * 100) : 0,
      comissao_mes: comissaoPorPessoa.get(p.id) ?? 0,
      origem_meta,
      posicao: null,
      tem_meta: meta_valor > 0,
    };
  });

  // Quem tem meta OU vendeu participa do ranking. Quem não tem nem uma
  // coisa nem outra fica fora, para não aparecer como último de uma
  // disputa da qual não faz parte.
  const participa = (l: LinhaRanking) => l.meta_valor > 0 || l.realizado_valor > 0;

  // Com meta, o mérito é o percentual atingido. Sem meta, o único mérito
  // observável é quanto vendeu. Ordenar os dois grupos pela mesma régua
  // colocaria quem vendeu R$ 15.000 sem meta atrás de quem vendeu R$ 100
  // e bateu a meta de R$ 90, o que ninguém aceitaria como ranking.
  linhas.sort((a, b) => {
    const pa = participa(a), pb = participa(b);
    if (pa !== pb) return pa ? -1 : 1;
    if (a.tem_meta !== b.tem_meta) return a.tem_meta ? -1 : 1;
    if (a.tem_meta) {
      if (b.pct_valor !== a.pct_valor) return b.pct_valor - a.pct_valor;
    }
    if (b.realizado_valor !== a.realizado_valor) return b.realizado_valor - a.realizado_valor;
    return a.vendedor_nome.localeCompare(b.vendedor_nome, 'pt-BR');
  });
  let posicao = 0;
  for (const l of linhas) l.posicao = participa(l) ? ++posicao : null;

  const meta_total = soma(linhas.map(l => l.meta_valor));
  const realizado_total = soma(linhas.map(l => l.realizado_valor));

  return {
    linhas,
    meta_total,
    realizado_total,
    pct_equipe: meta_total > 0 ? round2(divSegura(realizado_total, meta_total) * 100) : 0,
    comissoes_mes: soma(linhas.map(l => l.comissao_mes)),
    sem_meta_com_venda: linhas.filter(l => !l.tem_meta && l.posicao !== null).length,
    fora_do_ranking: linhas.filter(l => l.posicao === null).map(l => l.vendedor_nome),
    vendas_sem_vendedor: vendasSemVendedor,
  };
}
