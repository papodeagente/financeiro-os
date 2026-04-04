'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Pencil, Trash2, X, ChevronDown, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Membro, createMembro } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const CARGO_OPTIONS = [
  'vendedor',
  'gerente',
  'supervisor',
  'atendente',
  'financeiro',
  'operacional',
  'diretoria',
  'outros',
];

export default function EquipePage() {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'ATIVO' | 'INATIVO'>('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Membro>(createMembro());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadEntities<Membro>('membros');
    setMembros(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = membros.filter((m) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      m.nome.toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q) ||
      m.cargo.toLowerCase().includes(q) ||
      m.cpf.includes(q);
    const matchStatus = !filterStatus || m.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const openNew = () => {
    setForm(createMembro());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (m: Membro) => {
    setForm({ ...m });
    setEditingId(m.id);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.nome.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateEntity<Membro>('membros', form);
        setMembros((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      } else {
        const created = await saveEntity<Membro>('membros', form);
        setMembros((prev) => [created, ...prev]);
      }
      closeForm();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteEntity('membros', id);
    setMembros((prev) => prev.filter((m) => m.id !== id));
    setConfirmDelete(null);
  };

  const setField = <K extends keyof Membro>(key: K, value: Membro[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const cargoLabel = (cargo: string) =>
    cargo.charAt(0).toUpperCase() + cargo.slice(1);

  const ativos = membros.filter((m) => m.status === 'ATIVO').length;

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-accent)]">Equipe</h1>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">
            {ativos} membro{ativos !== 1 ? 's' : ''} ativo{ativos !== 1 ? 's' : ''} de {membros.length} cadastrado{membros.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          onClick={openNew}
          className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold gap-2"
        >
          <Plus size={16} /> Novo Membro
        </Button>
      </div>

      {/* Stats strip */}
      {!loading && membros.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Total de Membros', value: membros.length },
            { label: 'Ativos', value: ativos },
            {
              label: 'Meta Total Mensal',
              value: BRL(membros.filter((m) => m.status === 'ATIVO').reduce((s, m) => s + m.meta_mensal_vendas, 0)),
            },
            {
              label: 'Qtd. Meta Mensal',
              value: membros.filter((m) => m.status === 'ATIVO').reduce((s, m) => s + m.meta_mensal_quantidade, 0),
            },
          ].map((stat) => (
            <Card key={stat.label} className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
              <CardContent className="p-4">
                <p className="text-xs text-[var(--t-text-secondary)]">{stat.label}</p>
                <p className="text-lg font-bold text-[var(--t-accent)] mt-1">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)] mb-4">
        <CardContent className="p-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t-text-secondary)]" />
            <Input
              className="pl-9 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-secondary)]"
              placeholder="Buscar por nome, e-mail ou cargo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="relative">
            <select
              className="appearance-none bg-[var(--t-bg)] border border-[var(--t-border)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as '' | 'ATIVO' | 'INATIVO')}
            >
              <option value="">Todos os status</option>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t-text-secondary)] pointer-events-none" />
          </div>
        </CardContent>
      </Card>

      {/* Inline Form */}
      {showForm && (
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-accent)]/40 mb-4">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-[var(--t-accent)]">
                {editingId ? 'Editar Membro' : 'Novo Membro da Equipe'}
              </h2>
              <button onClick={closeForm} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Nome */}
              <div className="sm:col-span-2">
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Nome Completo *</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.nome}
                  onChange={(e) => setField('nome', e.target.value)}
                />
              </div>

              {/* CPF */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">CPF</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.cpf}
                  onChange={(e) => setField('cpf', e.target.value)}
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">E-mail</label>
                <Input
                  type="email"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                />
              </div>

              {/* Telefone */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Telefone</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.telefone}
                  onChange={(e) => setField('telefone', e.target.value)}
                />
              </div>

              {/* Cargo */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Cargo</label>
                <select
                  className="w-full bg-[var(--t-bg)] border border-[var(--t-border)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
                  value={form.cargo}
                  onChange={(e) => setField('cargo', e.target.value)}
                >
                  {CARGO_OPTIONS.map((c) => (
                    <option key={c} value={c}>{cargoLabel(c)}</option>
                  ))}
                </select>
              </div>

              {/* Data de Admissão */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Data de Admissão</label>
                <Input
                  type="date"
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.data_admissao}
                  onChange={(e) => setField('data_admissao', e.target.value)}
                />
              </div>

              {/* Meta Mensal Vendas */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Meta Mensal (R$)</label>
                <Input
                  type="number"
                  min={0}
                  step={100}
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.meta_mensal_vendas}
                  onChange={(e) => setField('meta_mensal_vendas', Number(e.target.value))}
                />
              </div>

              {/* Meta Mensal Quantidade */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Meta Mensal (Qtd. Vendas)</label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.meta_mensal_quantidade}
                  onChange={(e) => setField('meta_mensal_quantidade', Number(e.target.value))}
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Status</label>
                <select
                  className="w-full bg-[var(--t-bg)] border border-[var(--t-border)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
                  value={form.status}
                  onChange={(e) => setField('status', e.target.value as 'ATIVO' | 'INATIVO')}
                >
                  <option value="ATIVO">Ativo</option>
                  <option value="INATIVO">Inativo</option>
                </select>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[var(--t-border)]">
              <Button
                variant="outline"
                className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                onClick={closeForm}
              >
                Cancelar
              </Button>
              <Button
                className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold min-w-[100px]"
                onClick={handleSave}
                disabled={saving || !form.nome.trim()}
              >
                {saving ? 'Salvando...' : editingId ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[var(--t-text-secondary)]">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--t-text-secondary)]">
              <Users size={40} className="mb-3 opacity-30" />
              <p>Nenhum membro encontrado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)] text-[var(--t-text-secondary)] text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Nome</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Cargo</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">E-mail</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Telefone</th>
                    <th className="text-right px-4 py-3 hidden lg:table-cell">Meta Mensal</th>
                    <th className="text-right px-4 py-3 hidden xl:table-cell">Meta Qtd.</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => (
                    <tr
                      key={m.id}
                      className="border-b border-[var(--t-border)]/50 hover:bg-[var(--t-bg)]/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--t-text)]">{m.nome}</div>
                        {m.data_admissao && (
                          <div className="text-xs text-[var(--t-text-secondary)]">
                            Desde {new Date(m.data_admissao + 'T00:00:00').toLocaleDateString('pt-BR')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="px-2 py-0.5 rounded bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] text-xs">
                          {cargoLabel(m.cargo)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden md:table-cell">{m.email}</td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden lg:table-cell">{m.telefone}</td>
                      <td className="px-4 py-3 text-right text-[var(--t-accent)] font-medium hidden lg:table-cell">
                        {BRL(m.meta_mensal_vendas)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--t-text-secondary)] hidden xl:table-cell">
                        {m.meta_mensal_quantidade}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            m.status === 'ATIVO'
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                              : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/20'
                          }
                        >
                          {m.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(m)}
                            className="p-1.5 rounded hover:bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] hover:text-[var(--t-accent)] transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          {confirmDelete === m.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(m.id)}
                                className="px-2 py-1 rounded bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30"
                              >
                                Confirmar
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-2 py-1 rounded bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] text-xs"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(m.id)}
                              className="p-1.5 rounded hover:bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
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

      {/* Summary */}
      {!loading && filtered.length > 0 && (
        <p className="text-xs text-[var(--t-text-secondary)] mt-3 text-right">
          Exibindo {filtered.length} de {membros.length} membro{membros.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
