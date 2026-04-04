'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, FileText, ArrowRight } from 'lucide-react';
import { VendaCRM, Cliente } from '@/lib/crm-types';
import { loadEntities, updateEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

export default function OrcamentosPage() {
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [clientes, setClientes] = useState<Record<string, Cliente>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [converting, setConverting] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<Cliente>('clientes'),
    ]).then(([vs, cs]) => {
      setVendas(vs.filter(v => v.status === 'ORCAMENTO'));
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
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      v.numero.toLowerCase().includes(q) ||
      getClienteNome(v.cliente_id).toLowerCase().includes(q)
    );
  });

  const totalOrcamentos = filtered.length;
  const valorTotal = filtered.reduce((sum, v) => sum + (v.valor_final || 0), 0);

  const handleConverter = async (venda: VendaCRM) => {
    setConverting(venda.id);
    try {
      const updated: VendaCRM = { ...venda, status: 'RESERVADO' };
      await updateEntity('vendas-crm', updated);
      setVendas(prev => prev.filter(v => v.id !== venda.id));
    } catch {
      alert('Erro ao converter orçamento.');
    } finally {
      setConverting(null);
    }
  };

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-text)]">Orçamentos</h1>
          <p className="text-[var(--t-text-secondary)] text-sm mt-1">Vendas com status de orçamento pendente</p>
        </div>
        <Link href="/vendas/nova">
          <Button className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold">
            <FileText className="w-4 h-4 mr-2" />
            Novo Orçamento
          </Button>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-yellow-500/10 rounded-lg">
              <FileText className="w-5 h-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-[var(--t-text-secondary)] text-sm">Orçamentos Abertos</p>
              <p className="text-xl font-bold text-[var(--t-text)]">{totalOrcamentos}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 bg-[var(--t-accent)]/10 rounded-lg">
              <ArrowRight className="w-5 h-5 text-[var(--t-accent)]" />
            </div>
            <div>
              <p className="text-[var(--t-text-secondary)] text-sm">Valor em Aberto</p>
              <p className="text-xl font-bold text-[var(--t-text)]">{fmt(valorTotal)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)] mb-6">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-secondary)]" />
            <Input
              placeholder="Buscar por número ou cliente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-secondary)]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
        <CardHeader className="px-4 py-3 border-b border-[var(--t-border)]">
          <CardTitle className="text-sm font-medium text-[var(--t-text-secondary)]">
            {filtered.length} orçamento{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[var(--t-text-secondary)]">
              Carregando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--t-text-secondary)]">
              <FileText className="w-10 h-10 mb-3 opacity-30" />
              <p className="font-medium">Nenhum orçamento encontrado</p>
              <p className="text-sm mt-1 text-[var(--t-text-secondary)]">
                {search ? 'Tente um termo diferente.' : 'Crie um novo orçamento para começar.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)]">
                    <th className="text-left px-4 py-3 text-[var(--t-text-secondary)] font-medium">Número</th>
                    <th className="text-left px-4 py-3 text-[var(--t-text-secondary)] font-medium">Data</th>
                    <th className="text-left px-4 py-3 text-[var(--t-text-secondary)] font-medium">Cliente</th>
                    <th className="text-center px-4 py-3 text-[var(--t-text-secondary)] font-medium">Produtos</th>
                    <th className="text-right px-4 py-3 text-[var(--t-text-secondary)] font-medium">Valor Final</th>
                    <th className="text-center px-4 py-3 text-[var(--t-text-secondary)] font-medium">Status</th>
                    <th className="text-center px-4 py-3 text-[var(--t-text-secondary)] font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((venda, idx) => (
                    <tr
                      key={venda.id}
                      className={`border-b border-[var(--t-border)]/50 hover:bg-[var(--t-surface-hover)]/30 transition-colors ${
                        idx % 2 === 0 ? '' : 'bg-[var(--t-bg)]/30'
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-[var(--t-accent)] font-medium">
                        {venda.numero}
                      </td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)]">
                        {venda.data_venda
                          ? new Date(venda.data_venda + 'T00:00:00').toLocaleDateString('pt-BR')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-[var(--t-text)]">
                        {getClienteNome(venda.cliente_id)}
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--t-text-secondary)]">
                        {venda.produtos.length}
                      </td>
                      <td className="px-4 py-3 text-right text-green-400 font-medium">
                        {fmt(venda.valor_final || 0)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-xs">
                          Orçamento
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleConverter(venda)}
                            disabled={converting === venda.id}
                            className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium"
                          >
                            {converting === venda.id ? (
                              'Convertendo...'
                            ) : (
                              <>
                                <ArrowRight className="w-3 h-3 mr-1" />
                                Converter em Venda
                              </>
                            )}
                          </Button>
                          <Link href={`/vendas/${venda.id}/editar`}>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-[var(--t-text-secondary)] hover:text-[var(--t-accent)] hover:bg-[var(--t-accent)]/10"
                            >
                              Editar
                            </Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer nav */}
      <div className="mt-4 flex justify-center">
        <Link href="/vendas">
          <Button variant="ghost" className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)] text-sm">
            Ver todas as vendas
          </Button>
        </Link>
      </div>
    </div>
  );
}
