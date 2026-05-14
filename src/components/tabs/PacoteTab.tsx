'use client';

import { useState } from 'react';
import {
  Plus, Trash2, Package, Plane, Hotel, MapPin, Car, Ship, Ticket,
  Shield, UserCog, MoreHorizontal, Edit2, Eye, EyeOff, X, Check,
} from 'lucide-react';
import {
  ITEM_PACOTE_LABEL,
  type GrupoViagem, type ItemPacote, type ItemPacoteTipo, type OperadoraData,
} from '@/lib/types';
import { generateId } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';

interface Props {
  grupo: GrupoViagem;
  onChange: (grupo: GrupoViagem) => void;
}

const ICONE_TIPO: Record<ItemPacoteTipo, React.ComponentType<{ className?: string }>> = {
  AEREO: Plane,
  HOTEL: Hotel,
  TRANSFER: Car,
  RECEPTIVO: MapPin,
  PASSEIO: MapPin,
  CRUZEIRO: Ship,
  INGRESSO: Ticket,
  SEGURO: Shield,
  GUIA: UserCog,
  OUTROS: MoreHorizontal,
};

function fmtBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
}

interface FormItem {
  id?: string;
  tipo: ItemPacoteTipo;
  descricao: string;
  quantidade: number;
  exibir_na_proposta: boolean;
  valor_individual: number | '';
  observacoes: string;
}

const formVazio: FormItem = {
  tipo: 'HOTEL',
  descricao: '',
  quantidade: 1,
  exibir_na_proposta: true,
  valor_individual: '',
  observacoes: '',
};

