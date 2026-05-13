'use client';

import { useEffect, useState } from 'react';
import { ContaPagar, PlanoContas, NaturezaCusto, createContaPagar, StatusContaPagar, CartaoCorporativo } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Plus, X, Check, Trash2, TrendingDown, Clock, AlertCircle, CreditCard,
  Copy, Target, Calendar, Search,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { MetricExplainer } from '@/components/financeiro/MetricExplainer';
import { PageShell } from '@/components/PageShell';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_BADGE: Record<StatusContaPagar, string> = {
  PENDENTE: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
  PAGO: 'bg-[var(--t-green-bg)] text-[var(--t-green)]',
  VENCIDO: 'bg-[var(--t-red-bg)] text-[var(--t-red)]',
  CANCELADO: 'bg-[var(--t-surface)] text-[var(--t-text-muted)]',
  PARCIAL: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
};

const NATUREZA_LABEL: Record<string, string> = {
  FIXO: 'Fixo',
  VARIAVEL: 'Variável',
  COMPRA_UNICA: 'Compra Única',
};

const NATUREZA_COLORS: Record<string, string> = {
  FIXO: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
  VARIAVEL: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
  COMPRA_UNICA: 'bg-purple-500/10 text-purple-400',
};

type RecorrenciaPeriodo = 'MENSAL' | 'SEMANAL' | 'QUINZENAL';

type FormState = {
  origem: ContaPagar['origem'];
  fornecedor_nome: string;
  descricao: string;
  categoria_id: string;
  valor_original: number;
  moeda: ContaPagar['moeda'];
  cambio: number;
  data_vencimento: string;
  forma_pagamento: ContaPagar['forma_pagamento'];
  cartao_id: string;
  natureza_custo: NaturezaCusto | null;
  is_custo_comercial: boolean;
  observacoes: string;
  // Recorrência (só quando origem = DESPESA_FIXA)
  recorrencia_ativa: boolean;
  recorrencia_periodo: RecorrenciaPeriodo;
  recorrencia_repeticoes: number;
};

const EMPTY_FORM: FormState = {
  origem: 'OUTROS',
  fornecedor_nome: '',
  descricao: '',
  categoria_id: '',
  valor_original: 0,
  moeda: 'BRL',
  cambio: 1,
  data_vencimento: '',
  forma_pagamento: '',
  cartao_id: '',
  natureza_custo: null,
  is_custo_comercial: false,
  observacoes: '',
  recorrencia_ativa: false,
  recorrencia_periodo: 'MENSAL',
  recorrencia_repeticoes: 12,
};

// Calcula próximo vencimento dado base e tipo de recorrência.
function avancarData(baseISO: string, periodo: RecorrenciaPeriodo, count: number): string {
  const [y, m, d] = baseISO.split('-').map(Number);
  if (periodo === 'MENSAL') {
    const nova = new Date(y, m - 1 + count, d);
    return `${nova.getFullYear()}-${String(nova.getMonth() + 1).padStart(2, '0')}-${String(nova.getDate()).padStart(2, '0')}`;
  }
  const dias = periodo === 'SEMANAL' ? 7 : 14;
  const nova = new Date(y, m - 1, d + dias * count);
  return `${nova.getFullYear()}-${String(nova.getMonth() + 1).padStart(2, '0')}-${String(nova.getDate()).padStart(2, '0')}`;
}

function getMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m) - 1]}/${y}`;
}

function addMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1); // month is already 0-indexed +1
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ContasPagarPage() {
  const [items, setItems] = useState<ContaPagar[]>([]);
  const [planoContas, setPlanoContas] = useState<PlanoContas[]>([]);
  const [cartoes, setCartoes] = useState<CartaoCorporativo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [filterStatus, setFilterStatus] = useState<StatusContaPagar | 'TODOS'>('TODOS');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterCategoria, setFilterCategoria] = useState('TODAS');
  const [filterBusca, setFilterBusca] = useState('');
  const [filterPeriodo, setFilterPeriodo] = useState<'TODOS' | 'MES_ATUAL' | 'PROX_30D' | 'PROX_90D' | 'VENCIDOS' | 'MES_PASSADO' | 'CUSTOM'>('MES_ATUAL');
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copySourceMonth, setCopySourceMonth] = useState('');
  const [copyTargetMonth, setCopyTargetMonth] = useState('');
  const [copying, setCopying] = useState(false);

  async function load() {
    setLoading(true);
    const [data, contas, cards] = await Promise.all([
      loadEntities<ContaPagar>('contas-pagar'),
      loadEntities<PlanoContas>('plano-contas'),
      loadEntities<CartaoCorporativo>('cartoes-corp'),
    ]);
    setItems(data);
    setPlanoContas(contas);
    setCartoes(cards);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // When a categoria is selected, auto-fill natureza/comercial from plano de contas
  function onCategoriaChange(catId: string) {
    const cat = planoContas.find(c => c.id === catId);
    setForm(f => ({
      ...f,
      categoria_id: catId,
      natureza_custo: cat?.natureza_custo ?? f.natureza_custo,
      is_custo_comercial: cat?.is_custo_comercial ?? f.is_custo_comercial,
    }));
  }

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(item: ContaPagar) {
    setForm({
      origem: item.origem,
      fornecedor_nome: item.fornecedor_nome,
      descricao: item.descricao,
      categoria_id: item.categoria_id || '',
      valor_original: item.valor_original,
      moeda: item.moeda,
      cambio: item.cambio,
      data_vencimento: item.data_vencimento,
      forma_pagamento: item.forma_pagamento,
      cartao_id: item.cartao_id || '',
      natureza_custo: item.natureza_custo ?? null,
      is_custo_comercial: item.is_custo_comercial ?? false,
      observacoes: item.observacoes,
      recorrencia_ativa: false,
      recorrencia_periodo: 'MENSAL',
      recorrencia_repeticoes: 12,
    });
    setEditId(item.id);
    setShowForm(true);
  }

  async function handleSave() {
    // Validações com feedback específico em vez de return silencioso
    if (!form.fornecedor_nome.trim()) { toast.error('Informe o fornecedor'); return; }
    if (!form.descricao.trim()) { toast.error('Informe uma descrição'); return; }
    if (!form.data_vencimento) { toast.error('Informe a data de vencimento'); return; }
    if (form.valor_original <= 0) { toast.error('Valor deve ser maior que zero'); return; }
    const valorBrl = form.valor_original * form.cambio;
    const cartaoIdFinal = form.forma_pagamento === 'CARTAO_CORP' ? (form.cartao_id || null) : null;

    // Edição NÃO suporta recorrência (só aplica em criação).
    if (editId) {
      const existing = items.find(i => i.id === editId)!;
      const updated: ContaPagar = {
        ...existing,
        ...form,
        cartao_id: cartaoIdFinal,
        valor_final: form.valor_original,
        valor_brl: valorBrl,
      };
      await updateEntity('contas-pagar', updated);
      setShowForm(false);
      setEditId(null);
      toast.success('Despesa atualizada');
      load();
      return;
    }

    // Quantas contas criar — 1 para única, N para recorrente.
    const isDespesaFixa = form.origem === 'DESPESA_FIXA';
    const recorrer = isDespesaFixa && form.recorrencia_ativa && form.recorrencia_repeticoes > 1;
    const total = recorrer ? form.recorrencia_repeticoes : 1;
    const periodoLabel: Record<RecorrenciaPeriodo, string> = {
      MENSAL: 'mensal', SEMANAL: 'semanal', QUINZENAL: 'quinzenal',
    };

    for (let i = 0; i < total; i++) {
      const vencimento = i === 0 ? form.data_vencimento : avancarData(form.data_vencimento, form.recorrencia_periodo, i);
      const desc = recorrer
        ? `${form.descricao} (${i + 1}/${total} — ${periodoLabel[form.recorrencia_periodo]})`
        : form.descricao;
      const nova: ContaPagar = {
        ...createContaPagar(),
        ...form,
        cartao_id: cartaoIdFinal,
        descricao: desc,
        data_vencimento: vencimento,
        valor_final: form.valor_original,
        valor_brl: valorBrl,
        parcela_numero: i + 1,
        total_parcelas: total,
      };
      await saveEntity('contas-pagar', nova);
    }

    setShowForm(false);
    setEditId(null);
    if (total > 1) {
      const primeiroVenc = form.data_vencimento;
      const ultimoVenc = avancarData(form.data_vencimento, form.recorrencia_periodo, total - 1);
      toast.success(`${total} parcelas criadas`, `Vencimentos de ${primeiroVenc.split('-').reverse().join('/')} a ${ultimoVenc.split('-').reverse().join('/')}`);
    } else {
      toast.success('Despesa criada', `${form.fornecedor_nome} · ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(form.valor_original)}`);
    }
    load();
  }

  // Estado do modal de confirmação de pagamento
  const [pagarModal, setPagarModal] = useState<{
    item: ContaPagar;
    dataPagamento: string;
    valorPago: number;
    observacao: string;
  } | null>(null);

  function abrirModalPagar(item: ContaPagar) {
    setPagarModal({
      item,
      dataPagamento: new Date().toISOString().split('T')[0],
      valorPago: item.valor_final,
      observacao: '',
    });
  }

  async function confirmarPagamento() {
    if (!pagarModal) return;
    const { item, dataPagamento, valorPago, observacao } = pagarModal;
    const updated: ContaPagar = {
      ...item,
      status: 'PAGO',
      data_pagamento: dataPagamento,
      valor_pago: valorPago,
      observacoes: observacao ? `${item.observacoes ? item.observacoes + ' · ' : ''}${observacao}` : item.observacoes,
    };
    await updateEntity('contas-pagar', updated);
    setPagarModal(null);
    toast.success('Pagamento confirmado', `${item.fornecedor_nome} · ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorPago)}`);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Confirmar exclusão?')) return;
    const item = items.find(i => i.id === id);
    await deleteEntity('contas-pagar', id);
    toast.success('Despesa removida', item?.fornecedor_nome || '');
    load();
  }

  // Monthly copy workflow
  function openCopyModal() {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setCopySourceMonth(currentMonth);
    setCopyTargetMonth(addMonth(currentMonth));
    setShowCopyModal(true);
  }

  async function handleCopyMonth() {
    if (!copySourceMonth || !copyTargetMonth) return;
    setCopying(true);

    // Get items from the source month (only recurring: FIXO or VARIAVEL natureza, not COMPRA_UNICA)
    const sourceItems = items.filter(i => {
      const itemMonth = i.data_vencimento?.substring(0, 7);
      return itemMonth === copySourceMonth && i.natureza_custo !== 'COMPRA_UNICA';
    });

    for (const item of sourceItems) {
      // Calculate new due date: same day, new month
      const day = item.data_vencimento.substring(8, 10);
      const newDueDate = `${copyTargetMonth}-${day}`;

      const nova: ContaPagar = {
        ...createContaPagar(),
        origem: item.origem,
        fornecedor_id: item.fornecedor_id,
        fornecedor_nome: item.fornecedor_nome,
        descricao: item.descricao,
        categoria_id: item.categoria_id,
        centro_custo: item.centro_custo,
        valor_original: item.valor_original,
        valor_final: item.valor_final,
        moeda: item.moeda,
        cambio: item.cambio,
        valor_brl: item.valor_brl,
        data_vencimento: newDueDate,
        forma_pagamento: item.forma_pagamento,
        natureza_custo: item.natureza_custo,
        is_custo_comercial: item.is_custo_comercial,
        observacoes: `Copiado de ${getMonthLabel(copySourceMonth)}`,
      };
      await saveEntity('contas-pagar', nova);
    }

    setCopying(false);
    setShowCopyModal(false);
    load();
  }

  // Get unique months from data for the copy modal
  const availableMonths = [...new Set(items.map(i => i.data_vencimento?.substring(0, 7)).filter(Boolean))].sort();

  // Resolve período pré-definido em range concreto de datas (sobrescreve
  // filterDateFrom/To quando o usuário usa um atalho).
  const today = new Date().toISOString().split('T')[0];
  const periodoRange = (() => {
    const d = new Date();
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (filterPeriodo === 'MES_ATUAL') {
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { de: `${ym}-01`, ate: last.toISOString().split('T')[0] };
    }
    if (filterPeriodo === 'PROX_30D') {
      const fim = new Date(d); fim.setDate(fim.getDate() + 30);
      return { de: today, ate: fim.toISOString().split('T')[0] };
    }
    if (filterPeriodo === 'PROX_90D') {
      const fim = new Date(d); fim.setDate(fim.getDate() + 90);
      return { de: today, ate: fim.toISOString().split('T')[0] };
    }
    if (filterPeriodo === 'VENCIDOS') {
      return { de: '', ate: today, somentePendente: true };
    }
    if (filterPeriodo === 'MES_PASSADO') {
      const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const fim = new Date(d.getFullYear(), d.getMonth(), 0);
      return { de: ini.toISOString().split('T')[0], ate: fim.toISOString().split('T')[0] };
    }
    if (filterPeriodo === 'CUSTOM') return { de: filterDateFrom, ate: filterDateTo };
    return { de: '', ate: '' };
  })() as { de: string; ate: string; somentePendente?: boolean };

  // Aplica TODOS os filtros menos status — usado pelos KPIs (que somam
  // por status). A tabela aplica também o filterStatus por cima.
  const filteredBase = items.filter(i => {
    if (periodoRange.de && i.data_vencimento < periodoRange.de) return false;
    if (periodoRange.ate && i.data_vencimento > periodoRange.ate) return false;
    if (periodoRange.somentePendente && i.status !== 'PENDENTE' && i.status !== 'VENCIDO') return false;
    if (filterCategoria !== 'TODAS' && i.categoria_id !== filterCategoria) return false;
    if (filterBusca) {
      const q = filterBusca.toLowerCase();
      const match = (i.fornecedor_nome || '').toLowerCase().includes(q)
        || (i.descricao || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const filtered = filteredBase.filter(i =>
    filterStatus === 'TODOS' ? true : i.status === filterStatus
  );

  // KPIs RESPEITAM o filtro do período/categoria/busca — só não filtram
  // por status (cada KPI corresponde a um status).
  const totalPendente = filteredBase.filter(i => i.status === 'PENDENTE').reduce((s, i) => s + i.valor_final, 0);
  const totalPago = filteredBase.filter(i => i.status === 'PAGO').reduce((s, i) => s + (i.valor_pago ?? i.valor_final), 0);
  const totalVencido = filteredBase.filter(i => i.status === 'VENCIDO' || (i.status === 'PENDENTE' && i.data_vencimento < today)).reduce((s, i) => s + i.valor_final, 0);
  const totalComercial = filteredBase.filter(i => i.is_custo_comercial && (i.status === 'PAGO' || i.status === 'PENDENTE')).reduce((s, i) => s + i.valor_final, 0);

  const filtrosAtivos =
    (filterPeriodo !== 'MES_ATUAL' ? 1 : 0) +
    (filterStatus !== 'TODOS' ? 1 : 0) +
    (filterCategoria !== 'TODAS' ? 1 : 0) +
    (filterBusca ? 1 : 0);

  const limparFiltros = () => {
    setFilterStatus('TODOS');
    setFilterPeriodo('MES_ATUAL');
    setFilterCategoria('TODAS');
    setFilterBusca('');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const STATUSES: Array<StatusContaPagar | 'TODOS'> = ['TODOS', 'PENDENTE', 'PAGO', 'VENCIDO', 'CANCELADO', 'PARCIAL'];
  // Mostra todas as categorias de DESPESA (com ou sem subcódigo). Antes
  // filtrava só com '.' no código, então categorias customizadas como
  // "Aluguel" (sem código numérico) sumiam.
  const despesaContas = planoContas.filter(c => c.tipo === 'DESPESA');

  const columns: DataTableColumn<ContaPagar>[] = [
    {
      key: 'fornecedor',
      header: 'Fornecedor',
      sortable: true,
      sortAccessor: i => i.fornecedor_nome || '',
      cell: i => <span className="font-medium text-[var(--t-text)]">{i.fornecedor_nome || '—'}</span>,
    },
    {
      key: 'descricao',
      header: 'Descrição',
      cell: i => (
        <div className="flex items-center gap-2 text-[var(--t-text-secondary)] max-w-xs truncate">
          <span>{i.descricao}</span>
          {i.is_custo_comercial && (
            <span title="Custo Comercial (CAC)">
              <Target className="w-3 h-3 text-[var(--t-amber)] shrink-0" />
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'referente',
      header: 'Referente a',
      headerClassName: 'hidden lg:table-cell',
      className: 'hidden lg:table-cell',
      cell: i => {
        const isAuto = (i as ContaPagar).auto_gerado;
        if (isAuto && i.origem === 'VENDA') return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">Venda (auto)</Badge>;
        if (i.origem === 'VENDA') return <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">Venda</Badge>;
        if (i.origem === 'GRUPO') return <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-[10px]">Produto</Badge>;
        return <span className="text-[var(--t-text-muted)] text-xs">{i.origem || '—'}</span>;
      },
    },
    {
      key: 'valor',
      header: 'Valor',
      align: 'right',
      sortable: true,
      sortAccessor: i => i.valor_final,
      cell: i => <span className="font-mono text-[var(--t-text)]">{BRL(i.valor_final)}</span>,
    },
    {
      key: 'natureza',
      header: 'Natureza',
      cell: i =>
        i.natureza_custo ? (
          <Badge className={`${NATUREZA_COLORS[i.natureza_custo]} border-0 text-[10px]`}>
            {NATUREZA_LABEL[i.natureza_custo]}
          </Badge>
        ) : (
          <span className="text-[var(--t-text-muted)] text-xs">—</span>
        ),
    },
    {
      key: 'vencimento',
      header: 'Vencimento',
      sortable: true,
      sortAccessor: i => i.data_vencimento || '',
      cell: i => (
        <span className="text-[var(--t-text-secondary)]">
          {i.data_vencimento ? new Date(i.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: i => (
        <Badge className={`${STATUS_BADGE[i.status]} border-0 text-xs`}>{i.status}</Badge>
      ),
    },
    {
      key: 'acoes',
      header: 'Ações',
      align: 'right',
      cell: i => (
        <div className="flex items-center justify-end gap-2">
          {(i.status === 'PENDENTE' || i.status === 'VENCIDO' || i.status === 'PARCIAL') && (
            <Button
              size="sm"
              onClick={() => abrirModalPagar(i)}
              className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] h-7 px-3 text-xs"
            >
              <Check className="w-3 h-3 mr-1" /> Pagar
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => openEdit(i)}
            className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] h-7 px-3 text-xs"
          >
            Editar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleDelete(i.id)}
            className="border-[var(--t-red)]/30 text-[var(--t-red)] hover:bg-[var(--t-red-bg)] h-7 px-2"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageShell>
        <MinimalPageHead
          title="Contas a pagar"
          meta={<p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Gestão de obrigações financeiras da agência</p>}
          actions={
            <>
              <button
                onClick={openCopyModal}
                className="h-[34px] px-3 text-[12px] border transition-colors hover:bg-[var(--ink-surface-2)]"
                style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}
              >
                <Copy className="w-3.5 h-3.5 inline mr-2" /> Copiar mês
              </button>
              <button
                onClick={openNew}
                className="h-[34px] px-3 text-[12px] font-medium"
                style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
              >
                <Plus className="w-3.5 h-3.5 inline mr-2" /> Nova conta
              </button>
            </>
          }
        />

        {/* Summary Cards — clicáveis, refletem o período/filtros ativos */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { key: 'PENDENTE' as const, label: 'Pendente', icon: Clock, color: 'text-[var(--t-amber)]', value: totalPendente, hint: 'Ainda não pago', explainer: 'Despesas cadastradas mas ainda não quitadas. Clique no card para filtrar a lista.' },
            { key: 'PAGO' as const, label: 'Pago', icon: TrendingDown, color: 'text-[var(--t-green)]', value: totalPago, hint: 'Já quitado', explainer: 'Despesas já pagas neste período. Saídas reais do caixa.' },
            { key: 'VENCIDO' as const, label: 'Vencido', icon: AlertCircle, color: 'text-[var(--t-red)]', value: totalVencido, hint: 'Pendente após o vencimento', explainer: 'Despesas pendentes com vencimento anterior a hoje. Resolva o quanto antes para evitar juros/multa.' },
            { key: 'COMERCIAL' as const, label: 'Custo Comercial', icon: Target, color: 'text-[var(--t-blue)]', value: totalComercial, hint: 'Marketing, CAC', explainer: 'Despesas relacionadas a marketing, anúncios e aquisição de clientes (CAC). Categoria 2.6 do plano de contas.' },
          ].map(card => {
            const ativo = (card.key === 'PENDENTE' || card.key === 'PAGO' || card.key === 'VENCIDO') && filterStatus === card.key;
            const Icon = card.icon;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => {
                  if (card.key === 'COMERCIAL') return;
                  setFilterStatus(filterStatus === card.key ? 'TODOS' : card.key);
                }}
                disabled={card.key === 'COMERCIAL'}
                className={`text-left rounded-[var(--t-card-radius)] bg-[var(--t-surface)] p-4 border transition-all ${
                  ativo ? 'border-[var(--t-green)] shadow-[0_0_0_3px_var(--t-green-shadow)]' : 'border-[var(--t-border)] hover:border-[var(--t-text-muted)]'
                } ${card.key === 'COMERCIAL' ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-7 h-7 shrink-0 ${card.color}`} />
                  <div className="min-w-0">
                    <p className="text-[var(--t-text-muted)] text-[10px] uppercase tracking-wide flex items-center">
                      {card.label}
                      <span onClick={e => e.stopPropagation()}>
                        <MetricExplainer title={card.label} text={card.explainer} size={11} />
                      </span>
                    </p>
                    <p className={`text-xl font-bold ${card.color}`}>{BRL(card.value)}</p>
                    <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">{card.hint}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Copy Month Modal */}
        {showCopyModal && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-green)] text-base flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Copiar Despesas do Mês
              </CardTitle>
              <button onClick={() => setShowCopyModal(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <p className="text-[var(--t-text-secondary)] text-sm mb-4">
                Copia todas as despesas fixas e variáveis de um mês para o seguinte (ignora compras únicas). Os valores são mantidos e o status volta para PENDENTE.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Mês Origem</label>
                  <select
                    value={copySourceMonth}
                    onChange={e => {
                      setCopySourceMonth(e.target.value);
                      setCopyTargetMonth(addMonth(e.target.value));
                    }}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    {availableMonths.map(m => (
                      <option key={m} value={m}>{getMonthLabel(m)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Mês Destino</label>
                  <Input
                    type="month"
                    value={copyTargetMonth}
                    onChange={e => setCopyTargetMonth(e.target.value)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
              </div>
              {copySourceMonth && (
                <p className="text-xs text-[var(--t-text-muted)] mt-2">
                  {items.filter(i => i.data_vencimento?.substring(0, 7) === copySourceMonth && i.natureza_custo !== 'COMPRA_UNICA').length} despesas serão copiadas
                </p>
              )}
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleCopyMonth}
                  disabled={copying || !copySourceMonth || !copyTargetMonth}
                  className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold"
                >
                  <Copy className="w-4 h-4 mr-1" /> {copying ? 'Copiando...' : 'Copiar Despesas'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowCopyModal(false)}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Inline Form */}
        {showForm && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-green)] text-base">
                {editId ? 'Editar Conta' : 'Nova Conta a Pagar'}
              </CardTitle>
              <button onClick={() => setShowForm(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Origem</label>
                  <select
                    value={form.origem}
                    onChange={e => setForm(f => ({ ...f, origem: e.target.value as ContaPagar['origem'] }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="VENDA">Venda</option>
                    <option value="GRUPO">Grupo</option>
                    <option value="DESPESA_FIXA">Despesa Fixa</option>
                    <option value="OUTROS">Outros</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Fornecedor *</label>
                  <Input
                    value={form.fornecedor_nome}
                    onChange={e => setForm(f => ({ ...f, fornecedor_nome: e.target.value }))}
                    placeholder="Nome do fornecedor"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Descrição *</label>
                  <Input
                    value={form.descricao}
                    onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                    placeholder="Descrição"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Categoria (Plano de Contas)</label>
                  <select
                    value={form.categoria_id}
                    onChange={e => onCategoriaChange(e.target.value)}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="">Selecione</option>
                    {despesaContas.sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })).map(c => (
                      <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Valor *</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.valor_original}
                    onChange={e => setForm(f => ({ ...f, valor_original: parseFloat(e.target.value) || 0 }))}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Moeda</label>
                  <select
                    value={form.moeda}
                    onChange={e => setForm(f => ({ ...f, moeda: e.target.value as ContaPagar['moeda'] }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="BRL">BRL</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Câmbio</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.0001"
                    value={form.cambio}
                    onChange={e => setForm(f => ({ ...f, cambio: parseFloat(e.target.value) || 1 }))}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Vencimento *</label>
                  <Input
                    type="date"
                    value={form.data_vencimento}
                    onChange={e => setForm(f => ({ ...f, data_vencimento: e.target.value }))}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Forma de Pagamento</label>
                  <select
                    value={form.forma_pagamento}
                    onChange={e => setForm(f => ({ ...f, forma_pagamento: e.target.value as ContaPagar['forma_pagamento'] }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="">Selecione</option>
                    <option value="PIX">PIX</option>
                    <option value="TED">TED</option>
                    <option value="CARTAO_CORP">Cartão Corporativo</option>
                    <option value="BOLETO">Boleto</option>
                    <option value="DEPOSITO">Depósito</option>
                  </select>
                </div>
                {form.forma_pagamento === 'CARTAO_CORP' && (
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Cartão usado</label>
                    {cartoes.filter(c => c.ativo).length === 0 ? (
                      <div className="text-xs text-[var(--t-text-muted)] py-2">
                        Nenhum cartão ativo. <a href="/financeiro-ag/cartoes" className="text-[var(--t-accent)] underline">Cadastrar</a>
                      </div>
                    ) : (
                      <select
                        value={form.cartao_id}
                        onChange={e => setForm(f => ({ ...f, cartao_id: e.target.value }))}
                        className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                      >
                        <option value="">Selecione o cartão</option>
                        {cartoes.filter(c => c.ativo).map(c => (
                          <option key={c.id} value={c.id}>
                            {c.apelido}{c.ultimos_digitos ? ` •••• ${c.ultimos_digitos}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {/* Classification fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 p-3 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)]">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Natureza do Custo</label>
                  <select
                    value={form.natureza_custo || ''}
                    onChange={e => setForm(f => ({ ...f, natureza_custo: (e.target.value || null) as NaturezaCusto | null }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="">Não classificado</option>
                    <option value="FIXO">Fixo</option>
                    <option value="VARIAVEL">Variável</option>
                    <option value="COMPRA_UNICA">Compra Única</option>
                  </select>
                </div>
                <div className="flex items-center gap-3 pt-4">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_custo_comercial}
                      onChange={e => setForm(f => ({ ...f, is_custo_comercial: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[var(--t-border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--t-green)]"></div>
                  </label>
                  <div>
                    <span className="text-sm text-[var(--t-text)]">Custo Comercial</span>
                    <p className="text-xs text-[var(--t-text-muted)]">Incluir no cálculo do CAC</p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Observações</label>
                <Input
                  value={form.observacoes}
                  onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                  placeholder="Observações"
                  className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                />
              </div>

              {/* Recorrência — aparece apenas se Origem = DESPESA_FIXA e for criação (não edição) */}
              {form.origem === 'DESPESA_FIXA' && !editId && (
                <div className="mt-4 p-4 rounded-lg border border-[var(--t-blue)]/30 bg-[var(--t-blue-bg)]/20">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.recorrencia_ativa}
                      onChange={e => setForm(f => ({ ...f, recorrencia_ativa: e.target.checked }))}
                      className="accent-[var(--t-blue)]"
                    />
                    <span className="text-sm font-medium text-[var(--t-text)]">Repetir esta despesa automaticamente</span>
                  </label>
                  {form.recorrencia_ativa && (
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Periodicidade</label>
                        <select
                          value={form.recorrencia_periodo}
                          onChange={e => setForm(f => ({ ...f, recorrencia_periodo: e.target.value as RecorrenciaPeriodo }))}
                          className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                        >
                          <option value="MENSAL">Mensal (todo mês no mesmo dia)</option>
                          <option value="QUINZENAL">Quinzenal (a cada 14 dias)</option>
                          <option value="SEMANAL">Semanal (a cada 7 dias)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Quantidade de parcelas</label>
                        <Input
                          type="number"
                          min={1}
                          max={120}
                          value={form.recorrencia_repeticoes}
                          onChange={e => setForm(f => ({ ...f, recorrencia_repeticoes: Math.max(1, parseInt(e.target.value) || 1) }))}
                          className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        />
                      </div>
                      <p className="col-span-2 text-[11px] text-[var(--t-text-secondary)] mt-1">
                        Vão ser criadas <strong>{form.recorrencia_repeticoes} contas a pagar</strong> a partir de {form.data_vencimento || '(sem data)'},
                        com vencimento avançando {form.recorrencia_periodo === 'MENSAL' ? 'mês a mês' : form.recorrencia_periodo === 'QUINZENAL' ? 'a cada 15 dias' : 'a cada 7 dias'}.
                        Cada parcela pode ser editada/paga individualmente.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {form.moeda !== 'BRL' && (
                <p className="text-sm text-[var(--t-text-secondary)] mt-2">
                  Valor BRL: <span className="text-[var(--t-text)] font-semibold">{BRL(form.valor_original * form.cambio)}</span>
                </p>
              )}
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleSave}
                  className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold"
                >
                  <Check className="w-4 h-4 mr-1" /> {editId ? 'Salvar' : 'Criar'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters — busca + chips de período + categoria + clear */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardContent className="p-4 space-y-3">
            {/* Linha 1: busca + categoria + limpar */}
            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-[var(--t-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={filterBusca}
                  onChange={e => setFilterBusca(e.target.value)}
                  placeholder="Buscar por fornecedor ou descrição..."
                  className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] pl-9"
                />
              </div>
              <select
                value={filterCategoria}
                onChange={e => setFilterCategoria(e.target.value)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)] min-w-[180px]"
              >
                <option value="TODAS">Todas as categorias</option>
                {despesaContas.sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true })).map(c => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>
                ))}
              </select>
              {filtrosAtivos > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={limparFiltros}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                >
                  <X className="w-3 h-3 mr-1" /> Limpar filtros ({filtrosAtivos})
                </Button>
              )}
            </div>

            {/* Linha 2: chips de período rápido */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] mr-1">Período:</span>
              {[
                { key: 'MES_ATUAL', label: 'Este mês' },
                { key: 'PROX_30D', label: 'Próximos 30d' },
                { key: 'PROX_90D', label: 'Próximos 90d' },
                { key: 'VENCIDOS', label: 'Vencidos' },
                { key: 'MES_PASSADO', label: 'Mês passado' },
                { key: 'TODOS', label: 'Tudo' },
                { key: 'CUSTOM', label: 'Personalizado' },
              ].map(p => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setFilterPeriodo(p.key as typeof filterPeriodo)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    filterPeriodo === p.key
                      ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14] font-medium'
                      : 'bg-[var(--t-bg)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Linha 3: date pickers (só quando CUSTOM) */}
            {filterPeriodo === 'CUSTOM' && (
              <div className="flex gap-3 items-end">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">De</label>
                  <Input
                    type="date"
                    value={filterDateFrom}
                    onChange={e => setFilterDateFrom(e.target.value)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Até</label>
                  <Input
                    type="date"
                    value={filterDateTo}
                    onChange={e => setFilterDateTo(e.target.value)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40"
                  />
                </div>
              </div>
            )}

            {/* Linha 4: chips de status */}
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] mr-1">Status:</span>
              {STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilterStatus(s)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                    filterStatus === s
                      ? 'bg-[var(--t-green)] text-white dark:text-[#0a0a14] font-medium'
                      : 'bg-[var(--t-bg)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] border border-[var(--t-border)]'
                  }`}
                >
                  {s === 'TODOS' ? 'Todos' : s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-[var(--t-green)]" />
              Lançamentos ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable<ContaPagar>
              columns={columns}
              data={filtered}
              loading={loading}
              rowKey={i => i.id}
              zebra
              emptyState={{
                icon: <CreditCard className="w-10 h-10 opacity-30" />,
                title: 'Nenhum lançamento encontrado',
                description: 'Ajuste os filtros ou cadastre uma nova conta a pagar.',
              }}
            />
          </CardContent>
        </Card>

      {/* Modal de confirmação de pagamento */}
      {pagarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setPagarModal(null)}>
          <div className="bg-[var(--t-surface)] rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--t-border)] flex items-center justify-between">
              <h3 className="text-base font-semibold text-[var(--t-text)]">Confirmar pagamento</h3>
              <button onClick={() => setPagarModal(null)} className="text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 rounded-lg bg-[var(--t-bg)] border border-[var(--t-border)]">
                <p className="text-[10px] uppercase text-[var(--t-text-muted)] tracking-wide">Despesa</p>
                <p className="text-sm font-medium text-[var(--t-text)]">{pagarModal.item.fornecedor_nome}</p>
                <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{pagarModal.item.descricao}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data do pagamento</label>
                  <Input
                    type="date"
                    value={pagarModal.dataPagamento}
                    onChange={e => setPagarModal({ ...pagarModal, dataPagamento: e.target.value })}
                    className="bg-[var(--t-input-bg)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Valor pago</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={pagarModal.valorPago}
                    onChange={e => setPagarModal({ ...pagarModal, valorPago: parseFloat(e.target.value) || 0 })}
                    className="bg-[var(--t-input-bg)]"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Observação (opcional)</label>
                <Input
                  value={pagarModal.observacao}
                  onChange={e => setPagarModal({ ...pagarModal, observacao: e.target.value })}
                  placeholder="Ex: pago via PIX"
                  className="bg-[var(--t-input-bg)]"
                />
              </div>
              <p className="text-[11px] text-[var(--t-text-muted)]">
                O saldo da Caixa Geral será atualizado automaticamente após confirmar.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--t-border)] flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPagarModal(null)}>Cancelar</Button>
              <Button onClick={confirmarPagamento} className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14]">
                <Check className="w-4 h-4 mr-1" /> Confirmar pagamento
              </Button>
            </div>
          </div>
        </div>
      )}
      <MinimalFooter pageId="contas a pagar" />
    </PageShell>
  );
}
