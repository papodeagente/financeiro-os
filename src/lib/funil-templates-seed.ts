/**
 * Seed de 6 templates pré-configurados para o simulador de funis.
 *
 * Executado dentro de initDB() com INSERT ... WHERE NOT EXISTS (idempotente).
 * Cada template tem ids fixos (tpl-01..tpl-06) para que re-runs nunca
 * dupliquem.
 *
 * Ordem de posicionamento: nodes são dispostos em uma linha horizontal
 * com 220px de espaçamento, 200px em y. O usuário pode reposicionar
 * à vontade depois.
 */

import type { FunilTemplate, NodeFunil, EdgeFunil } from './funil-types';

const Y = 200;
const STEP_X = 220;
const START_X = 80;

function node(
  idx: number,
  tipo: NodeFunil['data']['tipo'],
  categoria: NodeFunil['data']['categoria'],
  label: string,
  config: NodeFunil['data']['config'],
): NodeFunil {
  return {
    id: `n${idx + 1}`,
    type: 'funilNode',
    position: { x: START_X + idx * STEP_X, y: Y },
    data: { tipo, categoria, label, config },
  };
}

function chainEdges(count: number): EdgeFunil[] {
  const edges: EdgeFunil[] = [];
  for (let i = 0; i < count - 1; i++) {
    edges.push({
      id: `e${i + 1}`,
      source: `n${i + 1}`,
      target: `n${i + 2}`,
      type: 'smoothstep',
      taxa_conversao_override: null,
    });
  }
  return edges;
}

// ----------------------------------------------------------------------------
// Template 1: Instagram Ads → Landing → WhatsApp → Grupo
// ----------------------------------------------------------------------------
const tpl01Nodes: NodeFunil[] = [
  node(0, 'ads_meta', 'trafego', 'Instagram Ads', {
    visitantes: 10000, investimento: 3000, cpc: 0.3, taxa_conversao: 100,
  }),
  node(1, 'landing_page', 'captura', 'Landing page', {
    taxa_conversao: 15,
  }),
  node(2, 'whatsapp_ativo', 'nutricao', 'WhatsApp ativo', {
    taxa_conversao: 40, taxa_resposta: 60,
  }),
  node(3, 'proposta_enviada', 'proposta', 'Proposta enviada', {
    taxa_conversao: 30,
  }),
  node(4, 'pagamento', 'fechamento', 'Fechamento', {
    taxa_conversao: 80, valor_produto: 4500, margem_liquida: 35,
  }),
];

// ----------------------------------------------------------------------------
// Template 2: Google Ads → Formulário → SDR → Proposta → Contrato
// ----------------------------------------------------------------------------
const tpl02Nodes: NodeFunil[] = [
  node(0, 'ads_google', 'trafego', 'Google Ads', {
    visitantes: 5000, investimento: 4000, cpc: 0.8, taxa_conversao: 100,
  }),
  node(1, 'formulario', 'captura', 'Formulário do site', {
    taxa_conversao: 12,
  }),
  node(2, 'sdr_ligacao', 'qualificacao', 'SDR qualifica', {
    taxa_conversao: 50, custo_por_unidade: 5,
  }),
  node(3, 'apresentacao', 'proposta', 'Apresentação', {
    taxa_conversao: 45,
  }),
  node(4, 'contrato', 'fechamento', 'Contrato', {
    taxa_conversao: 70, valor_produto: 8000, margem_liquida: 30,
  }),
];

// ----------------------------------------------------------------------------
// Template 3: SEO orgânico → Lead magnet → E-mail → Agendamento
// ----------------------------------------------------------------------------
const tpl03Nodes: NodeFunil[] = [
  node(0, 'seo_organico', 'trafego', 'Tráfego orgânico', {
    visitantes: 8000, investimento: 500, taxa_conversao: 100,
  }),
  node(1, 'lead_magnet', 'captura', 'E-book grátis', {
    taxa_conversao: 10,
  }),
  node(2, 'email_sequencia', 'nutricao', 'Sequência de e-mail', {
    taxa_conversao: 25, taxa_abertura: 40,
  }),
  node(3, 'agendamento', 'qualificacao', 'Agendamento', {
    taxa_conversao: 35,
  }),
  node(4, 'apresentacao', 'proposta', 'Apresentação', {
    taxa_conversao: 50,
  }),
  node(5, 'venda_direta', 'fechamento', 'Venda', {
    taxa_conversao: 60, valor_produto: 3800, margem_liquida: 40,
  }),
];

// ----------------------------------------------------------------------------
// Template 4: TikTok Ads → Quiz → Proposta (funil curto direto)
// ----------------------------------------------------------------------------
const tpl04Nodes: NodeFunil[] = [
  node(0, 'ads_tiktok', 'trafego', 'TikTok Ads', {
    visitantes: 15000, investimento: 2500, cpc: 0.17, taxa_conversao: 100,
  }),
  node(1, 'quiz', 'qualificacao', 'Quiz de destino', {
    taxa_conversao: 20,
  }),
  node(2, 'proposta_enviada', 'proposta', 'Proposta', {
    taxa_conversao: 25,
  }),
  node(3, 'pagamento', 'fechamento', 'Pagamento', {
    taxa_conversao: 85, valor_produto: 2200, margem_liquida: 45,
  }),
];

