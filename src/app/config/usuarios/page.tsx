'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Users, Plus, Pencil, Trash2, X, Save, Loader2, ShieldCheck, Eye, EyeOff,
  Crown, UserCircle, Briefcase, Check, X as XIcon, Shield,
} from 'lucide-react';
import { Usuario, PerfilUsuario } from '@/lib/crm-types';
import { PERFIS, permissoesParaPerfil, perfilCanonico } from '@/lib/permissoes';
import { loadEntities, saveEntity, updateEntity, deleteEntity } from '@/lib/crm-storage';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';

const ENDPOINT = 'usuarios';

const PERFIL_ICONS: Record<'ADMIN' | 'OPERADOR' | 'VENDEDOR', React.ComponentType<{ className?: string }>> = {
  ADMIN: Crown,
  OPERADOR: UserCircle,
  VENDEDOR: Briefcase,
};

const PERFIL_BADGE: Record<'ADMIN' | 'OPERADOR' | 'VENDEDOR', string> = {
  ADMIN: 'bg-red-500/10 text-red-600 border-red-500/30',
  OPERADOR: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  VENDEDOR: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
};

function newUsuario(): Usuario {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9),
    nome: '',
    email: '',
    senha_hash: '',
    perfil: 'VENDEDOR',
    permissoes: permissoesParaPerfil('VENDEDOR'),
    ativo: true,
  };
}

