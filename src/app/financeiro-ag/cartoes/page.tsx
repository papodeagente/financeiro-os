'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CartaoCorporativo, ContaPagar, BandeiraCartao } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatBRL, generateId } from '@/lib/utils';
import { somaPor, divSegura, round2 } from '@/lib/money';
import {
  calcLimiteUsado,
  calcProximoFechamento,
  calcProximoVencimento,
  calcFaturaPeriodo,
  bandeiraColor,
  BANDEIRA_LABEL,
} from '@/lib/cartoes-utils';
import {
  Plus, X, Check, Trash2, Pencil, CreditCard, AlertTriangle,
  ChevronDown, ChevronUp, FileText, Power, PowerOff,
} from 'lucide-react';

const BANDEIRAS: BandeiraCartao[] = ['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD', 'OUTRA'];

function createNew(): CartaoCorporativo {
  return {
    id: generateId(),
    apelido: '',
    bandeira: 'VISA',
    ultimos_digitos: '',
    titular: '',
    banco_emissor: '',
    limite_total: 0,
    dia_fechamento: 0,
    dia_vencimento: 0,
    taxa_antecipacao: 0,
    taxa_parcelamento: 0,
    taxa_anuidade: 0,
    ativo: true,
    observacoes: '',
  };
}

type FormState = Omit<CartaoCorporativo, 'id'>;

