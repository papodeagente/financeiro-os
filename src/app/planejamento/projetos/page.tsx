'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCardGrid } from '@/components/SkeletonCard';
import { MoneyInput } from '@/components/MoneyInput';
import { formatBRL, generateId } from '@/lib/utils';
import { FolderKanban, Plus, X, GripVertical } from 'lucide-react';

interface Projeto {
  id: string;
  nome: string;
  canal: string;
  budget: number;
  gasto: number;
  responsavel: string;
  data_inicio: string;
  data_fim: string;
  status: 'planejando' | 'em_execucao' | 'concluido';
}

const CANAIS = ['Marketing digital', 'Marketing offline', 'Comercial', 'Eventos/Feiras', 'Branding', 'Capacitacao', 'Outros'];
const STATUS_LABELS: Record<string, string> = { planejando: 'Planejando', em_execucao: 'Em execucao', concluido: 'Concluido' };
const COLUMNS: Projeto['status'][] = ['planejando', 'em_execucao', 'concluido'];

export default function ProjetosPage() {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Projeto | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [membros, setMembros] = useState<{ id: string; nome: string }[]>([]);
  const [dragItem, setDragItem] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/planejamento/projetos').then(r => r.json()),
      fetch('/api/membros').then(r => r.json()),
    ]).then(([p, m]) => {
      setProjetos(p || []);
      setMembros(m || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const save = async (proj: Projeto) => {
    await fetch(proj.id ? `/api/planejamento/projetos/${proj.id}` : '/api/planejamento/projetos', {
      method: proj.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proj),
    });
    setProjetos(prev => {
      const idx = prev.findIndex(p => p.id === proj.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = proj; return n; }
      return [...prev, proj];
    });
  };

  const remove = async (id: string) => {
    await fetch(`/api/planejamento/projetos/${id}`, { method: 'DELETE' });
    setProjetos(prev => prev.filter(p => p.id !== id));
  };

  const openNew = () => {
    setEditing({
      id: generateId(), nome: '', canal: CANAIS[0], budget: 0, gasto: 0,
      responsavel: '', data_inicio: '', data_fim: '', status: 'planejando',
    });
    setSheetOpen(true);
  };

  const handleDrop = async (status: Projeto['status'], e: React.DragEvent) => {
    e.preventDefault();
    if (!dragItem) return;
    const proj = projetos.find(p => p.id === dragItem);
    if (proj && proj.status !== status) {
      const updated = { ...proj, status };
      await save(updated);
    }
    setDragItem(null);
  };

  if (loading) return (
    <div className="p-6">
      <PageHeader title="Projetos comerciais" />
      <SkeletonCardGrid count={6} />
    </div>
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Projetos comerciais"
        actions={
          <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 transition-opacity">
            <Plus className="w-4 h-4" /> Novo projeto
          </button>
        }
      />

      {projetos.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="w-7 h-7" />}
          title="Nenhum projeto criado"
          description="Crie projetos comerciais para acompanhar investimentos e budget."
          action={{ label: 'Criar projeto', onClick: openNew }}
        />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {COLUMNS.map(status => (
            <div
              key={status}
              className="min-h-[300px]"
              onDragOver={e => e.preventDefault()}
              onDrop={e => handleDrop(status, e)}
            >
              <h3 className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-3">
                {STATUS_LABELS[status]} ({projetos.filter(p => p.status === status).length})
              </h3>
              <div className="space-y-3">
                {projetos.filter(p => p.status === status).map(proj => (
                  <div
                    key={proj.id}
                    draggable
                    onDragStart={() => setDragItem(proj.id)}
                    onClick={() => { setEditing(proj); setSheetOpen(true); }}
                    className="p-4 rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] cursor-pointer hover:border-[var(--t-border-hover)] transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="w-4 h-4 text-[var(--t-text-muted)] mt-0.5 shrink-0 cursor-grab" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)] truncate">{proj.nome || 'Sem nome'}</p>
                        <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">{proj.canal}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[var(--text-caption)] text-[var(--t-text-secondary)]">Budget: {formatBRL(proj.budget)}</span>
                          {proj.status === 'concluido' && proj.budget > 0 && (
                            <span className={`text-[var(--text-caption)] font-medium ${proj.gasto <= proj.budget ? 'text-[var(--crm-ok)]' : 'text-[var(--crm-err)]'}`}>
                              {((proj.gasto / proj.budget) * 100).toFixed(0)}% gasto
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sheet for editing */}
      {sheetOpen && editing && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSheetOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-[400px] h-full bg-[var(--t-surface)] border-l border-[var(--t-border)] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--t-border)]">
              <h3 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)]">
                {editing.nome ? 'Editar projeto' : 'Novo projeto'}
              </h3>
              <button onClick={() => setSheetOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--t-sidebar-item-hover)]">
                <X className="w-4 h-4 text-[var(--t-text-muted)]" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="proj-nome" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Nome</label>
                <input id="proj-nome" value={editing.nome} onChange={e => setEditing({ ...editing, nome: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
              </div>
              <div>
                <label htmlFor="proj-canal" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Canal</label>
                <select id="proj-canal" value={editing.canal} onChange={e => setEditing({ ...editing, canal: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]">
                  {CANAIS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="proj-budget" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Budget</label>
                <MoneyInput value={editing.budget} onChange={v => setEditing({ ...editing, budget: v ?? 0 })} />
              </div>
              <div>
                <label htmlFor="proj-gasto" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Gasto ate agora</label>
                <MoneyInput value={editing.gasto} onChange={v => setEditing({ ...editing, gasto: v ?? 0 })} />
              </div>
              <div>
                <label htmlFor="proj-resp" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Responsavel</label>
                <select id="proj-resp" value={editing.responsavel} onChange={e => setEditing({ ...editing, responsavel: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]">
                  <option value="">Selecionar...</option>
                  {membros.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="proj-inicio" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Inicio</label>
                  <input id="proj-inicio" type="date" value={editing.data_inicio} onChange={e => setEditing({ ...editing, data_inicio: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
                </div>
                <div>
                  <label htmlFor="proj-fim" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Fim</label>
                  <input id="proj-fim" type="date" value={editing.data_fim} onChange={e => setEditing({ ...editing, data_fim: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]" />
                </div>
              </div>
              <div>
                <label htmlFor="proj-status" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Status</label>
                <select id="proj-status" value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value as Projeto['status'] })}
                  className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]">
                  {COLUMNS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  onClick={async () => { await save(editing); setSheetOpen(false); }}
                  className="flex-1 px-4 py-2 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90"
                >
                  Salvar
                </button>
                <button
                  onClick={async () => { await remove(editing.id); setSheetOpen(false); }}
                  className="px-4 py-2 text-[var(--text-body-sm)] text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10"
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
