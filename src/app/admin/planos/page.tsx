'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Plus, Trash2, Check } from 'lucide-react';

interface Plano {
  id: string;
  slug: string;
  nome: string;
  descricao: string;
  preco_mensal: number | string;
  preco_anual: number | string;
  moeda: string;
  destaque: boolean;
  ordem: number;
  ativo: boolean;
  limites: Record<string, unknown>;
  features: string[];
}

export default function AdminPlanosPage() {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const carregar = () => {
    fetch('/api/admin/planos').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setPlanos(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(carregar, []);

  const updateLocal = (id: string, patch: Partial<Plano>) => {
    setPlanos(ps => ps.map(p => p.id === id ? { ...p, ...patch } : p));
  };

  const salvar = async (p: Plano) => {
    setSaving(p.id);
    try {
      await fetch(`/api/admin/planos/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: p.nome, descricao: p.descricao,
          preco_mensal: Number(p.preco_mensal), preco_anual: Number(p.preco_anual),
          moeda: p.moeda, destaque: p.destaque, ordem: Number(p.ordem),
          ativo: p.ativo, limites: p.limites, features: p.features,
        }),
      });
      setSavedAt(p.id);
      setTimeout(() => setSavedAt(null), 2000);
    } catch { /* ignore */ }
    setSaving(null);
  };

  const desativar = async (p: Plano) => {
    if (!confirm(`Desativar plano "${p.nome}"?`)) return;
    await fetch(`/api/admin/planos/${p.id}`, { method: 'DELETE' });
    carregar();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Planos do SaaS</h1>
          <p className="text-sm text-slate-600 mt-1">
            Edite preço, descrição, limites e features. As mudanças refletem imediatamente na landing e no signup.
          </p>
        </div>
        <button
          onClick={async () => {
            const slug = prompt('Slug do novo plano (sem espaços, ex: "premium")');
            if (!slug) return;
            await fetch('/api/admin/planos', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                slug: slug.toLowerCase(),
                nome: slug.charAt(0).toUpperCase() + slug.slice(1),
                descricao: '',
                preco_mensal: 0,
                ordem: 99,
                ativo: true,
                limites: { usuarios: 1, propostas_mes: 10, grupos: 1 },
                features: [],
              }),
            });
            carregar();
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
        >
          <Plus className="w-4 h-4" /> Novo plano
        </button>
      </div>

      <div className="space-y-6">
        {planos.map(p => (
          <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <input
                  className="text-xl font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 focus:outline-none px-1"
                  value={p.nome}
                  onChange={e => updateLocal(p.id, { nome: e.target.value })}
                />
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">{p.slug}</span>
                {p.destaque && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold uppercase">Destaque</span>
                )}
                {!p.ativo && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold uppercase">Inativo</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {savedAt === p.id && (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                    <Check className="w-3 h-3" /> Salvo
                  </span>
                )}
                <button
                  onClick={() => salvar(p)}
                  disabled={saving === p.id}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Salvar
                </button>
                <button
                  onClick={() => desativar(p)}
                  className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                  title="Desativar plano"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Descrição</Label>
                <textarea
                  rows={2}
                  value={p.descricao}
                  onChange={e => updateLocal(p.id, { descricao: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Preço mensal (R$)</Label>
                  <input
                    type="number" step="0.01"
                    value={p.preco_mensal}
                    onChange={e => updateLocal(p.id, { preco_mensal: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <Label>Preço anual (R$)</Label>
                  <input
                    type="number" step="0.01"
                    value={p.preco_anual}
                    onChange={e => updateLocal(p.id, { preco_anual: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Ordem</Label>
                  <input
                    type="number"
                    value={p.ordem}
                    onChange={e => updateLocal(p.id, { ordem: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={p.destaque}
                      onChange={e => updateLocal(p.id, { destaque: e.target.checked })}
                    />
                    Destaque
                  </label>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={p.ativo}
                      onChange={e => updateLocal(p.id, { ativo: e.target.checked })}
                    />
                    Ativo
                  </label>
                </div>
              </div>

              {/* Limites */}
              <div className="md:col-span-2">
                <Label>Limites (JSON — usuarios/propostas_mes/grupos: -1 = ilimitado)</Label>
                <textarea
                  rows={3}
                  value={JSON.stringify(p.limites, null, 2)}
                  onChange={e => {
                    try {
                      updateLocal(p.id, { limites: JSON.parse(e.target.value) });
                    } catch { /* ignore — usuario ainda editando */ }
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono resize-none"
                />
              </div>

              {/* Features */}
              <div className="md:col-span-2">
                <Label>Features (1 por linha — mostrados na landing/signup)</Label>
                <textarea
                  rows={Math.max(3, (p.features || []).length + 1)}
                  value={(p.features || []).join('\n')}
                  onChange={e => updateLocal(p.id, { features: e.target.value.split('\n').filter(Boolean) })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold text-slate-700 mb-1">{children}</div>
  );
}
