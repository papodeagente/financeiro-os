'use client';

import { useState, useEffect } from 'react';
import {
  Users, Plus, Pencil, Trash2, X, Save, Loader2, ShieldCheck, Eye, EyeOff,
} from 'lucide-react';
import { Usuario } from '@/lib/crm-types';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

const ENDPOINT = 'usuarios';

const PERFIL_LABELS: Record<Usuario['perfil'], string> = {
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  VENDEDOR: 'Vendedor',
  FINANCEIRO: 'Financeiro',
  VISUALIZADOR: 'Visualizador',
};

const PERFIL_COLORS: Record<Usuario['perfil'], string> = {
  ADMIN: 'bg-red-900/40 text-red-300 border-red-800',
  GERENTE: 'bg-purple-900/40 text-purple-300 border-purple-800',
  VENDEDOR: 'bg-blue-900/40 text-blue-300 border-blue-800',
  FINANCEIRO: 'bg-green-900/40 text-green-300 border-green-800',
  VISUALIZADOR: 'bg-[var(--t-surface)]/40 text-[var(--t-text-secondary)] border-[var(--t-border)]',
};

const PERMISSOES_LABELS: { key: keyof Omit<Usuario['permissoes'], 'ver_extrato_contas'>; label: string }[] = [
  { key: 'ver_vendas_todos', label: 'Ver vendas de todos' },
  { key: 'ver_financeiro', label: 'Ver financeiro' },
  { key: 'editar_financeiro', label: 'Editar financeiro' },
  { key: 'ver_comissoes', label: 'Ver comissões' },
  { key: 'acessar_relatorios', label: 'Acessar relatórios' },
  { key: 'gerenciar_usuarios', label: 'Gerenciar usuários' },
];

