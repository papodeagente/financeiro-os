'use client';

import { useEffect, useState, useMemo } from 'react';
import { ComissaoVenda, VendaCRM, Membro, PlanoComissao, StatusComissao } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Calculator, Check, DollarSign, RefreshCw, Clock, CheckCircle2,
  Banknote, Trash2,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_BADGE: Record<StatusComissao, string> = {
  CALCULADA: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
  APROVADA: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
  PAGA: 'bg-[var(--t-green-bg)] text-[var(--t-green)]',
  CANCELADA: 'bg-[var(--t-surface)] text-[var(--t-text-muted)]',
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export default function ComissoesPage() {
  const [comissoes, setComissoes] = useState<ComissaoVenda[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [planos, setPlanos] = useState<PlanoComissao[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [filterStatus, setFilterStatus] = useState<StatusComissao | 'TODOS'>('TODOS');
  const [filterVendedor, setFilterVendedor] = useState('');
  const [filterMonth, setFilterMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  async function load() {
    setLoading(true);
    const [c, v, m, p] = await Promise.all([
      loadEntities<ComissaoVenda>('comissoes'),
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<Membro>('membros'),
      loadEntities<PlanoComissao>('planos-comissao'),
    ]);
    setComissoes(c);
    setVendas(v);
    setMembros(m);
    setPlanos(p);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Calculate commissions for all uncalculated sales
  async function handleCalcular() {
    setCalculating(true);
    const existingVendaIds = new Set(comissoes.map(c => c.venda_id));

    // Sales that are confirmed/completed and don't have commissions yet
    const vendasPendentes = vendas.filter(v =>
      !existingVendaIds.has(v.id) &&
      (v.status === 'CONFIRMADO' || v.status === 'CONCLUIDO') &&
      v.vendedor_id
    );

    for (const venda of vendasPendentes) {
      const vendedor = membros.find(m => m.id === venda.vendedor_id);
      if (!vendedor) continue;

      // Find the vendedor's commission plan
      const plano = planos.find(p => p.id === vendedor.plano_comissao_id && p.ativo)
        || planos.find(p => p.ativo); // fallback to first active plan
      if (!plano) continue;

      // Calculate base value
      let valorBase = 0;
      switch (plano.base_calculo) {
        case 'MARKUP':
          valorBase = venda.valor_final - venda.valor_total_custo;
          break;
        case 'VALOR_VENDA':
          valorBase = venda.valor_final;
          break;
        case 'COMISSAO_FORNECEDOR':
          valorBase = venda.produtos?.reduce((s, p) => s + p.comissao_fornecedor, 0) || 0;
          break;
        case 'LUCRO':
          valorBase = venda.valor_final - venda.valor_total_custo;
          break;
      }

      // Determine percentage
      let percentual = plano.percentual_padrao;

      // Check product-specific rules (average across products)
      if (plano.regras_produto.length > 0 && venda.produtos?.length > 0) {
        const prodPercentuais = venda.produtos.map(prod => {
          const regra = plano.regras_produto.find(r => r.tipo_produto === prod.tipo);
          return regra ? regra.percentual : plano.percentual_padrao;
        });
        percentual = prodPercentuais.reduce((s, p) => s + p, 0) / prodPercentuais.length;
      }

      // Check progressive tiers
      if (plano.faixas.length > 0) {
        const faixa = plano.faixas.find(f => valorBase >= f.de && (f.ate === 0 || valorBase <= f.ate));
        if (faixa) percentual = faixa.percentual;
      }

      const valorComissao = valorBase * (percentual / 100);

      const comissao: ComissaoVenda = {
        id: generateId(),
        venda_id: venda.id,
        venda_numero: venda.numero,
        vendedor_id: venda.vendedor_id,
        vendedor_nome: vendedor.nome,
        plano_comissao_id: plano.id,
        plano_nome: plano.nome,
        data_venda: venda.data_venda,
        valor_base: valorBase,
        percentual_aplicado: percentual,
        valor_comissao: valorComissao,
        status: 'CALCULADA',
        data_aprovacao: null,
        data_pagamento: null,
        observacoes: '',
      };

      await saveEntity('comissoes', comissao);
    }

    setCalculating(false);
    load();
  }

  async function handleAprovar(c: ComissaoVenda) {
    await updateEntity('comissoes', { ...c, status: 'APROVADA', data_aprovacao: new Date().toISOString().split('T')[0] });
    load();
  }

  async function handlePagar(c: ComissaoVenda) {
    await updateEntity('comissoes', { ...c, status: 'PAGA', data_pagamento: new Date().toISOString().split('T')[0] });
    load();
  }

  async function handleCancelar(c: ComissaoVenda) {
    await updateEntity('comissoes', { ...c, status: 'CANCELADA' });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir comissão?')) return;
    await deleteEntity('comissoes', id);
    load();
  }

  const filtered = comissoes.filter(c => {
    if (filterStatus !== 'TODOS' && c.status !== filterStatus) return false;
    if (filterVendedor && c.vendedor_id !== filterVendedor) return false;
    if (filterMonth && c.data_venda?.substring(0, 7) !== filterMonth) return false;
    return true;
  }).sort((a, b) => b.data_venda.localeCompare(a.data_venda));

  const stats = useMemo(() => {
    const calculadas = comissoes.filter(c => c.status === 'CALCULADA').reduce((s, c) => s + c.valor_comissao, 0);
    const aprovadas = comissoes.filter(c => c.status === 'APROVADA').reduce((s, c) => s + c.valor_comissao, 0);
    const pagas = comissoes.filter(c => c.status === 'PAGA').reduce((s, c) => s + c.valor_comissao, 0);
    return { calculadas, aprovadas, pagas };
  }, [comissoes]);

  const STATUSES: Array<StatusComissao | 'TODOS'> = ['TODOS', 'CALCULADA', 'APROVADA', 'PAGA', 'CANCELADA'];

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Comissões</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Cálculo e gestão de comissões por venda</p>
          </div>
          <Button onClick={handleCalcular} disabled={calculating}
            className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
            <RefreshCw className={`w-4 h-4 mr-2 ${calculating ? 'animate-spin' : ''}`} />
            {calculating ? 'Calculando...' : 'Calcular Comissões'}
          </Button>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <Clock className="w-8 h-8 text-[var(--t-amber)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">A Aprovar</p>
                <p className="text-xl font-bold text-[var(--t-amber)]">{BRL(stats.calculadas)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <CheckCircle2 className="w-8 h-8 text-[var(--t-blue)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Aprovadas</p>
                <p className="text-xl font-bold text-[var(--t-blue)]">{BRL(stats.aprovadas)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <Banknote className="w-8 h-8 text-[var(--t-green)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Pagas</p>
                <p className="text-xl font-bold text-[var(--t-green)]">{BRL(stats.pagas)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardContent className="p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as StatusComissao | 'TODOS')}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Vendedor</label>
              <select value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                <option value="">Todos</option>
                {membros.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Mês</label>
              <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]" />
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[var(--t-green)]" />
              Comissões ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="text-[var(--t-text-secondary)] text-sm p-6">Carregando...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8">
                <DollarSign className="w-10 h-10 text-[var(--t-text-muted)] mx-auto mb-3" />
                <p className="text-[var(--t-text-muted)] text-sm">Nenhuma comissão encontrada.</p>
                <p className="text-[var(--t-text-muted)] text-xs mt-1">Clique em &quot;Calcular Comissões&quot; para gerar a partir das vendas confirmadas.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)] text-xs uppercase">
                      <th className="text-left px-4 py-3">Vendedor</th>
                      <th className="text-left px-4 py-3">Venda</th>
                      <th className="text-left px-4 py-3">Data</th>
                      <th className="text-right px-4 py-3">Base</th>
                      <th className="text-center px-4 py-3">%</th>
                      <th className="text-right px-4 py-3">Comissão</th>
                      <th className="text-left px-4 py-3">Plano</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(c => (
                      <tr key={c.id} className="border-b border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] transition-colors">
                        <td className="px-4 py-3 font-medium text-[var(--t-text)]">{c.vendedor_nome}</td>
                        <td className="px-4 py-3 text-[var(--t-text-secondary)] font-mono text-xs">{c.venda_numero}</td>
                        <td className="px-4 py-3 text-[var(--t-text-secondary)]">
                          {c.data_venda ? new Date(c.data_venda + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--t-text-secondary)]">{BRL(c.valor_base)}</td>
                        <td className="px-4 py-3 text-center text-[var(--t-text-secondary)]">{c.percentual_aplicado}%</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-[var(--t-green)]">{BRL(c.valor_comissao)}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-[var(--t-text-muted)]">{c.plano_nome}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={`${STATUS_BADGE[c.status]} border-0 text-xs`}>{c.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {c.status === 'CALCULADA' && (
                              <Button size="sm" onClick={() => handleAprovar(c)}
                                className="bg-[var(--t-blue)] hover:brightness-110 text-white h-7 px-2 text-xs">
                                <Check className="w-3 h-3 mr-1" /> Aprovar
                              </Button>
                            )}
                            {c.status === 'APROVADA' && (
                              <Button size="sm" onClick={() => handlePagar(c)}
                                className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] h-7 px-2 text-xs">
                                <Banknote className="w-3 h-3 mr-1" /> Pagar
                              </Button>
                            )}
                            {(c.status === 'CALCULADA' || c.status === 'APROVADA') && (
                              <Button size="sm" variant="outline" onClick={() => handleCancelar(c)}
                                className="border-[var(--t-border)] text-[var(--t-text-secondary)] h-7 px-2 text-xs">Cancelar</Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => handleDelete(c.id)}
                              className="border-[var(--t-red)]/30 text-[var(--t-red)] h-7 px-2">
                              <Trash2 className="w-3 h-3" />
                            </Button>
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
      </div>
    </div>
  );
}
