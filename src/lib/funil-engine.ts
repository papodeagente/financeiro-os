/**
 * Motor de simulação de funis — função pura, 100% testável isoladamente.
 *
 * Entrada: nodes + edges + cenário (opcional) + dados reais (opcional).
 * Saída: nodes com `resultado` preenchido + KPIs agregados.
 *
 * Algoritmo:
 *  1. Clonar nodes (nunca mutar input).
 *  2. Aplicar multiplicadores do cenário à config clonada.
 *  3. Se `usar_dados_reais`, sobrescrever campos chave com dados da agência.
 *  4. BFS topológico a partir dos nodes raiz (categoria 'trafego' e outros
 *     que não tenham edges de entrada) — propaga `entrantes` adiante.
 *  5. Em cada node calcular `convertidos`, `perdidos`, `receita`, `custo`.
 *  6. Identificar o gargalo (maior perda relativa).
 *  7. Agregar KPIs.
 *
 * Design: zero dependências externas. Importado tanto pelo frontend
 * (atualização live ao mexer nos sliders) quanto pelo backend
 * (`POST /api/funis/[id]/simular`) — não pode tocar em window/document.
 */

import type {
  NodeFunil, EdgeFunil, NodeConfig, NodeResultado,
  KPIsFunil, CenarioComparativo, DadosReaisAgencia, CategoriaNode,
} from './funil-types';

// ----------------------------------------------------------------------------
// Util: clonar nodes preservando tipos
// ----------------------------------------------------------------------------

function cloneNodes(nodes: NodeFunil[]): NodeFunil[] {
  return nodes.map(n => ({
    ...n,
    data: {
      ...n.data,
      config: { ...n.data.config },
      resultado: undefined,
    },
  }));
}

// ----------------------------------------------------------------------------
// Util: aplicar multiplicadores do cenário
// ----------------------------------------------------------------------------

function aplicarCenario(nodes: NodeFunil[], cenario?: CenarioComparativo): void {
  if (!cenario) return;
  const { taxa_conversao, investimento, ticket_medio } = cenario.multiplicadores;
  for (const n of nodes) {
    const c: NodeConfig = n.data.config;
    if (typeof c.taxa_conversao === 'number') {
      c.taxa_conversao = clamp(c.taxa_conversao * taxa_conversao, 0, 100);
    }
    if (typeof c.investimento === 'number') {
      c.investimento = Math.max(0, c.investimento * investimento);
    }
    if (typeof c.valor_produto === 'number') {
      c.valor_produto = Math.max(0, c.valor_produto * ticket_medio);
    }
  }
}

// ----------------------------------------------------------------------------
// Util: sobrescrever com dados reais
// ----------------------------------------------------------------------------

function aplicarDadosReais(
  nodes: NodeFunil[],
  dadosReais: DadosReaisAgencia | undefined,
  usarDadosReais: boolean,
): void {
  if (!usarDadosReais || !dadosReais) return;
  for (const n of nodes) {
    if (n.data.categoria === 'proposta' && dadosReais.taxa_proposta_aceita > 0) {
      n.data.config.taxa_conversao = dadosReais.taxa_proposta_aceita;
    }
    if (n.data.categoria === 'fechamento' && dadosReais.ticket_medio > 0) {
      n.data.config.valor_produto = dadosReais.ticket_medio;
    }
  }
}

// ----------------------------------------------------------------------------
// BFS topológico
// ----------------------------------------------------------------------------

interface GraphIndex {
  byId: Map<string, NodeFunil>;
  outgoing: Map<string, EdgeFunil[]>;
  incoming: Map<string, EdgeFunil[]>;
}

function buildGraph(nodes: NodeFunil[], edges: EdgeFunil[]): GraphIndex {
  const byId = new Map<string, NodeFunil>();
  const outgoing = new Map<string, EdgeFunil[]>();
  const incoming = new Map<string, EdgeFunil[]>();
  for (const n of nodes) {
    byId.set(n.id, n);
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    outgoing.get(e.source)?.push(e);
    incoming.get(e.target)?.push(e);
  }
  return { byId, outgoing, incoming };
}

/**
 * Nodes raiz = sem edges de entrada. Normalmente são os de tráfego, mas
 * aceita qualquer node órfão (o usuário pode começar no meio do funil se
 * quiser simular só uma etapa).
 */
function findRoots(graph: GraphIndex): NodeFunil[] {
  const roots: NodeFunil[] = [];
  for (const n of graph.byId.values()) {
    if ((graph.incoming.get(n.id)?.length ?? 0) === 0) {
      roots.push(n);
    }
  }
  return roots;
}

// ----------------------------------------------------------------------------
// Cálculo por node
// ----------------------------------------------------------------------------

