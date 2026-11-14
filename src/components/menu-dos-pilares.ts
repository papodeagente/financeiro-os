/**
 * Menu lateral dos quatro pilares (dados). Separado de PillarSidebar.tsx
 * para o teste do menu por módulo ler sem montar a tela (14/11/2026).
 * O filtro por versão e módulo está em src/lib/menu-por-modulo.ts.
 */
import type { ComponentType } from 'react';
import type { Pillar } from '@/hooks/useActivePillar';
import type { ModuloId } from '@/lib/modulos';
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
  Eraser, LifeBuoy, FileText,
  LayoutGrid, ChartColumn, ArrowDownLeft, ArrowUpRight, GitCompareArrows, ListTree,
  MessageCircleQuestion, Contact, Truck, Repeat, Lock, ArrowDownUp, Barcode, FolderInput, Coins, FileStack, HandCoins, Handshake, BadgePercent, FilePlus2, FileCog, ReceiptText, Users2, Grid3x3, CalendarCheck, Banknote, UserRound, BarChart3, Undo2, PiggyBank, FileText as FileTextIcon, CalendarRange, Network, Split, Tags, ShieldCheck, Stamp, Scale, ScrollText, ListOrdered, Table2, ClipboardCheck, RefreshCw,
} from 'lucide-react';

export interface SidebarItem {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  href: string;
  /** Só na conta do ecossistema (perfil-da-conta.ts). Esconder aqui é só a tela: a rota barra no servidor. */
  soEcossistema?: boolean;
  /**
   * Módulo da versão completa (src/lib/modulos.ts): sem ele, o item não
   * aparece. A agência simples vê exatamente o menu da versão simples
   * (scripts/test-modulos-menu.ts congela esse menu).
   */
  modulo?: ModuloId;
  /** Rótulo na versão simples, quando a completa renomeou a tela (vale sem o núcleo completo). */
  rotuloSimples?: string;
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
      { key: 'comissao-mrr', label: 'Comissão por MRR', icon: Repeat, href: '/equipe/mrr', soEcossistema: true, modulo: 'comissoes' },
      { key: 'vendedores', label: 'Vendedores e planos', icon: UserCheck, href: '/equipe/vendedores' },
      { key: 'folha', label: 'Folha', icon: Wallet2, href: '/equipe/folha' },
      { key: 'planos-comissao', label: 'Planos de comissão', icon: Settings, href: '/equipe/planos-comissao' },
      { key: 'funcoes', label: 'Funções', icon: Users2, href: '/equipe/funcoes', modulo: 'comissoes' },
      { key: 'planos-por-funcao', label: 'Planos por função', icon: Grid3x3, href: '/equipe/planos-por-funcao', modulo: 'comissoes' },
      { key: 'metas-por-funcao', label: 'Grade de metas', icon: Table2, href: '/equipe/metas-por-funcao', modulo: 'comissoes' },
      { key: 'fechar-comissoes', label: 'Fechar comissões', icon: CalendarCheck, href: '/equipe/fechar-comissoes', modulo: 'comissoes' },
      { key: 'pagar-comissoes', label: 'Pagar comissões', icon: Banknote, href: '/equipe/pagar-comissoes', modulo: 'comissoes' },
      { key: 'minhas-comissoes', label: 'Minhas comissões', icon: UserRound, href: '/equipe/minhas-comissoes', modulo: 'comissoes' },
      { key: 'relatorios-vendas', label: 'Relatórios de vendas', icon: BarChart3, href: '/relatorios/vendas', modulo: 'relatorios' },
      { key: 'relatorios-envios', label: 'Envios agendados', icon: CalendarRange, href: '/relatorios/envios', modulo: 'relatorios' },
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
      { key: 'fin-perguntar', label: 'Perguntar', icon: MessageCircleQuestion, href: '/financeiro-ag/perguntar', modulo: 'ia' },
      { key: 'fluxo-caixa', label: 'Fluxo de caixa', icon: ChartColumn, href: '/financeiro-ag/fluxo-caixa' },
      { key: 'dre', label: 'Resultado do mês', icon: FileText, href: '/financeiro-ag/dre' },
      { key: 'resultado-por-categoria', label: 'Resultado por categoria', icon: Table2, href: '/financeiro-ag/resultado-por-categoria', modulo: 'relatorios' },
    ],
  },
  {
    title: 'Dia a dia',
    items: [
      { key: 'contas', label: 'Contas a Pagar/Receber', icon: ArrowDownUp, href: '/financeiro-ag/contas', modulo: 'nucleo' },
      { key: 'receber', label: 'Contas a receber', icon: ArrowDownLeft, href: '/financeiro-ag/receber' },
      { key: 'pagar', label: 'Contas a pagar', icon: ArrowUpRight, href: '/financeiro-ag/pagar' },
      { key: 'cobrancas', label: 'Cobranças', icon: Barcode, href: '/financeiro-ag/cobrancas', modulo: 'cobranca' },
      { key: 'faturas', label: 'Faturas', icon: FileTextIcon, href: '/financeiro-ag/faturas', modulo: 'venda' },
      { key: 'regras-faturamento', label: 'Regras de faturamento', icon: CalendarRange, href: '/financeiro-ag/regras-faturamento', modulo: 'venda' },
      { key: 'conciliacao', label: 'Conciliação', icon: GitCompareArrows, href: '/financeiro-ag/conciliacao' },
      { key: 'extrato-automatico', label: 'Extrato automático', icon: RefreshCw, href: '/financeiro-ag/extrato-automatico', modulo: 'extrato' },
      { key: 'conferencia-operadora', label: 'Conferência de operadora', icon: ClipboardCheck, href: '/financeiro-ag/conferencia-operadora', modulo: 'extrato' },
      { key: 'notas-fiscais', label: 'Notas fiscais', icon: Receipt, href: '/financeiro-ag/notas' },
      { key: 'notas-gerar', label: 'Gerar notas', icon: FilePlus2, href: '/financeiro-ag/notas/gerar', modulo: 'notas' },
      { key: 'notas-regras', label: 'Regras da nota', icon: FileCog, href: '/financeiro-ag/notas/regras', modulo: 'notas' },
      { key: 'notas-retencoes', label: 'Retenções na fonte', icon: ReceiptText, href: '/financeiro-ag/notas/retencoes', modulo: 'notas' },
      { key: 'extrato', label: 'Extrato de conta', icon: ScrollText, href: '/financeiro-ag/extrato', modulo: 'nucleo' },
      { key: 'movimentacoes', label: 'Movimentações', icon: ListOrdered, href: '/financeiro-ag/movimentacoes', modulo: 'nucleo' },
      { key: 'transferencias', label: 'Transferências', icon: ArrowRightLeft, href: '/financeiro-ag/transferencias' },
      { key: 'cheques', label: 'Cheques emitidos', icon: ReceiptText, href: '/financeiro-ag/cheques', modulo: 'cheques' },
      { key: 'fechamento', label: 'Fechar Caixa', icon: Lock, href: '/financeiro-ag/fechamento', modulo: 'nucleo' },
      { key: 'aprovacoes', label: 'Aprovações', icon: Stamp, href: '/financeiro-ag/aprovacoes', modulo: 'nucleo' },
      { key: 'reembolsos', label: 'Reembolsos', icon: Undo2, href: '/financeiro-ag/reembolsos', modulo: 'venda' },
      { key: 'creditos', label: 'Crédito do cliente', icon: PiggyBank, href: '/financeiro-ag/creditos', modulo: 'venda' },
    ],
  },
  {
    title: 'Fornecedores',
    items: [
      { key: 'forn-faturas', label: 'Fatura do fornecedor', icon: FileStack, href: '/financeiro-ag/fornecedores/faturas', modulo: 'venda' },
      { key: 'forn-sinais', label: 'Sinais a fornecedores', icon: HandCoins, href: '/financeiro-ag/fornecedores/sinais', modulo: 'venda' },
      { key: 'forn-acordos', label: 'Acordos com fornecedores', icon: Handshake, href: '/financeiro-ag/fornecedores/acordos', modulo: 'venda' },
      { key: 'forn-comissoes', label: 'Comissão de fornecedores', icon: BadgePercent, href: '/financeiro-ag/fornecedores/comissoes', modulo: 'venda' },
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
      { key: 'centros-custo', label: 'Centros de custo', icon: Network, href: '/financeiro-ag/centros-custo', modulo: 'nucleo' },
      { key: 'formas-pagamento', label: 'Formas de pagamento', icon: Wallet, href: '/financeiro-ag/formas-pagamento', modulo: 'nucleo' },
      { key: 'moedas', label: 'Moedas e câmbio', icon: Coins, href: '/financeiro-ag/moedas', modulo: 'cambio' },
    ],
  },
  {
    title: 'Relatórios',
    items: [
      { key: 'rel-categoria', label: 'Por categoria', icon: Tags, href: '/financeiro-ag/relatorios/lancamentos-categoria', modulo: 'relatorios' },
      { key: 'rel-centro', label: 'Por centro de custo', icon: Network, href: '/financeiro-ag/relatorios/lancamentos-centro-custo', modulo: 'relatorios' },
      { key: 'rel-rateio', label: 'Por rateio', icon: Split, href: '/financeiro-ag/relatorios/lancamentos-rateio', modulo: 'relatorios' },
    ],
  },
];

