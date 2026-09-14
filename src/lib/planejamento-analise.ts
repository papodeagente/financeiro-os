/**
 * Leitura crítica do plano mensal — o que um consultor diria ao olhar os
 * números, incluindo o que está desconfortável.
 *
 * Regra deste módulo: nada de elogio automático. Cada apontamento nasce de
 * um limiar declarado e vem com o número que o disparou, para o leitor poder
 * discordar com base no mesmo dado.
 *
 * Lib pura (sem React/DOM) — testada em scripts/test-planejamento.ts
 */
import type { CustosData, Relatorio } from './planejamento-custos';

export type Gravidade = 'critico' | 'atencao' | 'ok';

export interface Apontamento {
  gravidade: Gravidade;
  titulo: string;
  texto: string;
}

export interface Analise {
  /** Frase de abertura: o plano fecha, e com que folga. */
  veredito: string;
  vereditoGravidade: Gravidade;
  riscos: Apontamento[];
  forcas: Apontamento[];
  /** Próximos passos concretos, na ordem em que compensa atacar. */
  recomendacoes: string[];
}

const brl = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dec1 = (v: number) =>
  (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct0 = (v: number) => `${Math.round(Number.isFinite(v) ? v : 0)}%`;

function percentualSeguro(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor)
    ? Math.min(100, Math.max(0, valor))
    : 0;
}