function calcularResultadoNode(
  node: NodeFunil,
  entrantes: number,
): NodeResultado {
  const c = node.data.config;
  const taxa = typeof c.taxa_conversao === 'number' ? clamp(c.taxa_conversao, 0, 100) : 100;
  const convertidos = Math.floor(entrantes * (taxa / 100));
  const perdidos = Math.max(0, entrantes - convertidos);

  // Receita: só nodes de fechamento têm valor_produto multiplicando convertidos.
  // Upsell também gera receita (produto adicional sobre convertidos).
  let receita = 0;
  if (node.data.categoria === 'fechamento' && typeof c.valor_produto === 'number') {
    receita = convertidos * c.valor_produto;
  } else if (node.data.categoria === 'upsell' && typeof c.valor_produto === 'number') {
    receita = convertidos * c.valor_produto;
  }

  // Custo: investimento direto (tráfego pago) + custos variáveis por entrante.
  let custo = 0;
  if (typeof c.investimento === 'number') custo += c.investimento;
  if (typeof c.custo_fixo === 'number') custo += c.custo_fixo;
  if (typeof c.custo_por_unidade === 'number') custo += c.custo_por_unidade * entrantes;

  return {
    entrantes,
    convertidos,
    perdidos,
    receita,
    custo,
    lucro: receita - custo,
  };
}

// ----------------------------------------------------------------------------
// BFS execução
// ----------------------------------------------------------------------------

