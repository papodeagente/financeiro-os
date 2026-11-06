/**
 * Breadcrumb trail builder.
 *
 * Maps the current pathname to a list of navigable crumbs. Knows about the
 * 4 pillars (planejamento / metas / produtos / financeiro) and the labels
 * for the most common routes. For unknown segments it falls back to a
 * humanized version of the slug.
 */

export type Pillar = 'planejamento' | 'metas' | 'produtos' | 'financeiro' | 'configuracoes';

export interface Crumb {
  href: string;
  label: string;
  isLeaf: boolean;
}

export const PILLAR_LABELS: Record<Pillar, string> = {
  planejamento: 'Planejamento',
  metas: 'Metas',
  produtos: 'Produtos',
  financeiro: 'Financeiro',
  configuracoes: 'Configurações',
};

export const PILLAR_HOME: Record<Pillar, string> = {
  planejamento: '/planejamento/custos',
  metas: '/dashboard',
  produtos: '/grupos',
  financeiro: '/financeiro-ag',
  configuracoes: '/config/agencia',
};

export const BREADCRUMB_MAP: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/grupos': 'Grupos',
  '/propostas': 'Propostas',
  '/propostas/nova': 'Nova proposta',
  '/propostas/analytics': 'Analytics',
  '/vendas': 'Vendas fechadas',
  '/vendas/nova': 'Nova venda',
  '/vendas/lancar': 'Lançar venda',
  '/vendas/orcamentos': 'Orçamentos',
  '/financeiro-ag/reembolsos': 'Reembolsos',
  '/financeiro-ag/creditos': 'Crédito do cliente',
  '/voos': 'Buscar voos',
  '/hoteis': 'Buscar hotéis',
  '/destinos': 'Destinos',
  '/financeiro-ag': 'Visão geral',
  '/financeiro-ag/fluxo-caixa': 'Fluxo de caixa',
  '/financeiro-ag/dre': 'Resultado do mês',
  '/financeiro-ag/extrato': 'Extrato de conta',
  '/financeiro-ag/movimentacoes': 'Movimentações',
  '/financeiro-ag/resultado-por-categoria': 'Resultado por categoria',
  '/financeiro-ag/conciliacao': 'Conciliação',
  '/financeiro-ag/conciliacao/automatica': 'Conciliação automática',
  '/financeiro-ag/conferencia-operadora': 'Conferência de operadora',
  '/financeiro-ag/recebimentos': 'Recebimentos das plataformas',
  '/financeiro-ag/contas': 'Contas a Pagar/Receber',
  '/financeiro-ag/receber': 'Contas a receber',
  '/financeiro-ag/cobrancas': 'Cobranças',
  '/financeiro-ag/notas/gerar': 'Gerar notas',
  '/financeiro-ag/notas/regras': 'Regras da nota',
  '/financeiro-ag/notas/retencoes': 'Retenções na fonte',
  '/financeiro-ag/faturas': 'Faturas',
  '/financeiro-ag/regras-faturamento': 'Regras de faturamento',
  '/financeiro-ag/pagar': 'Contas a pagar',
  '/financeiro-ag/plano-contas': 'Categorias',
  '/financeiro-ag/formas-pagamento': 'Formas de pagamento',
  '/financeiro-ag/contas-bancarias': 'Contas bancárias',
  '/financeiro-ag/transferencias': 'Transferências',
  '/financeiro-grupos': 'Financeiro por grupo',
  '/equipe/vendedores': 'Vendedores e planos',
  '/equipe/folha': 'Folha de pagamento',
  '/config/plataformas': 'Plataformas de venda',
  '/pessoas': 'Pessoas',
  '/pessoas/clientes': 'Clientes',
  '/pessoas/fornecedores': 'Fornecedores',
  '/pessoas/equipe': 'Equipe',
  '/equipe/metas': 'Metas da equipe',
  '/equipe/comissoes': 'Comissões',
  '/equipe/planos-comissao': 'Planos de comissão',
  '/equipe/funcoes': 'Funções',
  '/equipe/planos-por-funcao': 'Planos por função',
  '/equipe/fechar-comissoes': 'Fechar comissões',
  '/equipe/pagar-comissoes': 'Pagar comissões',
  '/equipe/minhas-comissoes': 'Minhas comissões',
  '/relatorios/vendas': 'Relatórios de vendas',
  '/cac/dashboard': 'Dashboard CAC',
  '/cac/cenarios': 'Simulador CAC',
  '/planejamento/custos': 'Custos do negócio',
  '/planejamento/projetos': 'Projetos',
  '/planejamento/fluxogramas': 'Fluxogramas',
  '/relatorios': 'Relatórios',
  '/relatorios/financeiro': 'Relatórios financeiros',
  '/relatorios/rentabilidade': 'Rentabilidade',
  '/relatorios/lucro-real': 'Lucro real',
  '/relatorios/comparativo': 'Comparativo mensal',
  '/config/agencia': 'Configurações',
  '/config/usuarios': 'Usuários',
  '/config/crm': 'Integração CRM',
  '/config/cobranca': 'Cobrança',
  '/config/vendas': 'Vendas',
  '/financeiro-ag/fornecedores': 'Fornecedores',
  '/financeiro-ag/fornecedores/faturas': 'Fatura do fornecedor',
  '/financeiro-ag/fornecedores/sinais': 'Sinais a fornecedores',
  '/financeiro-ag/fornecedores/acordos': 'Acordos com fornecedores',
  '/financeiro-ag/fornecedores/comissoes': 'Comissão de fornecedores',
  '/config/comissoes': 'Comissões',
  '/config/auditoria': 'Registro de atividades',
  '/mudanca': 'Mudar para o EnturOS',
  '/mudanca/glossario': 'Glossário',
  '/mudanca/paridade': 'Checklist de paridade',
};

