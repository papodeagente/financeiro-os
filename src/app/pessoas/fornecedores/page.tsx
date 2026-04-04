'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Pencil, Trash2, X, ChevronDown, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { FornecedorCRM, TipoFornecedor, createFornecedorCRM } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';

const TIPO_OPTIONS: { value: TipoFornecedor; label: string }[] = [
  { value: 'OPERADORA', label: 'Operadora' },
  { value: 'CONSOLIDADORA', label: 'Consolidadora' },
  { value: 'CIA_AEREA', label: 'Cia Aérea' },
  { value: 'HOTEL', label: 'Hotel' },
  { value: 'RECEPTIVO', label: 'Receptivo' },
  { value: 'SEGURADORA', label: 'Seguradora' },
  { value: 'LOCADORA', label: 'Locadora' },
  { value: 'CRUZEIRO', label: 'Cruzeiro' },
  { value: 'OUTROS', label: 'Outros' },
];

const TIPO_LABEL: Record<TipoFornecedor, string> = Object.fromEntries(
  TIPO_OPTIONS.map(({ value, label }) => [value, label])
) as Record<TipoFornecedor, string>;

const TIPO_COLOR: Record<TipoFornecedor, string> = {
  OPERADORA: 'bg-[var(--t-blue-bg)]0/20 text-blue-400 border-blue-500/30',
  CONSOLIDADORA: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  CIA_AEREA: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  HOTEL: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  RECEPTIVO: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  SEGURADORA: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  LOCADORA: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  CRUZEIRO: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  OUTROS: 'bg-[var(--t-surface-hover)]0/20 text-[var(--t-text-secondary)] border-[var(--t-border)]/30',
};

