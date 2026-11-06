'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, FolderOpen, FileText, BarChart3, Plane, Hotel, Globe,
  LayoutDashboard, Medal, Percent, Settings, Wallet,
  Gauge, TrendingUp, Receipt, CreditCard, BookOpen, Landmark,
  ArrowRightLeft, Package, ShoppingCart, ListOrdered, UserPlus,
  Building2, Briefcase, DollarSign, Link2, FileSpreadsheet, Plus, Compass,
  FolderInput, BookA, ListChecks,
} from 'lucide-react';
import { buscarPorTermoDeMercado, normalizarBusca } from '@/lib/busca-de-mercado';
import { buscarNoGlossario } from '@/lib/migracao/telas/glossario';
import { rotuloDaEntrega } from '@/lib/migracao/telas/paridade';

interface CommandItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  section: 'navegacao' | 'criar' | 'recentes' | 'crm' | 'mercado' | 'glossario';
  /** Linha curta abaixo do nome (busca por termo de mercado). */
  dica?: string;
}

const NAVIGATION_ITEMS: CommandItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="w-4 h-4" />, section: 'navegacao' },
  { id: 'grupos', label: 'Produtos', href: '/grupos', icon: <FolderOpen className="w-4 h-4" />, section: 'navegacao' },
  { id: 'propostas', label: 'Propostas', href: '/propostas', icon: <FileText className="w-4 h-4" />, section: 'navegacao' },
  { id: 'orcamentos', label: 'Orçamentos', href: '/vendas/orcamentos', icon: <BarChart3 className="w-4 h-4" />, section: 'navegacao' },
  { id: 'vendas', label: 'Vendas fechadas', href: '/vendas', icon: <ListOrdered className="w-4 h-4" />, section: 'navegacao' },
  { id: 'voos', label: 'Buscar voos', href: '/voos', icon: <Plane className="w-4 h-4" />, section: 'navegacao' },
  { id: 'hoteis', label: 'Buscar hotéis', href: '/hoteis', icon: <Hotel className="w-4 h-4" />, section: 'navegacao' },
  { id: 'destinos', label: 'Destinos', href: '/destinos', icon: <Globe className="w-4 h-4" />, section: 'navegacao' },
  { id: 'fluxo', label: 'Fluxo de caixa', href: '/financeiro-ag/fluxo-caixa', icon: <DollarSign className="w-4 h-4" />, section: 'navegacao' },
  { id: 'dre', label: 'Resultado do mês (DRE)', href: '/financeiro-ag/dre', icon: <FileSpreadsheet className="w-4 h-4" />, section: 'navegacao' },
  // Nomes de mercado (05/11/2026): quem vem do sistema anterior acha pelo nome que já usa.
  { id: 'extrato', label: 'Extrato de conta', href: '/financeiro-ag/extrato', icon: <Landmark className="w-4 h-4" />, section: 'navegacao' },
  { id: 'movimentacoes', label: 'Movimentações', href: '/financeiro-ag/movimentacoes', icon: <ArrowRightLeft className="w-4 h-4" />, section: 'navegacao' },
  { id: 'dre-resultado', label: 'DRE', href: '/financeiro-ag/dre', icon: <FileSpreadsheet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'resultado-por-categoria', label: 'Resultado por categoria', href: '/financeiro-ag/resultado-por-categoria', icon: <BarChart3 className="w-4 h-4" />, section: 'navegacao' },
  { id: 'visao-geral-financeiro', label: 'Visão geral do financeiro', href: '/financeiro-ag', icon: <Wallet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'registro-atividades', label: 'Registro de atividades', href: '/config/auditoria', icon: <ListOrdered className="w-4 h-4" />, section: 'navegacao' },
  { id: 'lucro-real', label: 'Lucro real', href: '/relatorios/lucro-real', icon: <TrendingUp className="w-4 h-4" />, section: 'navegacao' },
  // Pagar e receber numa lista só (05/11/2026). Mais de um nome, para achar pelo que a pessoa já fala.
  { id: 'contas-pagar-receber', label: 'Contas a Pagar/Receber', href: '/financeiro-ag/contas', icon: <Wallet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'liquidar-em-lote', label: 'Liquidar contas em lote (dar baixa em várias)', href: '/financeiro-ag/contas', icon: <Wallet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'titulos-pagar-receber', label: 'Títulos a pagar e a receber', href: '/financeiro-ag/contas', icon: <Wallet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'receber', label: 'Contas a receber', href: '/financeiro-ag/receber', icon: <Receipt className="w-4 h-4" />, section: 'navegacao' },
  { id: 'cobrancas', label: 'Cobranças (boletos e Pix)', href: '/financeiro-ag/cobrancas', icon: <Receipt className="w-4 h-4" />, section: 'navegacao' },
  // Cancelamento, reembolsos e crédito do cliente (E5, parte D).
  { id: 'reembolsos', label: 'Reembolsos (ao cliente e do fornecedor)', href: '/financeiro-ag/reembolsos', icon: <Receipt className="w-4 h-4" />, section: 'navegacao' },
  { id: 'creditos-cliente', label: 'Crédito do cliente (carteira, validade e extrato)', href: '/financeiro-ag/creditos', icon: <Wallet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'cancelar-passageiro', label: 'Cancelar passageiro ou produto (abra a venda e use Cancelar)', href: '/vendas', icon: <ListOrdered className="w-4 h-4" />, section: 'navegacao' },
  { id: 'boletos-nao-emitidos', label: 'Gerar boletos (contas sem boleto)', href: '/financeiro-ag/contas?cobranca=sem_boleto', icon: <Receipt className="w-4 h-4" />, section: 'navegacao' },
  { id: 'config-cobranca', label: 'Configurações de cobrança', href: '/config/cobranca', icon: <Settings className="w-4 h-4" />, section: 'navegacao' },
  { id: 'pagar', label: 'Contas a pagar', href: '/financeiro-ag/pagar', icon: <CreditCard className="w-4 h-4" />, section: 'navegacao' },
  { id: 'conciliacao', label: 'Conciliação', href: '/financeiro-ag/conciliacao', icon: <FileSpreadsheet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'transferencias', label: 'Transferências', href: '/financeiro-ag/transferencias', icon: <ArrowRightLeft className="w-4 h-4" />, section: 'navegacao' },
  { id: 'plano-contas', label: 'Categorias (plano de contas)', href: '/financeiro-ag/plano-contas', icon: <BookOpen className="w-4 h-4" />, section: 'navegacao' },
  { id: 'formas-pagamento', label: 'Formas de pagamento', href: '/financeiro-ag/formas-pagamento', icon: <Wallet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'config-financeiro', label: 'Configurações do financeiro', href: '/config/financeiro', icon: <Settings className="w-4 h-4" />, section: 'navegacao' },
  // Fora do menu do Financeiro desde 08/10/2026: a busca é o caminho curto.
  { id: 'recebimentos', label: 'Recebimentos das plataformas', href: '/financeiro-ag/recebimentos', icon: <Receipt className="w-4 h-4" />, section: 'navegacao' },
  { id: 'notas', label: 'Notas fiscais', href: '/financeiro-ag/notas', icon: <FileText className="w-4 h-4" />, section: 'navegacao' },
  { id: 'cartoes', label: 'Cartões', href: '/financeiro-ag/cartoes', icon: <CreditCard className="w-4 h-4" />, section: 'navegacao' },
  { id: 'taxas', label: 'Taxas de pagamento', href: '/relatorios/taxas', icon: <Percent className="w-4 h-4" />, section: 'navegacao' },
  { id: 'comparativo', label: 'Comparativo mensal', href: '/relatorios/comparativo', icon: <BarChart3 className="w-4 h-4" />, section: 'navegacao' },
  { id: 'contas-bancarias', label: 'Contas bancárias', href: '/financeiro-ag/contas-bancarias', icon: <Landmark className="w-4 h-4" />, section: 'navegacao' },
  { id: 'fin-grupos', label: 'Financeiro por produto', href: '/financeiro-grupos', icon: <Package className="w-4 h-4" />, section: 'navegacao' },
  { id: 'clientes', label: 'Clientes', href: '/pessoas/clientes', icon: <UserPlus className="w-4 h-4" />, section: 'navegacao' },
  { id: 'fornecedores', label: 'Fornecedores', href: '/pessoas/fornecedores', icon: <Building2 className="w-4 h-4" />, section: 'navegacao' },
  { id: 'equipe', label: 'Equipe', href: '/pessoas/equipe', icon: <Briefcase className="w-4 h-4" />, section: 'navegacao' },
  { id: 'metas', label: 'Metas da equipe', href: '/equipe/metas', icon: <Medal className="w-4 h-4" />, section: 'navegacao' },
  { id: 'comissoes', label: 'Comissões', href: '/equipe/comissoes', icon: <Percent className="w-4 h-4" />, section: 'navegacao' },
  { id: 'planos-comissao', label: 'Planos de comissão', href: '/equipe/planos-comissao', icon: <Settings className="w-4 h-4" />, section: 'navegacao' },
  { id: 'funcoes-comissao', label: 'Funções e metas (comissão por função)', href: '/equipe/funcoes', icon: <Briefcase className="w-4 h-4" />, section: 'navegacao' },
  { id: 'planos-por-funcao', label: 'Planos de comissão por função', href: '/equipe/planos-por-funcao', icon: <Settings className="w-4 h-4" />, section: 'navegacao' },
  { id: 'fechar-comissoes', label: 'Fechar comissões', href: '/equipe/fechar-comissoes', icon: <Percent className="w-4 h-4" />, section: 'navegacao' },
  { id: 'pagar-comissoes', label: 'Pagar comissões', href: '/equipe/pagar-comissoes', icon: <Wallet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'minhas-comissoes', label: 'Minhas comissões (painel do vendedor)', href: '/equipe/minhas-comissoes', icon: <Medal className="w-4 h-4" />, section: 'navegacao' },
  { id: 'config-comissoes', label: 'Configurações de comissão', href: '/config/comissoes', icon: <Settings className="w-4 h-4" />, section: 'navegacao' },
  { id: 'relatorios-vendas', label: 'Relatórios de vendas (por produto, vendedor, forma de pagamento, ranking de clientes, tabela dinâmica)', href: '/relatorios/vendas', icon: <BarChart3 className="w-4 h-4" />, section: 'navegacao' },
  { id: 'custos', label: 'Custos do negócio', href: '/planejamento/custos', icon: <Wallet className="w-4 h-4" />, section: 'navegacao' },
  { id: 'relatorios', label: 'Relatórios financeiros', href: '/relatorios/financeiro', icon: <DollarSign className="w-4 h-4" />, section: 'navegacao' },
  { id: 'cac', label: 'Dashboard CAC', href: '/cac/dashboard', icon: <Gauge className="w-4 h-4" />, section: 'navegacao' },
  { id: 'rentabilidade', label: 'Rentabilidade', href: '/relatorios/rentabilidade', icon: <TrendingUp className="w-4 h-4" />, section: 'navegacao' },
  { id: 'config-agencia', label: 'Configurações', href: '/config/agencia', icon: <Settings className="w-4 h-4" />, section: 'navegacao' },
  // Mudança de sistema (E4, 05/11/2026).
  { id: 'mudanca', label: 'Mudar para o EnturOS (trazer dados do sistema anterior)', href: '/mudanca', icon: <FolderInput className="w-4 h-4" />, section: 'navegacao' },
  { id: 'mudanca-glossario', label: 'Glossário: como chamava lá, como chama aqui', href: '/mudanca/glossario', icon: <BookA className="w-4 h-4" />, section: 'navegacao' },
  { id: 'mudanca-paridade', label: 'Checklist de paridade', href: '/mudanca/paridade', icon: <ListChecks className="w-4 h-4" />, section: 'navegacao' },
  { id: 'mudanca-registros', label: 'Registros trazidos do sistema anterior (faturas, notas, comissões pagas)', href: '/mudanca/historico', icon: <FolderInput className="w-4 h-4" />, section: 'navegacao' },
];

