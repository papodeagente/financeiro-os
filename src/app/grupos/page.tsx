'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { GrupoViagem, TipoProduto, TIPO_PRODUTO_LABEL } from '@/lib/types';
import { createGrupoViagem } from '@/lib/defaults';
import { loadGrupos, saveGrupos, deleteGrupo, exportGrupoJSON, importGrupoJSON } from '@/lib/storage';
import { useApp } from '@/contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Plus, Copy, Download, Upload, Trash2, FolderOpen, X,
  Search, Calendar, MapPin, Users, ArrowUpDown, LayoutGrid, List,
  ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { toast } from '@/lib/toast';

/* ─── Constants ─── */

// 4 estagios: PRODUTO/PROPOSTA (Entur OS) -> ORCAMENTO/VENDA (CRM).
// RESERVA mantido como alias visual de ORCAMENTO para grupos legados.
const PIPELINE_COLORS: Record<string, string> = {
  PRODUTO: 'bg-green-100 text-green-700',
  PROPOSTA: 'bg-blue-100 text-blue-700',
  ORCAMENTO: 'bg-amber-100 text-amber-700',
  RESERVA: 'bg-amber-100 text-amber-700',
  VENDA: 'bg-emerald-100 text-emerald-700',
  INCOMPLETO: 'bg-red-100 text-red-600',
};

const PIPELINE_BORDER: Record<string, string> = {
  PRODUTO: 'border-t-green-500',
  PROPOSTA: 'border-t-blue-500',
  ORCAMENTO: 'border-t-amber-500',
  RESERVA: 'border-t-amber-500',
  VENDA: 'border-t-emerald-500',
  INCOMPLETO: 'border-t-red-400',
};

const PIPELINE_DOT: Record<string, string> = {
  PRODUTO: 'bg-green-500',
  PROPOSTA: 'bg-blue-500',
  ORCAMENTO: 'bg-amber-500',
  RESERVA: 'bg-amber-500',
  VENDA: 'bg-emerald-500',
  INCOMPLETO: 'bg-red-400',
};

const PIPELINE_OPTIONS = ['TODOS', 'PRODUTO', 'PROPOSTA', 'ORCAMENTO', 'VENDA', 'INCOMPLETOS'] as const;
const PIPELINE_LABELS: Record<string, string> = {
  TODOS: 'Todos',
  PRODUTO: 'Produto',
  PROPOSTA: 'Proposta',
  ORCAMENTO: 'Orçamento',
  RESERVA: 'Orçamento', // legado
  VENDA: 'Venda',
  INCOMPLETOS: 'Incompletos',
  INCOMPLETO: 'Incompleto',
};

const PIPELINE_ORDER: Record<string, number> = {
  PRODUTO: 0, PROPOSTA: 1, ORCAMENTO: 2, RESERVA: 2, VENDA: 3,
};

const TARIFA_OPTIONS = [
  { key: 'sgl' as const, label: 'SGL', desc: 'Single — 1 pessoa' },
  { key: 'dbl' as const, label: 'DBL', desc: 'Duplo — 2 pessoas' },
  { key: 'tpl' as const, label: 'TPL', desc: 'Triplo — 3 pessoas' },
  { key: 'qdp' as const, label: 'QDP', desc: 'Quádruplo — 4 pessoas' },
] as const;

const SERVICES: { key: string; label: string; check: (g: GrupoViagem) => boolean }[] = [
  { key: 'tkt', label: 'Aéreo', check: g => (g.tkt?.trechos?.length ?? 0) > 0 },
  { key: 'htl', label: 'Hotel', check: g => (g.htl?.hoteis?.length ?? 0) > 0 },
  { key: 'rec', label: 'Receptivo', check: g => (g.rec?.passeios?.length ?? 0) > 0 },
  { key: 'car', label: 'Carro', check: g => (g.car?.transportes?.length ?? 0) > 0 },
  { key: 'guia', label: 'Guia', check: g => (g.guia?.destinos?.length ?? 0) > 0 },
  { key: 'seg', label: 'Seguro', check: g => (g.seg?.seguradoras?.length ?? 0) > 0 },
  { key: 'navio', label: 'Navio', check: g => (g.navio?.fornecedores?.length ?? 0) > 0 },
  { key: 'ing', label: 'Ingresso', check: g => (g.ing?.atrativos?.length ?? 0) > 0 },
  { key: 'brinde', label: 'Brinde', check: g => (g.brinde?.fornecedores?.length ?? 0) > 0 },
  { key: 'divulgacao', label: 'Divulgação', check: g => (g.divulgacao?.fornecedores?.length ?? 0) > 0 },
];