const CONFIGURACOES_MENU: SidebarSection[] = [
  {
    title: 'Geral',
    items: [
      { key: 'cfg-agencia', label: 'Dados da agência', icon: Building2, href: '/config/agencia' },
      { key: 'cfg-empresas', label: 'Empresas', icon: Network, href: '/config/empresas', modulo: 'empresas' },
      { key: 'cfg-usuarios', label: 'Usuários', icon: Users, href: '/config/usuarios' },
      { key: 'cfg-financeiro', label: 'Financeiro', icon: Percent, href: '/config/financeiro', modulo: 'nucleo' },
      { key: 'cfg-cobranca', label: 'Cobrança', icon: Barcode, href: '/config/cobranca', modulo: 'cobranca' },
      { key: 'cfg-vendas', label: 'Vendas', icon: ShoppingBag, href: '/config/vendas', modulo: 'venda' },
      { key: 'cfg-comissoes', label: 'Comissões', icon: Percent, href: '/config/comissoes', modulo: 'comissoes' },
      { key: 'cfg-mudanca', label: 'Mudar para o EnturOS', icon: FolderInput, href: '/mudanca', modulo: 'mudanca' },
      { key: 'cfg-perfis', label: 'Perfis de acesso', icon: ShieldCheck, href: '/config/perfis-de-acesso', modulo: 'nucleo' },
      { key: 'cfg-limites', label: 'Limites e aprovação', icon: Scale, href: '/config/limites-e-aprovacao', modulo: 'nucleo' },
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
      { key: 'cfg-auditoria', label: 'Registro de atividades', rotuloSimples: 'Auditoria', icon: ClipboardList, href: '/config/auditoria' },
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
