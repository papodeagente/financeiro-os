'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { MetaVendedor, Membro, VendaCRM, ComissaoVenda, PeriodoMeta } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Target, Plus, X, Check, Trash2, Trophy, Medal, TrendingUp,
  Users, DollarSign, BarChart3, RefreshCw,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

function getMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[parseInt(m) - 1]}/${y}`;
}

const MEDAL_COLORS = ['text-yellow-400', 'text-[var(--t-text-secondary)]', 'text-amber-600'];

export default function MetasPage() {
  const [metas, setMetas] = useState<MetaVendedor[]>([]);
  const [membros, setMembros] = useState<Membro[]>([]);
  const [vendas, setVendas] = useState<VendaCRM[]>([]);
  const [comissoes, setComissoes] = useState<ComissaoVenda[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [recalculating, setRecalculating] = useState(false);

  // Form
  const [formVendedorId, setFormVendedorId] = useState('');
  const [formMetaValor, setFormMetaValor] = useState(0);
  const [formMetaQtd, setFormMetaQtd] = useState(0);
  const [formBonus, setFormBonus] = useState(0);

  async function load() {
    setLoading(true);
    const [mt, mb, v, c] = await Promise.all([
      loadEntities<MetaVendedor>('metas'),
      loadEntities<Membro>('membros'),
      loadEntities<VendaCRM>('vendas-crm'),
      loadEntities<ComissaoVenda>('comissoes'),
    ]);
    setMetas(mt);
    setMembros(mb);
    setVendas(v);
    setComissoes(c);
    const now = new Date();
    if (!selectedMonth) setSelectedMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setLoading(false);
  }

  const loadedRef = React.useRef(false);
  useEffect(() => { load(); }, []);

  // Auto-recalcular ao carregar dados
  useEffect(() => {
    if (!loading && metas.length > 0 && vendas.length >= 0 && selectedMonth && !loadedRef.current) {
      loadedRef.current = true;
      handleRecalcular();
    }
  }, [loading, metas.length, vendas.length, selectedMonth]);

  function openNew() {
    setFormVendedorId(membros[0]?.id || '');
    setFormMetaValor(50000);
    setFormMetaQtd(10);
    setFormBonus(500);
    setShowForm(true);
  }

  async function handleSave() {
    if (!formVendedorId || !selectedMonth) return;
    const vendedor = membros.find(m => m.id === formVendedorId);
    const meta: MetaVendedor = {
      id: generateId(),
      vendedor_id: formVendedorId,
      vendedor_nome: vendedor?.nome || '',
      periodo: 'MENSAL',
      mes_referencia: selectedMonth,
      meta_valor: formMetaValor,
      meta_quantidade: formMetaQtd,
      realizado_valor: 0,
      realizado_quantidade: 0,
      percentual_atingido_valor: 0,
      percentual_atingido_quantidade: 0,
      bonus_meta: formBonus,
      criado_em: new Date().toISOString(),
    };
    await saveEntity('metas', meta);
    setShowForm(false);
    load();
  }

  // Recalculate realized values from actual sales
  async function handleRecalcular() {
    setRecalculating(true);
    const monthMetas = metas.filter(m => m.mes_referencia === selectedMonth);

    for (const meta of monthMetas) {
      const vendasVendedor = vendas.filter(v =>
        v.vendedor_id === meta.vendedor_id &&
        v.data_venda?.substring(0, 7) === selectedMonth &&
        v.status !== 'CANCELADO' && v.status !== 'ORCAMENTO'
      );
      const realizadoValor = vendasVendedor.reduce((s, v) => s + v.valor_final, 0);
      const realizadoQtd = vendasVendedor.length;

      const updated: MetaVendedor = {
        ...meta,
        realizado_valor: realizadoValor,
        realizado_quantidade: realizadoQtd,
        percentual_atingido_valor: meta.meta_valor > 0 ? (realizadoValor / meta.meta_valor) * 100 : 0,
        percentual_atingido_quantidade: meta.meta_quantidade > 0 ? (realizadoQtd / meta.meta_quantidade) * 100 : 0,
      };
      await updateEntity('metas', updated);
    }

    setRecalculating(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir meta?')) return;
    await deleteEntity('metas', id);
    load();
  }

  const monthMetas = metas.filter(m => m.mes_referencia === selectedMonth);

  // Ranking — consolidado por vendedor (agrupa múltiplas metas do mesmo vendedor)
  const ranking = useMemo(() => {
    const byVendedor = new Map<string, { vendedor_id: string; vendedor_nome: string; realizado_valor: number; realizado_quantidade: number; meta_valor: number; percentual_atingido_valor: number }>();
    for (const m of monthMetas) {
      const cur = byVendedor.get(m.vendedor_id);
      if (cur) {
        cur.realizado_valor += m.realizado_valor;
        cur.realizado_quantidade += m.realizado_quantidade;
        cur.meta_valor += m.meta_valor;
        cur.percentual_atingido_valor = cur.meta_valor > 0 ? (cur.realizado_valor / cur.meta_valor) * 100 : 0;
      } else {
        byVendedor.set(m.vendedor_id, {
          vendedor_id: m.vendedor_id,
          vendedor_nome: m.vendedor_nome,
          realizado_valor: m.realizado_valor,
          realizado_quantidade: m.realizado_quantidade,
          meta_valor: m.meta_valor,
          percentual_atingido_valor: m.meta_valor > 0 ? (m.realizado_valor / m.meta_valor) * 100 : 0,
        });
      }
    }
    return [...byVendedor.values()]
      .sort((a, b) => b.realizado_valor - a.realizado_valor)
      .map((v, i) => ({ ...v, posicao: i + 1, id: v.vendedor_id }));
  }, [monthMetas]);

  // Team totals
  const teamTotals = useMemo(() => {
    const metaTotal = monthMetas.reduce((s, m) => s + m.meta_valor, 0);
    const realizadoTotal = monthMetas.reduce((s, m) => s + m.realizado_valor, 0);
    const qtdTotal = monthMetas.reduce((s, m) => s + m.realizado_quantidade, 0);
    const pctTotal = metaTotal > 0 ? (realizadoTotal / metaTotal) * 100 : 0;
    return { metaTotal, realizadoTotal, qtdTotal, pctTotal };
  }, [monthMetas]);

  // Commissions for the month
  const monthCommissions = useMemo(() =>
    comissoes.filter(c => c.data_venda?.substring(0, 7) === selectedMonth)
      .reduce((s, c) => s + c.valor_comissao, 0),
    [comissoes, selectedMonth]
  );

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Metas e Ranking</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Acompanhe metas individuais e ranking da equipe</p>
          </div>
          <div className="flex gap-2 items-center">
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
              {(() => {
                const months = [];
                const now = new Date();
                for (let i = -3; i <= 6; i++) {
                  const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
                  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                  months.push(ym);
                }
                return months.map(m => <option key={m} value={m}>{getMonthLabel(m)}</option>);
              })()}
            </select>
            <Button onClick={handleRecalcular} disabled={recalculating} variant="outline"
              className="border-[var(--t-border)] text-[var(--t-text-secondary)]">
              <RefreshCw className={`w-4 h-4 mr-2 ${recalculating ? 'animate-spin' : ''}`} />
              Recalcular
            </Button>
            <Button onClick={openNew} className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
              <Plus className="w-4 h-4 mr-2" /> Definir Meta
            </Button>
          </div>
        </div>

        {/* Team KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bento-card">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-5 h-5 text-[var(--t-blue)]" />
              <span className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide">Meta Equipe</span>
            </div>
            <p className="text-2xl font-bold text-[var(--t-blue)]">{BRL(teamTotals.metaTotal)}</p>
          </div>
          <div className="bento-card">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-5 h-5 text-[var(--t-green)]" />
              <span className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide">Realizado</span>
            </div>
            <p className="text-2xl font-bold text-[var(--t-green)]">{BRL(teamTotals.realizadoTotal)}</p>
          </div>
          <div className="bento-card">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-5 h-5 text-[var(--t-amber)]" />
              <span className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide">% Atingido</span>
            </div>
            <p className={`text-2xl font-bold ${teamTotals.pctTotal >= 100 ? 'text-[var(--t-green)]' : teamTotals.pctTotal >= 70 ? 'text-[var(--t-amber)]' : 'text-[var(--t-red)]'}`}>
              {teamTotals.pctTotal.toFixed(1)}%
            </p>
          </div>
          <div className="bento-card">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="w-5 h-5 text-purple-400" />
              <span className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wide">Comissões do Mês</span>
            </div>
            <p className="text-2xl font-bold text-purple-400">{BRL(monthCommissions)}</p>
          </div>
        </div>

        {/* Team progress bar */}
        <Card className="bg-[var(--t-surface)]">
          <CardContent className="p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-[var(--t-text-secondary)]">Progresso da Equipe</span>
              <span className="text-[var(--t-text)] font-medium">{BRL(teamTotals.realizadoTotal)} / {BRL(teamTotals.metaTotal)}</span>
            </div>
            <div className="w-full bg-[var(--t-bg)] rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all ${teamTotals.pctTotal >= 100 ? 'bg-[var(--t-green)]' : teamTotals.pctTotal >= 70 ? 'bg-[var(--t-amber)]' : 'bg-[var(--t-red)]'}`}
                style={{ width: `${Math.min(100, teamTotals.pctTotal)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Form */}
        {showForm && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-green)] text-base">Definir Meta — {getMonthLabel(selectedMonth)}</CardTitle>
              <button onClick={() => setShowForm(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Vendedor *</label>
                  <select value={formVendedorId} onChange={e => setFormVendedorId(e.target.value)}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]">
                    {membros.filter(m => m.status === 'ATIVO').map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Meta Valor (R$)</label>
                  <Input type="number" min={0} step={1000} value={formMetaValor} onChange={e => setFormMetaValor(parseFloat(e.target.value) || 0)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Meta Qtd Vendas</label>
                  <Input type="number" min={0} value={formMetaQtd} onChange={e => setFormMetaQtd(parseInt(e.target.value) || 0)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Bônus por Atingir (R$)</label>
                  <Input type="number" min={0} step={100} value={formBonus} onChange={e => setFormBonus(parseFloat(e.target.value) || 0)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]" />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button onClick={handleSave} className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
                  <Check className="w-4 h-4 mr-1" /> Salvar
                </Button>
                <Button variant="outline" onClick={() => setShowForm(false)} className="border-[var(--t-border)] text-[var(--t-text-secondary)]">Cancelar</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Ranking + Individual Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Ranking */}
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)] lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-400" />
                Ranking do Mês
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ranking.length === 0 ? (
                <p className="text-[var(--t-text-muted)] text-sm text-center py-4">Nenhuma meta definida para este mês.</p>
              ) : (
                <div className="space-y-3">
                  {ranking.map((r, i) => (
                    <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-[var(--t-bg)] shadow-[var(--t-card-shadow)]">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--t-surface)] shadow-[var(--t-card-shadow)]">
                        {i < 3 ? (
                          <Medal className={`w-5 h-5 ${MEDAL_COLORS[i]}`} />
                        ) : (
                          <span className="text-xs text-[var(--t-text-muted)] font-bold">{r.posicao}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--t-text)] truncate">{r.vendedor_nome}</p>
                        <p className="text-xs text-[var(--t-text-muted)]">{r.realizado_quantidade} vendas</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-[var(--t-green)]">{BRL(r.realizado_valor)}</p>
                        <p className="text-[10px] text-[var(--t-text-muted)]">{r.percentual_atingido_valor.toFixed(0)}% da meta</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Individual progress */}
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-medium text-[var(--t-text-secondary)] uppercase flex items-center gap-2">
              <Users className="w-4 h-4" /> Metas Individuais
            </h2>
            {monthMetas.length === 0 ? (
              <Card className="bg-[var(--t-surface)]">
                <CardContent className="py-8 text-center">
                  <Target className="w-10 h-10 text-[var(--t-text-muted)] mx-auto mb-3" />
                  <p className="text-[var(--t-text-muted)] text-sm">Defina metas para os vendedores deste mês.</p>
                </CardContent>
              </Card>
            ) : (
              monthMetas.map(m => {
                const pctVal = m.percentual_atingido_valor;
                const pctQtd = m.percentual_atingido_quantidade;
                const atingiuMeta = pctVal >= 100;

                return (
                  <Card key={m.id} className={`bg-[var(--t-surface)] border-[var(--t-border)] ${atingiuMeta ? 'border-[var(--t-green)]/30' : ''}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-[var(--t-text)]">{m.vendedor_nome}</h3>
                          {atingiuMeta && (
                            <Badge className="bg-[var(--t-green-bg)] text-[var(--t-green)] border-0 text-xs flex items-center gap-0.5">
                              <Trophy className="w-3 h-3" /> Meta Atingida!
                            </Badge>
                          )}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => handleDelete(m.id)}
                          className="border-[var(--t-red)]/30 text-[var(--t-red)] h-7 px-2">
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        {/* Valor */}
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-[var(--t-text-muted)]">Valor</span>
                            <span className="text-[var(--t-text-secondary)]">{BRL(m.realizado_valor)} / {BRL(m.meta_valor)}</span>
                          </div>
                          <div className="w-full bg-[var(--t-bg)] rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-2 rounded-full transition-all ${pctVal >= 100 ? 'bg-[var(--t-green)]' : pctVal >= 70 ? 'bg-[var(--t-amber)]' : 'bg-[var(--t-red)]'}`}
                              style={{ width: `${Math.min(100, pctVal)}%` }}
                            />
                          </div>
                          <p className="text-right text-xs text-[var(--t-text-muted)] mt-0.5">{pctVal.toFixed(1)}%</p>
                        </div>
                        {/* Quantidade */}
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-[var(--t-text-muted)]">Vendas</span>
                            <span className="text-[var(--t-text-secondary)]">{m.realizado_quantidade} / {m.meta_quantidade}</span>
                          </div>
                          <div className="w-full bg-[var(--t-bg)] rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-2 rounded-full transition-all ${pctQtd >= 100 ? 'bg-[var(--t-green)]' : pctQtd >= 70 ? 'bg-[var(--t-amber)]' : 'bg-[var(--t-red)]'}`}
                              style={{ width: `${Math.min(100, pctQtd)}%` }}
                            />
                          </div>
                          <p className="text-right text-xs text-[var(--t-text-muted)] mt-0.5">{pctQtd.toFixed(1)}%</p>
                        </div>
                      </div>

                      {m.bonus_meta > 0 && (
                        <p className="text-xs text-[var(--t-text-muted)] mt-2">
                          Bônus: <span className={atingiuMeta ? 'text-[var(--t-green)] font-medium' : 'text-[var(--t-text-muted)]'}>
                            {BRL(m.bonus_meta)} {atingiuMeta ? '(liberado)' : '(pendente)'}
                          </span>
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
