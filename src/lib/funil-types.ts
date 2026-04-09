/**
 * Tipos do Simulador de Funis de Vendas (/planejamento/funis).
 *
 * O simulador deixa o consultor desenhar visualmente uma campanha — do tráfego
 * até o fechamento — e simular o resultado financeiro antes de investir.
 *
 * Estes tipos são compartilhados entre:
 *  - src/lib/funil-engine.ts (motor de simulação puro)
 *  - src/app/api/funis/** (persistência JSONB + rotas de simulação)
 *  - src/app/planejamento/funis/** (canvas + lista)
 *  - src/components/funis/** (node, painel, modais)
 */

// ----------------------------------------------------------------------------
// Categorias e tipos de node
// ----------------------------------------------------------------------------

/**
 * 8 categorias mapeiam as etapas clássicas de um funil — usadas tanto para
 * colorir os nodes quanto para agrupar a biblioteca na sidebar.
 */
export type CategoriaNode =
  | 'trafego'
  | 'captura'
  | 'nutricao'
  | 'qualificacao'
  | 'proposta'
  | 'fechamento'
  | 'upsell'
  | 'saida';

/**
 * Tipos específicos de node dentro de cada categoria. Cada tipo carrega uma
 * semântica distinta (ex.: "ads_meta" tem campo `cpc`, "whatsapp_ativo" tem
 * campo `taxa_resposta`), mas todos compartilham o mesmo shape base de
 * `NodeConfig` — os campos não-aplicáveis ficam `undefined`.
 */
export type TipoNode =
  // trafego
  | 'ads_meta' | 'ads_google' | 'ads_tiktok' | 'seo_organico' | 'indicacao'
  // captura
  | 'landing_page' | 'formulario' | 'lead_magnet'
  // nutricao
  | 'email_sequencia' | 'whatsapp_ativo' | 'remarketing'
  // qualificacao
  | 'sdr_ligacao' | 'quiz' | 'agendamento'
  // proposta
  | 'apresentacao' | 'proposta_enviada' | 'followup'
  // fechamento
  | 'contrato' | 'pagamento' | 'venda_direta'
  // upsell
  | 'upsell_produto' | 'cross_sell' | 'recompra_indicacao'
  // saida
  | 'cliente_final' | 'churn' | 'perdido';

/**
 * Configuração editável de um node. Todos os campos são opcionais porque o
 * mesmo tipo acumula propriedades específicas (ex.: proposta tem ticket_medio
 * mas tráfego tem investimento).
 */
export interface NodeConfig {
  // universal
  taxa_conversao?: number;  // 0-100 (%)
  observacoes?: string;

  // trafego
  visitantes?: number;
  investimento?: number;
  cpc?: number;
  cpm?: number;

  // captura
  leads_capturados?: number;

  // nutricao
  taxa_resposta?: number;   // 0-100 (%)
  taxa_abertura?: number;   // 0-100 (%)

  // proposta / fechamento
  valor_produto?: number;
  margem_liquida?: number;  // 0-100 (%)

  // custos adicionais
  custo_por_unidade?: number;
  custo_fixo?: number;
}

/**
 * Resultado acumulado por node após uma simulação. O motor preenche tudo isso
 * num BFS topológico partindo dos nodes de tráfego.
 */
export interface NodeResultado {
  entrantes: number;     // total que chegou a este node
  convertidos: number;   // quantos avançaram para o próximo
  perdidos: number;      // entrantes - convertidos
  receita: number;       // receita gerada neste node (quando aplicável)
  custo: number;         // custo atribuído a este node
  lucro: number;         // receita - custo
  is_gargalo?: boolean;  // maior perda relativa do funil
}

/**
 * Node de um funil — formato compatível com React Flow
 * (`{ id, position, data, type }`) + metadados do simulador no `data`.
 */
export interface NodeFunil {
  id: string;
  type: 'funilNode';              // custom node único registrado no ReactFlow
  position: { x: number; y: number };
  data: {
    tipo: TipoNode;
    categoria: CategoriaNode;
    label: string;
    config: NodeConfig;
    resultado?: NodeResultado;    // preenchido após simular
  };
}

/**
 * Edge de um funil. O `taxa_conversao_override` permite sobrescrever a taxa
 * do node destino num caminho específico (útil em forks A/B).
 */
