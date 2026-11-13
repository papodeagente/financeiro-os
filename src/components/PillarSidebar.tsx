'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useActivePillar, PILLARS as PILARES_DO_MENU, type Pillar } from '@/hooks/useActivePillar';

/** Mesma tabela da barra de cima: a gaveta e o topo abrem a mesma porta. */
const ROTA_DO_PILAR: Record<Pillar, string> = {
  planejamento: '/planejamento/custos',
  metas: '/dashboard',
  financeiro: '/financeiro-ag',
  configuracoes: '/config/agencia',
};
import {
  Wallet,
  Wallet2,
  ShoppingBag,
  LayoutDashboard, Medal, Percent, Settings, UserCheck,
  Receipt, CreditCard,
  Landmark, ArrowRightLeft,
  Building2, Link2,
  GitBranch as MindIcon,
  Users, ClipboardList,
  PanelLeftClose, PanelLeftOpen,
  Eraser, LifeBuoy, FileText,
  LayoutGrid, ChartColumn, ArrowDownLeft, ArrowUpRight, GitCompareArrows, ListTree,
  Contact, Truck,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

export interface SidebarItem {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
}

export interface SidebarSection {
  title?: string;
  items: SidebarItem[];
}

const PLANEJAMENTO_MENU: SidebarSection[] = [
  {
    title: 'Planejamento',
    items: [
      { key: 'custos-negocio', label: 'Custos do negócio', icon: Wallet, href: '/planejamento/custos' },
      { key: 'mapas-mentais', label: 'Mapa mental', icon: MindIcon, href: '/planejamento/mapas-mentais' },
    ],
  },
];

const METAS_MENU: SidebarSection[] = [
  {
    title: 'Visão geral',
    items: [
      { key: 'dashboard-kpi', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
      { key: 'metas-ranking', label: 'Metas da equipe', icon: Medal, href: '/equipe/metas' },
    ],
  },
  {
    title: 'Equipe',
    items: [
      { key: 'comissoes', label: 'Comissões', icon: Percent, href: '/equipe/comissoes' },
      { key: 'vendedores', label: 'Vendedores e planos', icon: UserCheck, href: '/equipe/vendedores' },
      { key: 'folha', label: 'Folha', icon: Wallet2, href: '/equipe/folha' },
      { key: 'planos-comissao', label: 'Planos de comissão', icon: Settings, href: '/equipe/planos-comissao' },
    ],
  },
];

// Menu do Financeiro simplificado (protótipo aprovado pelo Bruno, 08/10/2026):
// o que se olha, o que se faz no dia a dia e o que se cadastra uma vez.
// Recebimentos das plataformas, vendas e relatórios saíram do menu e
// continuam na busca (⌘K) e nos atalhos de cada tela: a visão geral leva aos
// recebimentos para conferir, a conta a receber leva ao cliente e à venda.
// Clientes e fornecedores voltaram em Cadastros (Bruno, 09/10/2026): é onde se
// confere o que veio do CRM.
const FINANCEIRO_MENU: SidebarSection[] = [
  {
    title: 'Visão geral',
    items: [
      { key: 'fin-hub', label: 'Visão geral', icon: LayoutGrid, href: '/financeiro-ag' },
      { key: 'fluxo-caixa', label: 'Fluxo de caixa', icon: ChartColumn, href: '/financeiro-ag/fluxo-caixa' },
      { key: 'dre', label: 'Resultado do mês', icon: FileText, href: '/financeiro-ag/dre' },
    ],
  },
  {
    title: 'Dia a dia',
    items: [
      { key: 'receber', label: 'Contas a receber', icon: ArrowDownLeft, href: '/financeiro-ag/receber' },
      { key: 'pagar', label: 'Contas a pagar', icon: ArrowUpRight, href: '/financeiro-ag/pagar' },
      { key: 'conciliacao', label: 'Conciliação', icon: GitCompareArrows, href: '/financeiro-ag/conciliacao' },
      { key: 'notas-fiscais', label: 'Notas fiscais', icon: Receipt, href: '/financeiro-ag/notas' },
      { key: 'transferencias', label: 'Transferências', icon: ArrowRightLeft, href: '/financeiro-ag/transferencias' },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { key: 'clientes', label: 'Clientes', icon: Contact, href: '/pessoas/clientes' },
      { key: 'fornecedores', label: 'Fornecedores', icon: Truck, href: '/pessoas/fornecedores' },
      { key: 'contas-bancarias', label: 'Contas bancárias', icon: Landmark, href: '/financeiro-ag/contas-bancarias' },
      { key: 'cartoes-corp', label: 'Cartões', icon: CreditCard, href: '/financeiro-ag/cartoes' },
      { key: 'plano-contas', label: 'Categorias', icon: ListTree, href: '/financeiro-ag/plano-contas' },
    ],
  },
];

const CONFIGURACOES_MENU: SidebarSection[] = [
  {
    title: 'Geral',
    items: [
      { key: 'cfg-agencia', label: 'Dados da agência', icon: Building2, href: '/config/agencia' },
      { key: 'cfg-usuarios', label: 'Usuários', icon: Users, href: '/config/usuarios' },
    ],
  },
  {
    title: 'Integrações',
    items: [
      // Uma entrada só. CRM, nota fiscal e IA estão dentro, cada um com a
      // sua página — três linhas de menu para três telas parecidas era o
      // que fazia ninguém achar nada.
      { key: 'cfg-plataformas', label: 'Plataformas de venda', icon: ShoppingBag, href: '/config/plataformas' },
      { key: 'cfg-integracoes', label: 'Integrações', icon: Link2, href: '/config/integracoes' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { key: 'cfg-suporte', label: 'Suporte', icon: LifeBuoy, href: '/suporte' },
      { key: 'cfg-auditoria', label: 'Auditoria', icon: ClipboardList, href: '/config/auditoria' },
      { key: 'cfg-reset', label: 'Resetar dados', icon: Eraser, href: '/config/reset' },
    ],
  },
];

export const PILLAR_MENUS: Record<Pillar, SidebarSection[]> = {
  planejamento: PLANEJAMENTO_MENU,
  metas: METAS_MENU,
  financeiro: FINANCEIRO_MENU,
  configuracoes: CONFIGURACOES_MENU,
};

interface PillarSidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  /**
   * Na gaveta do celular o trilho também carrega a troca de pilar, que no
   * desktop mora na barra de cima. Sem isto a gaveta mostraria as páginas de
   * um pilar sem oferecer caminho para os outros três.
   */
  comSeletorDePilar?: boolean;
}

/** Itens que só acendem na página exata, nunca nas de baixo. */
const SO_EXATO = new Set(['/financeiro-ag']);

/** Páginas fora do menu e o item que acende quando a pessoa está nelas. */
const PAI_NO_MENU: Array<[string, string]> = [
  ['/financeiro-ag/recebimentos', '/financeiro-ag/receber'],
  ['/relatorios', '/financeiro-ag/dre'],
  ['/cac', '/financeiro-ag/dre'],
];

export function PillarSidebar({ collapsed = false, onToggle, comSeletorDePilar = false }: PillarSidebarProps) {
  const pathname = usePathname();
  const activePillar = useActivePillar();

  if (!activePillar) return null;

  const sections = PILLAR_MENUS[activePillar];

  // Um item ativo só: o MAIS ESPECÍFICO que casa com a rota. Antes era
  // "casa por prefixo", e em /financeiro-ag/receber acendiam juntos
  // "Visão geral" (/financeiro-ag) e "Contas a receber".
  //
  // "Visão geral" do Financeiro só acende nela mesma: as páginas fora do menu
  // (Recebimentos das plataformas, por exemplo) também moram em /financeiro-ag,
  // e acendê-la ali dizia que a pessoa estava onde não estava. Essas páginas
  // acendem o item mais próximo do que fazem (PAI_NO_MENU).
  const casa = (href: string) =>
    pathname === href
    || (href !== '/' && !SO_EXATO.has(href) && pathname.startsWith(href + '/'))
    || (href === '/grupos' && pathname === '/');
  const hrefs = sections.flatMap(sec => sec.items.map(it => it.href));
  const pai = PAI_NO_MENU.find(([prefixo]) => pathname === prefixo || pathname.startsWith(prefixo + '/'));
  const hrefAtivo = hrefs.filter(casa).sort((a, b) => b.length - a.length)[0]
    ?? (pai && hrefs.includes(pai[1]) ? pai[1] : null);
  const isActive = (href: string) => href === hrefAtivo;

  return (
    <TooltipProvider delay={collapsed ? 100 : 600}>
      {/* Navegação BRANCA, separada da área de trabalho (--fin-bg) por uma
          borda fina: é a direção do painel de referência de 05/10/2026. O
          item ativo é o único ponto de cor da barra (azul suave + texto azul),
          e o ícone acompanha o texto. */}
      <aside
        className={`flex shrink-0 flex-col overflow-hidden border-r border-[var(--fin-border)] bg-[var(--fin-surface)] transition-[width] duration-200 ease-out ${
          collapsed ? 'w-[64px]' : 'w-[240px]'
        }`}
      >
        {/* min-h-0 é o que faz o scroll acontecer AQUI e não empurrar o rodapé
            para fora: sem ele o botão de recolher subia por cima do último
            item da lista. */}
        {comSeletorDePilar && (
          <div className="shrink-0 border-b border-[var(--fin-border)] p-2">
            {PILARES_DO_MENU.map(pilar => {
              const Icone = pilar.icon;
              const selecionado = activePillar === pilar.id;
              return (
                <Link
                  key={pilar.id}
                  href={ROTA_DO_PILAR[pilar.id]}
                  aria-current={selecionado ? 'page' : undefined}
                  className={[
                    'flex h-10 items-center gap-3 rounded-[var(--fin-r-md)] px-3 fin-t-body transition-colors',
                    selecionado
                      ? 'bg-[var(--fin-accent-soft)] font-medium text-[var(--fin-accent)]'
                      : 'text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]',
                  ].join(' ')}
                >
                  <Icone className="size-[18px] shrink-0" />
                  <span className="truncate">{pilar.label}</span>
                </Link>
              );
            })}
          </div>
        )}

        <nav aria-label="Menu do módulo" className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="sidebar-content" key={activePillar}>
            {sections.map((section, sIdx) => (
              <div key={sIdx} className={sIdx > 0 ? 'mt-4' : ''}>
                {section.title && !collapsed && (
                  <div className="fin-t-overline px-3 pb-1.5 pt-4 text-[var(--fin-text-3)]">
                    {section.title}
                  </div>
                )}
                {section.title && collapsed && (
                  <div className="mx-2 mb-1.5 mt-1.5 h-px bg-[var(--fin-border)]" />
                )}
                <div className="space-y-px">
                  {section.items.map(item => {
                    const Icon = item.icon;
                    const active = isActive(item.href);

                    const linkContent = (
                      <Link
                        key={item.key}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={[
                          'sidebar-item flex h-10 items-center gap-3 rounded-[var(--fin-r-md)] px-3',
                          'fin-t-body transition-colors duration-[var(--fin-dur-rapida)]',
                          'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-[-2px]',
                          active
                            ? 'bg-[var(--fin-accent-soft)] font-medium text-[var(--fin-accent)]'
                            : 'text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
                        ].join(' ')}
                      >
                        <Icon className="size-[18px] shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </Link>
                    );

                    if (collapsed) {
                      return (
                        <Tooltip key={item.key}>
                          <TooltipTrigger
                            render={
                              <Link
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                className={[
                                  'sidebar-item relative mx-auto flex size-10 items-center justify-center rounded-[var(--fin-r-md)]',
                                  'transition-colors duration-[var(--fin-dur-rapida)]',
                                  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-[-2px]',
                                  active
                                    ? 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]'
                                    : 'text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
                                ].join(' ')}
                              />
                            }
                          >
                            <Icon className="size-[18px] shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8}>
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return linkContent;
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Na gaveta não há o que recolher: ela já some ao fechar. */}
        {onToggle && (
        <>
        {/* shrink-0 mantém o rodapé fora da rolagem: com a lista mais alta que
            a janela ele era empurrado e cobria o último item do menu. */}
        <div className="shrink-0 border-t border-[var(--fin-border)] px-3 py-2">
          <button
            onClick={onToggle}
            className={[
              'sidebar-item flex h-10 items-center rounded-[var(--fin-r-md)] transition-colors duration-[var(--fin-dur-rapida)]',
              'text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
              'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-[-2px]',
              collapsed ? 'mx-auto w-10 justify-center' : 'w-full gap-3 px-3',
            ].join(' ')}
            title={collapsed ? 'Expandir menu (Ctrl+B)' : 'Recolher menu (Ctrl+B)'}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed
              ? <PanelLeftOpen className="size-[18px]" />
              : <><PanelLeftClose className="size-[18px] shrink-0" /><span className="fin-t-caption">Recolher</span></>
            }
          </button>
        </div>
        </>
        )}
      </aside>
    </TooltipProvider>
  );
}
