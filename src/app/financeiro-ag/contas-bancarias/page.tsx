'use client';

import { useEffect, useState } from 'react';
import { ContaBancaria } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Plus, X, Check, Trash2, Pencil, Wallet, Building2, CreditCard,
  Banknote, PiggyBank, TrendingUp,
} from 'lucide-react';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const TIPO_LABEL: Record<ContaBancaria['tipo'], string> = {
  CORRENTE: 'Conta Corrente',
  POUPANCA: 'Poupança',
  CARTAO_CREDITO: 'Cartão de Crédito',
  CAIXA: 'Caixa',
  APLICACAO: 'Aplicação',
};

const TIPO_ICON: Record<ContaBancaria['tipo'], React.ReactNode> = {
  CORRENTE: <Building2 className="w-5 h-5" />,
  POUPANCA: <PiggyBank className="w-5 h-5" />,
  CARTAO_CREDITO: <CreditCard className="w-5 h-5" />,
  CAIXA: <Banknote className="w-5 h-5" />,
  APLICACAO: <TrendingUp className="w-5 h-5" />,
};

const TIPO_COLOR: Record<ContaBancaria['tipo'], string> = {
  CORRENTE: 'text-blue-400 bg-blue-900/30',
  POUPANCA: 'text-green-400 bg-green-900/30',
  CARTAO_CREDITO: 'text-purple-400 bg-purple-900/30',
  CAIXA: 'text-yellow-400 bg-yellow-900/30',
  APLICACAO: 'text-teal-400 bg-teal-900/30',
};

function createNewConta(): ContaBancaria {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
    nome: '',
    tipo: 'CORRENTE',
    banco: '',
    agencia: '',
    conta: '',
    saldo_inicial: 0,
    saldo_atual: 0,
    limite: 0,
    dia_fechamento: 0,
    dia_vencimento: 0,
  };
}

type FormState = {
  nome: string;
  tipo: ContaBancaria['tipo'];
  banco: string;
  agencia: string;
  conta: string;
  saldo_inicial: number;
};

const EMPTY_FORM: FormState = {
  nome: '',
  tipo: 'CORRENTE',
  banco: '',
  agencia: '',
  conta: '',
  saldo_inicial: 0,
};

