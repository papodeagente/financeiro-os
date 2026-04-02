'use client';

import { useEffect, useState } from 'react';
import { TransferenciaBancaria, ContaBancaria, createTransferencia, StatusTransferencia } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Plus, X, Check, Trash2, ArrowRightLeft, ArrowRight, CheckCircle2,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_BADGE: Record<StatusTransferencia, string> = {
  PENDENTE: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
  EFETIVADA: 'bg-[var(--t-green-bg)] text-[var(--t-green)]',
  CANCELADA: 'bg-[var(--t-surface)] text-[var(--t-text-muted)]',
};

export default function TransferenciasPage() {
  const [items, setItems] = useState<TransferenciaBancaria[]>([]);
  const [contas, setContas] = useState<ContaBancaria[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [contaOrigemId, setContaOrigemId] = useState('');
  const [contaDestinoId, setContaDestinoId] = useState('');
  const [valor, setValor] = useState(0);
  const [data, setData] = useState(new Date().toISOString().split('T')[0]);
  const [descricao, setDescricao] = useState('');

  async function load() {
    setLoading(true);
    const [t, c] = await Promise.all([
      loadEntities<TransferenciaBancaria>('transferencias'),
      loadEntities<ContaBancaria>('contas-bancarias'),
    ]);
    setItems(t);
    setContas(c);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setContaOrigemId('');
    setContaDestinoId('');
    setValor(0);
    setData(new Date().toISOString().split('T')[0]);
    setDescricao('');
    setShowForm(true);
  }

  async function handleSave() {
    if (!contaOrigemId || !contaDestinoId || contaOrigemId === contaDestinoId || valor <= 0) return;
    const origem = contas.find(c => c.id === contaOrigemId);
    const destino = contas.find(c => c.id === contaDestinoId);
    const t: TransferenciaBancaria = {
      ...createTransferencia(),
      conta_origem_id: contaOrigemId,
      conta_origem_nome: origem?.nome || '',
      conta_destino_id: contaDestinoId,
      conta_destino_nome: destino?.nome || '',
      valor,
      data,
      descricao,
    };
    await saveEntity('transferencias', t);
    setShowForm(false);
    load();
  }

  async function handleEfetivar(item: TransferenciaBancaria) {
    if (!confirm(`Efetivar transferência de ${BRL(item.valor)}?`)) return;
    const updated: TransferenciaBancaria = {
      ...item,
      status: 'EFETIVADA',
      data_efetivacao: new Date().toISOString().split('T')[0],
    };
    await updateEntity('transferencias', updated);

    // Update bank balances
    const origem = contas.find(c => c.id === item.conta_origem_id);
    const destino = contas.find(c => c.id === item.conta_destino_id);
    if (origem) {
      await updateEntity('contas-bancarias', { ...origem, saldo_atual: origem.saldo_atual - item.valor });
    }
    if (destino) {
      await updateEntity('contas-bancarias', { ...destino, saldo_atual: destino.saldo_atual + item.valor });
    }
    load();
  }

  async function handleCancelar(item: TransferenciaBancaria) {
    if (!confirm('Cancelar transferência?')) return;
    await updateEntity('transferencias', { ...item, status: 'CANCELADA' });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir transferência?')) return;
    await deleteEntity('transferencias', id);
    load();
  }

  const totalPendente = items.filter(i => i.status === 'PENDENTE').reduce((s, i) => s + i.valor, 0);
  const totalEfetivada = items.filter(i => i.status === 'EFETIVADA').reduce((s, i) => s + i.valor, 0);

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Transferências entre Contas</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Movimentações entre contas bancárias da agência</p>
          </div>
          <Button onClick={openNew} className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
            <Plus className="w-4 h-4 mr-2" /> Nova Transferência
          </Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <ArrowRightLeft className="w-8 h-8 text-[var(--t-amber)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Pendente</p>
                <p className="text-xl font-bold text-[var(--t-amber)]">{BRL(totalPendente)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-4 flex items-center gap-4">
              <CheckCircle2 className="w-8 h-8 text-[var(--t-green)] shrink-0" />
              <div>
                <p className="text-[var(--t-text-muted)] text-xs uppercase">Efetivada</p>
                <p className="text-xl font-bold text-[var(--t-green)]">{BRL(totalEfetivada)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Bank Account Balances */}
        {contas.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {contas.map(c => (
              <div key={c.id} className="flex-shrink-0 px-4 py-2 rounded-lg bg-[var(--t-surface)] border border-[var(--t-border)] text-sm">
                <span className="text-[var(--t-text-secondary)]">{c.nome}</span>
                <span className="ml-2 font-mono font-medium text-[var(--t-text)]">{BRL(c.saldo_atual)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Form */}
        {showForm && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-green)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-green)] text-base">Nova Transferência</CardTitle>
              <button onClick={() => setShowForm(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 items-end">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Conta Origem *</label>
                  <select
                    value={contaOrigemId}
                    onChange={e => setContaOrigemId(e.target.value)}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="">Selecione</option>
                    {contas.map(c => (
                      <option key={c.id} value={c.id}>{c.nome} ({BRL(c.saldo_atual)})</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center justify-center">
                  <ArrowRight className="w-5 h-5 text-[var(--t-green)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Conta Destino *</label>
                  <select
                    value={contaDestinoId}
                    onChange={e => setContaDestinoId(e.target.value)}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="">Selecione</option>
                    {contas.filter(c => c.id !== contaOrigemId).map(c => (
                      <option key={c.id} value={c.id}>{c.nome} ({BRL(c.saldo_atual)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Valor *</label>
                  <Input
                    type="number" min={0} step="0.01"
                    value={valor}
                    onChange={e => setValor(parseFloat(e.target.value) || 0)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Data</label>
                  <Input
                    type="date"
                    value={data}
                    onChange={e => setData(e.target.value)}
                    className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Descrição</label>
                <Input
                  value={descricao}
                  onChange={e => setDescricao(e.target.value)}
                  placeholder="Ex: Transferência para conta investimento"
                  className="bg-[var(--t-input-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                />
              </div>
              <div className="flex gap-2 mt-4">
                <Button onClick={handleSave} className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] font-semibold">
                  <Check className="w-4 h-4 mr-1" /> Criar
                </Button>
                <Button variant="outline" onClick={() => setShowForm(false)} className="border-[var(--t-border)] text-[var(--t-text-secondary)]">
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Table */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-[var(--t-text)] text-base flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-[var(--t-green)]" />
              Transferências ({items.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="text-[var(--t-text-secondary)] text-sm p-6">Carregando...</p>
            ) : items.length === 0 ? (
              <p className="text-[var(--t-text-muted)] text-sm p-6 text-center">Nenhuma transferência registrada.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)] text-xs uppercase">
                      <th className="text-left px-4 py-3">Data</th>
                      <th className="text-left px-4 py-3">Origem</th>
                      <th className="text-center px-2 py-3"></th>
                      <th className="text-left px-4 py-3">Destino</th>
                      <th className="text-right px-4 py-3">Valor</th>
                      <th className="text-left px-4 py-3">Descrição</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.sort((a, b) => b.data.localeCompare(a.data)).map(item => (
                      <tr key={item.id} className="border-b border-[var(--t-border)] hover:bg-[var(--t-surface-hover)] transition-colors">
                        <td className="px-4 py-3 text-[var(--t-text-secondary)]">
                          {new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-4 py-3 text-[var(--t-text)]">{item.conta_origem_nome}</td>
                        <td className="px-2 py-3 text-center">
                          <ArrowRight className="w-4 h-4 text-[var(--t-green)] inline" />
                        </td>
                        <td className="px-4 py-3 text-[var(--t-text)]">{item.conta_destino_nome}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium text-[var(--t-text)]">{BRL(item.valor)}</td>
                        <td className="px-4 py-3 text-[var(--t-text-secondary)] max-w-xs truncate">{item.descricao || '—'}</td>
                        <td className="px-4 py-3">
                          <Badge className={`${STATUS_BADGE[item.status]} border-0 text-xs`}>{item.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {item.status === 'PENDENTE' && (
                              <>
                                <Button size="sm" onClick={() => handleEfetivar(item)}
                                  className="bg-[var(--t-green)] hover:brightness-110 text-white dark:text-[#0a0a14] h-7 px-3 text-xs">
                                  <Check className="w-3 h-3 mr-1" /> Efetivar
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => handleCancelar(item)}
                                  className="border-[var(--t-border)] text-[var(--t-text-secondary)] h-7 px-3 text-xs">
                                  Cancelar
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="outline" onClick={() => handleDelete(item.id)}
                              className="border-[var(--t-red)]/30 text-[var(--t-red)] hover:bg-[var(--t-red-bg)] h-7 px-2">
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
