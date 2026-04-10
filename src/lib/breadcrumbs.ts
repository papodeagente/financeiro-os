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
  '/vendas/orcamentos': 'Orçamentos',
  '/voos': 'Buscar voos',
  '/hoteis': 'Buscar hotéis',
  '/destinos': 'Destinos',
  '/financeiro-ag': 'Visão geral',
  '/financeiro-ag/fluxo-caixa': 'Fluxo de caixa',
  '/financeiro-ag/dre': 'DRE',
  '/financeiro-ag/conciliacao': 'Conciliação',
  '/financeiro-ag/receber': 'Contas a receber',
  '/financeiro-ag/pagar': 'Contas a pagar',
  '/financeiro-ag/plano-contas': 'Plano de contas',
  '/financeiro-ag/contas-bancarias': 'Contas bancárias',
  '/financeiro-ag/transferencias': 'Transferências',
  '/financeiro-grupos': 'Financeiro por grupo',
  '/pessoas': 'Pessoas',
  '/pessoas/clientes': 'Clientes',
  '/pessoas/fornecedores': 'Fornecedores',
  '/pessoas/equipe': 'Equipe',
  '/equipe/metas': 'Metas da equipe',
  '/equipe/comissoes': 'Comissões',
  '/equipe/planos-comissao': 'Planos de comissão',
  '/cac/dashboard': 'Dashboard CAC',
  '/cac/cenarios': 'Simulador CAC',
  '/planejamento/custos': 'Custos do negócio',
  '/planejamento/projetos': 'Projetos',
  '/planejamento/fluxogramas': 'Fluxogramas',
  '/relatorios': 'Relatórios',
  '/relatorios/financeiro': 'Relatórios financeiros',
  '/relatorios/rentabilidade': 'Rentabilidade',
  '/relatorios/comparativo': 'Comparativo mensal',
  '/config/agencia': 'Configurações',
  '/config/usuarios': 'Usuários',
  '/config/crm': 'Integração CRM',
};

const PILLAR_PREFIXES: { pillar: Pillar; prefixes: string[] }[] = [
  { pillar: 'planejamento', prefixes: ['/planejamento'] },
  { pillar: 'metas', prefixes: ['/dashboard', '/equipe', '/cac', '/relatorios'] },
  { pillar: 'produtos', prefixes: ['/grupos', '/grupo', '/propostas', '/vendas', '/voos', '/hoteis', '/destinos'] },
  { pillar: 'financeiro', prefixes: ['/financeiro-ag', '/financeiro-grupos', '/financeiro', '/pessoas'] },
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
    const known = BREADCRUMB_MAP[acc];
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