export function PacoteTab({ grupo, onChange }: Props) {
  const operadora: OperadoraData = grupo.operadora || { itens: [], valor_custo: 0, valor_venda: 0 };

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editandoIdx, setEditandoIdx] = useState<number | null>(null);
  const [form, setForm] = useState<FormItem>(formVazio);

  const update = (patch: Partial<OperadoraData>) => {
    onChange({ ...grupo, operadora: { ...operadora, ...patch } });
  };

  const updateValores = (patch: { valor_custo?: number; valor_venda?: number }) => {
    update(patch);
  };

  const margem = operadora.valor_venda > 0
    ? ((operadora.valor_venda - operadora.valor_custo) / operadora.valor_venda) * 100
    : 0;
  const lucro = operadora.valor_venda - operadora.valor_custo;

  const corMargem = margem >= 20
    ? 'var(--lg-pos, #10B981)'
    : margem >= 0
      ? 'var(--lg-warn, #F59E0B)'
      : 'var(--lg-neg, #EF4444)';

  // ---- Itens ---------------------------------------------------------

  const abrirNovo = () => {
    setForm(formVazio);
    setEditandoIdx(null);
    setSheetOpen(true);
  };

  const abrirEditar = (i: number) => {
    const it = operadora.itens[i];
    setForm({
      id: it.id,
      tipo: it.tipo,
      descricao: it.descricao,
      quantidade: it.quantidade,
      exibir_na_proposta: it.exibir_na_proposta,
      valor_individual: typeof it.valor_individual === 'number' ? it.valor_individual : '',
      observacoes: it.observacoes || '',
    });
    setEditandoIdx(i);
    setSheetOpen(true);
  };

  const salvar = () => {
    if (!form.descricao.trim()) { toast.error('Descrição é obrigatória'); return; }
    const novoItem: ItemPacote = {
      id: form.id || generateId(),
      tipo: form.tipo,
      descricao: form.descricao.trim(),
      quantidade: Math.max(1, form.quantidade || 1),
      exibir_na_proposta: form.exibir_na_proposta,
      valor_individual: form.valor_individual === '' ? undefined : Number(form.valor_individual),
      observacoes: form.observacoes,
    };
    const itens = [...operadora.itens];
    if (editandoIdx !== null) {
      itens[editandoIdx] = novoItem;
    } else {
      itens.push(novoItem);
    }
    update({ itens });
    toast.success(editandoIdx !== null ? 'Item atualizado' : 'Item adicionado');
    setSheetOpen(false);
    setEditandoIdx(null);
  };

  const remover = (i: number) => {
    const it = operadora.itens[i];
    if (!confirm(`Remover "${it.descricao}"?`)) return;
    update({ itens: operadora.itens.filter((_, idx) => idx !== i) });
  };

  const toggleExibir = (i: number) => {
    const itens = [...operadora.itens];
    itens[i] = { ...itens[i], exibir_na_proposta: !itens[i].exibir_na_proposta };
    update({ itens });
  };

  // ---- Render --------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--t-text)]">Pacote da operadora</h2>
        <p className="text-sm text-[var(--t-text-secondary)] mt-1">
          Cadastre o que está incluso no pacote da operadora e o preço final (custo, venda e margem).
          Os itens marcados <b>Exibir na proposta</b> aparecem para o cliente.
        </p>
      </div>

      {/* Fornecedor / operadora principal */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Operadora (fornecedor principal)</Label>
          <Input
            value={operadora.fornecedor_nome || ''}
            onChange={e => update({ fornecedor_nome: e.target.value })}
            placeholder="Ex: CVC, Decolar Operadora, ABC Tours..."
          />
        </div>
      </div>

      {/* Lista de itens */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--t-text)] flex items-center gap-2">
            <Package className="w-4 h-4" />
            Itens inclusos
            <span className="text-xs text-[var(--t-text-muted)] font-normal">
              ({operadora.itens.length} {operadora.itens.length === 1 ? 'item' : 'itens'})
            </span>
          </h3>
          <Button onClick={abrirNovo} size="sm" className="gap-1">
            <Plus className="w-4 h-4" /> Adicionar item
          </Button>
        </div>

        {operadora.itens.length === 0 ? (
          <div
            className="border rounded-[12px] p-10 text-center"
            style={{ borderStyle: 'dashed', borderColor: 'var(--t-border)' }}
          >
            <Package className="w-8 h-8 mx-auto mb-2" style={{ color: '#CBD5E1' }} />
            <p className="text-[14px] font-medium text-[var(--t-text-secondary)]">
              Nenhum item adicionado ainda
            </p>
            <p className="text-[12px] text-[var(--t-text-muted)] mt-1">
              Adicione hotel, voo, passeios e demais serviços que compõem o pacote.
            </p>
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-[12px]"
            style={{ background: 'var(--t-surface)', border: '1px solid var(--t-border)', boxShadow: 'var(--t-card-shadow)' }}
          >
            <table className="w-full text-[13px]">
              <thead style={{ background: 'var(--t-surface-hover)' }}>
                <tr style={{ borderBottom: '1px solid var(--t-border)' }}>
                  <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-[var(--t-text-muted)]">Tipo</th>
                  <th className="text-left px-3 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-[var(--t-text-muted)]">Descrição</th>
                  <th className="text-center px-3 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-[var(--t-text-muted)]">Qtd</th>
                  <th className="text-center px-3 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-[var(--t-text-muted)]">Na proposta</th>
                  <th className="text-right px-3 py-2.5 text-[11px] uppercase tracking-wide font-semibold text-[var(--t-text-muted)]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {operadora.itens.map((item, i) => {
                  const Icon = ICONE_TIPO[item.tipo];
                  return (
                    <tr
                      key={item.id}
                      style={{ borderTop: '1px solid var(--t-border)' }}
                      className="hover:bg-[var(--t-surface-hover)]"
                    >
                      <td className="px-3 py-2.5">
                        <div className="inline-flex items-center gap-2">
                          <Icon className="w-4 h-4 text-[var(--t-text-muted)]" />
                          <span className="text-[12px] uppercase tracking-wide font-medium text-[var(--t-text-secondary)]">
                            {ITEM_PACOTE_LABEL[item.tipo]}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-[var(--t-text)]">{item.descricao}</div>
                        {item.observacoes && (
                          <div className="text-[11px] mt-0.5 text-[var(--t-text-muted)] italic">{item.observacoes}</div>
                        )}
                        {item.valor_individual !== undefined && item.valor_individual > 0 && (
                          <div className="text-[11px] mt-0.5 mono text-[var(--t-text-secondary)]">
                            valor unitário: {fmtBRL(item.valor_individual)} (informativo)
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center mono">{item.quantidade}</td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => toggleExibir(i)}
                          className="inline-flex items-center justify-center"
                          title={item.exibir_na_proposta ? 'Visível para o cliente' : 'Oculto da proposta'}
                        >
                          {item.exibir_na_proposta
                            ? <Eye className="w-4 h-4 text-[var(--t-green)]" />
                            : <EyeOff className="w-4 h-4 text-[var(--t-text-muted)]" />
                          }
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => abrirEditar(i)}
                            className="w-8 h-8 rounded-md inline-flex items-center justify-center text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => remover(i)}
                            className="w-8 h-8 rounded-md inline-flex items-center justify-center text-[var(--t-text-muted)] hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Precificação final */}
      <div
        className="rounded-[12px] p-5"
        style={{ background: 'var(--t-surface)', border: '1px solid var(--t-border)', boxShadow: 'var(--t-card-shadow)' }}
      >
        <h3 className="text-base font-semibold text-[var(--t-text)] mb-4">Precificação do pacote</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Preço de custo (operadora)</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={operadora.valor_custo || ''}
              onChange={e => updateValores({ valor_custo: parseFloat(e.target.value) || 0 })}
              placeholder="0,00"
              className="mono"
            />
            <p className="text-[10px] text-[var(--t-text-muted)] mt-1">Quanto a agência paga à operadora</p>
          </div>
          <div>
            <Label>Preço de venda (cliente)</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={operadora.valor_venda || ''}
              onChange={e => updateValores({ valor_venda: parseFloat(e.target.value) || 0 })}
              placeholder="0,00"
              className="mono"
            />
            <p className="text-[10px] text-[var(--t-text-muted)] mt-1">Quanto a agência cobra do cliente</p>
          </div>
          <div>
            <Label>Margem (calculada)</Label>
            <div
              className="h-10 px-3 py-2 rounded-md flex items-center justify-between font-bold text-[16px] mono"
              style={{
                background: 'var(--t-surface-hover)',
                color: corMargem,
                border: '1px solid var(--t-border)',
              }}
            >
              <span>{margem.toFixed(1)}%</span>
              <span className="text-[13px] font-normal">{fmtBRL(lucro)}</span>
            </div>
            <p className="text-[10px] text-[var(--t-text-muted)] mt-1">Lucro bruto sobre venda</p>
          </div>
        </div>

        <div className="mt-4">
          <Label>Observações gerais do pacote</Label>
          <textarea
            rows={2}
            value={operadora.observacoes_gerais || ''}
            onChange={e => update({ observacoes_gerais: e.target.value })}
            placeholder="Política de cancelamento, condições especiais, regras..."
            className="w-full px-3 py-2 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] text-sm text-[var(--t-text)] resize-none"
          />
        </div>
      </div>

      {/* Sheet adicionar/editar item */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ background: 'rgba(15,23,42,0.45)' }}
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full max-w-lg h-full overflow-y-auto p-6 space-y-4 shadow-2xl"
            style={{ background: 'white' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-[var(--t-border)]">
              <h3 className="text-[18px] font-bold text-[var(--t-text)]">
                {editandoIdx !== null ? 'Editar item' : 'Adicionar item'}
              </h3>
              <button onClick={() => setSheetOpen(false)} className="text-[var(--t-text-muted)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <Label>Tipo</Label>
              <select
                value={form.tipo}
                onChange={e => setForm(f => ({ ...f, tipo: e.target.value as ItemPacoteTipo }))}
                className="w-full h-10 px-3 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] text-sm text-[var(--t-text)]"
              >
                {(Object.entries(ITEM_PACOTE_LABEL) as [ItemPacoteTipo, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Descrição *</Label>
              <Input
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                placeholder="Ex: Hotel Marriott Miami Beach, 5 noites"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.quantidade}
                  onChange={e => setForm(f => ({ ...f, quantidade: parseInt(e.target.value) || 1 }))}
                />
              </div>
              <div>
                <Label>Valor individual (opcional)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.valor_individual}
                  onChange={e => setForm(f => ({ ...f, valor_individual: e.target.value === '' ? '' : Number(e.target.value) }))}
                  placeholder="apenas informativo"
                  className="mono"
                />
              </div>
            </div>

            <div>
              <Label>Observações</Label>
              <textarea
                rows={2}
                value={form.observacoes}
                onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                placeholder="Detalhes adicionais"
                className="w-full px-3 py-2 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] text-sm text-[var(--t-text)] resize-none"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-sm text-[var(--t-text)]">
              <input
                type="checkbox"
                checked={form.exibir_na_proposta}
                onChange={e => setForm(f => ({ ...f, exibir_na_proposta: e.target.checked }))}
              />
              Exibir este item na proposta enviada ao cliente
            </label>

            <div className="flex items-center gap-2 pt-3 border-t border-[var(--t-border)]">
              <Button onClick={salvar} className="gap-1">
                <Check className="w-4 h-4" /> Salvar
              </Button>
              <Button onClick={() => setSheetOpen(false)} variant="ghost">Cancelar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
