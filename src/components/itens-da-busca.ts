/**
 * Itens e busca do ⌘K (dados e regra pura). Separado de CommandPalette.tsx
 * para o teste por módulo ler sem montar a tela (14/11/2026).
 *
 * Por versão e módulo (menu-por-modulo.ts): o item com `modulo` só aparece
 * com o módulo ligado. Sem o núcleo completo, a busca é a da versão simples
 * (só pelo nome, sem acento tratado, sem nomes de mercado nem pergunta em
 * texto): scripts/test-modulos-menu.ts congela esse comportamento.
 */
import type { ComponentType } from 'react';
import {
  FolderOpen, FileText, BarChart3, Plane, Hotel, Globe,
  LayoutDashboard, Medal, Percent, Settings, Wallet,
  Gauge, TrendingUp, Receipt, CreditCard, BookOpen, Landmark,
  ArrowRightLeft, Package, ShoppingCart, ListOrdered, UserPlus,
  Building2, Briefcase, DollarSign, Link2, FileSpreadsheet, Plus, Compass,
  FolderInput, BookA, ListChecks, MessageCircleQuestion, ScanText,
} from 'lucide-react';
import { buscarPorTermoDeMercado, normalizarBusca } from '@/lib/busca-de-mercado';
import { buscarNoGlossario } from '@/lib/migracao/telas/glossario';
import { rotuloDaEntrega } from '@/lib/migracao/telas/paridade';
import { moduloLigado, type ModuloId } from '@/lib/modulos';
import { itemLiberado, type ContextoDoMenu } from '@/lib/menu-por-modulo';

export interface CommandItem {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  section: 'navegacao' | 'criar' | 'recentes' | 'crm' | 'mercado' | 'glossario';
  /** Linha curta abaixo do nome (busca por termo de mercado). */
  dica?: string;
  /** Módulo da versão completa (src/lib/modulos.ts): sem ele, o item não aparece. */
  modulo?: ModuloId;
}

