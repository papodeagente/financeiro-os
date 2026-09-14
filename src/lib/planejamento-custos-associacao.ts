import type { FunilPayload } from './funil-types';
import { CANAIS_MARKETING, type CanalMarketing } from './planejamento-custos';
import { round2, soma } from './money';

export interface FunilResumoAssociavel {
  count: number;
  simulados: number;
  emExecucao: number;
  investimentoTotal: number;
  /** Volume bruto vendido no cenário do funil; não é receita própria. */
  volumeVendasProjetado: number;
  /** Investimento agrupado pelos canais exibidos no planejamento mensal. */
  porCanal: Record<string, number>;
}

const CANAIS_POR_NOME = new Map(
  CANAIS_MARKETING.map(canal => [normalizarTexto(canal), canal]),
);

function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function numeroNaoNegativo(valor: unknown): number {
  let candidato = valor;
  if (typeof candidato === 'string') {
    const limpo = candidato.trim();
    candidato = limpo.includes(',')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : limpo;
  }

  const numero = typeof candidato === 'number' ? candidato : Number(candidato);
  return Number.isFinite(numero) && numero > 0 ? round2(numero) : 0;
}

function canalCanonicoPersistido(canal: string): string | null {
  const nome = normalizarTexto(canal);
  const canonico = CANAIS_POR_NOME.get(nome);
  if (canonico) return canonico;

  if (nome === 'ads_meta' || nome === 'meta_ads' || nome === 'facebook_ads') {
    return 'Instagram Ads';
  }
  if (nome === 'ads_google' || nome === 'google_adwords' || nome === 'sem') {
    return 'Google Ads';
  }
  if (nome === 'influencer' || nome === 'influencers') return 'Influenciadores';
  if (nome === 'affiliate' || nome === 'affiliate_marketing') return 'Afiliados';

  return null;
}

/**
 * Converte tipos de tráfego do simulador para os canais disponíveis em Custos.
 * Tipos sem linha dedicada (TikTok, YouTube, LinkedIn etc.) entram em "Outros".
 */
export function canalMarketingDoTipo(tipo: unknown): string {
  const nome = normalizarTexto(typeof tipo === 'string' ? tipo : '');

  if (nome.includes('instagram') || nome.includes('facebook') || nome.includes('meta')) {
    return 'Instagram Ads';
  }
  if (nome.includes('google') || nome === 'sem' || nome.startsWith('sem_')) {
    return 'Google Ads';
  }
  if (nome.includes('influen')) return 'Influenciadores';
  if (nome.includes('evento')) return 'Eventos';
  if (nome.includes('afiliad') || nome.includes('affiliate')) return 'Afiliados';
  return 'Outros';
}

/**
 * Recompõe as linhas canônicas e consolida duplicatas sem descartar canais
 * legados/customizados. Isso impede que um canal ausente esconda a importação
 * e que linhas duplicadas contem o mesmo investimento mais de uma vez.
 */
export function normalizarMarketing(marketing: unknown): CanalMarketing[] {
  const totais = new Map<string, number>();
  const rotulosCustomizados = new Map<string, string>();

  if (Array.isArray(marketing)) {
    for (const entrada of marketing) {
      if (!entrada || typeof entrada !== 'object') continue;
      const bruto = entrada as { canal?: unknown; valor?: unknown };
      if (typeof bruto.canal !== 'string' || !bruto.canal.trim()) continue;

      const canalCanonico = canalCanonicoPersistido(bruto.canal);
      const chave = canalCanonico ?? `custom:${normalizarTexto(bruto.canal)}`;
      if (chave === 'custom:') continue;

      if (!canalCanonico && !rotulosCustomizados.has(chave)) {
        rotulosCustomizados.set(chave, bruto.canal.trim());
      }
      totais.set(chave, soma([totais.get(chave), numeroNaoNegativo(bruto.valor)]));
    }
  }

  const resultado: CanalMarketing[] = CANAIS_MARKETING.map(canal => ({
    canal,
    valor: totais.get(canal) ?? 0,
  }));

  for (const [chave, rotulo] of rotulosCustomizados) {
    resultado.push({ canal: rotulo, valor: totais.get(chave) ?? 0 });
  }

  return resultado;
}

/**
 * Funis simulados já possuem um orçamento utilizável. Enquanto o produto não
 * oferece a transição manual para "em_execucao", ambos os estados são fontes
 * elegíveis; rascunhos nunca são importados.
 */
export function resumirFunisAssociaveis(
  funis: readonly FunilPayload[],
): FunilResumoAssociavel {
  const elegiveis = funis.filter(
    funil => funil?.status === 'simulado' || funil?.status === 'em_execucao',
  );
  const porCanal: Record<string, number> = {};
  let investimentoTotal = 0;
  let volumeVendasProjetado = 0;

  for (const funil of elegiveis) {
    const nodes = Array.isArray(funil.data?.nodes) ? funil.data.nodes : [];
    for (const node of nodes) {
      if (node?.data?.categoria !== 'trafego') continue;

      const investimento = numeroNaoNegativo(node.data.config?.investimento);
      if (investimento === 0) continue;

      const canal = canalMarketingDoTipo(node.data.tipo);
      investimentoTotal = soma([investimentoTotal, investimento]);
      porCanal[canal] = soma([porCanal[canal], investimento]);
    }

    const cenarios = Array.isArray(funil.data?.cenarios) ? funil.data.cenarios : [];
    const cenario = cenarios.find(item => item.id === 'baseline' && item.kpis)
      ?? cenarios.find(item => item.kpis);
    volumeVendasProjetado = soma([volumeVendasProjetado, numeroNaoNegativo(cenario?.kpis?.receita_bruta)]);
  }

  return {
    count: elegiveis.length,
    simulados: elegiveis.filter(funil => funil.status === 'simulado').length,
    emExecucao: elegiveis.filter(funil => funil.status === 'em_execucao').length,
    investimentoTotal,
    volumeVendasProjetado,
    porCanal,
  };
}

/** Aplica apenas os canais presentes nos funis e preserva os demais valores. */
export function aplicarInvestimentoDosFunis(
  marketing: unknown,
  resumo: Pick<FunilResumoAssociavel, 'porCanal'>,
): CanalMarketing[] {
  return normalizarMarketing(marketing).map(item => (
    Object.prototype.hasOwnProperty.call(resumo.porCanal, item.canal)
      ? { ...item, valor: numeroNaoNegativo(resumo.porCanal[item.canal]) }
      : item
  ));
}
