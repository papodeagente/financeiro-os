'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft, Loader2, Save, Upload, User as UserIcon, Mail, Phone, Check, X,
} from 'lucide-react';

export default function PerfilPage() {
  const router = useRouter();
  const { user, refresh } = useAuth();

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [foto, setFoto] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setNome(d.nome || '');
          setTelefone(d.telefone || '');
          setFoto(d.foto || '');
          setEmail(d.email || '');
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      setError('Selecione um arquivo de imagem.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('files', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Falha no upload');
      }
      const data = await res.json();
      const url = data[0]?.url;
      if (url) setFoto(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro no upload');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (!nome.trim()) {
      setError('Nome é obrigatório');
      return;
    }
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), telefone: telefone.trim(), foto }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Erro ao salvar');
      }
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }

  const inicial = (nome || user?.nome || 'U').charAt(0).toUpperCase();

  return (
    <div className="max-w-2xl mx-auto p-6">
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Voltar
      </button>

      <h1 className="text-2xl font-bold text-slate-900 mb-1">Meu perfil</h1>
      <p className="text-sm text-slate-600 mb-6">Atualize seu nome, foto e telefone de contato.</p>

      {error && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-900 flex items-start gap-2">
          <X className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={foto}
              alt={nome}
              className="w-20 h-20 rounded-full object-cover border-2 border-white shadow"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center text-white text-2xl font-bold border-2 border-white shadow">
              {inicial}
            </div>
          )}
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium disabled:opacity-60"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {uploading ? 'Enviando...' : 'Trocar foto'}
            </button>
            {foto && (
              <button
                onClick={() => setFoto('')}
                className="ml-2 text-xs text-red-500 hover:text-red-700"
              >
                Remover
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => handleUpload(e.target.files)}
            />
            <p className="text-[11px] text-slate-500 mt-1">JPG, PNG ou WebP até 25MB</p>
          </div>
        </div>

        <hr className="border-slate-100" />

        {/* Nome */}
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-slate-500 inline-flex items-center gap-1">
            <UserIcon className="w-3 h-3" /> Nome completo
          </span>
          <input
            type="text"
            value={nome}
            onChange={e => setNome(e.target.value)}
            placeholder="Seu nome"
            className="mt-1.5 w-full px-3 py-2 rounded-md border border-slate-200 text-sm outline-none focus:border-blue-400"
          />
        </label>

        {/* E-mail (somente leitura) */}
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-slate-500 inline-flex items-center gap-1">
            <Mail className="w-3 h-3" /> E-mail
          </span>
          <input
            type="email"
            value={email}
            disabled
            className="mt-1.5 w-full px-3 py-2 rounded-md border border-slate-200 bg-slate-50 text-sm text-slate-500"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Pra alterar o e-mail, peça ao administrador da agência.
          </p>
        </label>

        {/* Telefone */}
        <label className="block">
          <span className="text-[11px] font-semibold uppercase text-slate-500 inline-flex items-center gap-1">
            <Phone className="w-3 h-3" /> Telefone
          </span>
          <input
            type="tel"
            value={telefone}
            onChange={e => setTelefone(e.target.value)}
            placeholder="(11) 99999-9999"
            className="mt-1.5 w-full px-3 py-2 rounded-md border border-slate-200 text-sm outline-none focus:border-blue-400"
          />
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
              <Check className="w-4 h-4" /> Salvo
            </span>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar alterações
          </button>
        </div>
      </div>
    </div>
  );
}