const PILLAR_PREFIXES: { pillar: Pillar; prefixes: string[] }[] = [
  { pillar: 'planejamento', prefixes: ['/planejamento'] },
  { pillar: 'metas', prefixes: ['/dashboard', '/equipe', '/cac', '/relatorios'] },
  { pillar: 'produtos', prefixes: ['/grupos', '/grupo', '/propostas', '/vendas', '/voos', '/hoteis', '/destinos'] },
  { pillar: 'financeiro', prefixes: ['/financeiro-ag', '/financeiro-grupos', '/financeiro', '/pessoas'] },
  // Mudança de sistema (E4): mora junto das configurações da agência.
  { pillar: 'configuracoes', prefixes: ['/mudanca'] },
];

export function pillarFromPathname(pathname: string): Pillar | null {
  for (const { pillar, prefixes } of PILLAR_PREFIXES) {
    if (prefixes.some(p => pathname === p || pathname.startsWith(p + '/'))) {
      return pillar;
    }
  }
  return null;
}

function humanize(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/^./, c => c.toUpperCase());
}

/** Rotas com id no caminho que têm um nome melhor que o id (E5, parte B). */
const ROTAS_COM_ID: { padrao: RegExp; rotulo: string }[] = [
  { padrao: /^\/financeiro-ag\/faturas\/[^/]+$/, rotulo: 'Ficha da fatura' },
];

/**
 * Build a breadcrumb trail for the given pathname.
 *
 * @param pathname  current location pathname (e.g. "/financeiro-ag/receber")
 * @param leafLabel optional override for the last crumb (useful for dynamic
 *                  routes where the [id] should display a friendly name)
 */
export function buildTrail(pathname: string, leafLabel?: string): Crumb[] {
  if (!pathname || pathname === '/') return [];
  const trail: Crumb[] = [];

  const pillar = pillarFromPathname(pathname);
  if (pillar) {
    trail.push({
      href: PILLAR_HOME[pillar],
      label: PILLAR_LABELS[pillar],
      isLeaf: false,
    });
  }

  // Walk segments and produce a crumb for each known route.
  const segments = pathname.split('/').filter(Boolean);
  let acc = '';
  for (let i = 0; i < segments.length; i++) {
    acc += '/' + segments[i];
    const isLast = i === segments.length - 1;
    const known = BREADCRUMB_MAP[acc] ?? ROTAS_COM_ID.find(r => r.padrao.test(acc))?.rotulo;
    // Skip duplicates with the pillar root crumb.
    if (trail.some(c => c.href === acc)) continue;
    // Dynamic / unknown segment.
    let label = known ?? (isLast && leafLabel ? leafLabel : humanize(segments[i]));
    if (isLast && leafLabel) label = leafLabel;
    trail.push({ href: acc, label, isLeaf: isLast });
  }

  // Mark only the last entry as leaf.
  if (trail.length) {
    trail.forEach((c, i) => {
      c.isLeaf = i === trail.length - 1;
    });
  }
  return trail;
}