export default function ContasBancariasPage() {
  const [items, setItems] = useState<ContaBancaria[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  async function load() {
    setLoading(true);
    const data = await loadEntities<ContaBancaria>('contas-bancarias');
    setItems(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(item: ContaBancaria) {
    setForm({
      nome: item.nome,
      tipo: item.tipo,
      banco: item.banco,
      agencia: item.agencia,
      conta: item.conta,
      saldo_inicial: item.saldo_inicial,
    });
    setEditId(item.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.nome) return;
    if (editId) {
      const existing = items.find(i => i.id === editId)!;
      const updated: ContaBancaria = {
        ...existing,
        nome: form.nome,
        tipo: form.tipo,
        banco: form.banco,
        agencia: form.agencia,
        conta: form.conta,
        saldo_inicial: form.saldo_inicial,
      };
      await updateEntity('contas-bancarias', updated);
    } else {
      const nova: ContaBancaria = {
        ...createNewConta(),
        nome: form.nome,
        tipo: form.tipo,
        banco: form.banco,
        agencia: form.agencia,
        conta: form.conta,
        saldo_inicial: form.saldo_inicial,
        saldo_atual: form.saldo_inicial,
      };
      await saveEntity('contas-bancarias', nova);
    }
    setShowForm(false);
    setEditId(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Confirmar exclusão desta conta?')) return;
    await deleteEntity('contas-bancarias', id);
    load();
  }

  const totalSaldo = items.reduce((s, i) => s + i.saldo_atual, 0);

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#d4a853]">Contas Bancárias</h1>
            <p className="text-gray-400 text-sm mt-1">Gestão de contas e saldos da agência</p>
          </div>
          <Button
            onClick={openNew}
            className="bg-[#d4a853] hover:bg-[#c49843] text-[#1a1a2e] font-semibold"
          >
            <Plus className="w-4 h-4 mr-2" /> Nova Conta
          </Button>
        </div>

        {/* Total Saldo Card */}
        <Card className="bg-[#16213e] border-[#d4a853]/30">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-[#d4a853]/10 rounded-xl">
              <Wallet className="w-7 h-7 text-[#d4a853]" />
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wide">Saldo Total Consolidado</p>
              <p className={`text-3xl font-bold mt-0.5 ${totalSaldo >= 0 ? 'text-[#d4a853]' : 'text-red-400'}`}>
                {BRL(totalSaldo)}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-gray-500 text-xs">{items.length} conta{items.length !== 1 ? 's' : ''} cadastrada{items.length !== 1 ? 's' : ''}</p>
            </div>
          </CardContent>
        </Card>

        {/* Inline Form */}
        {showForm && (
          <Card className="bg-[#16213e] border-[#d4a853]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[#d4a853] text-base">
                {editId ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}
              </CardTitle>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Nome da Conta *</label>
                  <Input
                    value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder="Ex: Bradesco PJ Principal"
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Tipo</label>
                  <select
                    value={form.tipo}
                    onChange={e => setForm(f => ({ ...f, tipo: e.target.value as ContaBancaria['tipo'] }))}
                    className="w-full bg-[#1a1a2e] border border-gray-600 rounded px-3 py-2 text-sm text-white"
                  >
                    <option value="CORRENTE">Conta Corrente</option>
                    <option value="POUPANCA">Poupança</option>
                    <option value="CARTAO_CREDITO">Cartão de Crédito</option>
                    <option value="CAIXA">Caixa</option>
                    <option value="APLICACAO">Aplicação</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Banco</label>
                  <Input
                    value={form.banco}
                    onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}
                    placeholder="Ex: Bradesco, Itaú, Nubank"
                    className="bg-[#1a1a2e] border-gray-600 text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Agência</label>
                  <Input
                    value={form.agencia}
                    onChange={e => setForm(f => ({ ...f, agencia: e.target.value }))}
                    placeholder="0000-0"
                    className="bg-[#1a1a2e] border-gray-600 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Conta</label>
                  <Input
                    value={form.conta}
                    onChange={e => setForm(f => ({ ...f, conta: e.target.value }))}
                    placeholder="00000000-0"
                    className="bg-[#1a1a2e] border-gray-600 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Saldo Inicial (R$)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.saldo_inicial}
                    onChange={e => setForm(f => ({ ...f, saldo_inicial: parseFloat(e.target.value) || 0 }))}
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

        {/* Cards Grid */}
        {loading ? (
          <p className="text-gray-400 text-sm">Carregando...</p>
        ) : items.length === 0 ? (
          <Card className="bg-[#16213e] border-gray-700">
            <CardContent className="p-12 text-center">
              <Wallet className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Nenhuma conta bancária cadastrada.</p>
              <p className="text-gray-600 text-xs mt-1">Clique em "Nova Conta" para adicionar.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(item => (
              <Card
                key={item.id}
                className="bg-[#16213e] border-gray-700 hover:border-[#d4a853]/40 transition-colors group"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${TIPO_COLOR[item.tipo]}`}>
                        {TIPO_ICON[item.tipo]}
                      </div>
                      <div>
                        <CardTitle className="text-white text-base leading-tight">{item.nome}</CardTitle>
                        <p className="text-gray-500 text-xs mt-0.5">{item.banco || 'Banco não informado'}</p>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(item)}
                        className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
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
                  <div className="space-y-3">
                    {/* Saldo */}
                    <div className="bg-[#1a1a2e] rounded-lg p-3">
                      <p className="text-gray-500 text-xs uppercase tracking-wide">Saldo Atual</p>
                      <p className={`text-xl font-bold mt-0.5 ${item.saldo_atual >= 0 ? 'text-white' : 'text-red-400'}`}>
                        {BRL(item.saldo_atual)}
                      </p>
                      {item.saldo_inicial !== item.saldo_atual && (
                        <p className="text-gray-600 text-xs mt-1">
                          Inicial: {BRL(item.saldo_inicial)}
                        </p>
                      )}
                    </div>

                    {/* Info row */}
                    <div className="flex items-center justify-between">
                      <Badge className="bg-gray-700 text-gray-300 border-0 text-xs">
                        {TIPO_LABEL[item.tipo]}
                      </Badge>
                      {(item.agencia || item.conta) && (
                        <span className="text-gray-600 text-xs font-mono">
                          {item.agencia && `Ag ${item.agencia}`}
                          {item.agencia && item.conta && ' · '}
                          {item.conta && `Cc ${item.conta}`}
                        </span>
                      )}
                    </div>

                    {/* Credit card specific */}
                    {item.tipo === 'CARTAO_CREDITO' && item.limite > 0 && (
                      <div className="text-xs text-gray-500">
                        <span>Limite: </span>
                        <span className="text-gray-300">{BRL(item.limite)}</span>
                        {item.dia_vencimento > 0 && (
                          <span className="ml-2">· Vence dia {item.dia_vencimento}</span>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
