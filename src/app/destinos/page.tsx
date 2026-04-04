'use client';

import { useState, useEffect, useCallback } from 'react';
import { Destino, createDestino } from '@/lib/crm-types';
import {
  MapPin, Plus, Search, Trash2, Sparkles, Loader2, Save,
  ChevronDown, ChevronRight, Globe, X,
} from 'lucide-react';

export default function DestinosPage() {
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editando, setEditando] = useState<Destino | null>(null);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/destinos');
      const data = await res.json();
      if (Array.isArray(data)) setDestinos(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const salvar = async (destino: Destino) => {
    setSaving(true);
    try {
      await fetch('/api/destinos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(destino),
      });
      await load();
      setEditando(null);
    } catch { /* ignore */ }
    setSaving(false);
  };

  const excluir = async (id: string) => {
    if (!confirm('Excluir este destino?')) return;
    await fetch(`/api/destinos/${id}`, { method: 'DELETE' });
    await load();
  };

  const enriquecer = async () => {
    if (!editando?.nome) return;
    setEnriching(true);
    try {
      const res = await fetch('/api/destinos/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: editando.nome, pais: editando.pais }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
      } else {
        setEditando(prev => prev ? {
          ...prev,
          ...data,
          enriquecido: true,
          enriquecido_em: new Date().toISOString(),
        } : null);
      }
    } catch {
      alert('Erro ao enriquecer destino');
    }
    setEnriching(false);
  };

  const novo = () => {
    setEditando(createDestino());
  };

  const filtered = destinos.filter(d =>
    !search || d.nome.toLowerCase().includes(search.toLowerCase()) || d.pais.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--t-green)]" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--t-text)] flex items-center gap-2">
              <Globe className="w-6 h-6 text-[var(--t-green)]" />
              Banco de Destinos
            </h1>
            <p className="text-sm text-[var(--t-text-secondary)] mt-1">
              Conteúdo rico sobre destinos para auto-preenchimento de propostas
            </p>
          </div>
          <button
            onClick={novo}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> Novo Destino
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar destinos..."
            className="w-full pl-10 pr-4 py-2.5 bg-[var(--t-surface)] shadow-[var(--t-card-shadow)] rounded-lg text-sm text-[var(--t-text)]"
          />
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-[var(--t-text-secondary)]">
            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">Nenhum destino cadastrado</p>
            <p className="text-sm mt-1">Crie destinos e enriqueça com IA para usar nas propostas</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(d => (
              <div key={d.id} className="bg-[var(--t-surface)] rounded-lg shadow-[var(--t-card-shadow)] overflow-hidden">
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--t-surface-hover)] transition-colors"
                  onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                >
                  {expandedId === d.id ? <ChevronDown className="w-4 h-4 text-[var(--t-text-muted)]" /> : <ChevronRight className="w-4 h-4 text-[var(--t-text-muted)]" />}
                  <MapPin className="w-4 h-4 text-[var(--t-green)]" />
                  <span className="font-medium text-[var(--t-text)]">{d.nome}</span>
                  {d.pais && <span className="text-sm text-[var(--t-text-secondary)]">— {d.pais}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    {d.enriquecido && (
                      <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Sparkles className="w-2.5 h-2.5" /> IA
                      </span>
                    )}
                    {d.fast_facts.length > 0 && (
                      <span className="text-[10px] text-[var(--t-text-muted)]">{d.fast_facts.length} facts</span>
                    )}
                  </div>
                </div>

                {expandedId === d.id && (
                  <div className="px-4 pb-4 border-t border-[var(--t-border)]">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                      {d.idioma && <div><span className="text-[10px] text-[var(--t-text-muted)] block">Idioma</span><span className="text-[var(--t-text)]">{d.idioma}</span></div>}
                      {d.moeda && <div><span className="text-[10px] text-[var(--t-text-muted)] block">Moeda</span><span className="text-[var(--t-text)]">{d.moeda}</span></div>}
                      {d.fuso && <div><span className="text-[10px] text-[var(--t-text-muted)] block">Fuso</span><span className="text-[var(--t-text)]">{d.fuso}</span></div>}
                      {d.melhor_epoca && <div><span className="text-[10px] text-[var(--t-text-muted)] block">Melhor época</span><span className="text-[var(--t-text)]">{d.melhor_epoca}</span></div>}
                    </div>
                    {d.descricao && (
                      <p className="text-sm text-[var(--t-text-secondary)] mt-3 line-clamp-3">{d.descricao}</p>
                    )}
                    {d.fast_facts.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {d.fast_facts.map((f, i) => (
                          <span key={i} className="text-[11px] bg-[var(--t-bg)] shadow-[var(--t-card-shadow)] px-2 py-1 rounded text-[var(--t-text)]">
                            <strong>{f.label}:</strong> {f.valor}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditando(d); }}
                        className="px-3 py-1.5 text-sm bg-[var(--t-green)]/10 text-[var(--t-green)] rounded-lg hover:bg-[var(--t-green)]/20"
                      >
                        Editar
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); excluir(d.id); }}
                        className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-400/10 rounded-lg flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Excluir
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Edit Modal */}
        {editando && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditando(null)}>
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
            <div
              className="relative bg-[var(--t-surface)] rounded-xl shadow-[var(--t-card-shadow)] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--t-border)]">
                <h2 className="text-lg font-semibold text-[var(--t-text)] flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-[var(--t-green)]" />
                  {editando.id && destinos.some(d => d.id === editando.id) ? 'Editar Destino' : 'Novo Destino'}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={enriquecer}
                    disabled={enriching || !editando.nome}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/10 text-purple-400 text-sm rounded-lg hover:bg-purple-500/20 disabled:opacity-40"
                  >
                    {enriching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Enriquecer via IA
                  </button>
                  <button onClick={() => setEditando(null)} className="text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Nome do Destino *</label>
                    <input
                      value={editando.nome}
                      onChange={e => setEditando({ ...editando, nome: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                      placeholder="Ex: Lisboa, Porto, Toscana..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">País</label>
                    <input
                      value={editando.pais}
                      onChange={e => setEditando({ ...editando, pais: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                      placeholder="Ex: Portugal, Itália..."
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Descrição</label>
                  <textarea
                    value={editando.descricao}
                    onChange={e => setEditando({ ...editando, descricao: e.target.value })}
                    rows={4}
                    className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)] resize-none"
                    placeholder="Descrição rica do destino..."
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Idioma</label>
                    <input
                      value={editando.idioma}
                      onChange={e => setEditando({ ...editando, idioma: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Moeda</label>
                    <input
                      value={editando.moeda}
                      onChange={e => setEditando({ ...editando, moeda: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Fuso horário</label>
                    <input
                      value={editando.fuso}
                      onChange={e => setEditando({ ...editando, fuso: e.target.value })}
                      className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Clima</label>
                  <textarea
                    value={editando.clima}
                    onChange={e => setEditando({ ...editando, clima: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)] resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Melhor época</label>
                  <input
                    value={editando.melhor_epoca}
                    onChange={e => setEditando({ ...editando, melhor_epoca: e.target.value })}
                    className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)]"
                  />
                </div>

                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Gastronomia</label>
                  <textarea
                    value={editando.gastronomia}
                    onChange={e => setEditando({ ...editando, gastronomia: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)] resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs text-[var(--t-text-secondary)] mb-1 block">Dicas para viajantes</label>
                  <textarea
                    value={editando.dicas}
                    onChange={e => setEditando({ ...editando, dicas: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded-lg text-sm text-[var(--t-text)] resize-none"
                  />
                </div>

                {/* Fast Facts */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-[var(--t-text-secondary)]">Fast Facts</label>
                    <button
                      onClick={() => setEditando({ ...editando, fast_facts: [...editando.fast_facts, { label: '', valor: '' }] })}
                      className="text-[10px] text-[var(--t-green)] hover:underline flex items-center gap-0.5"
                    >
                      <Plus className="w-3 h-3" /> Adicionar
                    </button>
                  </div>
                  <div className="space-y-2">
                    {editando.fast_facts.map((f, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <input
                          value={f.label}
                          onChange={e => {
                            const ff = [...editando.fast_facts];
                            ff[i] = { ...ff[i], label: e.target.value };
                            setEditando({ ...editando, fast_facts: ff });
                          }}
                          className="w-1/3 px-2 py-1.5 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded text-xs text-[var(--t-text)]"
                          placeholder="Label"
                        />
                        <input
                          value={f.valor}
                          onChange={e => {
                            const ff = [...editando.fast_facts];
                            ff[i] = { ...ff[i], valor: e.target.value };
                            setEditando({ ...editando, fast_facts: ff });
                          }}
                          className="flex-1 px-2 py-1.5 bg-[var(--t-input-bg)] border border-[var(--t-border)] rounded text-xs text-[var(--t-text)]"
                          placeholder="Valor"
                        />
                        <button
                          onClick={() => setEditando({ ...editando, fast_facts: editando.fast_facts.filter((_, j) => j !== i) })}
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-5 py-3 border-t border-[var(--t-border)] flex justify-end gap-3">
                <button
                  onClick={() => setEditando(null)}
                  className="px-4 py-2 text-sm text-[var(--t-text-secondary)] hover:text-[var(--t-text)]"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => salvar(editando)}
                  disabled={saving || !editando.nome}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--t-green)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
