'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Pencil, Trash2, X, ChevronDown, User, Phone, MapPin, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Cliente, createCliente } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';

const BRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

type Tab = 'pessoais' | 'contato' | 'endereco' | 'preferencias';

const TIPO_VIAGEM_OPTIONS = ['Lazer', 'Negócios', 'Aventura', 'Cruzeiro', 'Lua de mel', 'Família'];
const CLASSE_VOO_OPTIONS = ['', 'Econômica', 'Executiva', 'Primeira Classe'];
const TIPO_HOTEL_OPTIONS = ['', '3 estrelas', '4 estrelas', '5 estrelas', 'Pousada', 'Resort'];
const ESTADO_CIVIL_OPTIONS = ['', 'Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União estável'];
const GENERO_OPTIONS: { value: '' | 'M' | 'F' | 'OUTRO'; label: string }[] = [
  { value: '', label: 'Não informado' },
  { value: 'M', label: 'Masculino' },
  { value: 'F', label: 'Feminino' },
  { value: 'OUTRO', label: 'Outro' },
];

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState<'' | 'PF' | 'PJ'>('');
  const [filterStatus, setFilterStatus] = useState<'' | 'ATIVO' | 'INATIVO'>('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Cliente>(createCliente());
  const [activeTab, setActiveTab] = useState<Tab>('pessoais');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [marcadorInput, setMarcadorInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadEntities<Cliente>('clientes');
    setClientes(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = clientes.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      c.nome_completo.toLowerCase().includes(q) ||
      c.cpf.includes(q) ||
      c.cnpj.includes(q) ||
      c.nome_fantasia.toLowerCase().includes(q);
    const matchTipo = !filterTipo || c.tipo === filterTipo;
    const matchStatus = !filterStatus || c.status === filterStatus;
    return matchSearch && matchTipo && matchStatus;
  });

  const openNew = () => {
    setForm(createCliente());
    setEditingId(null);
    setActiveTab('pessoais');
    setShowForm(true);
  };

  const openEdit = (c: Cliente) => {
    setForm({ ...c });
    setEditingId(c.id);
    setActiveTab('pessoais');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setMarcadorInput('');
  };

  const handleSave = async () => {
    if (!form.nome_completo.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateEntity<Cliente>('clientes', form);
        setClientes((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      } else {
        const created = await saveEntity<Cliente>('clientes', form);
        setClientes((prev) => [created, ...prev]);
      }
      closeForm();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteEntity('clientes', id);
    setClientes((prev) => prev.filter((c) => c.id !== id));
    setConfirmDelete(null);
  };

  const handleCepBlur = async () => {
    const cep = form.cep.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm((prev) => ({
          ...prev,
          logradouro: data.logradouro || prev.logradouro,
          bairro: data.bairro || prev.bairro,
          cidade: data.localidade || prev.cidade,
          estado: data.uf || prev.estado,
        }));
      }
    } catch {
      // silently fail
    } finally {
      setCepLoading(false);
    }
  };

  const setField = <K extends keyof Cliente>(key: K, value: Cliente[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const addMarcador = () => {
    const tag = marcadorInput.trim();
    if (tag && !form.marcadores.includes(tag)) {
      setField('marcadores', [...form.marcadores, tag]);
    }
    setMarcadorInput('');
  };

  const removeMarcador = (tag: string) =>
    setField('marcadores', form.marcadores.filter((m) => m !== tag));

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'pessoais', label: 'Dados Pessoais', icon: <User size={14} /> },
    { id: 'contato', label: 'Contato', icon: <Phone size={14} /> },
    { id: 'endereco', label: 'Endereço', icon: <MapPin size={14} /> },
    { id: 'preferencias', label: 'Preferências', icon: <Star size={14} /> },
  ];

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t-accent)]">Clientes</h1>
          <p className="text-sm text-[var(--t-text-secondary)] mt-1">{clientes.length} cliente{clientes.length !== 1 ? 's' : ''} cadastrado{clientes.length !== 1 ? 's' : ''}</p>
        </div>
        <Button
          onClick={openNew}
          className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold gap-2"
        >
          <Plus size={16} /> Novo Cliente
        </Button>
      </div>

      {/* Filters */}
      <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)] mb-4">
        <CardContent className="p-4 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t-text-secondary)]" />
            <Input
              className="pl-9 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-secondary)]"
              placeholder="Buscar por nome ou CPF/CNPJ..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="relative">
            <select
              className="appearance-none bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
              value={filterTipo}
              onChange={(e) => setFilterTipo(e.target.value as '' | 'PF' | 'PJ')}
            >
              <option value="">Todos os tipos</option>
              <option value="PF">Pessoa Física</option>
              <option value="PJ">Pessoa Jurídica</option>
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-[var(--t-accent)]">
                {editingId ? 'Editar Cliente' : 'Novo Cliente'}
              </h2>
              <button onClick={closeForm} className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)]">
                <X size={20} />
              </button>
            </div>

            {/* Tipo toggle */}
            <div className="flex gap-2 mb-5">
              {(['PF', 'PJ'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setField('tipo', t)}
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                    form.tipo === t
                      ? 'bg-[var(--t-accent)] text-[var(--t-text)]'
                      : 'bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] hover:text-[var(--t-text)]'
                  }`}
                >
                  {t === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                </button>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-5 border-b border-[var(--t-border)]">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    activeTab === t.id
                      ? 'border-[var(--t-accent)] text-[var(--t-accent)]'
                      : 'border-transparent text-[var(--t-text-secondary)] hover:text-[var(--t-text)]'
                  }`}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Tab: Dados Pessoais */}
            {activeTab === 'pessoais' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="sm:col-span-2 lg:col-span-2">
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">
                    {form.tipo === 'PF' ? 'Nome Completo *' : 'Razão Social *'}
                  </label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.tipo === 'PF' ? form.nome_completo : form.razao_social}
                    onChange={(e) =>
                      setField(form.tipo === 'PF' ? 'nome_completo' : 'razao_social', e.target.value)
                    }
                  />
                </div>
                {form.tipo === 'PJ' && (
                  <div>
                    <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Nome Fantasia</label>
                    <Input
                      className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                      value={form.nome_fantasia}
                      onChange={(e) => setField('nome_fantasia', e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">
                    {form.tipo === 'PF' ? 'CPF' : 'CNPJ'}
                  </label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.tipo === 'PF' ? form.cpf : form.cnpj}
                    onChange={(e) =>
                      setField(form.tipo === 'PF' ? 'cpf' : 'cnpj', e.target.value)
                    }
                  />
                </div>
                {form.tipo === 'PF' && (
                  <>
                    <div>
                      <label className="block text-xs text-[var(--t-text-secondary)] mb-1">RG</label>
                      <Input
                        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        value={form.rg}
                        onChange={(e) => setField('rg', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Data de Nascimento</label>
                      <Input
                        type="date"
                        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        value={form.data_nascimento}
                        onChange={(e) => setField('data_nascimento', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Gênero</label>
                      <select
                        className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
                        value={form.genero}
                        onChange={(e) => setField('genero', e.target.value as Cliente['genero'])}
                      >
                        {GENERO_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Estado Civil</label>
                      <select
                        className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
                        value={form.estado_civil}
                        onChange={(e) => setField('estado_civil', e.target.value)}
                      >
                        {ESTADO_CIVIL_OPTIONS.map((o) => (
                          <option key={o} value={o}>{o || 'Não informado'}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Passaporte</label>
                      <Input
                        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        value={form.passaporte}
                        onChange={(e) => setField('passaporte', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Validade Passaporte</label>
                      <Input
                        type="date"
                        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                        value={form.validade_passaporte}
                        onChange={(e) => setField('validade_passaporte', e.target.value)}
                      />
                    </div>
                  </>
                )}
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
            )}

            {/* Tab: Contato */}
            {activeTab === 'contato' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: 'Telefone Principal', key: 'telefone_principal' },
                  { label: 'Telefone Secundário', key: 'telefone_secundario' },
                  { label: 'WhatsApp', key: 'whatsapp' },
                  { label: 'E-mail Principal', key: 'email' },
                  { label: 'E-mail Secundário', key: 'email_secundario' },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <label className="block text-xs text-[var(--t-text-secondary)] mb-1">{label}</label>
                    <Input
                      className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                      value={(form as unknown as Record<string, unknown>)[key] as string}
                      onChange={(e) => setField(key as keyof Cliente, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Tab: Endereço */}
            {activeTab === 'endereco' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">
                    CEP {cepLoading && <span className="text-[var(--t-accent)] text-xs">(buscando...)</span>}
                  </label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.cep}
                    onChange={(e) => setField('cep', e.target.value)}
                    onBlur={handleCepBlur}
                    maxLength={9}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Logradouro</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.logradouro}
                    onChange={(e) => setField('logradouro', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Número</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.numero}
                    onChange={(e) => setField('numero', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Complemento</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.complemento}
                    onChange={(e) => setField('complemento', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Bairro</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.bairro}
                    onChange={(e) => setField('bairro', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Cidade</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.cidade}
                    onChange={(e) => setField('cidade', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Estado</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.estado}
                    onChange={(e) => setField('estado', e.target.value)}
                    maxLength={2}
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">País</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.pais}
                    onChange={(e) => setField('pais', e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Tab: Preferências */}
            {activeTab === 'preferencias' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Classe de Voo Preferida</label>
                  <select
                    className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
                    value={form.preferencias.classe_voo}
                    onChange={(e) =>
                      setField('preferencias', { ...form.preferencias, classe_voo: e.target.value })
                    }
                  >
                    {CLASSE_VOO_OPTIONS.map((o) => (
                      <option key={o} value={o}>{o || 'Não informado'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Tipo de Hotel</label>
                  <select
                    className="w-full bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#d4a853]"
                    value={form.preferencias.tipo_hotel}
                    onChange={(e) =>
                      setField('preferencias', { ...form.preferencias, tipo_hotel: e.target.value })
                    }
                  >
                    {TIPO_HOTEL_OPTIONS.map((o) => (
                      <option key={o} value={o}>{o || 'Não informado'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Assento Preferido</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    placeholder="Ex: janela, corredor"
                    value={form.preferencias.assento_preferido}
                    onChange={(e) =>
                      setField('preferencias', { ...form.preferencias, assento_preferido: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Restrições Alimentares</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.preferencias.restricoes_alimentares}
                    onChange={(e) =>
                      setField('preferencias', {
                        ...form.preferencias,
                        restricoes_alimentares: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Necessidades Especiais</label>
                  <Input
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                    value={form.preferencias.necessidades_especiais}
                    onChange={(e) =>
                      setField('preferencias', {
                        ...form.preferencias,
                        necessidades_especiais: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-2">Tipos de Viagem</label>
                  <div className="flex flex-wrap gap-2">
                    {TIPO_VIAGEM_OPTIONS.map((opt) => {
                      const selected = form.preferencias.tipo_viagem.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            const arr = selected
                              ? form.preferencias.tipo_viagem.filter((x) => x !== opt)
                              : [...form.preferencias.tipo_viagem, opt];
                            setField('preferencias', { ...form.preferencias, tipo_viagem: arr });
                          }}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            selected
                              ? 'bg-[var(--t-accent)] text-[var(--t-text)]'
                              : 'bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] text-[var(--t-text-secondary)] hover:border-[var(--t-accent)]'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-[var(--t-text-secondary)] mb-1">Marcadores / Tags</label>
                  <div className="flex gap-2 mb-2">
                    <Input
                      className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] flex-1"
                      placeholder="Adicionar marcador..."
                      value={marcadorInput}
                      onChange={(e) => setMarcadorInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMarcador(); } }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="border-[var(--t-border)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]"
                      onClick={addMarcador}
                    >
                      <Plus size={14} />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {form.marcadores.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] rounded text-xs"
                      >
                        {tag}
                        <button onClick={() => removeMarcador(tag)} className="hover:text-red-400">
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

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
                disabled={saving || !form.nome_completo.trim()}
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
              <User size={40} className="mb-3 opacity-30" />
              <p>Nenhum cliente encontrado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)] text-[var(--t-text-secondary)] text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-3">Nome</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">CPF/CNPJ</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Telefone</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">E-mail</th>
                    <th className="text-left px-4 py-3 hidden xl:table-cell">Cidade/UF</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-right px-4 py-3 hidden lg:table-cell">Total Compras</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-[var(--t-border)]/50 hover:bg-[var(--t-bg)]/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--t-text)]">{c.nome_completo || c.razao_social}</div>
                        <div className="text-xs text-[var(--t-text-secondary)]">{c.tipo === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}</div>
                      </td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden sm:table-cell">
                        {c.tipo === 'PF' ? c.cpf : c.cnpj}
                      </td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden md:table-cell">{c.telefone_principal}</td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden lg:table-cell">{c.email}</td>
                      <td className="px-4 py-3 text-[var(--t-text-secondary)] hidden xl:table-cell">
                        {[c.cidade, c.estado].filter(Boolean).join(' / ')}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={
                            c.status === 'ATIVO'
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                              : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/20'
                          }
                        >
                          {c.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--t-accent)] font-medium hidden lg:table-cell">
                        {BRL(c.valor_total_historico)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(c)}
                            className="p-1.5 rounded hover:bg-[var(--t-surface-hover)] text-[var(--t-text-secondary)] hover:text-[var(--t-accent)] transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          {confirmDelete === c.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDelete(c.id)}
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
                              onClick={() => setConfirmDelete(c.id)}
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
          Exibindo {filtered.length} de {clientes.length} cliente{clientes.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