// ----------------------------------------------------------------------------
// Template 5: Indicação → Apresentação → Venda → Upsell
// ----------------------------------------------------------------------------
const tpl05Nodes: NodeFunil[] = [
  node(0, 'indicacao', 'trafego', 'Indicação', {
    visitantes: 200, investimento: 0, taxa_conversao: 100,
  }),
  node(1, 'sdr_ligacao', 'qualificacao', 'Ligação de boas-vindas', {
    taxa_conversao: 70,
  }),
  node(2, 'apresentacao', 'proposta', 'Apresentação', {
    taxa_conversao: 60,
  }),
  node(3, 'venda_direta', 'fechamento', 'Venda principal', {
    taxa_conversao: 75, valor_produto: 6000, margem_liquida: 40,
  }),
  node(4, 'upsell_produto', 'upsell', 'Upsell seguro viagem', {
    taxa_conversao: 30, valor_produto: 400, margem_liquida: 60,
  }),
];

// ----------------------------------------------------------------------------
// Template 6: Remarketing → Follow-up → Pagamento (recuperação de leads)
// ----------------------------------------------------------------------------
const tpl06Nodes: NodeFunil[] = [
  node(0, 'remarketing', 'trafego', 'Remarketing Meta', {
    visitantes: 3000, investimento: 800, cpc: 0.27, taxa_conversao: 100,
  }),
  node(1, 'whatsapp_ativo', 'nutricao', 'WhatsApp follow-up', {
    taxa_conversao: 35, taxa_resposta: 50,
  }),
  node(2, 'followup', 'proposta', 'Follow-up proposta', {
    taxa_conversao: 40,
  }),
  node(3, 'pagamento', 'fechamento', 'Fechamento', {
    taxa_conversao: 70, valor_produto: 3500, margem_liquida: 38,
  }),
];

// ----------------------------------------------------------------------------
// Exporta os 6 templates
// ----------------------------------------------------------------------------

export const FUNIL_TEMPLATES_SEED: FunilTemplate[] = [
  {
    id: 'tpl-01',
    nome: 'Instagram Ads → Grupo',
    categoria: 'B2C',
    data: {
      descricao: 'Tráfego Meta → landing → WhatsApp ativo → fechamento. Ideal para grupos de viagem populares.',
      nodes: tpl01Nodes,
      edges: chainEdges(tpl01Nodes.length),
      config: { moeda: 'BRL', periodo_simulacao: 'mensal', usar_dados_reais: false },
    },
  },
  {
    id: 'tpl-02',
    nome: 'Google Ads → Alto ticket',
    categoria: 'B2C',
    data: {
      descricao: 'Para produtos caros: tráfego pago de alta intenção + SDR qualificando por telefone.',
      nodes: tpl02Nodes,
      edges: chainEdges(tpl02Nodes.length),
      config: { moeda: 'BRL', periodo_simulacao: 'mensal', usar_dados_reais: false },
    },
  },
  {
    id: 'tpl-03',
    nome: 'Orgânico → E-mail → Venda',
    categoria: 'Orgânico',
    data: {
      descricao: 'Sem ads. SEO + lead magnet + nutrição por e-mail até o agendamento.',
      nodes: tpl03Nodes,
      edges: chainEdges(tpl03Nodes.length),
      config: { moeda: 'BRL', periodo_simulacao: 'mensal', usar_dados_reais: false },
    },
  },
  {
    id: 'tpl-04',
    nome: 'TikTok → Quiz curto',
    categoria: 'B2C',
    data: {
      descricao: 'Funil curto com qualificação via quiz. Volume alto, ticket menor.',
      nodes: tpl04Nodes,
      edges: chainEdges(tpl04Nodes.length),
      config: { moeda: 'BRL', periodo_simulacao: 'mensal', usar_dados_reais: false },
    },
  },
  {
    id: 'tpl-05',
    nome: 'Indicação + Upsell',
    categoria: 'Relacionamento',
    data: {
      descricao: 'Leads quentes de indicação, taxa de conversão alta, upsell incluído.',
      nodes: tpl05Nodes,
      edges: chainEdges(tpl05Nodes.length),
      config: { moeda: 'BRL', periodo_simulacao: 'mensal', usar_dados_reais: false },
    },
  },
  {
    id: 'tpl-06',
    nome: 'Remarketing → Recuperação',
    categoria: 'Reativação',
    data: {
      descricao: 'Recupera leads que já visitaram mas não converteram com remarketing + WhatsApp.',
      nodes: tpl06Nodes,
      edges: chainEdges(tpl06Nodes.length),
      config: { moeda: 'BRL', periodo_simulacao: 'mensal', usar_dados_reais: false },
    },
  },
];