function executarBFS(graph: GraphIndex, nodes: NodeFunil[]): void {
  // Entrantes iniciais: nodes raiz usam seu próprio `visitantes` como entrada
  // (ex.: um node de tráfego pago com 10k visitantes). Nodes raiz sem
  // `visitantes` (caso edge onde o usuário esqueceu) caem para 0.
  const entrantesMap = new Map<string, number>();
  const roots = findRoots(graph);
  for (const r of roots) {
    const inicial = typeof r.data.config.visitantes === 'number' ? r.data.config.visitantes : 0;
    entrantesMap.set(r.id, inicial);
  }

  // Kahn-style: processa um node só quando TODOS os antecessores já
  // contribuíram. Detecta visitados para evitar loop infinito em ciclos
  // (mesmo sendo tecnicamente um DAG, proteger contra má entrada do usuário).
  const processed = new Set<string>();
  const queue: string[] = roots.map(r => r.id);
  const entradasSomadas = new Map<string, number>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (processed.has(currentId)) continue;

    const node = graph.byId.get(currentId);
    if (!node) continue;

    // Só processa se TODOS os antecessores foram processados (garante ordem
    // topológica). Se não, empurra para o final da fila.
    const incoming = graph.incoming.get(currentId) ?? [];
    const allReady = incoming.every(e => processed.has(e.source));
    if (!allReady) {
      queue.push(currentId);
      // Se o queue só tem nodes não-ready, é ciclo — break para não loopar.
      if (queue.every(id => !isNodeReady(id, graph, processed))) break;
      continue;
    }

    const entrantes = entrantesMap.get(currentId) ?? entradasSomadas.get(currentId) ?? 0;
    const resultado = calcularResultadoNode(node, entrantes);
    node.data.resultado = resultado;
    processed.add(currentId);

    // Propaga `convertidos` para os sucessores.
    const outgoing = graph.outgoing.get(currentId) ?? [];
    for (const edge of outgoing) {
      const targetNode = graph.byId.get(edge.target);
      if (!targetNode) continue;

      // Se a edge tem override, aplica taxa customizada nesse caminho;
      // caso contrário propaga `convertidos` inteiro (a taxa do próprio
      // target será aplicada quando ele for processado).
      let contribuicao = resultado.convertidos;
      if (typeof edge.taxa_conversao_override === 'number') {
        contribuicao = Math.floor(
          resultado.convertidos * (clamp(edge.taxa_conversao_override, 0, 100) / 100),
        );
      }

      const acumulado = entradasSomadas.get(edge.target) ?? 0;
      entradasSomadas.set(edge.target, acumulado + contribuicao);
      entrantesMap.set(edge.target, acumulado + contribuicao);

      if (!processed.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }

  // Nodes nunca alcançados ficam com resultado zerado (não fica undefined,
  // para o painel direito exibir "0" em vez de "—" confusamente).
  for (const n of nodes) {
    if (!n.data.resultado) {
      n.data.resultado = {
        entrantes: 0, convertidos: 0, perdidos: 0,
        receita: 0, custo: 0, lucro: 0,
      };
    }
  }
}

function isNodeReady(id: string, graph: GraphIndex, processed: Set<string>): boolean {
  const incoming = graph.incoming.get(id) ?? [];
  return incoming.every(e => processed.has(e.source));
}

// ----------------------------------------------------------------------------
// Identificar gargalo
// ----------------------------------------------------------------------------

function identificarGargalo(nodes: NodeFunil[]): string | null {
  let pior: { id: string; perdaRelativa: number } | null = null;
  for (const n of nodes) {
    const r = n.data.resultado;
    if (!r || r.entrantes === 0) continue;
    if (n.data.categoria === 'trafego') continue; // tráfego é origem, não gargalo
    if (n.data.categoria === 'saida') continue;
    const perdaRelativa = r.perdidos / r.entrantes;
    if (!pior || perdaRelativa > pior.perdaRelativa) {
      pior = { id: n.id, perdaRelativa };
    }
  }
  if (pior) {
    for (const n of nodes) {
      if (n.data.resultado) n.data.resultado.is_gargalo = n.id === pior.id;
    }
    return pior.id;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Agregar KPIs
// ----------------------------------------------------------------------------

function agregarKPIs(
  nodes: NodeFunil[],
  gargaloId: string | null,
  dadosReais?: DadosReaisAgencia,
): KPIsFunil {
  const byCategory = (cat: CategoriaNode) => nodes.filter(n => n.data.categoria === cat);

  const total_visitantes = byCategory('trafego')
    .reduce((s, n) => s + (n.data.resultado?.entrantes ?? 0), 0);
  const total_leads = byCategory('captura')
    .reduce((s, n) => s + (n.data.resultado?.convertidos ?? 0), 0);
  const total_propostas = byCategory('proposta')
    .reduce((s, n) => s + (n.data.resultado?.convertidos ?? 0), 0);
  const total_vendas = byCategory('fechamento')
    .reduce((s, n) => s + (n.data.resultado?.convertidos ?? 0), 0);

  const investimento_total = nodes.reduce((s, n) => s + (n.data.resultado?.custo ?? 0), 0);
  const receita_bruta = nodes.reduce((s, n) => s + (n.data.resultado?.receita ?? 0), 0);

  // Receita líquida: aplica margem dos nodes de fechamento sobre a receita
  // deles; nodes de upsell usam margem própria se definida, senão 100%.
  let receita_liquida = 0;
  for (const n of nodes) {
    const r = n.data.resultado;
    if (!r || r.receita === 0) continue;
    const margem = typeof n.data.config.margem_liquida === 'number'
      ? clamp(n.data.config.margem_liquida, 0, 100) / 100
      : 1;
    receita_liquida += r.receita * margem;
  }

  const lucro = receita_liquida - investimento_total;
  const margem_percentual = receita_bruta > 0 ? (lucro / receita_bruta) * 100 : 0;
  const cac_simulado = total_vendas > 0 ? investimento_total / total_vendas : 0;
  const ticket_medio = total_vendas > 0 ? receita_bruta / total_vendas : 0;
  const roi = investimento_total > 0 ? lucro / investimento_total : 0;
  const ltv_cac = cac_simulado > 0 ? ticket_medio / cac_simulado : 0;

  const margemMinima = dadosReais?.margem_minima ?? 0;
  const taxa_conversao_geral = total_visitantes > 0
    ? (total_vendas / total_visitantes) * 100
    : 0;

  return {
    total_visitantes,
    total_leads,
    total_propostas,
    total_vendas,
    taxa_conversao_geral,
    investimento_total,
    receita_bruta,
    receita_liquida,
    lucro,
    margem_percentual,
    cac_simulado,
    ticket_medio,
    roi,
    ltv_cac,
    abaixo_margem_minima: margemMinima > 0 && margem_percentual < margemMinima,
    gargalo_node_id: gargaloId,
  };
}

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------

/**
 * Simula um funil completo. Retorna novos `nodes` (com resultado preenchido) e
 * os KPIs agregados. Não muta os inputs.
 */
export function simularFunil(
  nodesInput: NodeFunil[],
  edges: EdgeFunil[],
  cenario?: CenarioComparativo,
  dadosReais?: DadosReaisAgencia,
  usarDadosReais = false,
): { nodes: NodeFunil[]; kpis: KPIsFunil } {
  const nodes = cloneNodes(nodesInput);

  aplicarCenario(nodes, cenario);
  aplicarDadosReais(nodes, dadosReais, usarDadosReais);

  const graph = buildGraph(nodes, edges);
  executarBFS(graph, nodes);

  const gargaloId = identificarGargalo(nodes);
  const kpis = agregarKPIs(nodes, gargaloId, dadosReais);

  return { nodes, kpis };
}

/**
 * Simula os 4 cenários comparativos de uma vez. Usado pelo ModalComparacao.
 */
export function simularCenarios(
  nodes: NodeFunil[],
  edges: EdgeFunil[],
  cenarios: CenarioComparativo[],
  dadosReais?: DadosReaisAgencia,
  usarDadosReais = false,
): CenarioComparativo[] {
  return cenarios.map(c => {
    const { kpis } = simularFunil(nodes, edges, c, dadosReais, usarDadosReais);
    return { ...c, kpis };
  });
}

/**
 * Cenários padrão para exibição inicial.
 */
export function cenariosPadrao(): CenarioComparativo[] {
  return [
    {
      id: 'baseline', nome: 'Baseline',
      multiplicadores: { taxa_conversao: 1.0, investimento: 1.0, ticket_medio: 1.0 },
    },
    {
      id: 'otimista', nome: 'Otimista',
      multiplicadores: { taxa_conversao: 1.2, investimento: 1.0, ticket_medio: 1.1 },
    },
    {
      id: 'pessimista', nome: 'Pessimista',
      multiplicadores: { taxa_conversao: 0.8, investimento: 1.0, ticket_medio: 0.9 },
    },
    {
      id: 'customizado', nome: 'Customizado',
      multiplicadores: { taxa_conversao: 1.0, investimento: 1.0, ticket_medio: 1.0 },
    },
  ];
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
