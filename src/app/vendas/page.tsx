'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Trash2, Eye, ShoppingCart } from 'lucide-react';
import { VendaCRM, Cliente } from '@/lib/crm-types';
import { loadEntities, deleteEntity } from '@/lib/crm-storage';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

// Badges de status — usa as 5 variantes do design system minimal.
const STATUS_BADGE: Record<string, string> = {
  ORCAMENTO:  'badge badge--warning',
  RESERVADO:  'badge badge--info',
  CONFIRMADO: 'badge badge--success',
  CANCELADO:  'badge badge--danger',
  CONCLUIDO:  'badge badge--neutral',
};

const STATUS_LABELS: Record<string, string> = {
  ORCAMENTO: 'Orçamento',
  RESERVADO: 'Reservado',
  CONFIRMADO: 'Confirmado',
  CANCELADO: 'Cancelado',
  CONCLUIDO: 'Concluído',
};

const ALL_STATUSES = ['ORCAMENTO', 'RESERVADO', 'CONFIRMADO', 'CANCELADO', 'CONCLUIDO'] as const;

export default function VendasPage() {
  const router = useRouter();
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [clientes, setClientes] = useState<Record<string, Cliente>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    Promise.all([
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<Cliente>('clientes'),
    ]).then(([vs, cs]) => {
      setVendas(vs);
      const map: Record<string, Cliente> = {};
      cs.forEach(c => { map[c.id] = c; });
      setClientes(map);
      setLoading(false);
    });
  }, []);

  const getClienteNome = (clienteId: string) => {
    const c = clientes[clienteId];
    if (!c) return '—';
    return c.tipo === 'PF' ? c.nome_completo : (c.nome_fantasia || c.razao_social);
  };

  const filtered = vendas.filter(v => {
    const nome = getClienteNome(v.cliente_id).toLowerCase();
    const q = search.toLowerCase();
    const matchLocalizador = v.produtos?.some(p => p.localizador?.toLowerCase().includes(q)) || false;
    const matchDescProduto = v.produtos?.some(p => p.descricao?.toLowerCase().includes(q)) || false;
    const matchObs = v.observacoes?.toLowerCase().includes(q) || false;
    const matchSearch = !search || v.numero.toLowerCase().includes(q) || nome.includes(q) || matchLocalizador || matchDescProduto || matchObs;
    const matchStatus = !statusFilter || v.status === statusFilter;
    const matchInicio = !dataInicio || v.data_venda >= dataInicio;
    const matchFim = !dataFim || v.data_venda <= dataFim;
    return matchSearch && matchStatus && matchInicio && matchFim;
  });

  const totalVendas = filtered.length;
  const valorTotal = filtered.reduce((sum, v) => sum + (v.valor_final || 0), 0);
  const ticketMedio = totalVendas > 0 ? valorTotal / totalVendas : 0;

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja excluir esta venda?')) return;
    await deleteEntity('vendas-crm', id);
    setVendas(prev => prev.filter(v => v.id !== id));
  };

  const columns: DataTableColumn<VendaCRM>[] = [
    {
      key: 'numero',
      header: 'Número',
      sortable: true,
      sortAccessor: v => v.numero,
      cell: v => <span className="font-mono text-[var(--t-accent)] font-medium">{v.numero}</span>,
    },
    {
      key: 'data',
      header: 'Data',
      sortable: true,
      sortAccessor: v => v.data_venda || '',
      cell: v => (
        <span className="text-[var(--t-text-secondary)]">
          {v.data_venda ? new Date(v.data_venda + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
        </span>
      ),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      sortable: true,
      sortAccessor: v => getClienteNome(v.cliente_id),
      cell: v => <span className="text-[var(--t-text)]">{getClienteNome(v.cliente_id)}</span>,
    },
    {
      key: 'valor',
      header: 'Valor Final',
      align: 'right',
      sortable: true,
      sortAccessor: v => v.valor_final || 0,
      cell: v => (
        <span className="font-semibold tabular-nums" style={{ color: 'var(--lg-text)' }}>
          {fmt(v.valor_final || 0)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: v => (
        <span className={STATUS_BADGE[v.status] || 'badge badge--neutral'}>
          {STATUS_LABELS[v.status] || v.status}
        </span>
      ),
    },
    {
      key: 'acoes',
      header: 'Ações',
      align: 'center',
      cell: v => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            className="table-action-btn"
            title="Ver detalhes"
            onClick={e => { e.stopPropagation(); router.push(`/vendas/${v.id}`); }}
          >
            <Eye className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="table-action-btn table-action-btn--danger"
            title="Excluir"
            onClick={e => { e.stopPropagation(); handleDelete(v.id); }}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  const filtrosAtivos = !!(search || statusFilter || dataInicio || dataFim);

  return (
    <PageShell
      header={
        <PageHeader
          title="Vendas"
          subtitle="Gerencie todas as vendas fechadas, com filtros por período, status e cliente"
          actions={
            <Link href="/vendas/nova">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Nova venda
              </Button>
            </Link>
          }
        />
      }
    >
      {/* KPIs minimal — sem ícones coloridos, valores neutros */}
      <div className="kpi-grid mb-6">
        <div className="kpi-card">
          <div className="kpi-card__label">Total de vendas</div>
          <div className="kpi-card__value">{totalVendas}</div>
          {filtrosAtivos && (
            <div className="kpi-card__meta">de {vendas.length} no total</div>
          )}
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Valor total</div>
          <div className="kpi-card__value tabular-nums">{fmt(valorTotal)}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__label">Ticket médio</div>
          <div className="kpi-card__value tabular-nums">{fmt(ticketMedio)}</div>
        </div>
      </div>

      {/* Filtros padronizados */}
      <div className="filters-bar">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--lg-text-4)' }}
          />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por número, cliente, localizador..."
            className="filter-input"
            style={{ paddingLeft: '36px', minWidth: '280px' }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="filter-select"
          style={{ minWidth: '160px' }}
        >
          <option value="">Todos os status</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>

        <input
          type="date"
          value={dataInicio}
          onChange={e => setDataInicio(e.target.value)}
          className="filter-input"
          style={{ width: '160px' }}
          title="Data inicial"
        />
        <input
          type="date"
          value={dataFim}
          onChange={e => setDataFim(e.target.value)}
          className="filter-input"
          style={{ width: '160px' }}
          title="Data final"
        />

        {filtrosAtivos && (
          <button
            type="button"
            onClick={() => { setSearch(''); setStatusFilter(''); setDataInicio(''); setDataFim(''); }}
            className="text-[13px]"
            style={{ color: 'var(--lg-text-3)' }}
          >
            Limpar
          </button>
        )}
      </div>

      {/* Tabela */}
      <div
        className="overflow-hidden"
        style={{
          background: 'var(--lg-surface-solid)',
          border: '1px solid var(--lg-border-base)',
          borderRadius: 'var(--lg-radius-lg)',
          boxShadow: 'var(--lg-shadow-card)',
        }}
      >
        <DataTable<VendaCRM>
          columns={columns}
          data={filtered}
          loading={loading}
          rowKey={v => v.id}
          onRowClick={v => router.push(`/vendas/${v.id}`)}
          zebra={false}
          emptyState={{
            icon: <ShoppingCart className="w-12 h-12" style={{ color: '#CBD5E1' }} strokeWidth={1.5} />,
            title: 'Nenhuma venda encontrada',
            description: filtrosAtivos
              ? 'Ajuste os filtros para ver mais resultados.'
              : 'Comece criando sua primeira venda.',
          }}
        />
      </div>
    </PageShell>
  );
}
