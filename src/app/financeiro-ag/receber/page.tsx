'use client';

import { useEffect, useState } from 'react';
import { ContaReceber, createContaReceber, StatusContaReceber } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Plus, X, Check, Trash2, TrendingUp, Clock, AlertCircle, DollarSign,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const STATUS_BADGE: Record<StatusContaReceber, string> = {
  PENDENTE: 'bg-yellow-100 text-yellow-800',
  RECEBIDO: 'bg-green-100 text-green-800',
  ATRASADO: 'bg-red-100 text-red-800',
  CANCELADO: 'bg-gray-200 text-gray-600',
  PARCIAL: 'bg-blue-100 text-blue-800',
};

type FormState = Omit<ContaReceber,
  'id' | 'juros' | 'multa' | 'desconto' | 'valor_final' | 'data_emissao' |
  'data_recebimento' | 'valor_recebido' | 'conta_bancaria_id' |
  'boleto_emitido' | 'boleto_codigo' | 'boleto_url' | 'status' |
  'rateio' | 'anexos' | 'venda_id' | 'grupo_id' | 'cliente_id' | 'centro_custo'
>;

const EMPTY_FORM: FormState = {
  origem: 'VENDA',
  cliente_nome: '',
  descricao: '',
  categoria_id: '',
  valor_original: 0,
  data_vencimento: '',
  forma_recebimento: '',
  parcela_numero: 1,
  total_parcelas: 1,
  observacoes: '',
};