export const NAVIGATION_ITEMS: CommandItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, section: 'navegacao' },
  { id: 'grupos', label: 'Produtos', href: '/grupos', icon: FolderOpen, section: 'navegacao' },
  { id: 'propostas', label: 'Propostas', href: '/propostas', icon: FileText, section: 'navegacao' },
  { id: 'orcamentos', label: 'Orçamentos', href: '/vendas/orcamentos', icon: BarChart3, section: 'navegacao' },
  { id: 'vendas', label: 'Vendas fechadas', href: '/vendas', icon: ListOrdered, section: 'navegacao' },
  { id: 'venda-voucher', label: 'Lançar venda pelo voucher (a IA lê e você revisa)', href: '/vendas/lancar/voucher', icon: ScanText, section: 'navegacao', modulo: 'ia' },
  { id: 'perguntar', label: 'Perguntar ao financeiro (em texto)', href: '/financeiro-ag/perguntar', icon: MessageCircleQuestion, section: 'navegacao', modulo: 'ia' },
  { id: 'voos', label: 'Buscar voos', href: '/voos', icon: Plane, section: 'navegacao' },
  { id: 'hoteis', label: 'Buscar hotéis', href: '/hoteis', icon: Hotel, section: 'navegacao' },
  { id: 'destinos', label: 'Destinos', href: '/destinos', icon: Globe, section: 'navegacao' },
  { id: 'fluxo', label: 'Fluxo de caixa', href: '/financeiro-ag/fluxo-caixa', icon: DollarSign, section: 'navegacao' },
  { id: 'dre', label: 'Resultado do mês (DRE)', href: '/financeiro-ag/dre', icon: FileSpreadsheet, section: 'navegacao' },
  // Nomes de mercado (05/11/2026): quem vem do sistema anterior acha pelo nome que já usa.
  { id: 'extrato', label: 'Extrato de conta', href: '/financeiro-ag/extrato', icon: Landmark, section: 'navegacao', modulo: 'nucleo' },
  { id: 'movimentacoes', label: 'Movimentações', href: '/financeiro-ag/movimentacoes', icon: ArrowRightLeft, section: 'navegacao', modulo: 'nucleo' },
  { id: 'dre-resultado', label: 'DRE', href: '/financeiro-ag/dre', icon: FileSpreadsheet, section: 'navegacao', modulo: 'nucleo' },
  { id: 'resultado-por-categoria', label: 'Resultado por categoria', href: '/financeiro-ag/resultado-por-categoria', icon: BarChart3, section: 'navegacao', modulo: 'relatorios' },
  { id: 'visao-geral-financeiro', label: 'Visão geral do financeiro', href: '/financeiro-ag', icon: Wallet, section: 'navegacao', modulo: 'nucleo' },
  { id: 'registro-atividades', label: 'Registro de atividades', href: '/config/auditoria', icon: ListOrdered, section: 'navegacao', modulo: 'nucleo' },
  { id: 'lucro-real', label: 'Lucro real', href: '/relatorios/lucro-real', icon: TrendingUp, section: 'navegacao' },
  // Pagar e receber numa lista só (05/11/2026). Mais de um nome, para achar pelo que a pessoa já fala.
  { id: 'contas-pagar-receber', label: 'Contas a Pagar/Receber', href: '/financeiro-ag/contas', icon: Wallet, section: 'navegacao', modulo: 'nucleo' },
  { id: 'liquidar-em-lote', label: 'Liquidar contas em lote (dar baixa em várias)', href: '/financeiro-ag/contas', icon: Wallet, section: 'navegacao', modulo: 'nucleo' },
  { id: 'titulos-pagar-receber', label: 'Títulos a pagar e a receber', href: '/financeiro-ag/contas', icon: Wallet, section: 'navegacao', modulo: 'nucleo' },
  { id: 'receber', label: 'Contas a receber', href: '/financeiro-ag/receber', icon: Receipt, section: 'navegacao' },
  { id: 'cobrancas', label: 'Cobranças (boletos e Pix)', href: '/financeiro-ag/cobrancas', icon: Receipt, section: 'navegacao', modulo: 'cobranca' },
  // Cancelamento, reembolsos e crédito do cliente (E5, parte D).
  { id: 'reembolsos', label: 'Reembolsos (ao cliente e do fornecedor)', href: '/financeiro-ag/reembolsos', icon: Receipt, section: 'navegacao', modulo: 'venda' },
  { id: 'creditos-cliente', label: 'Crédito do cliente (carteira, validade e extrato)', href: '/financeiro-ag/creditos', icon: Wallet, section: 'navegacao', modulo: 'venda' },
  { id: 'cancelar-passageiro', label: 'Cancelar passageiro ou produto (abra a venda e use Cancelar)', href: '/vendas', icon: ListOrdered, section: 'navegacao', modulo: 'venda' },
  { id: 'boletos-nao-emitidos', label: 'Gerar boletos (contas sem boleto)', href: '/financeiro-ag/contas?cobranca=sem_boleto', icon: Receipt, section: 'navegacao', modulo: 'cobranca' },
  { id: 'config-cobranca', label: 'Configurações de cobrança', href: '/config/cobranca', icon: Settings, section: 'navegacao', modulo: 'cobranca' },
  { id: 'pagar', label: 'Contas a pagar', href: '/financeiro-ag/pagar', icon: CreditCard, section: 'navegacao' },
  { id: 'conciliacao', label: 'Conciliação', href: '/financeiro-ag/conciliacao', icon: FileSpreadsheet, section: 'navegacao' },
  // E6 (05/11/2026): regras aprendidas e conferência do extrato de operadora.
  { id: 'conciliacao-automatica', label: 'Conciliação automática (regras aprendidas)', href: '/financeiro-ag/conciliacao/automatica', icon: FileSpreadsheet, section: 'navegacao', modulo: 'extrato' },
  { id: 'conciliado-sozinho', label: 'Conciliado sozinho (desfazer conciliação automática)', href: '/financeiro-ag/conciliacao/automatica', icon: FileSpreadsheet, section: 'navegacao', modulo: 'extrato' },
  { id: 'tarifas-bancarias', label: 'Tarifas bancárias que se repetem', href: '/financeiro-ag/conciliacao/automatica', icon: Landmark, section: 'navegacao', modulo: 'extrato' },
  { id: 'conferencia-operadora', label: 'Conferência de operadora (extrato da operadora ou consolidadora)', href: '/financeiro-ag/conferencia-operadora', icon: FileSpreadsheet, section: 'navegacao', modulo: 'extrato' },
  { id: 'comissao-esperada-recebida', label: 'Comissão esperada × recebida por operadora', href: '/financeiro-ag/conferencia-operadora', icon: Percent, section: 'navegacao', modulo: 'extrato' },
  { id: 'transferencias', label: 'Transferências', href: '/financeiro-ag/transferencias', icon: ArrowRightLeft, section: 'navegacao' },
  { id: 'plano-contas', label: 'Categorias (plano de contas)', href: '/financeiro-ag/plano-contas', icon: BookOpen, section: 'navegacao' },
  { id: 'formas-pagamento', label: 'Formas de pagamento', href: '/financeiro-ag/formas-pagamento', icon: Wallet, section: 'navegacao', modulo: 'nucleo' },
  { id: 'config-financeiro', label: 'Configurações do financeiro', href: '/config/financeiro', icon: Settings, section: 'navegacao', modulo: 'nucleo' },
  // Fora do menu do Financeiro desde 08/10/2026: a busca é o caminho curto.
  { id: 'recebimentos', label: 'Recebimentos das plataformas', href: '/financeiro-ag/recebimentos', icon: Receipt, section: 'navegacao' },
  { id: 'notas', label: 'Notas fiscais', href: '/financeiro-ag/notas', icon: FileText, section: 'navegacao' },
  { id: 'cartoes', label: 'Cartões', href: '/financeiro-ag/cartoes', icon: CreditCard, section: 'navegacao' },
  { id: 'taxas', label: 'Taxas de pagamento', href: '/relatorios/taxas', icon: Percent, section: 'navegacao' },
  { id: 'comparativo', label: 'Comparativo mensal', href: '/relatorios/comparativo', icon: BarChart3, section: 'navegacao' },
  { id: 'contas-bancarias', label: 'Contas bancárias', href: '/financeiro-ag/contas-bancarias', icon: Landmark, section: 'navegacao' },
  { id: 'fin-grupos', label: 'Financeiro por produto', href: '/financeiro-grupos', icon: Package, section: 'navegacao' },
  { id: 'clientes', label: 'Clientes', href: '/pessoas/clientes', icon: UserPlus, section: 'navegacao' },
  { id: 'fornecedores', label: 'Fornecedores', href: '/pessoas/fornecedores', icon: Building2, section: 'navegacao' },
  { id: 'equipe', label: 'Equipe', href: '/pessoas/equipe', icon: Briefcase, section: 'navegacao' },
  { id: 'metas', label: 'Metas da equipe', href: '/equipe/metas', icon: Medal, section: 'navegacao' },
  { id: 'comissoes', label: 'Comissões', href: '/equipe/comissoes', icon: Percent, section: 'navegacao' },
  { id: 'planos-comissao', label: 'Planos de comissão', href: '/equipe/planos-comissao', icon: Settings, section: 'navegacao' },
  { id: 'funcoes-comissao', label: 'Funções e metas (comissão por função)', href: '/equipe/funcoes', icon: Briefcase, section: 'navegacao', modulo: 'comissoes' },
  { id: 'planos-por-funcao', label: 'Planos de comissão por função', href: '/equipe/planos-por-funcao', icon: Settings, section: 'navegacao', modulo: 'comissoes' },
  { id: 'metas-por-funcao', label: 'Grade de metas (pessoas × meses)', href: '/equipe/metas-por-funcao', icon: Medal, section: 'navegacao', modulo: 'comissoes' },
  { id: 'fechar-comissoes', label: 'Fechar comissões', href: '/equipe/fechar-comissoes', icon: Percent, section: 'navegacao', modulo: 'comissoes' },
  { id: 'pagar-comissoes', label: 'Pagar comissões', href: '/equipe/pagar-comissoes', icon: Wallet, section: 'navegacao', modulo: 'comissoes' },
  { id: 'minhas-comissoes', label: 'Minhas comissões (painel do vendedor)', href: '/equipe/minhas-comissoes', icon: Medal, section: 'navegacao', modulo: 'comissoes' },
  { id: 'config-comissoes', label: 'Configurações de comissão', href: '/config/comissoes', icon: Settings, section: 'navegacao', modulo: 'comissoes' },
  { id: 'relatorios-vendas', label: 'Relatórios de vendas (por produto, vendedor, unidade, fornecedor, forma de pagamento, pagamentos, ranking de clientes, tabela dinâmica)', href: '/relatorios/vendas', icon: BarChart3, section: 'navegacao', modulo: 'relatorios' },
  { id: 'relatorios-envios', label: 'Envios agendados de relatório (por e-mail, com link de leitura)', href: '/relatorios/envios', icon: BarChart3, section: 'navegacao', modulo: 'relatorios' },
  { id: 'custos', label: 'Custos do negócio', href: '/planejamento/custos', icon: Wallet, section: 'navegacao' },
  { id: 'relatorios', label: 'Relatórios financeiros', href: '/relatorios/financeiro', icon: DollarSign, section: 'navegacao' },
  { id: 'cac', label: 'Dashboard CAC', href: '/cac/dashboard', icon: Gauge, section: 'navegacao' },
  { id: 'rentabilidade', label: 'Rentabilidade', href: '/relatorios/rentabilidade', icon: TrendingUp, section: 'navegacao' },
  { id: 'config-agencia', label: 'Configurações', href: '/config/agencia', icon: Settings, section: 'navegacao' },
  { id: 'cheques', label: 'Cheques emitidos (imprimir cheque, compensar, devolver)', href: '/financeiro-ag/cheques', icon: Receipt, section: 'navegacao', modulo: 'cheques' },
  { id: 'cartao-corporativo-cliente', label: 'Conciliação do cartão corporativo do cliente (relatório de vendas)', href: '/relatorios/vendas?relatorio=cartao_corporativo', icon: CreditCard, section: 'navegacao', modulo: 'relatorios' },
  { id: 'moedas-agencia', label: 'Moedas da agência (cadastrar moeda, câmbio)', href: '/financeiro-ag/moedas', icon: DollarSign, section: 'navegacao', modulo: 'cambio' },
  { id: 'config-empresas', label: 'Empresas da agência (lojas, CNPJs, multiempresa)', href: '/config/empresas', icon: Settings, section: 'navegacao', modulo: 'empresas' },
  // Mudança de sistema (E4, 05/11/2026).
  { id: 'mudanca', label: 'Mudar para o EnturOS (trazer dados do sistema anterior)', href: '/mudanca', icon: FolderInput, section: 'navegacao', modulo: 'mudanca' },
  { id: 'mudanca-glossario', label: 'Glossário: como chamava lá, como chama aqui', href: '/mudanca/glossario', icon: BookA, section: 'navegacao', modulo: 'mudanca' },
  { id: 'mudanca-paridade', label: 'Checklist de paridade', href: '/mudanca/paridade', icon: ListChecks, section: 'navegacao', modulo: 'mudanca' },
  { id: 'mudanca-registros', label: 'Registros trazidos do sistema anterior (faturas, notas, comissões pagas)', href: '/mudanca/historico', icon: FolderInput, section: 'navegacao', modulo: 'mudanca' },
];

