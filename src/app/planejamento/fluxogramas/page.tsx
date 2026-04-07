'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCardGrid } from '@/components/SkeletonCard';
import { generateId } from '@/lib/utils';
import {
  Workflow, Plus, X, FolderPlus, Pencil, Trash2,
  Search, Calendar,
} from 'lucide-react';

interface Categoria {
  id: string;
  nome: string;
  ordem: number;
}

interface Fluxograma {
  id: string;
  nome: string;
  descricao?: string;
  categoria_id: string;
  nodes: unknown[];
  edges: unknown[];
  updated_at?: string;
  created_at?: string;
}

const CATEGORIAS_PADRAO: { nome: string; ordem: number }[] = [
  { nome: 'Vendas 1', ordem: 0 },
  { nome: 'Vendas 2', ordem: 1 },
  { nome: 'Grupo de viagem', ordem: 2 },
  { nome: 'Pós-venda', ordem: 3 },
  { nome: 'Suporte ao cliente', ordem: 4 },
  { nome: 'Concierge 24h', ordem: 5 },
];

export default function FluxogramasPage() {
  const router = useRouter();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [fluxogramas, setFluxogramas] = useState<Fluxograma[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategoria, setActiveCategoria] = useState<string>('todos');
  const [search, setSearch] = useState('');

  const [editingCategoria, setEditingCategoria] = useState<Categoria | null>(null);
  const [categoriaSheetOpen, setCategoriaSheetOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/planejamento/fluxograma-categorias').then(r => r.json()),
      fetch('/api/planejamento/fluxogramas').then(r => r.json()),
    ]).then(async ([cats, flx]) => {
      let cs: Categoria[] = Array.isArray(cats) ? cats : [];
      // Seed das 6 categorias padrão se vazio
      if (cs.length === 0) {
        const seeded = await Promise.all(
          CATEGORIAS_PADRAO.map(async (c) => {
            const cat: Categoria = { id: generateId(), nome: c.nome, ordem: c.ordem };
            await fetch('/api/planejamento/fluxograma-categorias', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(cat),
            });
            return cat;
          }),
        );
        cs = seeded;
      }
      cs.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      setCategorias(cs);
      setFluxogramas(Array.isArray(flx) ? flx : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = fluxogramas;
    if (activeCategoria !== 'todos') {
      list = list.filter(f => f.categoria_id === activeCategoria);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(f => f.nome.toLowerCase().includes(s) || (f.descricao ?? '').toLowerCase().includes(s));
    }
    return list.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  }, [fluxogramas, activeCategoria, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: fluxogramas.length };
    fluxogramas.forEach(f => { c[f.categoria_id] = (c[f.categoria_id] ?? 0) + 1; });
    return c;
  }, [fluxogramas]);

  const createFluxograma = async () => {
    const targetCat = activeCategoria !== 'todos'
      ? activeCategoria
      : (categorias[0]?.id ?? '');
    const novo: Fluxograma = {
      id: generateId(),
      nome: 'Novo fluxograma',
      descricao: '',
      categoria_id: targetCat,
      nodes: [],
      edges: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await fetch('/api/planejamento/fluxogramas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(novo),
    });
    router.push(`/planejamento/fluxogramas/${novo.id}`);
  };

  const removeFluxograma = async (id: string) => {
    if (!confirm('Excluir este fluxograma?')) return;
    await fetch(`/api/planejamento/fluxogramas/${id}`, { method: 'DELETE' });
    setFluxogramas(prev => prev.filter(f => f.id !== id));
  };

  const saveCategoria = async (cat: Categoria) => {
    const exists = categorias.some(c => c.id === cat.id);
    await fetch(exists ? `/api/planejamento/fluxograma-categorias/${cat.id}` : '/api/planejamento/fluxograma-categorias', {
      method: exists ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cat),
    });
    setCategorias(prev => {
      const idx = prev.findIndex(c => c.id === cat.id);
      const next = idx >= 0 ? [...prev.slice(0, idx), cat, ...prev.slice(idx + 1)] : [...prev, cat];
      return next.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    });
  };

  const removeCategoria = async (id: string) => {
    const usados = fluxogramas.filter(f => f.categoria_id === id).length;
    if (usados > 0) {
      alert(`Esta categoria possui ${usados} fluxograma(s). Mova-os antes de excluir.`);
      return;
    }
    if (!confirm('Excluir esta categoria?')) return;
    await fetch(`/api/planejamento/fluxograma-categorias/${id}`, { method: 'DELETE' });
    setCategorias(prev => prev.filter(c => c.id !== id));
    if (activeCategoria === id) setActiveCategoria('todos');
  };

  const openNewCategoria = () => {
    setEditingCategoria({
      id: generateId(),
      nome: '',
      ordem: categorias.length,
    });
    setCategoriaSheetOpen(true);
  };

  const openEditCategoria = (c: Categoria) => {
    setEditingCategoria({ ...c });
    setCategoriaSheetOpen(true);
  };

  if (loading) return (
    <div className="p-6">
      <PageHeader title="Fluxogramas" subtitle="Construtor BPMN para mapear seus processos" />
      <SkeletonCardGrid count={6} />
    </div>
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Fluxogramas"
        subtitle="Construtor BPMN para mapear vendas, suporte e operações"
        actions={
          <>
            <button
              onClick={openNewCategoria}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-medium text-[var(--t-text)] border border-[var(--t-border)] rounded-lg hover:bg-[var(--t-surface-hover)] transition-colors"
            >
              <FolderPlus className="w-4 h-4" /> Nova categoria
            </button>
            <button
              onClick={createFluxograma}
              disabled={categorias.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Novo fluxograma
            </button>
          </>
        }
      />

      <div className="grid grid-cols-[260px_1fr] gap-6">
        {/* Sidebar de categorias */}
        <aside className="space-y-1">
          <button
            onClick={() => setActiveCategoria('todos')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[var(--text-body-sm)] transition-colors ${
              activeCategoria === 'todos'
                ? 'bg-[var(--t-green-bg)] text-[var(--t-green)] font-medium'
                : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]'
            }`}
          >
            <span>Todos</span>
            <span className="text-[var(--text-caption)] opacity-70">{counts.todos ?? 0}</span>
          </button>
          {categorias.map(c => (
            <div key={c.id} className="group flex items-center gap-1">
              <button
                onClick={() => setActiveCategoria(c.id)}
                className={`flex-1 flex items-center justify-between px-3 py-2 rounded-lg text-[var(--text-body-sm)] transition-colors ${
                  activeCategoria === c.id
                    ? 'bg-[var(--t-green-bg)] text-[var(--t-green)] font-medium'
                    : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]'
                }`}
              >
                <span className="truncate">{c.nome}</span>
                <span className="text-[var(--text-caption)] opacity-70">{counts[c.id] ?? 0}</span>
              </button>
              <button
                onClick={() => openEditCategoria(c)}
                className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-md flex items-center justify-center text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)]"
                title="Editar categoria"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </aside>

        {/* Lista de fluxogramas */}
        <section>
          <div className="mb-4 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar fluxograma..."
              className="w-full pl-9 pr-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Workflow className="w-7 h-7" />}
              title="Nenhum fluxograma criado"
              description="Crie seu primeiro fluxograma BPMN para mapear processos da agência."
              action={{ label: 'Novo fluxograma', onClick: createFluxograma }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(f => {
                const cat = categorias.find(c => c.id === f.categoria_id);
                return (
                  <button
                    key={f.id}
                    onClick={() => router.push(`/planejamento/fluxogramas/${f.id}`)}
                    className="group relative text-left p-4 rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] hover:border-[var(--t-border-hover)] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--t-green-bg)] flex items-center justify-center shrink-0">
                        <Workflow className="w-5 h-5 text-[var(--t-green)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[var(--text-body-sm)] font-medium text-[var(--t-text)] truncate">
                          {f.nome || 'Sem nome'}
                        </p>
                        {cat && (
                          <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] truncate">
                            {cat.nome}
                          </p>
                        )}
                        {f.descricao && (
                          <p className="mt-1 text-[var(--text-caption)] text-[var(--t-text-secondary)] line-clamp-2">
                            {f.descricao}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[var(--text-caption)] text-[var(--t-text-muted)]">
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--t-green)]" />
                        {(f.nodes?.length ?? 0)} blocos · {(f.edges?.length ?? 0)} ligações
                      </span>
                      {f.updated_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(f.updated_at).toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); removeFluxograma(f.id); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); removeFluxograma(f.id); } }}
                      className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 w-7 h-7 rounded-md flex items-center justify-center text-red-500 hover:bg-red-500/10 cursor-pointer"
                      title="Excluir"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Sheet de categoria */}
      {categoriaSheetOpen && editingCategoria && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setCategoriaSheetOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-[400px] h-full bg-[var(--t-surface)] border-l border-[var(--t-border)] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-[var(--t-border)]">
              <h3 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)]">
                {categorias.some(c => c.id === editingCategoria.id) ? 'Editar categoria' : 'Nova categoria'}
              </h3>
              <button onClick={() => setCategoriaSheetOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--t-surface-hover)]">
                <X className="w-4 h-4 text-[var(--t-text-muted)]" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="cat-nome" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Nome</label>
                <input
                  id="cat-nome"
                  value={editingCategoria.nome}
                  onChange={e => setEditingCategoria({ ...editingCategoria, nome: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                />
              </div>
              <div>
                <label htmlFor="cat-ordem" className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1">Ordem</label>
                <input
                  id="cat-ordem"
                  type="number"
                  value={editingCategoria.ordem}
                  onChange={e => setEditingCategoria({ ...editingCategoria, ordem: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                />
              </div>
              <div className="flex gap-2 pt-4">
                <button
                  onClick={async () => {
                    if (!editingCategoria.nome.trim()) return;
                    await saveCategoria(editingCategoria);
                    setCategoriaSheetOpen(false);
                  }}
                  className="flex-1 px-4 py-2 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90"
                >
                  Salvar
                </button>
                {categorias.some(c => c.id === editingCategoria.id) && (
                  <button
                    onClick={async () => {
                      await removeCategoria(editingCategoria.id);
                      setCategoriaSheetOpen(false);
                    }}
                    className="px-4 py-2 text-[var(--text-body-sm)] text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/10"
                  >
                    Excluir
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