/* ─── Helpers ─── */

function isIncomplete(g: GrupoViagem): boolean {
  const noDestino = !g.origem_destino || g.origem_destino.trim() === '';
  const noDates = !g.periodos?.some(p => p.check_in);
  const noServices = getServiceCount(g) === 0;
  return noDestino || (noDates && noServices);
}

function getMissingItems(g: GrupoViagem): string[] {
  const missing: string[] = [];
  if (!g.origem_destino || g.origem_destino.trim() === '') missing.push('destino');
  if (!g.periodos?.some(p => p.check_in)) missing.push('datas de viagem');
  if (getServiceCount(g) === 0) missing.push('serviços');
  return missing;
}

function getEffectiveStatus(g: GrupoViagem): string {
  if (isIncomplete(g)) return 'INCOMPLETO';
  return g.status_pipeline || 'PRODUTO';
}

function getMonthKey(g: GrupoViagem): string {
  const d = g.periodos?.[0]?.check_in || g.created_at;
  if (!d) return '0000-00';
  return d.slice(0, 7);
}

function formatMonthLabel(key: string): string {
  if (key === '0000-00') return 'Sem data';
  try {
    const label = new Date(key + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return key;
  }
}

function getDateRange(g: GrupoViagem): { start: string | null; end: string | null; days: number | null } {
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const p of g.periodos || []) {
    if (p.check_in && (!minDate || p.check_in < minDate)) minDate = p.check_in;
    if (p.check_out && (!maxDate || p.check_out > maxDate)) maxDate = p.check_out;
  }
  let days: number | null = null;
  if (minDate && maxDate) {
    days = Math.round((new Date(maxDate).getTime() - new Date(minDate).getTime()) / 86400000);
  }
  return { start: minDate, end: maxDate, days };
}

function formatShortDate(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  } catch {
    return d;
  }
}

function formatShortDateYear(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

function getServiceCount(g: GrupoViagem): number {
  return SERVICES.filter(s => s.check(g)).length;
}

function getSortDate(g: GrupoViagem): string {
  return g.periodos?.[0]?.check_in || g.created_at || '';
}

/** Completion percentage (0-100) based on filled fields */
function getCompletionPercent(g: GrupoViagem): number {
  let filled = 0;
  const total = 5; // destino, datas, serviços (>=1), pax, tarifas
  if (g.origem_destino && g.origem_destino.trim()) filled++;
  if (g.periodos?.some(p => p.check_in)) filled++;
  if (getServiceCount(g) > 0) filled++;
  if (g.params?.qtd_min_pax > 0 || g.params?.qtd_max_pax > 0) filled++;
  if (g.tarifas_ativas?.length > 0) filled++;
  return Math.round((filled / total) * 100);
}

/** Semantic color for completion bar */
function getCompletionColor(pct: number): string {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 40) return 'bg-amber-500';
  return 'bg-red-400';
}

function getCompletionLabel(pct: number): string {
  if (pct >= 80) return 'text-green-600';
  if (pct >= 40) return 'text-amber-600';
  return 'text-red-500';
}

/* ─── Component ─── */