export const CREATE_ITEMS: CommandItem[] = [
  { id: 'novo-grupo', label: 'Novo produto', href: '/grupos', icon: Plus, section: 'criar' },
  { id: 'nova-proposta', label: 'Nova proposta', href: '/propostas/nova', icon: Plus, section: 'criar' },
  { id: 'nova-venda', label: 'Nova venda', href: '/vendas/nova', icon: ShoppingCart, section: 'criar' },
];

export const CRM_ITEMS: CommandItem[] = [
  { id: 'crm-status', label: 'Status da integração CRM', href: '/config/crm', icon: Link2, section: 'crm' },
];


/** Os itens que a agência pode abrir. */
export const visiveis = (itens: readonly CommandItem[], ctx: ContextoDoMenu): CommandItem[] => itens.filter(i => itemLiberado(i, ctx));

/** Recentes guardados no navegador (endereços), só os que a agência pode abrir. */
export function recentesDaConta(enderecos: readonly string[], ctx: ContextoDoMenu): CommandItem[] {
  const nav = visiveis(NAVIGATION_ITEMS, ctx);
  return enderecos.slice(0, 5).map(href => {
    const found = nav.find(i => i.href === href);
    return found ? { ...found, section: 'recentes' as const } : null;
  }).filter(Boolean) as CommandItem[];
}