export default function UsuariosPage() {
  const { user: currentUser } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Usuario | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const isAdmin = currentUser?.perfil === 'ADMIN';

  useEffect(() => {
    loadEntities<Usuario>(ENDPOINT).then((items) => {
      setUsuarios(items);
      setLoading(false);
    });
  }, []);

  function handleNew() {
    if (!isAdmin) {
      toast.error('Apenas administradores podem criar usuários');
      return;
    }
    setEditing(newUsuario());
    setIsNew(true);
    setShowPassword(false);
  }

  function handleEdit(u: Usuario) {
    if (!isAdmin) {
      toast.error('Apenas administradores podem editar usuários');
      return;
    }
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

  // Ao mudar o perfil, sobrescreve permissões pelo set padrão do perfil.
  function changePerfil(novoPerfil: PerfilUsuario) {
    setEditing((prev) => {
      if (!prev) return prev;
      return { ...prev, perfil: novoPerfil, permissoes: permissoesParaPerfil(novoPerfil) };
    });
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const toSave = { ...editing };
      // Garante permissões coerentes com o perfil na hora de salvar
      toSave.permissoes = permissoesParaPerfil(toSave.perfil);

      if (toSave.senha_hash && !toSave.senha_hash.includes(':')) {
        if (toSave.senha_hash.length < 6) {
          toast.error('A senha deve ter no mínimo 6 caracteres');
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
          toast.error('Erro ao processar senha');
          setSaving(false);
          return;
        }
      } else if (!toSave.senha_hash && !isNew) {
        const existing = usuarios.find(u => u.id === toSave.id);
        if (existing) toSave.senha_hash = existing.senha_hash;
      }

      if (isNew) {
        if (!toSave.senha_hash) {
          toast.error('Defina uma senha para o novo usuário');
          setSaving(false);
          return;
        }
        const saved = await saveEntity<Usuario>(ENDPOINT, toSave);
        setUsuarios((prev) => [...prev, saved]);
        toast.success(`Usuário ${saved.nome} criado`);
      } else {
        const updated = await updateEntity<Usuario>(ENDPOINT, toSave);
        setUsuarios((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
        toast.success('Alterações salvas');
      }
      setEditing(null);
      setIsNew(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!isAdmin) {
      toast.error('Apenas administradores podem excluir usuários');
      return;
    }
    if (id === currentUser?.id) {
      toast.error('Você não pode excluir a si mesmo');
      return;
    }
    if (!confirm('Excluir este usuário? Essa ação não pode ser desfeita.')) return;
    setDeletingId(id);
    try {
      await deleteEntity(ENDPOINT, id);
      setUsuarios((prev) => prev.filter((u) => u.id !== id));
      toast.success('Usuário excluído');
    } finally {
      setDeletingId(null);
    }
  }

  // Promover/Rebaixar inline (sem abrir form)
  async function quickChangePerfil(u: Usuario, novoPerfil: PerfilUsuario) {
    if (!isAdmin) return;
    if (u.id === currentUser?.id) {
      toast.error('Você não pode alterar seu próprio perfil');
      return;
    }
    const updated: Usuario = {
      ...u,
      perfil: novoPerfil,
      permissoes: permissoesParaPerfil(novoPerfil),
    };
    const saved = await updateEntity<Usuario>(ENDPOINT, updated);
    setUsuarios((prev) => prev.map(x => x.id === saved.id ? saved : x));
    toast.success(`${u.nome} agora é ${perfilCanonico(novoPerfil).toLowerCase()}`);
  }

  const editingCanon = editing ? perfilCanonico(editing.perfil) : null;

  return (
    <div className="bg-[var(--t-bg)] text-[var(--t-text)] p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)] flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              Usuários
            </h1>
            <p className="text-[var(--t-text-secondary)] text-sm mt-1">
              Adicione operadores e vendedores. Todo usuário começa como Vendedor — promova a Operador ou Administrador quando precisar.
            </p>
          </div>
          {!editing && (
            <Button
              onClick={handleNew}
              disabled={!isAdmin}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-2 disabled:opacity-50"
              title={isAdmin ? 'Adicionar novo usuário' : 'Apenas administradores'}
            >
              <Plus className="w-4 h-4" />
              Novo Usuário
            </Button>
          )}
        </div>

        {/* Guia dos 3 perfis */}
        {!editing && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {PERFIS.map(p => {
              const Icon = PERFIL_ICONS[p.id];
              const perms = permissoesParaPerfil(p.id);
              return (
                <div key={p.id} className="bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-7 h-7 rounded-md flex items-center justify-center ${PERFIL_BADGE[p.id]}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="font-semibold text-[var(--t-text)]">{p.label}</span>
                  </div>
                  <p className="text-[12px] text-[var(--t-text-secondary)] mb-3">{p.descricao}</p>
                  <ul className="space-y-1 text-[11px]">
                    <PermRow ok={perms.ver_vendas_todos} label="Ver todas as vendas" />
                    <PermRow ok={perms.ver_financeiro} label="Acessar financeiro" />
                    <PermRow ok={perms.acessar_relatorios} label="Ver relatórios" />
                    <PermRow ok={perms.pode_excluir} label="Excluir registros" />
                    <PermRow ok={perms.pode_exportar} label="Exportar (PDF/Excel)" />
                    <PermRow ok={perms.gerenciar_usuarios} label="Gerenciar usuários" />
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {/* Edit / New Form */}
        {editing && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
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
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">E-mail</label>
                  <Input
                    type="email"
                    value={editing.email}
                    onChange={(e) => setEditField('email', e.target.value)}
                    placeholder="email@agencia.com.br"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Senha</label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={editing.senha_hash}
                      onChange={(e) => setEditField('senha_hash', e.target.value)}
                      placeholder={isNew ? 'Senha de acesso (mín. 6)' : 'Deixe em branco para manter'}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--t-text-secondary)]"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1 flex items-end">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={editing.ativo}
                      onClick={() => setEditField('ativo', !editing.ativo)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        editing.ativo ? 'bg-blue-600' : 'bg-slate-300'
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
                  </label>
                </div>
              </div>

              {/* Perfil — 3 cards radio-style */}
              <div className="space-y-2">
                <p className="text-xs text-[var(--t-text-secondary)] uppercase tracking-wide">Perfil</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {PERFIS.map(p => {
                    const Icon = PERFIL_ICONS[p.id];
                    const isSelected = editingCanon === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => changePerfil(p.id)}
                        className={`text-left p-3 rounded-lg border-2 transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`w-6 h-6 rounded flex items-center justify-center ${PERFIL_BADGE[p.id]}`}>
                            <Icon className="w-3 h-3" />
                          </span>
                          <span className="font-semibold text-[var(--t-text)] text-sm">{p.label}</span>
                          {isSelected && <Check className="w-4 h-4 text-blue-600 ml-auto" />}
                        </div>
                        <p className="text-[11px] text-[var(--t-text-secondary)]">{p.descricao}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preview de permissões */}
              <PermissoesPreview perms={editing.permissoes} />

              {/* Form actions */}
              <div className="flex items-center gap-3 pt-2">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? 'Salvando...' : 'Salvar'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleCancel}
                  className="gap-2"
                >
                  <X className="w-4 h-4" />
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* User List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4 text-blue-600" />
              Usuários da agência
              <span className="ml-auto text-xs font-normal text-[var(--t-text-secondary)]">
                {usuarios.length} {usuarios.length === 1 ? 'usuário' : 'usuários'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              </div>
            ) : usuarios.length === 0 ? (
              <div className="text-center py-12 text-[var(--t-text-secondary)]">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhum usuário cadastrado.</p>
                <p className="text-xs mt-1">Clique em &quot;Novo Usuário&quot; para começar.</p>
              </div>
            ) : (
              <UsuariosTable
                usuarios={usuarios}
                isAdmin={isAdmin}
                currentUserId={currentUser?.id}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onQuickPerfil={quickChangePerfil}
                deletingId={deletingId}
              />
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

function PermRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      {ok ? (
        <Check className="w-3 h-3 text-emerald-600 shrink-0" />
      ) : (
        <XIcon className="w-3 h-3 text-slate-300 shrink-0" />
      )}
      <span className={ok ? 'text-[var(--t-text)]' : 'text-slate-400 line-through'}>{label}</span>
    </li>
  );
}

function PermissoesPreview({ perms }: { perms: Usuario['permissoes'] }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <p className="text-[10px] uppercase font-semibold text-slate-600 mb-2 inline-flex items-center gap-1">
        <Shield className="w-3 h-3" /> Permissões aplicadas pelo perfil
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 text-[12px]">
        <PermRow ok={perms.ver_vendas_todos} label="Ver vendas de todos" />
        <PermRow ok={perms.ver_financeiro} label="Ver financeiro" />
        <PermRow ok={perms.editar_financeiro} label="Editar financeiro" />
        <PermRow ok={perms.ver_comissoes} label="Ver comissões" />
        <PermRow ok={perms.acessar_relatorios} label="Acessar relatórios" />
        <PermRow ok={perms.gerenciar_usuarios} label="Gerenciar usuários" />
        <PermRow ok={perms.pode_excluir} label="Excluir registros" />
        <PermRow ok={perms.pode_exportar} label="Exportar (PDF/Excel)" />
      </ul>
    </div>
  );
}

function UsuariosTable({
  usuarios, isAdmin, currentUserId, onEdit, onDelete, onQuickPerfil, deletingId,
}: {
  usuarios: Usuario[];
  isAdmin: boolean;
  currentUserId?: string;
  onEdit: (u: Usuario) => void;
  onDelete: (id: string) => void;
  onQuickPerfil: (u: Usuario, p: PerfilUsuario) => void;
  deletingId: string | null;
}) {
  const sorted = useMemo(() => [...usuarios].sort((a, b) => {
    // ADMIN primeiro, depois alfabetico
    const ac = perfilCanonico(a.perfil); const bc = perfilCanonico(b.perfil);
    if (ac !== bc) {
      const order = { ADMIN: 0, OPERADOR: 1, VENDEDOR: 2 };
      return order[ac] - order[bc];
    }
    return (a.nome || '').localeCompare(b.nome || '');
  }), [usuarios]);

  return (
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
        <tbody className="divide-y divide-[var(--t-border)]">
          {sorted.map((u) => {
            const canon = perfilCanonico(u.perfil);
            const Icon = PERFIL_ICONS[canon];
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id} className="hover:bg-[var(--t-surface-hover)]/50 group">
                <td className="py-3 pr-4 font-medium">
                  {u.nome || '—'}
                  {isSelf && <span className="ml-2 text-[10px] text-blue-600 font-semibold">(você)</span>}
                </td>
                <td className="py-3 pr-4 text-[var(--t-text-secondary)]">{u.email || '—'}</td>
                <td className="py-3 pr-4">
                  {isAdmin && !isSelf ? (
                    <select
                      value={canon}
                      onChange={e => onQuickPerfil(u, e.target.value as PerfilUsuario)}
                      className={`text-xs font-medium border rounded px-2 py-1 cursor-pointer ${PERFIL_BADGE[canon]}`}
                    >
                      {PERFIS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                  ) : (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${PERFIL_BADGE[canon]}`}>
                      <Icon className="w-3 h-3" />
                      {PERFIS.find(p => p.id === canon)?.label}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4">
                  <Badge
                    className={
                      u.ativo
                        ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30'
                        : 'bg-slate-500/10 text-slate-500 border border-slate-500/30'
                    }
                  >
                    {u.ativo ? 'Ativo' : 'Inativo'}
                  </Badge>
                </td>
                <td className="py-3 text-right">
                  {isAdmin && (
                    <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" variant="ghost" onClick={() => onEdit(u)} className="h-7 w-7 p-0">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {!isSelf && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDelete(u.id)}
                          disabled={deletingId === u.id}
                          className="h-7 w-7 p-0 hover:text-red-500 hover:bg-red-500/10"
                        >
                          {deletingId === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