export default function GruposPage() {
  const router = useRouter();
  const [grupos, setGrupos] = useState<GrupoViagem[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTarifas, setNewTarifas] = useState<Set<'sgl' | 'dbl' | 'tpl' | 'qdp'>>(new Set(['dbl']));
  const [newNome, setNewNome] = useState('');
  const [newTipo, setNewTipo] = useState<TipoProduto>('GRUPO');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setActiveGrupo } = useApp();

  // Filter/sort/view state
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');
  const [filtroTipo, setFiltroTipo] = useState<TipoProduto | 'TODOS'>('TODOS');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'name' | 'status'>('date-desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const [filtroMes, setFiltroMes] = useState('TODOS');

  useEffect(() => { loadGrupos().then(setGrupos); }, []);

  // Persist view mode
  useEffect(() => {
    try {
      const saved = localStorage.getItem('entur:grupos-view');
      if (saved === 'list') setViewMode('list');
    } catch { /* ignore */ }
  }, []);

  const setAndPersistView = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    try { localStorage.setItem('entur:grupos-view', mode); } catch { /* ignore */ }
  };

  // Unique months for filter dropdown
  const uniqueMonths = useMemo(() => {
    const set = new Set<string>();
    for (const g of grupos) set.add(getMonthKey(g));
    return [...set].sort().reverse();
  }, [grupos]);

  // Status counts (including INCOMPLETOS). Grupos legados com 'RESERVA'
  // sao contados como ORCAMENTO (mesma posicao no funil novo).
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { PRODUTO: 0, PROPOSTA: 0, ORCAMENTO: 0, VENDA: 0, INCOMPLETOS: 0 };
    for (const g of grupos) {
      const raw = g.status_pipeline || 'PRODUTO';
      const key = raw === 'RESERVA' ? 'ORCAMENTO' : raw;
      counts[key] = (counts[key] || 0) + 1;
      if (isIncomplete(g)) counts.INCOMPLETOS++;
    }
    return counts;
  }, [grupos]);

  // Filter → Sort → Group pipeline
  const { grouped, filteredCount } = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    let filtered = grupos;

    // Status filter (INCOMPLETOS is a virtual status)
    if (filtroStatus === 'INCOMPLETOS') {
      filtered = filtered.filter(g => isIncomplete(g));
    } else if (filtroStatus !== 'TODOS') {
      filtered = filtered.filter(g => (g.status_pipeline || 'PRODUTO') === filtroStatus);
    }

    // Text search
    if (q) {
      filtered = filtered.filter(g => {
        const dest = (g.origem_destino || '').toLowerCase();
        const id = (g.grp_id || '').toLowerCase();
        const periodoDestinos = (g.periodos || []).map(p => (p.destino || '').toLowerCase()).join(' ');
        return dest.includes(q) || id.includes(q) || periodoDestinos.includes(q);
      });
    }

    // Month filter
    if (filtroMes !== 'TODOS') {
      filtered = filtered.filter(g => getMonthKey(g) === filtroMes);
    }

    // Tipo filter (Personalizado / Grupo / Operadora)
    if (filtroTipo !== 'TODOS') {
      filtered = filtered.filter(g => (g.tipo || 'GRUPO') === filtroTipo);
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'date-desc': return getSortDate(b).localeCompare(getSortDate(a));
        case 'date-asc': return getSortDate(a).localeCompare(getSortDate(b));
        case 'name': return (a.origem_destino || '').localeCompare(b.origem_destino || '', 'pt-BR');
        case 'status': return (PIPELINE_ORDER[a.status_pipeline || 'PRODUTO'] ?? 0) - (PIPELINE_ORDER[b.status_pipeline || 'PRODUTO'] ?? 0);
        default: return 0;
      }
    });

    // Group by month
    const map = new Map<string, GrupoViagem[]>();
    for (const g of sorted) {
      const key = getMonthKey(g);
      const arr = map.get(key);
      if (arr) arr.push(g);
      else map.set(key, [g]);
    }

    return { grouped: map, filteredCount: sorted.length };
  }, [grupos, filtroStatus, filtroTipo, searchQuery, filtroMes, sortBy]);

  const hasActiveFilters = filtroStatus !== 'TODOS' || filtroTipo !== 'TODOS' || searchQuery !== '' || filtroMes !== 'TODOS';

  const clearFilters = () => {
    setFiltroStatus('TODOS');
    setFiltroTipo('TODOS');
    setSearchQuery('');
    setFiltroMes('TODOS');
  };

  const toggleMonth = (key: string) => {
    setCollapsedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // CRUD handlers
  const toggleTarifa = (t: 'sgl' | 'dbl' | 'tpl' | 'qdp') => {
    setNewTarifas(prev => {
      const s = new Set(prev);
      if (s.has(t)) { if (s.size > 1) s.delete(t); } else s.add(t);
      return s;
    });
  };

  const criarGrupo = async () => {
    if (!newNome || newNome.trim().length < 3) {
      toast.error('Nome deve ter ao menos 3 caracteres');
      return;
    }
    const novo = createGrupoViagem();
    novo.tipo = newTipo;
    // Modo PROPOSTA: cotacao pontual, 1 pax, sem distincao por apto.
    // Mantem o array para compatibilidade com calculos existentes.
    if (newTipo === 'PROPOSTA') {
      novo.tarifas_ativas = ['sgl'];
      novo.params.qtd_min_pax = 1;
      novo.params.qtd_max_pax = 1;
      novo.params.cortesia = 0;
    } else {
      novo.tarifas_ativas = Array.from(newTarifas);
    }
    novo.origem_destino = newNome.trim();
    const updated = [...grupos, novo];
    setGrupos(updated);
    await saveGrupos(updated);
    setShowNewModal(false);
    setNewTarifas(new Set(['dbl']));
    setNewNome('');
    setNewTipo('GRUPO');
    router.push(`/grupo/${novo.id}`);
  };

  const duplicarGrupo = async (g: GrupoViagem) => {
    const copia = { ...JSON.parse(JSON.stringify(g)), id: Date.now().toString(36) + Math.random().toString(36).substring(2, 9), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), grp_id: g.grp_id + ' (copia)' };
    const updated = [...grupos, copia];
    setGrupos(updated);
    await saveGrupos(updated);
  };

  const removerGrupo = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este produto?')) return;
    await deleteGrupo(id);
    setGrupos(grupos.filter(g => g.id !== id));
  };

  const exportar = (g: GrupoViagem) => {
    const json = exportGrupoJSON(g);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${g.grp_id || 'grupo'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const grupo = importGrupoJSON(ev.target?.result as string);
      if (grupo) {
        grupo.id = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
        const updated = [...grupos, grupo];
        setGrupos(updated);
        await saveGrupos(updated);
      } else {
        toast.error('Arquivo JSON inválido', 'Verifique se o arquivo foi exportado corretamente.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  /* ─── Render ─── */

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageShell
        width="wide"
        header={
          <PageHeader
            title="Produtos"
            subtitle="Crie e configure roteiros de viagem para vender"
            actions={
              <>
                <Button onClick={() => setShowNewModal(true)} className="bg-[var(--t-green)] hover:opacity-90 text-white font-semibold">
                  <Plus className="w-4 h-4 mr-2" /> Novo Produto
                </Button>
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-4 h-4 mr-2" /> Importar JSON
                </Button>
                <input ref={fileInputRef} type="file" accept=".json" onChange={importar} className="hidden" />
              </>
            }
          />
        }
      >
        {/* Stats Bar — filtros rápidos por status com contagens */}
        {grupos.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Todos */}
            <button
              onClick={() => setFiltroStatus('TODOS')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-sm transition-all ${
                filtroStatus === 'TODOS'
                  ? 'border-[var(--t-green)] bg-[var(--t-green)]/8 text-[var(--t-green)] font-semibold ring-1 ring-[var(--t-green)]/20'
                  : 'border-[var(--t-border)] bg-[var(--t-surface)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]'
              }`}
            >
              <span className="font-bold text-base">{grupos.length}</span>
              <span className="text-xs">Todos</span>
            </button>

            {/* Pipeline statuses */}
            {(['PRODUTO', 'PROPOSTA', 'ORCAMENTO', 'VENDA'] as const).map(status => (
              <button
                key={status}
                onClick={() => setFiltroStatus(filtroStatus === status ? 'TODOS' : status)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${
                  filtroStatus === status
                    ? 'border-[var(--t-green)] bg-[var(--t-green)]/8 text-[var(--t-text)] font-semibold ring-1 ring-[var(--t-green)]/20'
                    : 'border-[var(--t-border)] bg-[var(--t-surface)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${PIPELINE_DOT[status]}`} />
                <span className="font-semibold">{statusCounts[status] || 0}</span>
                <span className="text-xs hidden sm:inline">{PIPELINE_LABELS[status]}</span>
              </button>
            ))}

            {/* Incompletos — filtro especial */}
            {statusCounts.INCOMPLETOS > 0 && (
              <button
                onClick={() => setFiltroStatus(filtroStatus === 'INCOMPLETOS' ? 'TODOS' : 'INCOMPLETOS')}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${
                  filtroStatus === 'INCOMPLETOS'
                    ? 'border-red-400 bg-red-50 text-red-600 font-semibold ring-1 ring-red-200'
                    : 'border-[var(--t-border)] bg-[var(--t-surface)] text-red-400 hover:bg-red-50/50'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="font-semibold">{statusCounts.INCOMPLETOS}</span>
                <span className="text-xs hidden sm:inline">Incompletos</span>
              </button>
            )}

            {/* Divisor visual entre filtros de status e de tipo */}
            <span className="h-6 w-px bg-[var(--t-border)] mx-1 hidden sm:inline-block" />

            {/* Filtro por tipo de produto */}
            <button
              onClick={() => setFiltroTipo('TODOS')}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${
                filtroTipo === 'TODOS'
                  ? 'border-[var(--t-blue)] bg-[var(--t-blue)]/8 text-[var(--t-blue)] font-semibold ring-1 ring-[var(--t-blue)]/20'
                  : 'border-[var(--t-border)] bg-[var(--t-surface)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]'
              }`}
            >
              <span className="text-xs">Todos os tipos</span>
            </button>
            {(['PROPOSTA', 'GRUPO', 'OPERADORA'] as const).map(tipo => (
              <button
                key={tipo}
                onClick={() => setFiltroTipo(filtroTipo === tipo ? 'TODOS' : tipo)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${
                  filtroTipo === tipo
                    ? 'border-[var(--t-blue)] bg-[var(--t-blue)]/8 text-[var(--t-text)] font-semibold ring-1 ring-[var(--t-blue)]/20'
                    : 'border-[var(--t-border)] bg-[var(--t-surface)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)]'
                }`}
              >
                <span className="text-xs">{TIPO_PRODUTO_LABEL[tipo]}</span>
              </button>
            ))}
          </div>
        )}

        {/* Toolbar */}
        {grupos.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar por destino, ID ou cidade..."
                className="pl-9 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] h-9"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--t-text-muted)] hover:text-[var(--t-text)]">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Month filter */}
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-[var(--t-text-muted)]" />
              <select
                value={filtroMes}
                onChange={e => setFiltroMes(e.target.value)}
                className="bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text)] rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-[var(--t-green)] transition-colors cursor-pointer"
              >
                <option value="TODOS">Todos os meses</option>
                {uniqueMonths.map(m => (
                  <option key={m} value={m}>{formatMonthLabel(m)}</option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="w-4 h-4 text-[var(--t-text-muted)]" />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text)] rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-[var(--t-green)] transition-colors cursor-pointer"
              >
                <option value="date-desc">Mais recente</option>
                <option value="date-asc">Mais antigo</option>
                <option value="name">Nome A-Z</option>
                <option value="status">Status pipeline</option>
              </select>
            </div>

            {/* View toggle */}
            <div className="flex items-center border border-[var(--t-border)] rounded-lg overflow-hidden ml-auto">
              <button
                onClick={() => setAndPersistView('grid')}
                className={`p-1.5 transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-[var(--t-green)] text-white'
                    : 'bg-[var(--t-surface)] text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
                }`}
                title="Visualização em grade"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setAndPersistView('list')}
                className={`p-1.5 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[var(--t-green)] text-white'
                    : 'bg-[var(--t-surface)] text-[var(--t-text-muted)] hover:text-[var(--t-text)]'
                }`}
                title="Visualização em lista"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-[var(--t-text-muted)] hover:text-[var(--t-text)] underline underline-offset-2">
                Limpar filtros
              </button>
            )}
          </div>
        )}

        {/* Active filters summary */}
        {grupos.length > 0 && hasActiveFilters && (
          <div className="text-xs text-[var(--t-text-muted)]">
            Mostrando <span className="font-semibold text-[var(--t-text)]">{filteredCount}</span> de{' '}
            <span className="font-semibold text-[var(--t-text)]">{grupos.length}</span> produtos
          </div>
        )}

        {/* Content */}
        {grupos.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="w-7 h-7" />}
            title="Nenhum produto criado"
            description="Crie seu primeiro roteiro de viagem para começar a montar propostas e fechar vendas."
            action={{ label: 'Novo Produto', onClick: () => setShowNewModal(true) }}
          />
        ) : filteredCount === 0 ? (
          <EmptyState
            icon={<Search className="w-7 h-7" />}
            title="Nenhum produto encontrado"
            description="Tente ajustar seus filtros ou busca para encontrar o que procura."
            action={{ label: 'Limpar filtros', onClick: clearFilters }}
          />
        ) : (
          <div className="space-y-2">
            {[...grouped.entries()].map(([monthKey, monthGrupos]) => {
              const isCollapsed = collapsedMonths.has(monthKey);
              const monthStatusCounts: Record<string, number> = {};
              for (const g of monthGrupos) {
                const st = g.status_pipeline || 'PRODUTO';
                monthStatusCounts[st] = (monthStatusCounts[st] || 0) + 1;
              }

              return (
                <div key={monthKey}>
                  {/* Month header */}
                  <button
                    onClick={() => toggleMonth(monthKey)}
                    className="w-full flex items-center gap-3 py-3 px-1 group hover:bg-[var(--t-surface-hover)]/50 rounded-lg transition-colors"
                  >
                    {isCollapsed
                      ? <ChevronRight className="w-4 h-4 text-[var(--t-text-muted)] group-hover:text-[var(--t-text)]" />
                      : <ChevronDown className="w-4 h-4 text-[var(--t-text-muted)] group-hover:text-[var(--t-text)]" />
                    }
                    <span className="font-semibold text-[var(--t-text)]">{formatMonthLabel(monthKey)}</span>
                    <span className="text-xs bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text-secondary)] px-2 py-0.5 rounded-full font-medium">
                      {monthGrupos.length}
                    </span>
                    <div className="flex items-center gap-1 ml-1">
                      {(['PRODUTO', 'PROPOSTA', 'ORCAMENTO', 'VENDA'] as const).map(st =>
                        (monthStatusCounts[st] || 0) > 0 ? (
                          <div key={st} className="flex items-center gap-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${PIPELINE_DOT[st]}`} />
                            <span className="text-[10px] text-[var(--t-text-muted)]">{monthStatusCounts[st]}</span>
                          </div>
                        ) : null
                      )}
                    </div>
                    <div className="flex-1" />
                  </button>

                  {/* Cards */}
                  {!isCollapsed && (
                    viewMode === 'grid' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-4">
                        {monthGrupos.map(g => (
                          <GridCard
                            key={g.id}
                            g={g}
                            onOpen={() => setActiveGrupo(g.id, g.grp_id || 'Sem ID')}
                            onDuplicate={() => duplicarGrupo(g)}
                            onExport={() => exportar(g)}
                            onDelete={() => removerGrupo(g.id)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 pb-4">
                        {monthGrupos.map(g => (
                          <ListRow
                            key={g.id}
                            g={g}
                            onOpen={() => setActiveGrupo(g.id, g.grp_id || 'Sem ID')}
                            onDuplicate={() => duplicarGrupo(g)}
                            onExport={() => exportar(g)}
                            onDelete={() => removerGrupo(g.id)}
                          />
                        ))}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PageShell>

      {/* New Product Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--t-surface)] border border-[var(--t-border)] rounded-2xl w-full max-w-md p-6" style={{ boxShadow: 'var(--elevation-4)' }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-[var(--t-text)]">Novo Produto</h2>
              <button onClick={() => setShowNewModal(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Tipo de produto: 3 opções */}
              <div>
                <label className="text-xs font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-2 block">Tipo de produto</label>
                <div className="grid grid-cols-1 gap-2">
                  {([
                    { key: 'PROPOSTA',  titulo: 'Personalizado', desc: 'Cotação pontual personalizada por cliente. Cada serviço é cotado e detalhado.' },
                    { key: 'GRUPO',     titulo: 'Grupo',         desc: 'Viagem em grupo. SGL/DBL/TPL/QDP + CHD com cortesia e tarifas múltiplas.' },
                    { key: 'OPERADORA', titulo: 'Operadora',     desc: 'Pacote pronto de fornecedor único. Apenas lista de itens + custo/venda no final.' },
                  ] as { key: TipoProduto; titulo: string; desc: string }[]).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setNewTipo(opt.key)}
                      className={`flex flex-col gap-1 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                        newTipo === opt.key
                          ? 'border-[var(--t-green)] bg-[var(--t-green)]/10'
                          : 'border-[var(--t-border)] hover:border-[var(--t-text-muted)]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          newTipo === opt.key
                            ? 'border-[var(--t-green)] bg-[var(--t-green)]'
                            : 'border-[var(--t-border)]'
                        }`}>
                          {newTipo === opt.key && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </div>
                        <span className="text-sm font-semibold text-[var(--t-text)]">{opt.titulo}</span>
                      </div>
                      <span className="text-[11px] text-[var(--t-text-muted)] leading-snug pl-6">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1.5 block">Destino / Nome do produto</label>
                <Input
                  value={newNome}
                  onChange={e => setNewNome(e.target.value)}
                  placeholder="Ex: Europa 2026, Maldivas, Orlando..."
                  className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
                  autoFocus
                />
              </div>

              {/* Tarifas — só relevantes para Grupo */}
              {newTipo === 'GRUPO' && (
                <div>
                  <label className="text-xs font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-2 block">Tarifas que deseja cotar</label>
                  <div className="grid grid-cols-2 gap-2">
                    {TARIFA_OPTIONS.map(t => (
                      <button
                        key={t.key}
                        onClick={() => toggleTarifa(t.key)}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left ${
                          newTarifas.has(t.key)
                            ? 'border-[var(--t-green)] bg-[var(--t-green)]/10'
                            : 'border-[var(--t-border)] hover:border-[var(--t-text-muted)]'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs font-bold ${
                          newTarifas.has(t.key)
                            ? 'border-[var(--t-green)] bg-[var(--t-green)] text-white'
                            : 'border-[var(--t-border)]'
                        }`}>
                          {newTarifas.has(t.key) && '✓'}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-[var(--t-text)]">{t.label}</div>
                          <div className="text-[10px] text-[var(--t-text-muted)]">{t.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-[var(--t-text-muted)] mt-2">Selecione as tarifas que precisa cotar. Você pode alterar depois.</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <Button variant="outline" onClick={() => setShowNewModal(false)} className="flex-1">Cancelar</Button>
              <Button onClick={criarGrupo} className="flex-1 bg-[var(--t-green)] hover:opacity-90 text-white font-semibold">
                <Plus className="w-4 h-4 mr-1" /> Criar Produto
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Grid Card ─── */

interface CardProps {
  g: GrupoViagem;
  onOpen: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function GridCard({ g, onOpen, onDuplicate, onExport, onDelete }: CardProps) {
  const incomplete = isIncomplete(g);
  const effectiveStatus = getEffectiveStatus(g);
  const range = getDateRange(g);
  const completionPct = getCompletionPercent(g);
  const firstDestino = g.periodos?.[0]?.destino;
  const missing = incomplete ? getMissingItems(g) : [];
  const hasDestino = !!(g.origem_destino && g.origem_destino.trim());

  return (
    <Card className={`hover:shadow-lg transition-all border-t-[3px] ${PIPELINE_BORDER[effectiveStatus]} flex flex-col`}>
      <CardContent className="p-5 flex flex-col flex-1">
        {/* Header — destino é o hero, GRP desce para metadado discreto */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0 flex-1">
            {hasDestino ? (
              <h3 className="font-bold text-lg text-[var(--t-text)] truncate leading-tight">
                {g.origem_destino}
              </h3>
            ) : (
              <h3 className="text-lg leading-tight">
                <span className="italic text-[var(--t-text-muted)]">Sem destino definido</span>
              </h3>
            )}
            {/* GRP code — metadado discreto em fonte mono pequena */}
            <p className="text-[11px] text-[var(--t-text-muted)] mt-0.5 truncate font-mono opacity-60">{g.grp_id}</p>
          </div>
          <Badge className={`text-[10px] shrink-0 ${PIPELINE_COLORS[effectiveStatus]}`}>
            {PIPELINE_LABELS[effectiveStatus] || effectiveStatus}
          </Badge>
        </div>

        {/* Alerta inline para incompletos */}
        {incomplete && (
          <div className="mt-2 flex items-start gap-2 px-2.5 py-2 rounded-lg bg-red-50 border border-red-100">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <span className="text-[11px] text-red-600 leading-snug">
              Falta preencher: {missing.join(', ')}
            </span>
          </div>
        )}

        {/* Date & Route */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-[var(--t-text-secondary)]">
            <Calendar className="w-3.5 h-3.5 text-[var(--t-text-muted)] shrink-0" />
            {range.start ? (
              <span>
                {formatShortDate(range.start)} — {formatShortDateYear(range.end)}
                {range.days !== null && <span className="text-[var(--t-text-muted)]"> · {range.days}d</span>}
              </span>
            ) : (
              <span className="text-[var(--t-text-muted)] italic">Sem datas definidas</span>
            )}
          </div>
          {firstDestino && (
            <div className="flex items-center gap-2 text-sm text-[var(--t-text-secondary)]">
              <MapPin className="w-3.5 h-3.5 text-[var(--t-text-muted)] shrink-0" />
              <span className="truncate">{firstDestino}</span>
            </div>
          )}
        </div>

        {/* Barra de completude — substitui os dots */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[var(--t-text-muted)]">Completude</span>
            <span className={`text-[11px] font-semibold ${getCompletionLabel(completionPct)}`}>{completionPct}%</span>
          </div>
          <div className="w-full h-1.5 bg-[var(--t-border)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${getCompletionColor(completionPct)}`}
              style={{ width: `${completionPct}%` }}
            />
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-3 flex items-center gap-3 text-xs text-[var(--t-text-muted)] flex-wrap">
          {(g.params?.qtd_min_pax > 0 || g.params?.qtd_max_pax > 0) && (
            <div className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              <span>{g.params.qtd_min_pax}-{g.params.qtd_max_pax} pax</span>
            </div>
          )}
          {g.tarifas_ativas?.length > 0 && (
            <span className="uppercase font-medium">{g.tarifas_ativas.join(' · ')}</span>
          )}
          {g.periodos?.length > 0 && (
            <span>{g.periodos.length} período{g.periodos.length > 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Actions — botão suave, CTA contextual */}
        <div className="flex gap-2 mt-auto pt-4">
          <Link
            href={`/grupo/${g.id}`}
            className="flex-1"
            onClick={onOpen}
          >
            {incomplete ? (
              <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white" size="sm">
                <AlertTriangle className="w-4 h-4 mr-1.5" /> Completar grupo
              </Button>
            ) : (
              <Button className="w-full bg-blue-500/15 hover:bg-blue-500/25 text-blue-600 border border-blue-200" size="sm" variant="outline">
                <FolderOpen className="w-4 h-4 mr-1.5" /> Abrir
              </Button>
            )}
          </Link>
          <Button variant="outline" size="sm" onClick={onDuplicate} title="Duplicar"><Copy className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" onClick={onExport} title="Exportar JSON"><Download className="w-4 h-4" /></Button>
          <Button variant="outline" size="sm" onClick={onDelete} title="Excluir" className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── List Row ─── */

function ListRow({ g, onOpen, onDuplicate, onExport, onDelete }: CardProps) {
  const incomplete = isIncomplete(g);
  const effectiveStatus = getEffectiveStatus(g);
  const range = getDateRange(g);
  const completionPct = getCompletionPercent(g);
  const hasDestino = !!(g.origem_destino && g.origem_destino.trim());

  return (
    <div className={`flex items-center gap-4 px-4 py-3 bg-[var(--t-surface)] border rounded-xl hover:shadow-md transition-all group ${
      incomplete ? 'border-red-200' : 'border-[var(--t-border)]'
    }`}>
      {/* Color indicator */}
      <div className={`w-1 h-10 rounded-full shrink-0 ${PIPELINE_DOT[effectiveStatus]}`} />

      {/* Destination — hero text */}
      <Link
        href={`/grupo/${g.id}`}
        onClick={onOpen}
        className="flex-1 min-w-0 hover:underline underline-offset-2"
      >
        {hasDestino ? (
          <div className="font-semibold text-[var(--t-text)] truncate">{g.origem_destino}</div>
        ) : (
          <div className="italic text-[var(--t-text-muted)] truncate">Sem destino definido</div>
        )}
        {/* GRP code — discreto em mono */}
        <div className="text-[10px] text-[var(--t-text-muted)] truncate font-mono opacity-60">{g.grp_id}</div>
      </Link>

      {/* Date */}
      <div className="text-xs text-[var(--t-text-secondary)] w-40 shrink-0 hidden md:block">
        {range.start ? (
          <>
            {formatShortDate(range.start)} — {formatShortDateYear(range.end)}
            {range.days !== null && <span className="text-[var(--t-text-muted)]"> · {range.days}d</span>}
          </>
        ) : (
          <span className="text-[var(--t-text-muted)] italic">Sem datas</span>
        )}
      </div>

      {/* Completion bar — mini version */}
      <div className="w-20 shrink-0 hidden lg:block">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1 bg-[var(--t-border)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${getCompletionColor(completionPct)}`}
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <span className={`text-[10px] font-medium ${getCompletionLabel(completionPct)}`}>{completionPct}%</span>
        </div>
      </div>

      {/* Badge */}
      <Badge className={`text-[10px] shrink-0 ${PIPELINE_COLORS[effectiveStatus]}`}>
        {PIPELINE_LABELS[effectiveStatus] || effectiveStatus}
      </Badge>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onDuplicate} title="Duplicar" className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button onClick={onExport} title="Exportar" className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]">
          <Download className="w-3.5 h-3.5" />
        </button>
        <button onClick={onDelete} title="Excluir" className="w-7 h-7 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-400/10 hover:text-red-500">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