function listarPremissas(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? 'premissas básicas';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}`;
}

/**
 * Se C é o percentual dos custos que incidem sobre a comissão e V o dos
 * custos que incidem sobre a venda, o empate exige margem * (1 - C) = V.
 * Somar o custo variável observado à margem atual é incorreto porque a parte
 * baseada na comissão também cresce quando a comissão aumenta.
 */
function margemMinimaParaEmpatar(data: CustosData): number | null {
  const custos = Array.isArray(data.custos_variaveis) ? data.custos_variaveis : [];
  let sobreComissao = 0;
  let sobreVenda = 0;

  for (const custo of custos) {
    const percentual = percentualSeguro(custo?.percentual);
    if (custo?.base === 'COMISSAO') sobreComissao += percentual;
    else sobreVenda += percentual;
  }

  const fracaoDisponivel = 1 - (sobreComissao / 100);
  if (fracaoDisponivel <= 0) return null;
  const margemMinima = sobreVenda / fracaoDisponivel;
  return margemMinima < 100 ? margemMinima : null;
}

// Limiares. Explicitados aqui para poderem ser discutidos e ajustados.
const LIMIARES = {
  /** Acima disso o atendimento perde qualidade (agência consultiva). */
  atendimentosPorVendedorDia: 8,
  /** Conversão de lead frio acima disso costuma ser otimismo de planilha. */
  conversaoOtimista: 25,
  /** Abaixo disso o funil provavelmente tem problema de qualificação. */
  conversaoBaixa: 3,
  /** Margem de contribuição apertada: sobra pouco por venda. */
  margemContribuicaoApertada: 40,
  /** Quanto da meta é só para empatar. Acima disso, pouca margem de erro. */
  breakEvenPesado: 70,
  /** Capacidade de aquisição comprometida. */
  aquisicaoComprometida: 85,
  /** Capacidade de aquisição ociosa. */
  aquisicaoOciosa: 40,
  /** Um único custo fixo dominando a estrutura. */
  concentracaoCusto: 60,
  /** Margem que não sustenta mídia paga no mercado brasileiro. */
  cplInviavel: 15,
  /** Vendas por vendedor por dia acima disso é ritmo de operação high-ticket improvável. */
  vendasPorVendedorDia: 2,
};

export function analisarPlano(data: CustosData, rel: Relatorio): Analise {
  const riscos: Apontamento[] = [];
  const forcas: Apontamento[] = [];
  const recomendacoes: string[] = [];

  // ── Veredito ───────────────────────────────────────────────────────────
  let veredito: string;
  let vereditoGravidade: Gravidade;

  if (rel.premissasIncompletas) {
    const faltantes = [
      [data.ticket_medio, 'ticket médio'],
      [data.margem_comissao, 'margem de comissão'],
      [data.taxa_conversao, 'taxa de conversão'],
    ].filter(([valor]) => !(typeof valor === 'number' && Number.isFinite(valor) && valor > 0))
      .map(([, nome]) => String(nome));
    const lista = listarPremissas(faltantes);
    veredito =
      `O plano ainda não pode ser avaliado: falta preencher ${lista}, que ${faltantes.length === 1 ? 'é' : 'são'} ` +
      'a base do cálculo financeiro e comercial.';
    vereditoGravidade = 'critico';
    recomendacoes.push(`Preencha ${lista} para que as metas façam sentido.`);
    return { veredito, vereditoGravidade, riscos, forcas, recomendacoes };
  }

  if (rel.lucroPorVenda <= 0) {
    veredito =
      `O plano não fecha. Cada venda deixa ${brl(rel.comissaoPorVenda)} de comissão mas consome ` +
      `${brl(rel.custoVarPorVenda)} em custos variáveis, dando prejuízo de ${brl(Math.abs(rel.lucroPorVenda))} ` +
      `por venda. Vender mais só aumenta a perda — nenhuma meta de volume resolve.`;
    vereditoGravidade = 'critico';
    riscos.push({
      gravidade: 'critico',
      titulo: 'Margem negativa por venda',
      texto:
        'Enquanto a comissão não cobrir os custos variáveis, o negócio perde dinheiro em cada operação. ' +
        'Isso é anterior a qualquer discussão de volume ou marketing.',
    });
    const margemMinima = margemMinimaParaEmpatar(data);
    if (margemMinima === null) {
      recomendacoes.push(
        'Reduza os custos variáveis: a combinação dos percentuais sobre comissão e venda não deixa margem positiva nem com comissão de 100% do ticket.',
      );
    } else {
      recomendacoes.push(
        `Renegocie a comissão com os fornecedores: ela precisa passar de ${dec1(margemMinima)}% do ticket só para empatar.`,
      );
    }
    recomendacoes.push('Revise os custos variáveis — taxa de cartão e impostos são os candidatos usuais.');
    return { veredito, vereditoGravidade, riscos, forcas, recomendacoes };
  }

  const folga = rel.lucroProjetado - (data.lucro_desejado || 0);
  veredito =
    `O plano fecha: ${rel.vendasMeta} vendas no mês cobrem ${brl(rel.custoFixoMaisMarketing)} de custos e ` +
    `entregam ${brl(rel.lucroProjetado)} de lucro` +
    (folga > 1 ? ` — ${brl(folga)} acima da meta, pelo arredondamento das vendas.` : '.');
  vereditoGravidade = 'ok';

  // ── Esforço comercial ──────────────────────────────────────────────────
  const vendedores = data.vendedores_ativos || 1;
  const vendasPorVendedorDia = rel.vendasMeta / ((data.dias_uteis || 22) * vendedores);

  if (rel.atendimentosPorVendedorDia > LIMIARES.atendimentosPorVendedorDia) {
    riscos.push({
      gravidade: 'critico',
      titulo: 'Time subdimensionado para o volume',
      texto:
        `A meta exige ${rel.atendimentosPorVendedorDia} atendimentos por vendedor a cada dia útil. ` +
        `Acima de ${LIMIARES.atendimentosPorVendedorDia} o atendimento vira triagem: a conversão de ` +
        `${data.taxa_conversao}% que sustenta este plano tende a cair justamente quando o volume aperta. ` +
        `Com ${vendedores} ${vendedores === 1 ? 'vendedor' : 'vendedores'}, o gargalo é de pessoas, não de leads.`,
    });
    const necessarios = Math.ceil(rel.atendimentosMeta / ((data.dias_uteis || 22) * LIMIARES.atendimentosPorVendedorDia));
    recomendacoes.push(
      `Para manter até ${LIMIARES.atendimentosPorVendedorDia} atendimentos por vendedor ao dia, o time precisaria de ` +
      `${necessarios} ${necessarios === 1 ? 'pessoa' : 'pessoas'} — ou a conversão precisa subir.`,
    );
  } else if (rel.atendimentosMeta > 0) {
    forcas.push({
      gravidade: 'ok',
      titulo: 'Carga de atendimento sustentável',
      texto:
        `${rel.atendimentosPorVendedorDia} atendimentos por vendedor ao dia deixa espaço para um atendimento ` +
        `consultivo, que é o que sustenta a conversão de ${data.taxa_conversao}%.`,
    });
  }

  if (vendasPorVendedorDia > LIMIARES.vendasPorVendedorDia) {
    riscos.push({
      gravidade: 'atencao',
      titulo: 'Ritmo de fechamento agressivo',
      texto:
        `São ${dec1(vendasPorVendedorDia)} vendas fechadas por vendedor a cada dia útil, com ticket de ` +
        `${brl(data.ticket_medio)}. Para venda consultiva de viagem esse ritmo é raro — vale conferir se o ` +
        `histórico da agência sustenta essa premissa.`,
    });
  }

  // ── Qualidade das premissas ────────────────────────────────────────────
  if (data.taxa_conversao > LIMIARES.conversaoOtimista) {
    riscos.push({
      gravidade: 'atencao',
      titulo: 'Conversão otimista',
      texto:
        `${data.taxa_conversao}% de conversão é alto para lead vindo de mídia paga. Se o número veio da ` +
        `carteira ou de indicação, ele não se sustenta ao escalar em tráfego frio — e todo o volume de leads ` +
        `deste plano depende dele.`,
    });
    const comMetade = Math.ceil(rel.vendasMeta / (data.taxa_conversao / 200));
    recomendacoes.push(
      `Simule o plano com metade da conversão: seriam ${comMetade} leads em vez de ${rel.atendimentosMeta}. ` +
      `Se o orçamento não suporta, a meta está apoiada numa premissa frágil.`,
    );
  } else if (data.taxa_conversao > 0 && data.taxa_conversao < LIMIARES.conversaoBaixa) {
    riscos.push({
      gravidade: 'atencao',
      titulo: 'Conversão baixa encarece a aquisição',
      texto:
        `Com ${data.taxa_conversao}% de conversão são necessários ${rel.atendimentosMeta} leads para ` +
        `${rel.vendasMeta} vendas. Antes de aumentar a verba, vale investigar qualificação e velocidade de resposta: ` +
        `cada ponto de conversão recuperado vale mais que o mesmo dinheiro em mídia.`,
    });
  }

  // ── Estrutura de margem ────────────────────────────────────────────────
  if (rel.margemContribuicaoPct < LIMIARES.margemContribuicaoApertada) {
    riscos.push({
      gravidade: 'atencao',
      titulo: 'Margem de contribuição apertada',
      texto:
        `De cada ${brl(rel.comissaoPorVenda)} de comissão, ${brl(rel.custoVarPorVenda)} vão embora em custos ` +
        `variáveis e sobram ${brl(rel.lucroPorVenda)} (${pct0(rel.margemContribuicaoPct)}). Com pouca sobra por venda, ` +
        `o resultado do mês fica muito sensível a qualquer variação de volume.`,
    });
  } else {
    forcas.push({
      gravidade: 'ok',
      titulo: 'Boa margem de contribuição',
      texto:
        `${pct0(rel.margemContribuicaoPct)} da comissão sobra depois dos custos variáveis (${brl(rel.lucroPorVenda)} ` +
        `por venda). É o que dá fôlego para investir em aquisição.`,
    });
  }

  // ── Segurança do plano ─────────────────────────────────────────────────
  const pesoBreakEven = rel.vendasMeta > 0 ? (rel.vendasBreakEven / rel.vendasMeta) * 100 : 0;
  if (pesoBreakEven > LIMIARES.breakEvenPesado) {
    riscos.push({
      gravidade: 'critico',
      titulo: 'Pouca margem de erro',
      texto:
        `${rel.vendasBreakEven} das ${rel.vendasMeta} vendas (${pct0(pesoBreakEven)}) servem apenas para pagar a ` +
        `estrutura. Só as últimas ${rel.vendasMeta - rel.vendasBreakEven} viram lucro, então um mês 20% abaixo do ` +
        `previsto já elimina quase todo o resultado.`,
    });
    recomendacoes.push(
      'Reduza custo fixo ou aumente a margem por venda: com o ponto de equilíbrio tão perto da meta, o plano não tem amortecedor.',
    );
  } else if (rel.vendasMeta > 0) {
    forcas.push({
      gravidade: 'ok',
      titulo: 'Estrutura leve para a meta',
      texto:
        `Os custos são cobertos com ${rel.vendasBreakEven} das ${rel.vendasMeta} vendas (${pct0(pesoBreakEven)} da meta). ` +
        `O que passa disso é lucro, o que dá alguma tolerância a um mês fraco.`,
    });
  }

  // ── Concentração de custo fixo ─────────────────────────────────────────
  const maiorFixo = [...data.custos_fixos].sort((a, b) => (b.valor || 0) - (a.valor || 0))[0];
  if (maiorFixo && rel.custoFixoTotal > 0) {
    const share = (maiorFixo.valor / rel.custoFixoTotal) * 100;
    if (share > LIMIARES.concentracaoCusto) {
      riscos.push({
        gravidade: 'atencao',
        titulo: `Custo concentrado em ${maiorFixo.categoria.toLowerCase()}`,
        texto:
          `${maiorFixo.categoria} responde por ${pct0(share)} dos custos fixos (${brl(maiorFixo.valor)} de ` +
          `${brl(rel.custoFixoTotal)}). Concentração alta significa que qualquer corte relevante passa por essa ` +
          `linha — e ela costuma ser a mais difícil de mexer.`,
      });
    }
  }

  // ── Aquisição ──────────────────────────────────────────────────────────
  if (rel.cplTeto > 0 && rel.cplTeto < LIMIARES.cplInviavel) {
    riscos.push({
      gravidade: 'critico',
      titulo: 'Margem não sustenta mídia paga',
      texto:
        `A margem suporta no máximo ${brl(rel.cplTeto)} por lead. Nenhum canal pago entrega lead qualificado a ` +
        `esse custo no Brasil, então o crescimento previsto depende de canais próprios: carteira, indicação e ` +
        `relacionamento.`,
    });
  } else if (rel.marketingTotal > 0 && rel.usoDoTetoPct >= LIMIARES.aquisicaoComprometida) {
    riscos.push({
      gravidade: 'atencao',
      titulo: 'Resultado dependente de mídia',
      texto:
        `O marketing já consome ${pct0(rel.usoDoTetoPct)} do que a margem suporta por lead ` +
        `(${brl(rel.cplAtual)} de um teto de ${brl(rel.cplTeto)}). Nesse patamar, qualquer piora no custo de ` +
        `mídia ou na conversão come o lucro direto.`,
    });
  } else if (rel.marketingTotal > 0 && rel.usoDoTetoPct < LIMIARES.aquisicaoOciosa) {
    forcas.push({
      gravidade: 'ok',
      titulo: 'Espaço para crescer via aquisição',
      texto:
        `Cada lead custa ${brl(rel.cplAtual)} e a margem suporta até ${brl(rel.cplTeto)} — ` +
        `${pct0(rel.usoDoTetoPct)} do teto. Há folga para investir mais em mídia sem comprometer a rentabilidade, ` +
        `desde que a conversão se mantenha.`,
    });
    recomendacoes.push(
      `Teste um aumento gradual de verba: enquanto o custo por lead ficar abaixo de ${brl(rel.cplTeto)}, ` +
      `cada venda adicional continua lucrativa.`,
    );
  } else if (rel.marketingTotal === 0) {
    riscos.push({
      gravidade: 'atencao',
      titulo: 'Plano sem verba de aquisição',
      texto:
        `Não há investimento em marketing previsto, mas a meta exige ${rel.atendimentosMeta} leads no mês. ` +
        `O plano assume que esse volume virá de canais próprios — vale confirmar se a carteira sustenta isso.`,
    });
  }

  // ── Dependência de um único canal ──────────────────────────────────────
  if (rel.marketingTotal > 0) {
    const maiorCanal = [...data.marketing].sort((a, b) => (b.valor || 0) - (a.valor || 0))[0];
    if (maiorCanal && maiorCanal.valor / rel.marketingTotal > 0.6) {
      riscos.push({
        gravidade: 'atencao',
        titulo: `Aquisição concentrada em ${maiorCanal.canal}`,
        texto:
          `${pct0((maiorCanal.valor / rel.marketingTotal) * 100)} da verba está em um canal só. ` +
          `Mudança de algoritmo, leilão ou conta bloqueada viram risco direto de faturamento.`,
      });
    }
  }

  // ── Recomendações finais, na ordem de maior alavanca ────────────────────
  if (recomendacoes.length === 0) {
    recomendacoes.push(
      `Acompanhe semanalmente o ritmo: ${dec1(rel.vendasPorDia)} vendas e ${rel.atendimentosPorDia} atendimentos por dia útil.`,
    );
  }
  recomendacoes.push(
    `Registre a conversão real do mês e compare com os ${data.taxa_conversao}% assumidos — é a premissa que mais move este plano.`,
  );

  const temCritico = riscos.some(r => r.gravidade === 'critico');
  if (temCritico) vereditoGravidade = 'atencao';

  return { veredito, vereditoGravidade, riscos, forcas, recomendacoes };
}