/**
 * O que a lista mostra para o que foi digitado. Sem o núcleo completo é a
 * busca da versão simples, igual à de antes; com ele, acento tratado, nomes
 * de mercado, glossário da mudança (com o módulo) e pergunta em texto (com a IA).
 */
export function resultadosDaBusca(query: string, recentes: readonly CommandItem[], ctx: ContextoDoMenu): CommandItem[] {
  const criar = visiveis(CREATE_ITEMS, ctx);
  const crm = visiveis(CRM_ITEMS, ctx);
  if (!query.trim()) {
    return [...criar, ...recentes.slice(0, 3), ...crm];
  }
  const all = [...criar, ...visiveis(NAVIGATION_ITEMS, ctx), ...crm];
  if (!ctx.modulos.telasCompletas) {
    const q = query.toLowerCase();
    return all.filter(item => item.label.toLowerCase().includes(q));
  }
  const q = normalizarBusca(query);
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
      icon: Compass,
      section: 'mercado' as const,
      dica: destino.frase
        ?? (normalizarBusca(termo) !== normalizarBusca(destino.tela) ? `Também chamado de "${termo}".` : undefined),
    }))
    .filter(i => itemLiberado(i, ctx));
  // Glossário da mudança (E4): o nome antigo leva à tela de agora, com a
  // diferença numa frase; o que ainda não existe leva ao glossário.
  const vistos = new Set([...porNome, ...mercado].map(i => `${i.href}|${normalizarBusca(i.label)}`));
  const glossario: CommandItem[] = !moduloLigado(ctx.modulos, 'mudanca') ? [] : buscarNoGlossario(query)
    .map(t => ({
      id: `glossario-${t.id}`,
      label: t.aqui,
      href: t.href ?? '/mudanca/glossario',
      icon: BookA,
      section: 'glossario' as const,
      dica: t.chega
        ? `Lá: "${t.la[0]}". Ainda vem: ${rotuloDaEntrega(t.chega)}.`
        : `Lá: "${t.la[0]}".${t.diferenca ? ` ${t.diferenca}` : ''}`,
    }))
    .filter(i => itemLiberado(i, ctx) && !vistos.has(`${i.href}|${normalizarBusca(i.label)}`))
    .slice(0, 4);
  // Pergunta em texto: o que foi digitado vira pergunta ao financeiro (com a IA).
  const pergunta: CommandItem[] = query.trim().length >= 8 && moduloLigado(ctx.modulos, 'ia') ? [{
    id: 'perguntar-texto',
    label: `Perguntar: "${query.trim()}"`,
    href: `/financeiro-ag/perguntar?q=${encodeURIComponent(query.trim())}`,
    icon: MessageCircleQuestion,
    section: 'navegacao' as const,
    modulo: 'ia',
  }] : [];
  return [...porNome, ...mercado, ...glossario, ...pergunta];
}

/** O texto da caixa de busca: o da versão simples sem o núcleo completo. */
export const textoDaCaixa = (ctx: ContextoDoMenu): string =>
  ctx.modulos.telasCompletas ? 'Buscar páginas, criar ou pelo nome que você já usa...' : 'Buscar paginas, criar...';
