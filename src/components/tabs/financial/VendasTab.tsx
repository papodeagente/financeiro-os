'use client';

import { useState, useMemo } from 'react';
import { GrupoViagem } from '@/lib/types';
import {
  Venda, Parcela, FormaPagamento, TipoApto, PAX_PER_APTO, StatusVenda, Passageiro, TipoPax,
} from '@/lib/financial-types';
import { getPrecoSugerido, gerarParcelas, calcVendasMetrics } from '@/lib/financial-calculations';
import { calcProposta } from '@/lib/calculations';
import { createFinanceiroGrupo } from '@/lib/financial-defaults';
import { formatBRL, generateId } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { MoneyInput } from '@/components/MoneyInput';

interface Props {
  grupo: GrupoViagem;
  onChange: (grupo: GrupoViagem) => void;
}

const TIPO_APTO_OPTIONS: TipoApto[] = ['SGL', 'DBL', 'TPL', 'QDP'];
const FORMA_PAGAMENTO_OPTIONS: { value: FormaPagamento; label: string }[] = [
  { value: 'AVISTA_PIX', label: 'A Vista / PIX' },
  { value: 'CARTAO', label: 'Cartao de Credito' },
  { value: 'BOLETO', label: 'Boleto' },
];
const STATUS_COLORS: Record<StatusVenda, string> = {
  RESERVADO: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  CONFIRMADO: 'bg-green-100 text-green-800 border-green-300',
  CANCELADO: 'bg-red-100 text-red-800 border-red-300',
};

function emptyPassageiro(): Passageiro {
  return { nome: '', tipo: 'ADT', documento: '', data_nascimento: '' };
}

interface VendaFormState {
  data_venda: string;
  cliente_nome: string;
  cliente_cpf: string;
  cliente_telefone: string;
  cliente_email: string;
  tipo_apto: TipoApto | '';
  forma_pagamento: FormaPagamento | '';
  valor_total_apto: number;
  desconto_concedido: number;
  valor_final: number;
  qtd_parcelas: number;
  vendedor: string;
  observacoes: string;
  is_cortesia: boolean;
  passageiros: Passageiro[];
}

function createEmptyForm(parcelas: number): VendaFormState {
  return {
    data_venda: new Date().toISOString().split('T')[0],
    cliente_nome: '',
    cliente_cpf: '',
    cliente_telefone: '',
    cliente_email: '',
    tipo_apto: '',
    forma_pagamento: '',
    valor_total_apto: 0,
    desconto_concedido: 0,
    valor_final: 0,
    qtd_parcelas: parcelas,
    vendedor: '',
    observacoes: '',
    is_cortesia: false,
    passageiros: [emptyPassageiro()],
  };
}