const EMPTY_FORM: FormState = {
  apelido: '',
  bandeira: 'VISA',
  ultimos_digitos: '',
  titular: '',
  banco_emissor: '',
  limite_total: 0,
  dia_fechamento: 0,
  dia_vencimento: 0,
  taxa_antecipacao: 0,
  taxa_parcelamento: 0,
  taxa_anuidade: 0,
  ativo: true,
  observacoes: '',
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

export default function CartoesCorpPage() {
  const [items, setItems] = useState<CartaoCorporativo[]>([]);
  const [contas, setContas] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showTaxas, setShowTaxas] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [faturaCardId, setFaturaCardId] = useState<string | null>(null);
  const [faturaMes, setFaturaMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  async function load() {
    setLoading(true);
    const [cartoes, cps] = await Promise.all([
      loadEntities<CartaoCorporativo>('cartoes-corp'),
      loadEntities<ContaPagar>('contas-pagar'),
    ]);
    setItems(cartoes);
    setContas(cps);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowTaxas(false);
    setShowForm(true);
  }

  function openEdit(item: CartaoCorporativo) {
    const { id: _id, ...rest } = item;
    void _id;
    setForm({ ...EMPTY_FORM, ...rest });
    setEditId(item.id);
    setShowTaxas((item.taxa_antecipacao || item.taxa_parcelamento || item.taxa_anuidade) > 0);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.apelido) return;
    if (editId) {
      const existing = items.find(i => i.id === editId)!;
      await updateEntity<CartaoCorporativo>('cartoes-corp', { ...existing, ...form });
    } else {
      const novo: CartaoCorporativo = { ...createNew(), ...form };
      await saveEntity<CartaoCorporativo>('cartoes-corp', novo);
    }
    setShowForm(false);
    setEditId(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Confirmar exclusão deste cartão? Lançamentos vinculados não serão afetados.')) return;
    await deleteEntity('cartoes-corp', id);
    load();
  }

  async function toggleAtivo(item: CartaoCorporativo) {
    await updateEntity<CartaoCorporativo>('cartoes-corp', { ...item, ativo: !item.ativo });
    load();
  }

  // KPI consolidado
  const totals = useMemo(() => {
    const limite = somaPor(items, c => c.limite_total);
    const usado = somaPor(items, c => calcLimiteUsado(c.id, contas));
    const pct = round2(divSegura(usado, limite) * 100);
    return { limite, usado, pct, ativos: items.filter(c => c.ativo).length };
  }, [items, contas]);

  // Fatura aberta
  const faturaCard = items.find(c => c.id === faturaCardId) || null;
  const fatura = useMemo(() => {
    if (!faturaCard) return null;
    return calcFaturaPeriodo(faturaCard, contas, faturaMes);
  }, [faturaCard, contas, faturaMes]);

  return (
    <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        <MinimalPageHead
          title="Cartões corporativos"
          meta={<p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Gestão de limites, faturas e lançamentos por cartão</p>}
          actions={
            <button
              onClick={openNew}
              className="h-[34px] px-3 text-[12px] font-medium"
              style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
            >
              <Plus className="w-3.5 h-3.5 inline mr-2" /> Novo cartão
            </button>
          }
        />

        {/* KPI consolidado */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-accent)]/30">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-[var(--t-text-secondary)] text-[11px] uppercase tracking-wide font-semibold">Limite total</p>
                <p className="text-2xl font-bold text-[var(--t-text)] mt-1">{formatBRL(totals.limite)}</p>
              </div>
              <div>
                <p className="text-[var(--t-text-secondary)] text-[11px] uppercase tracking-wide font-semibold">Limite usado</p>
                <p className="text-2xl font-bold text-[var(--t-text)] mt-1">{formatBRL(totals.usado)}</p>
              </div>
              <div>
                <p className="text-[var(--t-text-secondary)] text-[11px] uppercase tracking-wide font-semibold">Disponível</p>
                <p className="text-2xl font-bold text-[var(--t-accent)] mt-1">{formatBRL(totals.limite - totals.usado)}</p>
              </div>
              <div>
                <p className="text-[var(--t-text-secondary)] text-[11px] uppercase tracking-wide font-semibold">Utilização</p>
                <p className={`text-2xl font-bold mt-1 ${totals.pct > 85 ? 'text-red-500' : totals.pct > 60 ? 'text-amber-500' : 'text-green-500'}`}>
                  {totals.pct.toFixed(1)}%
                </p>
                <p className="text-[var(--t-text-muted)] text-xs mt-0.5">{totals.ativos} cartão{totals.ativos !== 1 ? 'es' : ''} ativo{totals.ativos !== 1 ? 's' : ''}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Form inline */}
        {showForm && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-accent)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-accent)] text-base">
                {editId ? 'Editar Cartão' : 'Novo Cartão'}
              </CardTitle>
              <button onClick={() => setShowForm(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Apelido *</label>
                  <Input
                    value={form.apelido}
                    onChange={e => setForm(f => ({ ...f, apelido: e.target.value }))}
                    placeholder="Ex: Itaú Black Marketing"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Bandeira</label>
                  <select
                    value={form.bandeira}
                    onChange={e => setForm(f => ({ ...f, bandeira: e.target.value as BandeiraCartao }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    {BANDEIRAS.map(b => (
                      <option key={b} value={b}>{BANDEIRA_LABEL[b]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Banco Emissor</label>
                  <Input
                    value={form.banco_emissor}
                    onChange={e => setForm(f => ({ ...f, banco_emissor: e.target.value }))}
                    placeholder="Ex: Itaú, Bradesco, Nubank"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">4 últimos dígitos</label>
                  <Input
                    value={form.ultimos_digitos}
                    maxLength={4}
                    onChange={e => setForm(f => ({ ...f, ultimos_digitos: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    placeholder="0000"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)] font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Titular</label>
                  <Input
                    value={form.titular}
                    onChange={e => setForm(f => ({ ...f, titular: e.target.value }))}
                    placeholder="Nome impresso no plástico"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Limite Total (R$)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.limite_total}
                    onChange={e => setForm(f => ({ ...f, limite_total: parseFloat(e.target.value) || 0 }))}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Dia de Fechamento</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={form.dia_fechamento || ''}
                    onChange={e => setForm(f => ({ ...f, dia_fechamento: parseInt(e.target.value) || 0 }))}
                    placeholder="1-31"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Dia de Vencimento</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={form.dia_vencimento || ''}
                    onChange={e => setForm(f => ({ ...f, dia_vencimento: parseInt(e.target.value) || 0 }))}
                    placeholder="1-31"
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="ativo"
                    checked={form.ativo}
                    onChange={e => setForm(f => ({ ...f, ativo: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  <label htmlFor="ativo" className="text-sm text-[var(--t-text)]">Cartão ativo</label>
                </div>
              </div>

              {/* Taxas (collapsible) */}
              <button
                type="button"
                onClick={() => setShowTaxas(s => !s)}
                className="mt-4 flex items-center gap-1 text-xs font-semibold text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
              >
                {showTaxas ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Taxas e custos (opcional)
              </button>
              {showTaxas && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3 p-3 rounded-lg bg-[var(--t-bg)]">
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Antecipação (% a.m.)</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.taxa_antecipacao}
                      onChange={e => setForm(f => ({ ...f, taxa_antecipacao: parseFloat(e.target.value) || 0 }))}
                      className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Parcelamento (%)</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.taxa_parcelamento}
                      onChange={e => setForm(f => ({ ...f, taxa_parcelamento: parseFloat(e.target.value) || 0 }))}
                      className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Anuidade (R$/ano)</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.taxa_anuidade}
                      onChange={e => setForm(f => ({ ...f, taxa_anuidade: parseFloat(e.target.value) || 0 }))}
                      className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleSave}
                  className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold"
                >
                  <Check className="w-4 h-4 mr-1" /> {editId ? 'Salvar' : 'Criar'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface)]"
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cards grid */}
        {loading ? (
          <p className="text-[var(--t-text-secondary)] text-sm">Carregando...</p>
        ) : items.length === 0 ? (
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-12 text-center">
              <CreditCard className="w-12 h-12 text-[var(--t-text-muted)] mx-auto mb-3" />
              <p className="text-[var(--t-text-secondary)] text-sm">Nenhum cartão cadastrado.</p>
              <p className="text-[var(--t-text-muted)] text-xs mt-1">Clique em &quot;Novo Cartão&quot; para adicionar.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(item => {
              const usado = calcLimiteUsado(item.id, contas);
              const pct = item.limite_total > 0 ? (usado / item.limite_total) * 100 : 0;
              const disponivel = Math.max(0, item.limite_total - usado);
              const proxFech = item.dia_fechamento ? calcProximoFechamento(item.dia_fechamento) : null;
              const proxVenc = item.dia_vencimento ? calcProximoVencimento(item.dia_vencimento) : null;
              const colors = bandeiraColor(item.bandeira);
              const barColor = pct > 85 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-green-500';

              return (
                <Card
                  key={item.id}
                  className={`bg-[var(--t-surface)] border-[var(--t-border)] hover:border-[var(--t-accent)]/40 transition-colors group ${item.ativo ? '' : 'opacity-60'}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-[var(--t-text)] text-base leading-tight truncate">{item.apelido}</CardTitle>
                        <p className="text-[var(--t-text-secondary)] text-xs mt-0.5">{item.banco_emissor || 'Banco não informado'}</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => toggleAtivo(item)}
                          title={item.ativo ? 'Desativar' : 'Ativar'}
                          className="p-1.5 rounded text-[var(--t-text-secondary)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors"
                        >
                          {item.ativo ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => openEdit(item)}
                          className="p-1.5 rounded text-[var(--t-text-secondary)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 rounded text-red-500 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {/* Visual cartão */}
                    <div
                      className="rounded-lg p-3 mb-3 relative overflow-hidden"
                      style={{ background: `linear-gradient(135deg, ${colors.bg}, ${colors.bg}cc)` }}
                    >
                      <div className="flex items-center justify-between">
                        <CreditCard className="w-5 h-5" style={{ color: colors.text }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: colors.text }}>
                          {BANDEIRA_LABEL[item.bandeira]}
                        </span>
                      </div>
                      <p className="font-mono text-base mt-3 tracking-widest" style={{ color: colors.text }}>
                        •••• •••• •••• {item.ultimos_digitos || '••••'}
                      </p>
                      <p className="text-[10px] mt-1 uppercase opacity-80" style={{ color: colors.text }}>
                        {item.titular || 'Titular'}
                      </p>
                    </div>

                    {/* Limite */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[var(--t-text-secondary)]">Usado</span>
                        <span className="text-[var(--t-text)] font-semibold">{formatBRL(usado)} / {formatBRL(item.limite_total)}</span>
                      </div>
                      <div className="w-full h-1.5 bg-[var(--t-bg)] rounded-full overflow-hidden">
                        <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--t-text-muted)]">Disponível: {formatBRL(disponivel)}</span>
                        <span className={pct > 85 ? 'text-red-500 font-semibold' : 'text-[var(--t-text-muted)]'}>{pct.toFixed(0)}%</span>
                      </div>
                    </div>

                    {/* Datas */}
                    {(proxFech || proxVenc) && (
                      <div className="mt-3 pt-3 border-t border-[var(--t-border)] flex items-center justify-between text-[11px] text-[var(--t-text-secondary)]">
                        {proxFech && (
                          <span>Fecha: <strong className="text-[var(--t-text)]">{fmtDate(proxFech)}</strong></span>
                        )}
                        {proxVenc && (
                          <span>Vence: <strong className="text-[var(--t-text)]">{fmtDate(proxVenc)}</strong></span>
                        )}
                      </div>
                    )}

                    {/* Status badge + ver fatura */}
                    <div className="mt-3 flex items-center justify-between">
                      <Badge className={`${item.ativo ? 'bg-green-500/15 text-green-500' : 'bg-[var(--t-surface-hover)] text-[var(--t-text-muted)]'} border-0 text-[10px]`}>
                        {item.ativo ? 'Ativo' : 'Inativo'}
                      </Badge>
                      <button
                        onClick={() => setFaturaCardId(faturaCardId === item.id ? null : item.id)}
                        className="flex items-center gap-1 text-xs text-[var(--t-accent)] hover:underline"
                      >
                        <FileText className="w-3 h-3" />
                        {faturaCardId === item.id ? 'Fechar' : 'Ver fatura'}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Painel de fatura */}
        {faturaCard && fatura && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-accent)]/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-[var(--t-text)] text-base">
                    Fatura — {faturaCard.apelido} •••• {faturaCard.ultimos_digitos}
                  </CardTitle>
                  <p className="text-[var(--t-text-secondary)] text-xs mt-0.5">
                    Período: {fmtDate(fatura.inicio)} → {fmtDate(fatura.fim)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    value={faturaMes}
                    onChange={e => setFaturaMes(e.target.value)}
                    className="px-2 py-1 rounded bg-[var(--t-input-bg)] border border-[var(--t-border)] text-xs text-[var(--t-text)]"
                  />
                  <button
                    onClick={() => setFaturaCardId(null)}
                    className="p-1 text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {fatura.lancamentos.length === 0 ? (
                <p className="text-[var(--t-text-secondary)] text-sm py-6 text-center">
                  Nenhum lançamento neste período.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto">
                    {fatura.lancamentos.map(l => (
                      <div key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-[var(--t-bg)] text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="text-[var(--t-text)] truncate">{l.descricao || l.fornecedor_nome || 'Sem descrição'}</p>
                          <p className="text-[var(--t-text-muted)] text-[11px]">
                            {l.data_pagamento || l.data_vencimento}
                            {l.total_parcelas > 1 && ` · ${l.parcela_numero}/${l.total_parcelas}`}
                          </p>
                        </div>
                        <span className="text-[var(--t-text)] font-mono tabular-nums whitespace-nowrap">
                          {formatBRL(l.valor_final)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-[var(--t-border)] flex items-center justify-between">
                    <span className="text-[var(--t-text-secondary)] text-sm">Total da fatura</span>
                    <span className="text-[var(--t-accent)] text-xl font-bold">{formatBRL(fatura.total)}</span>
                  </div>
                  {fatura.total > faturaCard.limite_total && (
                    <div className="mt-3 flex items-start gap-2 p-2 rounded-lg bg-red-500/10">
                      <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <p className="text-[13px] text-red-500">Fatura ultrapassa o limite total deste cartão.</p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        <MinimalFooter pageId="cartões" />
      </div>
    </div>
  );
}
