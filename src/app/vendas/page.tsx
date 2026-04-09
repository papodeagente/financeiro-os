'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Trash2, Eye, TrendingUp, ShoppingCart, DollarSign } from 'lucide-react';
import { VendaCRM, Cliente } from '@/lib/crm-types';
import { loadEntities, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_COLORS: Record<string, string> = {
  ORCAMENTO: 'bg-[var(--t-status-warning-bg)] text-[var(--t-status-warning)] border-[var(--t-status-warning)]/30',
  RESERVADO: 'bg-[var(--t-status-info-bg)] text-[var(--t-status-info)] border-[var(--t-status-info)]/30',
  CONFIRMADO: 'bg-[var(--t-status-success-bg)] text-[var(--t-status-success)] border-[var(--t-status-success)]/30',
  CANCELADO: 'bg-[var(--t-status-danger-bg)] text-[var(--t-status-danger)] border-[var(--t-status-danger)]/30',
  CONCLUIDO: 'bg-[var(--t-status-neutral-bg)] text-[var(--t-status-neutral)] border-[var(--t-status-neutral)]/30',
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
        <span className="text-green-400 font-medium">{fmt(v.valor_final || 0)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      cell: v => (
        <Badge className={`border text-xs ${STATUS_COLORS[v.status] || ''}`}>
          {STATUS_LABELS[v.status] || v.status}
        </Badge>
      ),
    },
    {
      key: 'acoes',
      header: 'Ações',
      align: 'center',
      cell: v => (
        <div className="flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-[var(--t-text-secondary)] hover:text-[var(--t-accent)] hover:bg-[var(--t-accent)]/10"
            onClick={() => router.push(`/vendas/${v.id}`)}
          >
            <Eye className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-[var(--t-text-secondary)] hover:text-red-400 hover:bg-red-500/10"
            onClick={() => handleDelete(v.id)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageShell
      header={
        <PageHeader
          title="Vendas"
          subtitle="Gestão de vendas e reservas"
          actions={
            <Link href="/vendas/nova">
              <Button className="bg-[var(--t-green)] hover:opacity-90 text-white dark:text-[#0a0a14] font-semibold">
                <Plus className="w-4 h-4 mr-2" />
                Nova Venda
              </Button>
            </Link>
          }
        />
      }
    >

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-[var(--t-accent)]/10 rounded-lg">
              <ShoppingCart className="w-5 h-5 text-[var(--t-accent)]" />
            </div>
            <div>
              <p className="text-[var(--t-text-secondary)] text-sm">Total de Vendas</p>
              <p className="text-xl font-bold text-[var(--t-text)]">{totalVendas}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-green-500/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-[var(--t-text-secondary)] text-sm">Valor Total</p>
              <p className="text-xl font-bold text-[var(--t-text)]">{fmt(valorTotal)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <TrendingUp className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-[var(--t-text-secondary)] text-sm">Ticket Médio</p>
              <p className="text-xl font-bold text-[var(--t-text)]">{fmt(ticketMedio)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)] mb-6">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-secondary)]" />
              <Input
                placeholder="Buscar por número, cliente ou localizador..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-secondary)]"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] rounded-md px-3 py-2 text-sm min-w-[160px]"
            >
              <option value="">Todos os status</option>
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            <Input
              type="date"
              value={dataInicio}
              onChange={e => setDataInicio(e.target.value)}
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] w-[160px]"
              title="Data inicial"
            />
            <Input
              type="date"
              value={dataFim}
              onChange={e => setDataFim(e.target.value)}
              className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] w-[160px]"
              title="Data final"
            />
            {(search || statusFilter || dataInicio || dataFim) && (
              <Button
                variant="ghost"
                className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
                onClick={() => { setSearch(''); setStatusFilter(''); setDataInicio(''); setDataFim(''); }}
              >
                Limpar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
        <CardContent className="p-0">
          <DataTable<VendaCRM>
            columns={columns}
            data={filtered}
            loading={loading}
            rowKey={v => v.id}
            onRowClick={v => router.push(`/vendas/${v.id}`)}
            zebra
            emptyState={{
              icon: <ShoppingCart className="w-10 h-10 opacity-30" />,
              title: 'Nenhuma venda encontrada',
              description: search || statusFilter || dataInicio || dataFim
                ? 'Ajuste os filtros para ver mais resultados.'
                : 'Comece criando sua primeira venda.',
            }}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