export function VendasTab({ grupo, onChange }: Props) {
  const fin = grupo.financeiro ?? createFinanceiroGrupo();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<VendaFormState>(() => createEmptyForm(grupo.params.parcelas));

  // Ensure financeiro is initialized
  const ensureFin = () => {
    if (!grupo.financeiro) {
      return createFinanceiroGrupo();
    }
    return { ...grupo.financeiro };
  };

  const proposta = useMemo(() => calcProposta(grupo), [grupo]);
  const metrics = useMemo(() => calcVendasMetrics(fin, grupo.params.qtd_max_pax), [fin, grupo.params.qtd_max_pax]);

  // --- Form helpers ---
  const updateForm = (patch: Partial<VendaFormState>) => {
    setForm(prev => {
      const next = { ...prev, ...patch };

      // Auto-fill price when tipo_apto and forma_pagamento are both set
      if (('tipo_apto' in patch || 'forma_pagamento' in patch) && next.tipo_apto && next.forma_pagamento) {
        const preco = getPrecoSugerido(proposta, next.tipo_apto as TipoApto, next.forma_pagamento as FormaPagamento);
        next.valor_total_apto = preco;
        next.valor_final = next.is_cortesia ? 0 : preco - next.desconto_concedido;
      }

      // Auto-set parcelas based on forma
      if ('forma_pagamento' in patch) {
        if (next.forma_pagamento === 'AVISTA_PIX') {
          next.qtd_parcelas = 1;
        } else {
          next.qtd_parcelas = grupo.params.parcelas;
        }
      }

      // Recalculate valor_final on desconto or cortesia change
      if ('desconto_concedido' in patch || 'is_cortesia' in patch) {
        next.valor_final = next.is_cortesia ? 0 : next.valor_total_apto - next.desconto_concedido;
      }

      return next;
    });
  };

  const updatePassageiro = (index: number, patch: Partial<Passageiro>) => {
    setForm(prev => {
      const passageiros = [...prev.passageiros];
      passageiros[index] = { ...passageiros[index], ...patch };
      return { ...prev, passageiros };
    });
  };

  const addPassageiro = () => {
    setForm(prev => ({ ...prev, passageiros: [...prev.passageiros, emptyPassageiro()] }));
  };

  const removePassageiro = (index: number) => {
    setForm(prev => ({
      ...prev,
      passageiros: prev.passageiros.filter((_, i) => i !== index),
    }));
  };

  // --- Actions ---
  const handleOpenDialog = () => {
    setForm(createEmptyForm(grupo.params.parcelas));
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.cliente_nome || !form.tipo_apto || !form.forma_pagamento) return;

    const vendaId = generateId();
    const valorParcela = form.qtd_parcelas > 0 ? form.valor_final / form.qtd_parcelas : form.valor_final;

    const venda: Venda = {
      id: vendaId,
      data_venda: form.data_venda,
      cliente_nome: form.cliente_nome,
      cliente_cpf: form.cliente_cpf,
      cliente_telefone: form.cliente_telefone,
      cliente_email: form.cliente_email,
      tipo_apto: form.tipo_apto as TipoApto,
      passageiros: form.passageiros.filter(p => p.nome.trim() !== ''),
      forma_pagamento: form.forma_pagamento as FormaPagamento,
      valor_total_apto: form.valor_total_apto,
      desconto_concedido: form.desconto_concedido,
      valor_final: form.valor_final,
      qtd_parcelas: form.qtd_parcelas,
      valor_parcela: Math.round(valorParcela * 100) / 100,
      chds_extras: [],
      status: 'RESERVADO',
      observacoes: form.observacoes,
      vendedor: form.vendedor,
      is_cortesia: form.is_cortesia,
    };

    const parcelas = gerarParcelas(venda);
    const updatedFin = ensureFin();
    updatedFin.vendas = [...updatedFin.vendas, venda];
    updatedFin.parcelas = [...updatedFin.parcelas, ...parcelas];

    onChange({ ...grupo, financeiro: updatedFin });
    setDialogOpen(false);
  };

  const handleChangeStatus = (vendaId: string, newStatus: StatusVenda) => {
    const updatedFin = ensureFin();

    updatedFin.vendas = updatedFin.vendas.map(v =>
      v.id === vendaId ? { ...v, status: newStatus } : v
    );

    // If canceling, cancel associated parcelas
    if (newStatus === 'CANCELADO') {
      updatedFin.parcelas = updatedFin.parcelas.map(p =>
        p.venda_id === vendaId ? { ...p, status: 'CANCELADO' as const } : p
      );
    }

    onChange({ ...grupo, financeiro: updatedFin });
  };

  const handleDelete = (vendaId: string) => {
    const updatedFin = ensureFin();
    updatedFin.vendas = updatedFin.vendas.filter(v => v.id !== vendaId);
    updatedFin.parcelas = updatedFin.parcelas.filter(p => p.venda_id !== vendaId);
    onChange({ ...grupo, financeiro: updatedFin });
  };

  const formatDate = (d: string) => {
    if (!d) return '--';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const formaLabel = (f: FormaPagamento) => {
    const found = FORMA_PAGAMENTO_OPTIONS.find(o => o.value === f);
    return found ? found.label : f;
  };

  return (
    <div className="space-y-6">
      {/* Summary Bar */}
      <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-4 rounded-lg grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="text-center">
          <div className="text-xs text-[var(--t-accent)] uppercase tracking-wide">Total Aptos</div>
          <div className="text-2xl font-bold">{metrics.totalAptos}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-[var(--t-accent)] uppercase tracking-wide">Total PAX</div>
          <div className="text-2xl font-bold">{metrics.totalPax}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-[var(--t-accent)] uppercase tracking-wide">Receita Total</div>
          <div className="text-2xl font-bold">{formatBRL(metrics.receitaLiquida)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-[var(--t-accent)] uppercase tracking-wide">Descontos</div>
          <div className="text-2xl font-bold text-red-400">{formatBRL(metrics.descontos)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-[var(--t-accent)] uppercase tracking-wide">Ticket Medio</div>
          <div className="text-2xl font-bold">{formatBRL(metrics.ticketMedioApto)}</div>
        </div>
      </div>

      {/* New Sale Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleOpenDialog}
          className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-bold"
        >
          + Nova Venda
        </Button>
      </div>

      {/* Sales Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
              <th className="p-2 border border-[var(--t-border)] text-left">Data</th>
              <th className="p-2 border border-[var(--t-border)] text-left">Cliente</th>
              <th className="p-2 border border-[var(--t-border)] text-center">Tipo</th>
              <th className="p-2 border border-[var(--t-border)] text-center">PAX</th>
              <th className="p-2 border border-[var(--t-border)] text-center">Forma</th>
              <th className="p-2 border border-[var(--t-border)] text-right">Valor</th>
              <th className="p-2 border border-[var(--t-border)] text-right">Desconto</th>
              <th className="p-2 border border-[var(--t-border)] text-right">Final</th>
              <th className="p-2 border border-[var(--t-border)] text-center">Status</th>
              <th className="p-2 border border-[var(--t-border)] text-center">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {fin.vendas.length === 0 && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-[var(--t-text-secondary)] border">
                  Nenhuma venda registrada. Clique em &quot;Nova Venda&quot; para adicionar.
                </td>
              </tr>
            )}
            {fin.vendas.map((v, i) => (
              <tr key={v.id} className={i % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]'}>
                <td className="p-2 border">{formatDate(v.data_venda)}</td>
                <td className="p-2 border">
                  <div className="font-medium">{v.cliente_nome}</div>
                  {v.is_cortesia && (
                    <span className="text-xs text-purple-600 font-semibold">CORTESIA</span>
                  )}
                </td>
                <td className="p-2 border text-center font-mono">{v.tipo_apto}</td>
                <td className="p-2 border text-center">{v.passageiros.length}</td>
                <td className="p-2 border text-center text-xs">{formaLabel(v.forma_pagamento)}</td>
                <td className="p-2 border text-right">{formatBRL(v.valor_total_apto)}</td>
                <td className="p-2 border text-right text-red-600">
                  {v.desconto_concedido > 0 ? formatBRL(v.desconto_concedido) : '--'}
                </td>
                <td className="p-2 border text-right font-bold">{formatBRL(v.valor_final)}</td>
                <td className="p-2 border text-center">
                  <Badge className={`${STATUS_COLORS[v.status]} text-xs`}>
                    {v.status}
                  </Badge>
                </td>
                <td className="p-2 border text-center">
                  <div className="flex flex-wrap gap-1 justify-center">
                    {v.status !== 'CONFIRMADO' && v.status !== 'CANCELADO' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 border-green-400 text-green-700 hover:bg-green-50"
                        onClick={() => handleChangeStatus(v.id, 'CONFIRMADO')}
                      >
                        Confirmar
                      </Button>
                    )}
                    {v.status !== 'CANCELADO' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 border-red-400 text-red-700 hover:bg-red-50"
                        onClick={() => handleChangeStatus(v.id, 'CANCELADO')}
                      >
                        Cancelar
                      </Button>
                    )}
                    {v.status === 'CONFIRMADO' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 border-yellow-400 text-yellow-700 hover:bg-yellow-50"
                        onClick={() => handleChangeStatus(v.id, 'RESERVADO')}
                      >
                        Reservar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 border-gray-400 text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)]"
                      onClick={() => handleDelete(v.id)}
                    >
                      Excluir
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Sale Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-[var(--t-text)] text-lg font-bold">Nova Venda</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Client Info */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-[var(--t-text)] border-b border-[var(--t-accent)] pb-1">
                Dados do Cliente
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Data da Venda</Label>
                  <Input
                    type="date"
                    value={form.data_venda}
                    onChange={e => updateForm({ data_venda: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Nome do Cliente *</Label>
                  <Input
                    value={form.cliente_nome}
                    onChange={e => updateForm({ cliente_nome: e.target.value })}
                    placeholder="Nome completo"
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">CPF</Label>
                  <Input
                    value={form.cliente_cpf}
                    onChange={e => updateForm({ cliente_cpf: e.target.value })}
                    placeholder="000.000.000-00"
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Telefone</Label>
                  <Input
                    value={form.cliente_telefone}
                    onChange={e => updateForm({ cliente_telefone: e.target.value })}
                    placeholder="(00) 00000-0000"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label className="text-xs">E-mail</Label>
                  <Input
                    type="email"
                    value={form.cliente_email}
                    onChange={e => updateForm({ cliente_email: e.target.value })}
                    placeholder="email@exemplo.com"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Sale Details */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-[var(--t-text)] border-b border-[var(--t-accent)] pb-1">
                Detalhes da Venda
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Tipo de Apartamento *</Label>
                  <Select
                    value={form.tipo_apto}
                    onValueChange={(v) => updateForm({ tipo_apto: v as TipoApto })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPO_APTO_OPTIONS.map(t => (
                        <SelectItem key={t} value={t}>
                          {t} ({PAX_PER_APTO[t]} PAX)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Forma de Pagamento *</Label>
                  <Select
                    value={form.forma_pagamento}
                    onValueChange={(v) => updateForm({ forma_pagamento: v as FormaPagamento })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMA_PAGAMENTO_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Qtd. Parcelas</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.qtd_parcelas}
                    onChange={e => updateForm({ qtd_parcelas: parseInt(e.target.value) || 1 })}
                    className="h-8 text-sm"
                    disabled={form.forma_pagamento === 'AVISTA_PIX'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Valor Total Apto (Proposta)</Label>
                  <MoneyInput
                    value={form.valor_total_apto || null}
                    onChange={v => {
                      const val = v ?? 0;
                      updateForm({
                        valor_total_apto: val,
                        valor_final: form.is_cortesia ? 0 : val - form.desconto_concedido,
                      });
                    }}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Desconto Concedido</Label>
                  <MoneyInput
                    value={form.desconto_concedido || null}
                    onChange={v => updateForm({ desconto_concedido: v ?? 0 })}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs">Valor Final</Label>
                  <div className="h-8 flex items-center px-3 bg-[var(--t-surface-hover)] border rounded text-sm font-bold text-green-700">
                    {formatBRL(form.valor_final)}
                  </div>
                </div>
              </div>

              {form.tipo_apto && form.forma_pagamento && form.qtd_parcelas > 1 && (
                <div className="text-xs text-[var(--t-text-secondary)]">
                  Parcela: {form.qtd_parcelas}x de{' '}
                  <span className="font-bold">
                    {formatBRL(form.valor_final / form.qtd_parcelas)}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Vendedor</Label>
                  <Input
                    value={form.vendedor}
                    onChange={e => updateForm({ vendedor: e.target.value })}
                    placeholder="Nome do vendedor"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.is_cortesia}
                      onChange={e => updateForm({ is_cortesia: e.target.checked })}
                      className="w-4 h-4 accent-[#d4a853]"
                    />
                    <span className="text-sm font-medium text-purple-700">Cortesia</span>
                  </label>
                </div>
              </div>

              <div>
                <Label className="text-xs">Observacoes</Label>
                <Textarea
                  value={form.observacoes}
                  onChange={e => updateForm({ observacoes: e.target.value })}
                  placeholder="Anotacoes sobre esta venda..."
                  className="text-sm resize-none"
                  rows={2}
                />
              </div>
            </div>

            {/* Passengers */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-[var(--t-accent)] pb-1">
                <h4 className="text-sm font-bold text-[var(--t-text)]">
                  Passageiros ({form.passageiros.length})
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addPassageiro}
                  className="text-xs h-7 border-[var(--t-accent)] text-[var(--t-accent)]"
                >
                  + Adicionar
                </Button>
              </div>

              {form.passageiros.map((pax, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-[var(--t-surface-hover)] p-2 rounded">
                  <div className="col-span-4">
                    <Label className="text-xs">Nome</Label>
                    <Input
                      value={pax.nome}
                      onChange={e => updatePassageiro(idx, { nome: e.target.value })}
                      placeholder="Nome do passageiro"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Tipo</Label>
                    <Select
                      value={pax.tipo}
                      onValueChange={(v) => updatePassageiro(idx, { tipo: v as TipoPax })}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ADT">ADT</SelectItem>
                        <SelectItem value="CHD">CHD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Documento</Label>
                    <Input
                      value={pax.documento}
                      onChange={e => updatePassageiro(idx, { documento: e.target.value })}
                      placeholder="CPF/RG"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Nascimento</Label>
                    <Input
                      type="date"
                      value={pax.data_nascimento}
                      onChange={e => updatePassageiro(idx, { data_nascimento: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {form.passageiros.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 h-8 w-8 p-0"
                        onClick={() => removePassageiro(idx)}
                      >
                        X
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.cliente_nome || !form.tipo_apto || !form.forma_pagamento}
              className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-bold"
            >
              Salvar Venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
