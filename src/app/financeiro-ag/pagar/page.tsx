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
  Copy, Target, Calendar,
} from 'lucide-react';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
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
};

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
    });
    setEditId(item.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.fornecedor_nome || !form.descricao || !form.data_vencimento || form.valor_original <= 0) return;
    const valorBrl = form.valor_original * form.cambio;
    const cartaoIdFinal = form.forma_pagamento === 'CARTAO_CORP' ? (form.cartao_id || null) : null;
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
    } else {
      const nova: ContaPagar = {
        ...createContaPagar(),
        ...form,
        cartao_id: cartaoIdFinal,
        valor_final: form.valor_original,
        valor_brl: valorBrl,
      };
      await saveEntity('contas-pagar', nova);
    }
    setShowForm(false);
    setEditId(null);
    load();
  }

  async function handlePagar(item: ContaPagar) {
    const updated: ContaPagar = {
      ...item,
      status: 'PAGO',
      data_pagamento: new Date().toISOString().split('T')[0],
      valor_pago: item.valor_final,
    };
    await updateEntity('contas-pagar', updated);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Confirmar exclusão?')) return;
    await deleteEntity('contas-pagar', id);
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

  const filtered = items.filter(i => {
    if (filterStatus !== 'TODOS' && i.status !== filterStatus) return false;
    if (filterDateFrom && i.data_vencimento < filterDateFrom) return false;
    if (filterDateTo && i.data_vencimento > filterDateTo) return false;
    return true;
  });

  const totalPendente = items.filter(i => i.status === 'PENDENTE').reduce((s, i) => s + i.valor_final, 0);
  const totalPago = items.filter(i => i.status === 'PAGO').reduce((s, i) => s + (i.valor_pago ?? i.valor_final), 0);
  const totalVencido = items.filter(i => i.status === 'VENCIDO').reduce((s, i) => s + i.valor_final, 0);
  const totalComercial = items.filter(i => i.is_custo_comercial && (i.status === 'PAGO' || i.status === 'PENDENTE')).reduce((s, i) => s + i.valor_final, 0);

  const STATUSES: Array<StatusContaPagar | 'TODOS'> = ['TODOS', 'PENDENTE', 'PAGO', 'VENCIDO', 'CANCELADO', 'PARCIAL'];
  const despesaContas = planoContas.filter(c => c.tipo === 'DESPESA' && c.codigo.includes('.'));

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
              onClick={() => handlePagar(i)}
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
    <PageShell
      header={
        <PageHeader
          title="Contas a Pagar"
          subtitle="Gestão de obrigações financeiras da agência"
          actions={
            <>
              <Button
                onClick={openCopyModal}
                variant="outline"
                className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
              >
                <Copy className="w-4 h-4 mr-2" /> Copiar Mês
              </Button>
              <Button
                onClick={openNew}
                className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold"
              >
                <Plus className="w-4 h-4 mr-2" /> Nova Conta
              </Button>
            </>
          }
        />
      }
    >

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <Clock className="w-8 h-8 text-[var(--t-amber)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Pendente</p>
                <p className="text-xl font-bold text-[var(--t-amber)]">{BRL(totalPendente)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <TrendingDown className="w-8 h-8 text-[var(--t-green)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Pago</p>
                <p className="text-xl font-bold text-[var(--t-green)]">{BRL(totalPago)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <AlertCircle className="w-8 h-8 text-[var(--t-red)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Vencido</p>
                <p className="text-xl font-bold text-[var(--t-red)]">{BRL(totalVencido)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <Target className="w-8 h-8 text-[var(--t-blue)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Custo Comercial</p>
                <p className="text-xl font-bold text-[var(--t-blue)]">{BRL(totalComercial)}</p>
              </div>
            </CardContent>
          </Card>
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

        {/* Filters */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardContent className="p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Status</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as StatusContaPagar | 'TODOS')}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
              >
                {STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Vencimento De</label>
              <Input
                type="date"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
                className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Vencimento Até</label>
              <Input
                type="date"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
                className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] w-40"
              />
            </div>
            {(filterStatus !== 'TODOS' || filterDateFrom || filterDateTo) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setFilterStatus('TODOS'); setFilterDateFrom(''); setFilterDateTo(''); }}
                className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
              >
                <X className="w-3 h-3 mr-1" /> Limpar
              </Button>
            )}
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
    </PageShell>
  );
}
