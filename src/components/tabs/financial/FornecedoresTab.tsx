'use client';

import { useState, useMemo } from 'react';
import { GrupoViagem } from '@/lib/types';
import {
  PagamentoFornecedor,
  CategoriaFornecedor,
  StatusFornecedor,
  DadosBancarios,
  TipoCusto,
} from '@/lib/financial-types';
import { calcFornecedoresMetrics } from '@/lib/financial-calculations';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { formatBRL, generateId } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from '@/components/MoneyInput';

// ---------- constants ----------

const CATEGORIAS: { value: CategoriaFornecedor; label: string }[] = [
  { value: 'TKT', label: 'Aéreo (TKT)' },
  { value: 'HTL', label: 'Hotel (HTL)' },
  { value: 'REC', label: 'Receptivo (REC)' },
  { value: 'CAR', label: 'Transporte (CAR)' },
  { value: 'GUIA', label: 'Guia' },
  { value: 'SEG', label: 'Seguro (SEG)' },
  { value: 'NAVIO', label: 'Cruzeiro (NAVIO)' },
  { value: 'ING', label: 'Ingressos (ING)' },
  { value: 'BRINDE', label: 'Brindes' },
  { value: 'OUTRO', label: 'Outro' },
];

const TIPOS_CUSTO: { value: TipoCusto; label: string }[] = [
  { value: 'POR_PAX', label: 'Por Pax' },
  { value: 'POR_APTO', label: 'Por Apto' },
  { value: 'POR_CABINE', label: 'Por Cabine' },
  { value: 'FIXO_GRUPO', label: 'Fixo Grupo' },
  { value: 'POR_VEICULO', label: 'Por Veículo' },
];

const STATUS_BADGE: Record<StatusFornecedor, { bg: string; text: string; label: string }> = {
  PENDENTE: { bg: 'bg-[var(--t-status-warning-bg)]', text: 'text-[var(--t-status-warning)]', label: 'Pendente' },
  PARCIAL: { bg: 'bg-[var(--t-status-info-bg)]', text: 'text-[var(--t-status-info)]', label: 'Parcial' },
  PAGO: { bg: 'bg-[var(--t-status-success-bg)]', text: 'text-[var(--t-status-success)]', label: 'Pago' },
  VENCIDO: { bg: 'bg-[var(--t-status-danger-bg)]', text: 'text-[var(--t-status-danger)]', label: 'Vencido' },
  CANCELADO: { bg: 'bg-[var(--t-status-neutral-bg)]', text: 'text-[var(--t-status-neutral)]', label: 'Cancelado' },
};

const CATEGORIA_ORDER: CategoriaFornecedor[] = [
  'TKT', 'HTL', 'REC', 'CAR', 'GUIA', 'SEG', 'NAVIO', 'ING', 'BRINDE', 'OUTRO',
];

// ---------- helpers ----------

function emptyDadosBancarios(): DadosBancarios {
  return { banco: '', agencia: '', conta: '', pix: '', titular: '', cnpj: '' };
}

function emptyPagamento(): Omit<PagamentoFornecedor, 'id'> {
  return {
    categoria: 'OUTRO',
    fornecedor_nome: '',
    descricao: '',
    valor_cotado: 0,
    valor_negociado: 0,
    valor_pago: 0,
    moeda: 'BRL',
    cambio_cotacao: 1,
    cambio_pagamento: null,
    valor_brl_cotado: 0,
    valor_brl_pago: 0,
    deadline: null,
    data_vencimento: null,
    data_pagamento: null,
    tipo_custo: 'FIXO_GRUPO',
    quantidade: 1,
    valor_unitario: 0,
    status: 'PENDENTE',
    forma_pagamento: null,
    comprovante: null,
    parcelas_fornecedor: [],
    contato_nome: '',
    contato_telefone: '',
    contato_email: '',
    dados_bancarios: emptyDadosBancarios(),
    observacoes: '',
  };
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('pt-BR');
}

function categoriaLabel(cat: CategoriaFornecedor): string {
  return CATEGORIAS.find(c => c.value === cat)?.label ?? cat;
}

// ---------- props ----------

interface Props {
  grupo: GrupoViagem;
  onChange: (g: GrupoViagem) => void;
}

// ---------- component ----------