function newUsuario(): Usuario {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
    nome: '',
    email: '',
    senha_hash: '',
    perfil: 'VENDEDOR',
    permissoes: {
      ver_vendas_todos: false,
      ver_financeiro: false,
      editar_financeiro: false,
      ver_comissoes: false,
      acessar_relatorios: false,
      gerenciar_usuarios: false,
      ver_extrato_contas: [],
    },
    ativo: true,
  };
}

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Usuario | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    loadEntities<Usuario>(ENDPOINT).then((items) => {
      setUsuarios(items);
      setLoading(false);
    });
  }, []);

  function handleNew() {
    setEditing(newUsuario());
    setIsNew(true);
    setShowPassword(false);
  }

  function handleEdit(u: Usuario) {
    setEditing({ ...u });
    setIsNew(false);
    setShowPassword(false);
  }

  function handleCancel() {
    setEditing(null);
    setIsNew(false);
  }

  function setEditField<K extends keyof Usuario>(key: K, value: Usuario[K]) {
    setEditing((prev) => prev ? { ...prev, [key]: value } : prev);
  }

  function setPermissao(key: keyof Omit<Usuario['permissoes'], 'ver_extrato_contas'>, value: boolean) {
    setEditing((prev) => {
      if (!prev) return prev;
      return { ...prev, permissoes: { ...prev.permissoes, [key]: value } };
    });
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const toSave = { ...editing };

      // Hash password if it was changed (not empty and not already a hash)
      if (toSave.senha_hash && !toSave.senha_hash.includes(':')) {
        if (toSave.senha_hash.length < 6) {
          alert('A senha deve ter no minimo 6 caracteres');
          setSaving(false);
          return;
        }
        const hashRes = await fetch('/api/auth/hash-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: toSave.senha_hash }),
        });
        if (hashRes.ok) {
          const { hash } = await hashRes.json();
          toSave.senha_hash = hash;
        } else {
          alert('Erro ao processar senha');
          setSaving(false);
          return;
        }
      } else if (!toSave.senha_hash && !isNew) {
        // Editing user without changing password — keep existing hash
        const existing = usuarios.find(u => u.id === toSave.id);
        if (existing) toSave.senha_hash = existing.senha_hash;
      }

      if (isNew) {
        const saved = await saveEntity<Usuario>(ENDPOINT, toSave);
        setUsuarios((prev) => [...prev, saved]);
      } else {
        const updated = await updateEntity<Usuario>(ENDPOINT, toSave);
        setUsuarios((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      }
      setEditing(null);
      setIsNew(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deseja excluir este usuário?')) return;
    setDeletingId(id);
    try {
      await deleteEntity(ENDPOINT, id);
      setUsuarios((prev) => prev.filter((u) => u.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)]">Usuários</h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">Gerenciamento de acesso e permissões</p>
          </div>
          {!editing && (
            <Button
              onClick={handleNew}
              className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold gap-2"
            >
              <Plus className="w-4 h-4" />
              Novo Usuário
            </Button>
          )}
        </div>

        {/* Edit / New Form */}
        {editing && (
          <Card className="bg-[var(--t-header-bg)] border-[var(--t-accent)]/40">
            <CardHeader className="pb-3">
              <CardTitle className="text-[var(--t-accent)] flex items-center gap-2 text-base">
                <ShieldCheck className="w-4 h-4" />
                {isNew ? 'Novo Usuário' : `Editando: ${editing.nome || 'sem nome'}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">

              {/* Basic fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Nome</label>
                  <Input
                    value={editing.nome}
                    onChange={(e) => setEditField('nome', e.target.value)}
                    placeholder="Nome completo"
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">E-mail</label>
                  <Input
                    type="email"
                    value={editing.email}
                    onChange={(e) => setEditField('email', e.target.value)}
                    placeholder="email@agencia.com.br"
                    className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Perfil</label>
                  <select
                    value={editing.perfil}
                    onChange={(e) => setEditField('perfil', e.target.value as Usuario['perfil'])}
                    className="w-full h-10 rounded-md border border-[var(--t-border)] bg-[var(--t-bg)] text-[var(--t-text)] px-3 text-sm focus:outline-none focus:border-[var(--t-accent)]"
                  >
                    {(Object.keys(PERFIL_LABELS) as Usuario['perfil'][]).map((p) => (
                      <option key={p} value={p}>{PERFIL_LABELS[p]}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Senha</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={editing.senha_hash}
                      onChange={(e) => setEditField('senha_hash', e.target.value)}
                      placeholder={isNew ? 'Senha de acesso' : 'Deixe em branco para manter'}
                      className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] placeholder:text-[var(--t-text-muted)] focus:border-[var(--t-accent)] pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--t-text-secondary)] hover:text-[var(--t-text-secondary)]"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Ativo toggle */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={editing.ativo}
                  onClick={() => setEditField('ativo', !editing.ativo)}
                  className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${
                    editing.ativo ? 'bg-[var(--t-accent)]' : 'bg-[var(--t-surface-hover)]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      editing.ativo ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
                <span className="text-sm text-[var(--t-text-secondary)]">
                  Usuário {editing.ativo ? 'ativo' : 'inativo'}
                </span>
              </div>

              {/* Permissions */}
              <div className="space-y-2">
                <p className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Permissões</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PERMISSOES_LABELS.map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex items-center gap-3 cursor-pointer group"
                    >
                      <input
                        type="checkbox"
                        checked={editing.permissoes[key]}
                        onChange={(e) => setPermissao(key, e.target.checked)}
                        className="w-4 h-4 rounded border-[var(--t-border)] bg-[var(--t-bg)] accent-[#d4a853] cursor-pointer"
                      />
                      <span className="text-sm text-[var(--t-text-secondary)] group-hover:text-[var(--t-text)] transition-colors">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Form actions */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-[var(--t-accent)] hover:opacity-90 text-[var(--t-text)] font-semibold gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Salvando...' : 'Salvar'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleCancel}
                  className="text-[var(--t-text-secondary)] hover:text-[var(--t-text)] gap-2"
                >
                  <X className="w-4 h-4" />
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* User List */}
        <Card className="bg-[var(--t-header-bg)] border-[var(--t-border)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-[var(--t-accent)] flex items-center gap-2 text-base">
              <Users className="w-4 h-4" />
              Usuários Cadastrados
              <span className="ml-auto text-xs font-normal text-[var(--t-text-secondary)]">
                {usuarios.length} {usuarios.length === 1 ? 'usuário' : 'usuários'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-[var(--t-accent)] animate-spin" />
              </div>
            ) : usuarios.length === 0 ? (
              <div className="text-center py-12 text-[var(--t-text-secondary)]">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhum usuário cadastrado.</p>
                <p className="text-xs mt-1">Clique em &quot;Novo Usuário&quot; para começar.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--t-border)]">
                      <th className="text-left text-xs text-[var(--t-text-secondary)] uppercase tracking-wide py-2 pr-4">Nome</th>
                      <th className="text-left text-xs text-[var(--t-text-secondary)] uppercase tracking-wide py-2 pr-4">E-mail</th>
                      <th className="text-left text-xs text-[var(--t-text-secondary)] uppercase tracking-wide py-2 pr-4">Perfil</th>
                      <th className="text-left text-xs text-[var(--t-text-secondary)] uppercase tracking-wide py-2 pr-4">Status</th>
                      <th className="text-right text-xs text-[var(--t-text-secondary)] uppercase tracking-wide py-2">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2a2a4e]/50">
                    {usuarios.map((u) => (
                      <tr key={u.id} className="hover:bg-[var(--t-bg)]/50 transition-colors group">
                        <td className="py-3 pr-4 font-medium text-[var(--t-text)]">{u.nome || '—'}</td>
                        <td className="py-3 pr-4 text-[var(--t-text-secondary)]">{u.email || '—'}</td>
                        <td className="py-3 pr-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${PERFIL_COLORS[u.perfil]}`}>
                            {PERFIL_LABELS[u.perfil]}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            className={
                              u.ativo
                                ? 'bg-green-900/40 text-green-300 border border-green-800 hover:bg-green-900/40'
                                : 'bg-[var(--t-surface)]/40 text-[var(--t-text-secondary)] border border-[var(--t-border)] hover:bg-[var(--t-surface)]/40'
                            }
                          >
                            {u.ativo ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </td>
                        <td className="py-3 text-right">
                          <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEdit(u)}
                              className="h-7 w-7 p-0 text-[var(--t-text-secondary)] hover:text-[var(--t-accent)] hover:bg-[var(--t-accent)]/10"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(u.id)}
                              disabled={deletingId === u.id}
                              className="h-7 w-7 p-0 text-[var(--t-text-secondary)] hover:text-red-400 hover:bg-red-400/10"
                            >
                              {deletingId === u.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Trash2 className="w-3.5 h-3.5" />
                              }
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