export interface EdgeFunil {
  id: string;
  source: string;
  target: string;
  type?: 'smoothstep';
  taxa_conversao_override?: number | null;
}

// ----------------------------------------------------------------------------
// KPIs agregados
// ----------------------------------------------------------------------------

/**
 * 14 KPIs exibidos no PainelKPIs após simular.
 * `abaixo_margem_minima` dispara a borda vermelha de alerta.
 */
export interface KPIsFunil {
  total_visitantes: number;
  total_leads: number;
  total_propostas: number;
  total_vendas: number;
  taxa_conversao_geral: number;     // 0-100 (%)
  investimento_total: number;
  receita_bruta: number;
  receita_liquida: number;          // aplica margem_liquida dos nodes de fechamento
  lucro: number;                    // receita_liquida - investimento_total
  margem_percentual: number;        // 0-100 (%)
  cac_simulado: number;             // investimento_total / total_vendas
  ticket_medio: number;             // receita_bruta / total_vendas
  roi: number;                      // lucro / investimento_total (multiplicador)
  ltv_cac: number;                  // ticket_medio / cac_simulado (proxy)
  abaixo_margem_minima: boolean;
  gargalo_node_id: string | null;
}

// ----------------------------------------------------------------------------
// Cenários e simulação
// ----------------------------------------------------------------------------

/**
 * Multiplicadores globais aplicados pelo cenário antes do BFS.
 * 1.0 = mantém original, 0.8 = reduz 20%, 1.2 = aumenta 20%.
 */
export interface CenarioComparativo {
  id: 'baseline' | 'otimista' | 'pessimista' | 'customizado';
  nome: string;
  multiplicadores: {
    taxa_conversao: number;
    investimento: number;
    ticket_medio: number;
  };
  kpis?: KPIsFunil;  // preenchido após simular
}

/**
 * Dados reais da agência agregados de outras tabelas. Retornado por
 * `GET /api/funis/dados-reais`. Alimenta o toggle "Usar dados reais" e o
 * painel lateral de baseline.
 */
export interface DadosReaisAgencia {
  ticket_medio: number;          // média de vendas fechadas (vendas_crm)
  taxa_proposta_aceita: number;  // 0-100 (%) — propostas APROVADAS / total
  cac_medio: number;             // cac_mensal (última janela disponível)
  margem_minima: number;         // 0-100 (%) — vindo de planejamento_custos
  investimento_marketing: number; // total do mês atual em marketing
  ultima_atualizacao: string;    // ISO, para mostrar "baseado em X"
}

// ----------------------------------------------------------------------------
// Funil persistido
// ----------------------------------------------------------------------------

export type StatusFunil = 'rascunho' | 'simulado' | 'em_execucao';

export interface FunilConfig {
  moeda: 'BRL';
  periodo_simulacao: 'mensal' | 'trimestral' | 'anual';
  usar_dados_reais: boolean;
}

/**
 * Payload completo de `funis.data` (JSONB). O status e nome ficam como
 * colunas indexadas separadas (ver createCrudHandlers).
 */
export interface FunilData {
  nodes: NodeFunil[];
  edges: EdgeFunil[];
  config: FunilConfig;
  cenarios: CenarioComparativo[];
  ultimo_simulado_at: string | null;
  descricao?: string;
}

/**
 * Registro completo retornado pela API (inclui id, nome, status, data).
 */
export interface FunilPayload {
  id: string;
  nome: string;
  status: StatusFunil;
  data: FunilData;
  created_at?: string;
  updated_at?: string;
}

/**
 * Entrada na tabela funis_templates (template reutilizável).
 */
export interface FunilTemplate {
  id: string;
  nome: string;
  categoria: string;
  data: {
    descricao: string;
    nodes: NodeFunil[];
    edges: EdgeFunil[];
    config: FunilConfig;
  };
}

/**
 * Entrada em funis_simulacoes (histórico imutável de execuções).
 */
export interface SimulacaoRegistro {
  id: string;
  funil_id: string;
  data: {
    cenario_id: CenarioComparativo['id'];
    kpis: KPIsFunil;
    nodes_resultado: Array<{ id: string; resultado: NodeResultado }>;
    executada_em: string;
  };
  created_at?: string;
}