export default function FornecedoresTab({ grupo, onChange }: Props) {
  const fin = grupo.financeiro ?? createFinanceiroGrupo();
  const pagamentos = fin.pagamentos_fornecedores;

  // dialogs
  const [showNew, setShowNew] = useState(false);
  const [showPagamento, setShowPagamento] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);

  // new supplier form
  const [form, setForm] = useState(emptyPagamento());

  // payment form
  const [pgForm, setPgForm] = useState({ valor: 0, data: '', forma: '', comprovante: '' });

  // ---------- derived ----------

  const metrics = useMemo(() => calcFornecedoresMetrics(pagamentos), [pagamentos]);

  const grouped = useMemo(() => {
    const map = new Map<CategoriaFornecedor, PagamentoFornecedor[]>();
    for (const cat of CATEGORIA_ORDER) {
      const items = pagamentos.filter(p => p.categoria === cat);
      if (items.length > 0) map.set(cat, items);
    }
    return map;
  }, [pagamentos]);

  // ---------- mutations ----------

  function updateFin(fn: (f: typeof fin) => typeof fin) {
    const updated = fn({ ...fin, pagamentos_fornecedores: [...pagamentos] });
    onChange({ ...grupo, financeiro: updated });
  }

  function addPagamento(p: PagamentoFornecedor) {
    updateFin(f => ({ ...f, pagamentos_fornecedores: [...f.pagamentos_fornecedores, p] }));
  }

  function updatePagamento(id: string, patch: Partial<PagamentoFornecedor>) {
    updateFin(f => ({
      ...f,
      pagamentos_fornecedores: f.pagamentos_fornecedores.map(p =>
        p.id === id ? { ...p, ...patch } : p
      ),
    }));
  }

  function removePagamento(id: string) {
    if (!confirm('Remover este fornecedor?')) return;
    updateFin(f => ({
      ...f,
      pagamentos_fornecedores: f.pagamentos_fornecedores.filter(p => p.id !== id),
    }));
  }

  // ---------- handlers ----------

  function handleNovoSave() {
    const valorBrlCotado = form.valor_cotado * form.cambio_cotacao;
    const novo: PagamentoFornecedor = {
      ...form,
      id: generateId(),
      valor_brl_cotado: valorBrlCotado,
      valor_brl_pago: 0,
      valor_pago: 0,
      status: 'PENDENTE',
    };
    addPagamento(novo);
    setForm(emptyPagamento());
    setShowNew(false);
  }

  function handleGerarContas() {
    const sample: PagamentoFornecedor = {
      id: generateId(),
      categoria: 'OUTRO',
      fornecedor_nome: 'Fornecedor Exemplo',
      descricao: 'Gerado automaticamente',
      valor_cotado: 1000,
      valor_negociado: 950,
      valor_pago: 0,
      moeda: 'BRL',
      cambio_cotacao: 1,
      cambio_pagamento: null,
      valor_brl_cotado: 1000,
      valor_brl_pago: 0,
      deadline: null,
      data_vencimento: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      data_pagamento: null,
      tipo_custo: 'FIXO_GRUPO',
      quantidade: 1,
      valor_unitario: 1000,
      status: 'PENDENTE',
      forma_pagamento: null,
      comprovante: null,
      parcelas_fornecedor: [],
      contato_nome: '',
      contato_telefone: '',
      contato_email: '',
      dados_bancarios: emptyDadosBancarios(),
      observacoes: 'Entrada gerada a partir do módulo de planejamento',
    };
    addPagamento(sample);
  }

  function openRegistrarPagamento(id: string) {
    setEditTarget(id);
    setPgForm({ valor: 0, data: new Date().toISOString().split('T')[0], forma: 'PIX', comprovante: '' });
    setShowPagamento(true);
  }

  function handleRegistrarPagamento() {
    if (!editTarget) return;
    const p = pagamentos.find(x => x.id === editTarget);
    if (!p) return;

    const novoValorPago = p.valor_brl_pago + pgForm.valor;
    const negociadoBrl = p.valor_negociado * (p.cambio_pagamento || p.cambio_cotacao);
    let novoStatus: StatusFornecedor = 'PARCIAL';
    if (novoValorPago >= negociadoBrl) novoStatus = 'PAGO';

    updatePagamento(editTarget, {
      valor_pago: p.valor_pago + pgForm.valor,
      valor_brl_pago: novoValorPago,
      data_pagamento: pgForm.data,
      forma_pagamento: pgForm.forma,
      comprovante: pgForm.comprovante || p.comprovante,
      status: novoStatus,
    });

    setShowPagamento(false);
    setEditTarget(null);
  }

  function handleChangeStatus(id: string, status: StatusFornecedor) {
    updatePagamento(id, { status });
  }

  // ---------- update form helpers ----------

  function setF<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  function setBanco<K extends keyof DadosBancarios>(key: K, val: string) {
    setForm(prev => ({
      ...prev,
      dados_bancarios: { ...prev.dados_bancarios, [key]: val },
    }));
  }

  // ---------- render ----------

  const summaryItems = [
    { label: 'Custo Cotado', value: formatBRL(metrics.custoCotado), color: 'text-[var(--t-text-secondary)]' },
    { label: 'Custo Negociado', value: formatBRL(metrics.custoNegociado), color: 'text-[var(--t-text)]' },
    {
      label: 'Economia',
      value: formatBRL(metrics.economiaNegociacao),
      color: metrics.economiaNegociacao >= 0 ? 'text-green-400' : 'text-red-400',
    },
    { label: 'Total Pago', value: formatBRL(metrics.totalPago), color: 'text-[var(--t-accent)]' },
    { label: 'A Pagar', value: formatBRL(metrics.totalAPagar), color: 'text-orange-400' },
    { label: 'Vencido', value: formatBRL(metrics.totalVencido), color: 'text-red-400' },
  ];

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryItems.map(item => (
          <div
            key={item.label}
            className="bg-[var(--t-header-bg)] border border-[var(--t-accent)]/20 rounded-lg p-3 text-center"
          >
            <div className="text-[11px] text-[var(--t-text-secondary)] uppercase tracking-wide">{item.label}</div>
            <div className={`text-lg font-bold ${item.color}`}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="border-[var(--t-accent)]/40 text-[var(--t-accent)] hover:bg-[var(--t-accent)]/10"
          onClick={handleGerarContas}
        >
          Gerar Contas a Pagar
        </Button>
        <Button
          size="sm"
          className="bg-[var(--t-accent)] text-[var(--t-text)] hover:bg-[var(--t-accent)]/80 font-semibold"
          onClick={() => {
            setForm(emptyPagamento());
            setShowNew(true);
          }}
        >
          + Novo Fornecedor
        </Button>
      </div>

      {/* Table grouped by category */}
      {pagamentos.length === 0 ? (
        <div className="text-center text-[var(--t-text-secondary)] py-12 bg-[var(--t-header-bg)] rounded-lg border border-[var(--t-accent)]/10">
          Nenhum fornecedor cadastrado. Clique em &quot;Novo Fornecedor&quot; para adicionar.
        </div>
      ) : (
        Array.from(grouped.entries()).map(([cat, items]) => (
          <div key={cat} className="space-y-1">
            <div className="text-xs font-bold text-[var(--t-accent)] uppercase tracking-wider mt-4 mb-1">
              {categoriaLabel(cat)}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-[var(--t-text-secondary)] uppercase border-b border-[var(--t-border)]">
                    <th className="text-left py-2 px-2">Fornecedor</th>
                    <th className="text-left py-2 px-2">Descrição</th>
                    <th className="text-right py-2 px-2">Cotado</th>
                    <th className="text-right py-2 px-2">Negociado</th>
                    <th className="text-right py-2 px-2">&Delta;</th>
                    <th className="text-center py-2 px-2">Vencimento</th>
                    <th className="text-center py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Pago</th>
                    <th className="text-right py-2 px-2">Saldo</th>
                    <th className="text-center py-2 px-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(p => {
                    const negBrl = p.valor_negociado * (p.cambio_pagamento || p.cambio_cotacao);
                    const delta = p.valor_brl_cotado - negBrl;
                    const saldo = negBrl - p.valor_brl_pago;
                    const st = STATUS_BADGE[p.status];

                    return (
                      <tr
                        key={p.id}
                        className="border-b border-[var(--t-border)] hover:bg-white/5 transition-colors"
                      >
                        <td className="py-2 px-2 text-[var(--t-text)] font-medium max-w-[160px] truncate">
                          {p.fornecedor_nome || '\u2014'}
                        </td>
                        <td className="py-2 px-2 text-[var(--t-text-secondary)] max-w-[180px] truncate">
                          {p.descricao || '\u2014'}
                        </td>
                        <td className="py-2 px-2 text-right text-[var(--t-text-secondary)]">
                          {formatBRL(p.valor_brl_cotado)}
                        </td>
                        <td className="py-2 px-2 text-right text-[var(--t-text)]">
                          {formatBRL(negBrl)}
                        </td>
                        <td
                          className={`py-2 px-2 text-right font-medium ${
                            delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-[var(--t-text-secondary)]'
                          }`}
                        >
                          {formatBRL(delta)}
                        </td>
                        <td className="py-2 px-2 text-center text-[var(--t-text-secondary)]">
                          {formatDate(p.data_vencimento)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <Badge className={`${st.bg} ${st.text} border-0 text-[10px]`}>
                            {st.label}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-right text-[var(--t-accent)]">
                          {formatBRL(p.valor_brl_pago)}
                        </td>
                        <td className="py-2 px-2 text-right text-orange-400">
                          {formatBRL(saldo > 0 ? saldo : 0)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px] text-[var(--t-accent)] hover:bg-[var(--t-accent)]/10"
                              onClick={() => openRegistrarPagamento(p.id)}
                              disabled={p.status === 'PAGO' || p.status === 'CANCELADO'}
                            >
                              Pagar
                            </Button>
                            <Select
                              value={p.status}
                              onValueChange={(v) => handleChangeStatus(p.id, v as StatusFornecedor)}
                            >
                              <SelectTrigger className="h-7 w-[90px] text-[10px] bg-transparent border-[var(--t-border)]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="PENDENTE">Pendente</SelectItem>
                                <SelectItem value="PARCIAL">Parcial</SelectItem>
                                <SelectItem value="PAGO">Pago</SelectItem>
                                <SelectItem value="VENCIDO">Vencido</SelectItem>
                                <SelectItem value="CANCELADO">Cancelado</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px] text-red-400 hover:bg-red-500/10"
                              onClick={() => removePagamento(p.id)}
                            >
                              ✕
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {/* ========== Dialog: Novo Fornecedor ========== */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-[var(--t-surface)] border-[var(--t-border)] text-[var(--t-text)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--t-accent)]">Novo Fornecedor</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Categoria */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Categoria</Label>
              <Select
                value={form.categoria}
                onValueChange={(v) => setF('categoria', v as CategoriaFornecedor)}
              >
                <SelectTrigger className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Nome fornecedor */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Nome do Fornecedor</Label>
              <Input
                value={form.fornecedor_nome}
                onChange={e => setF('fornecedor_nome', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Descricao */}
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[var(--t-text-secondary)] text-xs">Descrição</Label>
              <Input
                value={form.descricao}
                onChange={e => setF('descricao', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Valor Cotado */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Valor Cotado</Label>
              <MoneyInput
                value={form.valor_cotado || null}
                onChange={v => setF('valor_cotado', v ?? 0)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Valor Negociado */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Valor Negociado</Label>
              <MoneyInput
                value={form.valor_negociado || null}
                onChange={v => setF('valor_negociado', v ?? 0)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Moeda */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Moeda</Label>
              <Select
                value={form.moeda}
                onValueChange={(v) => setF('moeda', v as 'BRL' | 'USD' | 'EUR')}
              >
                <SelectTrigger className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BRL">BRL</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Cambio Cotacao */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Câmbio Cotação</Label>
              <Input
                type="number"
                step="0.01"
                value={form.cambio_cotacao}
                onChange={e => setF('cambio_cotacao', parseFloat(e.target.value) || 1)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Cambio Pagamento */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Câmbio Pagamento</Label>
              <Input
                type="number"
                step="0.01"
                value={form.cambio_pagamento ?? ''}
                onChange={e => {
                  const v = parseFloat(e.target.value);
                  setF('cambio_pagamento', isNaN(v) ? null : v);
                }}
                placeholder="Mesmo da cotação"
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Deadline */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Deadline</Label>
              <Input
                type="date"
                value={form.deadline ?? ''}
                onChange={e => setF('deadline', e.target.value || null)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Data Vencimento */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Data Vencimento</Label>
              <Input
                type="date"
                value={form.data_vencimento ?? ''}
                onChange={e => setF('data_vencimento', e.target.value || null)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Tipo Custo */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Tipo de Custo</Label>
              <Select
                value={form.tipo_custo}
                onValueChange={(v) => setF('tipo_custo', v as TipoCusto)}
              >
                <SelectTrigger className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_CUSTO.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Quantidade */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Quantidade</Label>
              <Input
                type="number"
                value={form.quantidade}
                onChange={e => setF('quantidade', parseInt(e.target.value) || 1)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Valor Unitario */}
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Valor Unitário</Label>
              <MoneyInput
                value={form.valor_unitario || null}
                onChange={v => setF('valor_unitario', v ?? 0)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Separator: Contato */}
            <div className="md:col-span-2 border-t border-[var(--t-border)] pt-3 mt-1">
              <span className="text-xs text-[var(--t-accent)] font-bold uppercase">Contato</span>
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Nome Contato</Label>
              <Input
                value={form.contato_nome}
                onChange={e => setF('contato_nome', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Telefone</Label>
              <Input
                value={form.contato_telefone}
                onChange={e => setF('contato_telefone', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label className="text-[var(--t-text-secondary)] text-xs">E-mail</Label>
              <Input
                value={form.contato_email}
                onChange={e => setF('contato_email', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Separator: Dados Bancarios */}
            <div className="md:col-span-2 border-t border-[var(--t-border)] pt-3 mt-1">
              <span className="text-xs text-[var(--t-accent)] font-bold uppercase">Dados Bancários</span>
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Banco</Label>
              <Input
                value={form.dados_bancarios.banco}
                onChange={e => setBanco('banco', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Agência</Label>
              <Input
                value={form.dados_bancarios.agencia}
                onChange={e => setBanco('agencia', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Conta</Label>
              <Input
                value={form.dados_bancarios.conta}
                onChange={e => setBanco('conta', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">PIX</Label>
              <Input
                value={form.dados_bancarios.pix}
                onChange={e => setBanco('pix', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Titular</Label>
              <Input
                value={form.dados_bancarios.titular}
                onChange={e => setBanco('titular', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">CNPJ</Label>
              <Input
                value={form.dados_bancarios.cnpj}
                onChange={e => setBanco('cnpj', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            {/* Observacoes */}
            <div className="md:col-span-2 space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Observações</Label>
              <Textarea
                value={form.observacoes}
                onChange={e => setF('observacoes', e.target.value)}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)] min-h-[60px]"
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setShowNew(false)} className="text-[var(--t-text-secondary)]">
              Cancelar
            </Button>
            <Button
              onClick={handleNovoSave}
              disabled={!form.fornecedor_nome}
              className="bg-[var(--t-accent)] text-[var(--t-text)] hover:bg-[var(--t-accent)]/80 font-semibold"
            >
              Salvar Fornecedor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ========== Dialog: Registrar Pagamento ========== */}
      <Dialog open={showPagamento} onOpenChange={setShowPagamento}>
        <DialogContent className="max-w-md bg-[var(--t-surface)] border-[var(--t-border)] text-[var(--t-text)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--t-accent)]">Registrar Pagamento</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Valor do Pagamento</Label>
              <MoneyInput
                value={pgForm.valor || null}
                onChange={v => setPgForm(prev => ({ ...prev, valor: v ?? 0 }))}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Data do Pagamento</Label>
              <Input
                type="date"
                value={pgForm.data}
                onChange={e => setPgForm(prev => ({ ...prev, data: e.target.value }))}
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Forma de Pagamento</Label>
              <Select
                value={pgForm.forma}
                onValueChange={(v) => setPgForm(prev => ({ ...prev, forma: v ?? '' }))}
              >
                <SelectTrigger className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PIX">PIX</SelectItem>
                  <SelectItem value="TED">TED</SelectItem>
                  <SelectItem value="BOLETO">Boleto</SelectItem>
                  <SelectItem value="CARTAO">Cartão</SelectItem>
                  <SelectItem value="DINHEIRO">Dinheiro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[var(--t-text-secondary)] text-xs">Comprovante (ref.)</Label>
              <Input
                value={pgForm.comprovante}
                onChange={e => setPgForm(prev => ({ ...prev, comprovante: e.target.value }))}
                placeholder="Nº do comprovante ou referência"
                className="bg-[var(--t-header-bg)] border-[var(--t-border)]"
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setShowPagamento(false)} className="text-[var(--t-text-secondary)]">
              Cancelar
            </Button>
            <Button
              onClick={handleRegistrarPagamento}
              disabled={pgForm.valor <= 0}
              className="bg-[var(--t-accent)] text-[var(--t-text)] hover:bg-[var(--t-accent)]/80 font-semibold"
            >
              Confirmar Pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
