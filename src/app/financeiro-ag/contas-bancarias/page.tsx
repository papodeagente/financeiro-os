'use client';

import { useEffect, useState } from 'react';
import { ContaBancaria } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
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
    <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        <MinimalPageHead
          title="Contas bancárias"
          meta={<p className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Gestão de contas e saldos da agência</p>}
          actions={
            <button
              onClick={openNew}
              className="h-[34px] px-3 text-[12px] font-medium"
              style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
            >
              <Plus className="w-3.5 h-3.5 inline mr-2" /> Nova conta
            </button>
          }
        />

        {/* Total Saldo Card */}
        <Card className="bg-[var(--t-surface)] border-[var(--t-accent)]/30">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="p-3 bg-[var(--t-accent)]/10 rounded-xl">
              <Wallet className="w-7 h-7 text-[var(--t-accent)]" />
            </div>
            <div>
              <p className="text-[var(--t-text-secondary)] text-xs uppercase tracking-wide">Saldo Total Consolidado</p>
              <p className={`text-3xl font-bold mt-0.5 ${totalSaldo >= 0 ? 'text-[var(--t-accent)]' : 'text-red-400'}`}>
                {BRL(totalSaldo)}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[var(--t-text-secondary)] text-xs">{items.length} conta{items.length !== 1 ? 's' : ''} cadastrada{items.length !== 1 ? 's' : ''}</p>
            </div>
          </CardContent>
        </Card>

        {/* Inline Form */}
        {showForm && (
          <Card className="bg-[var(--t-surface)] border-[var(--t-accent)]/40">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-[var(--t-accent)] text-base">
                {editId ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}
              </CardTitle>
              <button onClick={() => setShowForm(false)} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X className="w-4 h-4" />
              </button>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Nome da Conta *</label>
                  <Input
                    value={form.nome}
                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                    placeholder="Ex: Bradesco PJ Principal"
                    className="bg-[var(--t-header-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Tipo</label>
                  <select
                    value={form.tipo}
                    onChange={e => setForm(f => ({ ...f, tipo: e.target.value as ContaBancaria['tipo'] }))}
                    className="w-full bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded px-3 py-2 text-sm text-[var(--t-text)]"
                  >
                    <option value="CORRENTE">Conta Corrente</option>
                    <option value="POUPANCA">Poupança</option>
                    <option value="CARTAO_CREDITO">Cartão de Crédito</option>
                    <option value="CAIXA">Caixa</option>
                    <option value="APLICACAO">Aplicação</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Banco</label>
                  <Input
                    value={form.banco}
                    onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}
                    placeholder="Ex: Bradesco, Itaú, Nubank"
                    className="bg-[var(--t-header-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Agência</label>
                  <Input
                    value={form.agencia}
                    onChange={e => setForm(f => ({ ...f, agencia: e.target.value }))}
                    placeholder="0000-0"
                    className="bg-[var(--t-header-bg)] border-[var(--t-border)] text-[var(--t-text)] font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Conta</label>
                  <Input
                    value={form.conta}
                    onChange={e => setForm(f => ({ ...f, conta: e.target.value }))}
                    placeholder="00000000-0"
                    className="bg-[var(--t-header-bg)] border-[var(--t-border)] text-[var(--t-text)] font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Saldo Inicial (R$)</label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.saldo_inicial}
                    onChange={e => setForm(f => ({ ...f, saldo_inicial: parseFloat(e.target.value) || 0 }))}
                    className="bg-[var(--t-header-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  />
                </div>
              </div>
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

        {/* Cards Grid */}
        {loading ? (
          <p className="text-[var(--t-text-secondary)] text-sm">Carregando...</p>
        ) : items.length === 0 ? (
          <Card className="bg-[var(--t-surface)] border-[var(--t-border)]">
            <CardContent className="p-12 text-center">
              <Wallet className="w-12 h-12 text-[var(--t-text-muted)] mx-auto mb-3" />
              <p className="text-[var(--t-text-secondary)] text-sm">Nenhuma conta bancária cadastrada.</p>
              <p className="text-[var(--t-text-muted)] text-xs mt-1">Clique em "Nova Conta" para adicionar.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(item => (
              <Card
                key={item.id}
                className="bg-[var(--t-surface)] border-[var(--t-border)] hover:border-[var(--t-accent)]/40 transition-colors group"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${TIPO_COLOR[item.tipo]}`}>
                        {TIPO_ICON[item.tipo]}
                      </div>
                      <div>
                        <CardTitle className="text-[var(--t-text)] text-base leading-tight">{item.nome}</CardTitle>
                        <p className="text-[var(--t-text-secondary)] text-xs mt-0.5">{item.banco || 'Banco não informado'}</p>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(item)}
                        className="p-1.5 rounded text-[var(--t-text-secondary)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface)] transition-colors"
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
                    <div className="bg-[var(--t-header-bg)] rounded-lg p-3">
                      <p className="text-[var(--t-text-secondary)] text-xs uppercase tracking-wide">Saldo Atual</p>
                      <p className={`text-xl font-bold mt-0.5 ${item.saldo_atual >= 0 ? 'text-[var(--t-text)]' : 'text-red-400'}`}>
                        {BRL(item.saldo_atual)}
                      </p>
                      {item.saldo_inicial !== item.saldo_atual && (
                        <p className="text-[var(--t-text-muted)] text-xs mt-1">
                          Inicial: {BRL(item.saldo_inicial)}
                        </p>
                      )}
                    </div>

                    {/* Info row */}
                    <div className="flex items-center justify-between">
                      <Badge className="bg-[var(--t-surface)] text-[var(--t-text-secondary)] border-0 text-xs">
                        {TIPO_LABEL[item.tipo]}
                      </Badge>
                      {(item.agencia || item.conta) && (
                        <span className="text-[var(--t-text-muted)] text-xs font-mono">
                          {item.agencia && `Ag ${item.agencia}`}
                          {item.agencia && item.conta && ' · '}
                          {item.conta && `Cc ${item.conta}`}
                        </span>
                      )}
                    </div>

                    {/* Credit card specific */}
                    {item.tipo === 'CARTAO_CREDITO' && item.limite > 0 && (
                      <div className="text-xs text-[var(--t-text-secondary)]">
                        <span>Limite: </span>
                        <span className="text-[var(--t-text-secondary)]">{BRL(item.limite)}</span>
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

        <MinimalFooter pageId="contas bancárias" />
      </div>
    </div>
  );
}