export default function ContasReceberPage() {
  const [items, setItems] = useState<ContaReceber[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [filterStatus, setFilterStatus] = useState<StatusContaReceber | 'TODOS'>('TODOS');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  async function load() {
    setLoading(true);
    const data = await loadEntities<ContaReceber>('contas-receber');
    setItems(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(item: ContaReceber) {
    setForm({
      origem: item.origem,
      cliente_nome: item.cliente_nome,
      descricao: item.descricao,
      categoria_id: item.categoria_id,
      valor_original: item.valor_original,
      data_vencimento: item.data_vencimento,
      forma_recebimento: item.forma_recebimento,
      parcela_numero: item.parcela_numero,
      total_parcelas: item.total_parcelas,
      observacoes: item.observacoes,
    });
    setEditId(item.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.cliente_nome || !form.descricao || !form.data_vencimento || form.valor_original <= 0) return;
    if (editId) {
      const existing = items.find(i => i.id === editId)!;
      const updated: ContaReceber = {
        ...existing,
        ...form,
        valor_final: form.valor_original,
      };
      await updateEntity('contas-receber', updated);
    } else {
      const nova: ContaReceber = {
        ...createContaReceber(),
        ...form,
        valor_final: form.valor_original,
      };
      await saveEntity('contas-receber', nova);
    }
    setShowForm(false);
    setEditId(null);
    load();
  }

  async function handleBaixar(item: ContaReceber) {
    const updated: ContaReceber = {
      ...item,
      status: 'RECEBIDO',
      data_recebimento: new Date().toISOString().split('T')[0],
      valor_recebido: item.valor_final,
    };
    await updateEntity('contas-receber', updated);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Confirmar exclusão?')) return;
    await deleteEntity('contas-receber', id);
    load();
  }

  const filtered = items.filter(i => {
    if (filterStatus !== 'TODOS' && i.status !== filterStatus) return false;
    if (filterDateFrom && i.data_vencimento < filterDateFrom) return false;
    if (filterDateTo && i.data_vencimento > filterDateTo) return false;
    return true;
  });

  const totalPendente = items.filter(i => i.status === 'PENDENTE').reduce((s, i) => s + i.valor_final, 0);
  const totalRecebido = items.filter(i => i.status === 'RECEBIDO').reduce((s, i) => s + (i.valor_recebido ?? i.valor_final), 0);
  const totalAtrasado = items.filter(i => i.status === 'ATRASADO').reduce((s, i) => s + i.valor_final, 0);

  const STATUSES: Array<StatusContaReceber | 'TODOS'> = ['TODOS', 'PENDENTE', 'RECEBIDO', 'ATRASADO', 'CANCELADO', 'PARCIAL'];

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#d4a853]">Contas a Receber</h1>
            <p className="text-gray-400 text-sm mt-1">Gestão de recebíveis da agência</p>
          </div>
          <Button
            onClick={openNew}
            className="bg-[#d4a853] hover:bg-[#c49843] text-[#1a1a2e] font-semibold"
          >
            <Plus className="w-4 h-4 mr-2" /> Nova Conta
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-[#16213e] border-yellow-500/30">
            <CardContent className="p-4 flex items-center gap-4">
              <Clock className="w-8 h-8 text-yellow-400 shrink-0" />
              <div>
                <p className="text-gray-400 text-xs uppercase">Pendente</p>
                <p className="text-xl font-bold text-yellow-400">{BRL(totalPendente)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#16213e] border-green-500/30">
            <CardContent className="p-4 flex items-center gap-4">
              <TrendingUp className="w-8 h-8 text-green-400 shrink-0" />
              <div>
                <p className="text-gray-400 text-xs uppercase">Recebido</p>
                <p className="text-xl font-bold text-green-400">{BRL(totalRecebido)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#16213e] border-red-500/30">
            <CardContent className="p-4 flex items-center gap-4">
              <AlertCircle className="w-8 h-8 text-red-400 shrink-0" />
              <div>
                <p className="text-gray-400 text-xs uppercase">Atrasado</p>
                <p className="text-xl font-bold text-red-400">{BRL(totalAtrasado)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Inline Form */}
        {showForm && (
          <Card className="bg-[#16213e] border-[#d4a853]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[#d4a853] text-base">
                {editId ? 'Editar Conta' : 'Nova Conta a Receber'}
              </CardTitle>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Origem</label>
                  <select
                    value={form.origem}
                    onChange={e => setForm(f => ({ ...f, origem: e.target.value as ContaReceber['origem'] }))}
                    className="w-full bg-[#1a1a2e] border border-gray-600 rounded px-3 py-2 text-sm text-white"
                  >
                    <option value="VENDA">Venda</option>
                    <option value="COMISSAO_FORNECEDOR">Comissão Fornecedor</option>
                    <option value="FEE">Fee</option>
                    <option value="OUTROS">Outros</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Cliente *</label>
                  <Input
                    value={form.cliente_nome}
                    onChange={e => setForm(f => ({ ...f, cliente_nome: e.target.value }))}
                    placeholder="Nome do cliente"
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Descrição *</label>
                  <Input
                    value={form.descricao}
                    onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                    placeholder="Descrição"
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Categoria ID</label>
                  <Input
                    value={form.categoria_id}
                    onChange={e => setForm(f => ({ ...f, categoria_id: e.target.value }))}
                    placeholder="ID da categoria"
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Valor (R$) *</label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.valor_original}
                    onChange={e => setForm(f => ({ ...f, valor_original: parseFloat(e.target.value) || 0 }))}
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Vencimento *</label>
                  <Input
                    type="date"
                    value={form.data_vencimento}
                    onChange={e => setForm(f => ({ ...f, data_vencimento: e.target.value }))}
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Forma de Recebimento</label>
                  <select
                    value={form.forma_recebimento}
                    onChange={e => setForm(f => ({ ...f, forma_recebimento: e.target.value as ContaReceber['forma_recebimento'] }))}
                    className="w-full bg-[#1a1a2e] border border-gray-600 rounded px-3 py-2 text-sm text-white"
                  >
                    <option value="">Selecione</option>
                    <option value="PIX">PIX</option>
                    <option value="TED">TED</option>
                    <option value="CARTAO">Cartão</option>
                    <option value="BOLETO">Boleto</option>
                    <option value="DINHEIRO">Dinheiro</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Parcela nº</label>
                  <Input
                    type="number"
                    min={1}
                    value={form.parcela_numero}
                    onChange={e => setForm(f => ({ ...f, parcela_numero: parseInt(e.target.value) || 1 }))}
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Total Parcelas</label>
                  <Input
                    type="number"
                    min={1}
                    value={form.total_parcelas}
                    onChange={e => setForm(f => ({ ...f, total_parcelas: parseInt(e.target.value) || 1 }))}
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="text-xs text-gray-400 mb-1 block">Observações</label>
                  <Input
                    value={form.observacoes}
                    onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
                    placeholder="Observações"
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={handleSave}
                  className="bg-[#d4a853] hover:bg-[#c49843] text-[#1a1a2e] font-semibold"
                >
                  <Check className="w-4 h-4 mr-1" /> {editId ? 'Salvar' : 'Criar'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  className="border-gray-600 text-gray-300 hover:bg-gray-700"
                >
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card className="bg-[#16213e] border-gray-700">
          <CardContent className="p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Status</label>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value as StatusContaReceber | 'TODOS')}
                className="bg-[#1a1a2e] border border-gray-600 rounded px-3 py-2 text-sm text-white"
              >
                {STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Vencimento De</label>
              <Input
                type="date"
                value={filterDateFrom}
                onChange={e => setFilterDateFrom(e.target.value)}
                className="bg-[#1a1a2e] border-gray-600 text-white w-40"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Vencimento Até</label>
              <Input
                type="date"
                value={filterDateTo}
                onChange={e => setFilterDateTo(e.target.value)}
                className="bg-[#1a1a2e] border-gray-600 text-white w-40"
              />
            </div>
            {(filterStatus !== 'TODOS' || filterDateFrom || filterDateTo) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setFilterStatus('TODOS'); setFilterDateFrom(''); setFilterDateTo(''); }}
                className="border-gray-600 text-gray-300 hover:bg-gray-700"
              >
                <X className="w-3 h-3 mr-1" /> Limpar
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="bg-[#16213e] border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[#d4a853]" />
              Lançamentos ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="text-gray-400 text-sm p-6">Carregando...</p>
            ) : filtered.length === 0 ? (
              <p className="text-gray-500 text-sm p-6 text-center">Nenhum lançamento encontrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
                      <th className="text-left px-4 py-3">Cliente</th>
                      <th className="text-left px-4 py-3">Descrição</th>
                      <th className="text-right px-4 py-3">Valor</th>
                      <th className="text-left px-4 py-3">Vencimento</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(item => (
                      <tr key={item.id} className="border-b border-gray-700/50 hover:bg-[#1a1a2e]/40 transition-colors">
                        <td className="px-4 py-3 font-medium text-white">{item.cliente_nome || '—'}</td>
                        <td className="px-4 py-3 text-gray-300 max-w-xs truncate">{item.descricao}</td>
                        <td className="px-4 py-3 text-right font-mono text-white">{BRL(item.valor_final)}</td>
                        <td className="px-4 py-3 text-gray-300">
                          {item.data_vencimento
                            ? new Date(item.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={`${STATUS_BADGE[item.status]} border-0 text-xs`}>
                            {item.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {item.status === 'PENDENTE' || item.status === 'ATRASADO' || item.status === 'PARCIAL' ? (
                              <Button
                                size="sm"
                                onClick={() => handleBaixar(item)}
                                className="bg-green-600 hover:bg-green-700 text-white h-7 px-3 text-xs"
                              >
                                <Check className="w-3 h-3 mr-1" /> Baixar
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEdit(item)}
                              className="border-gray-600 text-gray-300 hover:bg-gray-700 h-7 px-3 text-xs"
                            >
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(item.id)}
                              className="border-red-700 text-red-400 hover:bg-red-900/30 h-7 px-2"
                            >
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