const CREATE_ITEMS: CommandItem[] = [
  { id: 'novo-grupo', label: 'Novo produto', href: '/grupos', icon: <Plus className="w-4 h-4" />, section: 'criar' },
  { id: 'nova-proposta', label: 'Nova proposta', href: '/propostas/nova', icon: <Plus className="w-4 h-4" />, section: 'criar' },
  { id: 'nova-venda', label: 'Nova venda', href: '/vendas/nova', icon: <ShoppingCart className="w-4 h-4" />, section: 'criar' },
];

const CRM_ITEMS: CommandItem[] = [
  { id: 'crm-status', label: 'Status da integração CRM', href: '/config/crm', icon: <Link2 className="w-4 h-4" />, section: 'crm' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const recents = useMemo(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = JSON.parse(localStorage.getItem('entur:recentes') || '[]') as string[];
      return stored.slice(0, 5).map(href => {
        const found = NAVIGATION_ITEMS.find(i => i.href === href);
        return found ? { ...found, section: 'recentes' as const } : null;
      }).filter(Boolean) as CommandItem[];
    } catch { return []; }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return [...CREATE_ITEMS, ...recents.slice(0, 3), ...CRM_ITEMS];
    }
    const q = normalizarBusca(query);
    const all = [...CREATE_ITEMS, ...NAVIGATION_ITEMS, ...CRM_ITEMS];
    const porNome = all.filter(item => normalizarBusca(item.label).includes(q));
    // Termos de mercado (05/11/2026): quem vem de outro sistema digita o nome
    // que já usa ("retorno do banco", "fechar caixa") e cai na tela certa,
    // com uma frase quando aqui funciona diferente.
    const jaListados = new Set(porNome.map(i => i.href));
    const mercado: CommandItem[] = buscarPorTermoDeMercado(query)
      .filter(({ destino }) => destino.frase || !jaListados.has(destino.href))
      .map(({ destino, termo }) => ({
        id: `mercado-${destino.id}`,
        label: destino.tela,
        href: destino.href,
        icon: <Compass className="w-4 h-4" />,
        section: 'mercado' as const,
        dica: destino.frase
          ?? (normalizarBusca(termo) !== normalizarBusca(destino.tela) ? `Também chamado de "${termo}".` : undefined),
      }));
    // Glossário da mudança (E4): o nome antigo leva à tela de agora, com a
    // diferença numa frase; o que ainda não existe leva ao glossário.
    const vistos = new Set([...porNome, ...mercado].map(i => `${i.href}|${normalizarBusca(i.label)}`));
    const glossario: CommandItem[] = buscarNoGlossario(query)
      .map(t => ({
        id: `glossario-${t.id}`,
        label: t.aqui,
        href: t.href ?? '/mudanca/glossario',
        icon: <BookA className="w-4 h-4" />,
        section: 'glossario' as const,
        dica: t.chega
          ? `Lá: "${t.la[0]}". Ainda vem: ${rotuloDaEntrega(t.chega)}.`
          : `Lá: "${t.la[0]}".${t.diferenca ? ` ${t.diferenca}` : ''}`,
      }))
      .filter(i => !vistos.has(`${i.href}|${normalizarBusca(i.label)}`))
      .slice(0, 4);
    return [...porNome, ...mercado, ...glossario];
  }, [query, recents]);

  const handleSelect = (item: CommandItem) => {
    onClose();
    router.push(item.href);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      handleSelect(filtered[selectedIdx]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  const sectionLabels: Record<string, string> = {
    criar: 'Criar',
    recentes: 'Recentes',
    navegacao: 'Navegação',
    crm: 'Integração',
    mercado: 'Pelo nome que você já usa',
    glossario: 'Glossário da mudança',
  };

  let lastSection = '';
  let globalIdx = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-lg bg-[var(--t-surface)] shadow-[var(--t-card-shadow)] rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--t-border)]">
          <Search className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar páginas, criar ou pelo nome que você já usa..."
            className="flex-1 bg-transparent text-[length:var(--text-body)] text-[var(--t-text)] outline-none placeholder:text-[var(--t-text-muted)]"
          />
          <kbd className="text-[10px] text-[var(--t-text-muted)] bg-[var(--t-sidebar-item-hover)] px-1.5 py-0.5 rounded">ESC</kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-[length:var(--text-body-sm)] text-[var(--t-text-muted)]">Nenhum resultado</p>
          )}
          {filtered.map((item) => {
            globalIdx++;
            const idx = globalIdx;
            const showSection = item.section !== lastSection;
            lastSection = item.section;

            return (
              <div key={item.id}>
                {showSection && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
                    {sectionLabels[item.section]}
                  </div>
                )}
                <button
                  className={`w-full flex items-center gap-3 px-4 py-2 text-[length:var(--text-body-sm)] transition-colors ${
                    idx === selectedIdx
                      ? 'bg-[var(--t-green)]/8 text-[var(--t-green)]'
                      : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-sidebar-item-hover)]'
                  }`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  {item.icon}
                  {item.dica ? (
                    <span className="flex min-w-0 flex-col text-left">
                      <span>{item.label}</span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">{item.dica}</span>
                    </span>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