export default function FornecedoresPage() {
  const [fornecedores, setFornecedores] = useState<FornecedorCRM[]>([]);
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState<TipoFornecedor | ''>('');
  const [filterStatus, setFilterStatus] = useState<'' | 'ATIVO' | 'INATIVO'>('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FornecedorCRM>(createFornecedorCRM());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadEntities<FornecedorCRM>('fornecedores-crm');
    setFornecedores(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = fornecedores.filter((f) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      f.nome_fantasia.toLowerCase().includes(q) ||
      f.razao_social.toLowerCase().includes(q) ||
      f.cnpj.includes(q) ||
      f.email.toLowerCase().includes(q);
    const matchTipo = !filterTipo || f.tipo === filterTipo;
    const matchStatus = !filterStatus || f.status === filterStatus;
    return matchSearch && matchTipo && matchStatus;
  });

  const openNew = () => {
    setForm(createFornecedorCRM());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (f: FornecedorCRM) => {
    setForm({ ...f });
    setEditingId(f.id);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    const displayName = form.nome_fantasia.trim() || form.razao_social.trim();
    if (!displayName) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateEntity<FornecedorCRM>('fornecedores-crm', form);
        setFornecedores((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      } else {
        const created = await saveEntity<FornecedorCRM>('fornecedores-crm', form);
        setFornecedores((prev) => [created, ...prev]);
      }
      closeForm();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteEntity('fornecedores-crm', id);
    setFornecedores((prev) => prev.filter((f) => f.id !== id));
    setConfirmDelete(null);
  };

  const setField = <K extends keyof FornecedorCRM>(key: K, value: FornecedorCRM[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSave = !!(form.nome_fantasia.trim() || form.razao_social.trim());

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-accent)]">Fornecedores</h1>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">
            {fornecedores.length} fornecedor{fornecedores.length !== 1 ? 'es' : ''} cadastrado{fornecedores.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button
          onClick={openNew}
          className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold gap-2"
        >
          <Plus size={16} /> Novo Fornecedor
        </Button>
      </div>

      {/* Filters */}
      <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)] mb-4">
        <CardContent className="p-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t-text-secondary)]" />
            <Input
              className="pl-9 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-secondary)]"
              placeholder="Buscar por nome ou CNPJ..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="relative">
            <select
              className="appearance-none bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
              value={filterTipo}
              onChange={(e) => setFilterTipo(e.target.value as TipoFornecedor | '')}
            >
              <option value="">Todos os tipos</option>
              {TIPO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--t-text-secondary)] pointer-events-none" />
          </div>
          <div className="relative">
            <select
              className="appearance-none bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
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
                {editingId ? 'Editar Fornecedor' : 'Novo Fornecedor'}
              </h2>
              <button onClick={closeForm} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Tipo */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Tipo *</label>
                <select
                  className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
                  value={form.tipo}
                  onChange={(e) => setField('tipo', e.target.value as TipoFornecedor)}
                >
                  {TIPO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Razão Social */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Razão Social</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.razao_social}
                  onChange={(e) => setField('razao_social', e.target.value)}
                />
              </div>

              {/* Nome Fantasia */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Nome Fantasia *</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.nome_fantasia}
                  onChange={(e) => setField('nome_fantasia', e.target.value)}
                />
              </div>

              {/* CNPJ */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">CNPJ</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.cnpj}
                  onChange={(e) => setField('cnpj', e.target.value)}
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

              {/* WhatsApp */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">WhatsApp</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.whatsapp}
                  onChange={(e) => setField('whatsapp', e.target.value)}
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

              {/* Site */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Site</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  placeholder="https://"
                  value={form.site}
                  onChange={(e) => setField('site', e.target.value)}
                />
              </div>

              {/* Contato Principal */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Contato Principal</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.contato_principal}
                  onChange={(e) => setField('contato_principal', e.target.value)}
                />
              </div>

              {/* Endereço Completo */}
              <div className="sm:col-span-2">
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Endereço Completo</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.endereco_completo}
                  onChange={(e) => setField('endereco_completo', e.target.value)}
                />
              </div>

              {/* Cidade */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Cidade</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.cidade}
                  onChange={(e) => setField('cidade', e.target.value)}
                />
              </div>

              {/* Estado */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Estado</label>
                <Input
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  value={form.estado}
                  onChange={(e) => setField('estado', e.target.value)}
                  maxLength={2}
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Status</label>
                <select
                  className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
                  value={form.status}
                  onChange={(e) => setField('status', e.target.value as 'ATIVO' | 'INATIVO')}
                >
                  <option value="ATIVO">Ativo</option>
                  <option value="INATIVO">Inativo</option>
                </select>
              </div>

              {/* Observações */}
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Observações</label>
                <textarea
                  className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853] resize-none"
                  rows={3}
                  value={form.observacoes}
                  onChange={(e) => setField('observacoes', e.target.value)}
                />
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
                disabled={saving || !canSave}
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
              <Building2 size={40} className="mb-3 opacity-30" />
              <p>Nenhum fornecedor encontrado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)] text-[var(--t-text-secondary)] text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Nome</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">CNPJ</th>
                    <th className="text-left px-4 py-3">Tipo</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Telefone</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">E-mail</th>
                    <th className="text-left px-4 py-3 hidden xl:table-cell">Cidade/UF</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr
                      key={f.id}
                      className="border-b border-[var(--t-border)]/50 hover:bg-[var(--t-bg)]/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--t-text)]">
                          {f.nome_fantasia || f.razao_social}
                        </div>
                        {f.nome_fantasia && f.razao_social && (
                          <div className="text-xs text-[var(--t-text-secondary)]">{f.razao_social}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden sm:table-cell">{f.cnpj}</td>
                      <td className="px-4 py-3">
                        <Badge className={`${TIPO_COLOR[f.tipo]} text-xs hover:${TIPO_COLOR[f.tipo]}`}>
                          {TIPO_LABEL[f.tipo]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden md:table-cell">{f.telefone}</td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden lg:table-cell">{f.email}</td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden xl:table-cell">
                        {[f.cidade, f.estado].filter(Boolean).join(' / ')}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            f.status === 'ATIVO'
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                              : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/20'
                          }
                        >
                          {f.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(f)}
                            className="p-1.5 rounded hover:bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] hover:text-[var(--t-accent)] transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          {confirmDelete === f.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(f.id)}
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
                              onClick={() => setConfirmDelete(f.id)}
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
          Exibindo {filtered.length} de {fornecedores.length} fornecedor{fornecedores.length !== 1 ? 'es' : ''}
        </p>
      )}
    </div>
  );
}
