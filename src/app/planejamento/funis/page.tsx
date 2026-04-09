'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCardGrid } from '@/components/SkeletonCard';
import { generateId } from '@/lib/utils';
import { formatBRL } from '@/lib/utils';
import { cenariosPadrao } from '@/lib/funil-engine';
import type { FunilPayload, FunilTemplate, StatusFunil } from '@/lib/funil-types';
import {
  Filter, Plus, Search, Calendar, Copy, Trash2, TrendingUp, CircleDot,
} from 'lucide-react';

const STATUS_COLORS: Record<StatusFunil, { bg: string; text: string; label: string }> = {
  rascunho: { bg: 'bg-[var(--t-sidebar-item-hover)]', text: 'text-[var(--t-text-muted)]', label: 'Rascunho' },
  simulado: { bg: 'bg-[var(--t-green-bg)]', text: 'text-[var(--t-green)]', label: 'Simulado' },
  em_execucao: { bg: 'bg-amber-500/10', text: 'text-amber-600', label: 'Em execução' },
};

export default function FunisPage() {
  const router = useRouter();
  const [funis, setFunis] = useState<FunilPayload[]>([]);
  const [templates, setTemplates] = useState<FunilTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | StatusFunil>('todos');
  const [modalTemplateOpen, setModalTemplateOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/funis').then(r => r.json()).catch(() => []),
      fetch('/api/funis/templates').then(r => r.json()).catch(() => []),
    ]).then(([fs, tpls]) => {
      setFunis(Array.isArray(fs) ? fs : []);
      setTemplates(Array.isArray(tpls) ? tpls : []);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    let list = funis;
    if (statusFilter !== 'todos') {
      list = list.filter(f => f.status === statusFilter);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(f => f.nome.toLowerCase().includes(s));
    }
    return list.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  }, [funis, statusFilter, search]);

  const counts = useMemo(() => ({
    todos: funis.length,
    rascunho: funis.filter(f => f.status === 'rascunho').length,
    simulado: funis.filter(f => f.status === 'simulado').length,
    em_execucao: funis.filter(f => f.status === 'em_execucao').length,
  }), [funis]);

  const criarDeTemplate = async (template?: FunilTemplate) => {
    const id = generateId();
    const agora = new Date().toISOString();
    const novo: FunilPayload = template ? {
      id,
      nome: `${template.nome}`,
      status: 'rascunho',
      data: {
        ...template.data,
        cenarios: cenariosPadrao(),
        ultimo_simulado_at: null,
      },
      created_at: agora,
      updated_at: agora,
    } : {
      id,
      nome: 'Novo funil',
      status: 'rascunho',
      data: {
        nodes: [],
        edges: [],
        config: { moeda: 'BRL', periodo_simulacao: 'mensal', usar_dados_reais: false },
        cenarios: cenariosPadrao(),
        ultimo_simulado_at: null,
      },
      created_at: agora,
      updated_at: agora,
    };
    await fetch('/api/funis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(novo),
    });
    router.push(`/planejamento/funis/${id}`);
  };

  const duplicar = async (id: string) => {
    const res = await fetch(`/api/funis/${id}/duplicar`, { method: 'POST' });
    if (res.ok) {
      const copia = await res.json();
      setFunis(prev => [copia, ...prev]);
    }
  };

  const excluir = async (id: string) => {
    if (!confirm('Excluir este funil?')) return;
    await fetch(`/api/funis/${id}`, { method: 'DELETE' });
    setFunis(prev => prev.filter(f => f.id !== id));
  };

  if (loading) return (
    <div className="p-6">
      <PageHeader title="Funis e campanhas" subtitle="Simule resultado antes de investir" />
      <SkeletonCardGrid count={6} />
    </div>
  );

  return (
    <div className="p-6">
      <PageHeader
        title="Funis e campanhas"
        subtitle="Desenhe o funil, simule o ROI e compare cenários antes de investir"
        actions={
          <button
            onClick={() => setModalTemplateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90"
          >
            <Plus className="w-4 h-4" /> Novo funil
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar funil..."
            className="w-full pl-9 pr-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
          />
        </div>
        <div className="flex items-center gap-1 text-[var(--text-body-sm)]">
          {(['todos', 'rascunho', 'simulado', 'em_execucao'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                statusFilter === s
                  ? 'bg-[var(--t-green-bg)] text-[var(--t-green)] font-medium'
                  : 'text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)]'
              }`}
            >
              {s === 'todos' ? 'Todos' : STATUS_COLORS[s].label}
              <span className="ml-1.5 text-[var(--text-caption)] opacity-70">{counts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Filter className="w-7 h-7" />}
          title="Nenhum funil criado"
          description="Crie um funil a partir de um dos 6 templates prontos ou comece do zero. Simule o ROI antes de investir."
          action={{ label: 'Novo funil', onClick: () => setModalTemplateOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(f => {
            const cor = STATUS_COLORS[f.status];
            const nodeCount = f.data?.nodes?.length ?? 0;
            const kpis = f.data?.cenarios?.[0]?.kpis;
            return (
              <div
                key={f.id}
                className="group relative p-4 rounded-xl shadow-[var(--t-card-shadow)] bg-[var(--t-surface)] hover:shadow-[var(--t-card-shadow-hover)] transition-shadow"
              >
                <button
                  type="button"
                  onClick={() => router.push(`/planejamento/funis/${f.id}`)}
                  className="block w-full text-left"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[var(--t-green-bg)] flex items-center justify-center shrink-0">
                      <TrendingUp className="w-5 h-5 text-[var(--t-green)]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)] truncate">
                        {f.nome || 'Sem nome'}
                      </p>
                      <span className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[var(--text-caption)] ${cor.bg} ${cor.text}`}>
                        <CircleDot className="w-2.5 h-2.5" /> {cor.label}
                      </span>
                    </div>
                  </div>

                  {kpis && f.status !== 'rascunho' ? (
                    <div className="grid grid-cols-2 gap-2 mb-3 p-2 rounded-lg bg-[var(--t-bg)]">
                      <div>
                        <p className="text-[10px] text-[var(--t-text-muted)] uppercase">Lucro</p>
                        <p className={`text-[var(--text-body-sm)] font-semibold ${kpis.lucro >= 0 ? 'text-[var(--t-green)]' : 'text-red-500'}`}>
                          {formatBRL(kpis.lucro)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[var(--t-text-muted)] uppercase">ROI</p>
                        <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">
                          {(kpis.roi * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mb-3">
                      {nodeCount} etapa{nodeCount !== 1 ? 's' : ''} · ainda não simulado
                    </p>
                  )}

                  <div className="flex items-center justify-between text-[var(--text-caption)] text-[var(--t-text-muted)]">
                    <span>{nodeCount} nodes · {f.data?.edges?.length ?? 0} ligações</span>
                    {f.updated_at && (
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(f.updated_at).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                  </div>
                </button>

                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); duplicar(f.id); }}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)]"
                    title="Duplicar"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); excluir(f.id); }}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-red-500 hover:bg-red-500/10"
                    title="Excluir"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de templates */}
      {modalTemplateOpen && (
        <ModalTemplate
          templates={templates}
          onClose={() => setModalTemplateOpen(false)}
          onEscolher={(tpl) => {
            setModalTemplateOpen(false);
            criarDeTemplate(tpl);
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Modal de templates (inline para manter single-file — é componente simples)
// ----------------------------------------------------------------------------

function ModalTemplate({
  templates,
  onClose,
  onEscolher,
}: {
  templates: FunilTemplate[];
  onClose: () => void;
  onEscolher: (tpl?: FunilTemplate) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-4xl max-h-[85vh] overflow-y-auto bg-[var(--t-surface)] rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[var(--text-h2)] font-semibold text-[var(--t-text)] mb-1">Escolha um template</h2>
        <p className="text-[var(--text-body-sm)] text-[var(--t-text-muted)] mb-5">
          Comece com um funil pronto ou crie do zero. Você pode editar tudo depois.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => onEscolher(tpl)}
              className="text-left p-4 rounded-xl border border-[var(--t-border)] bg-[var(--t-bg)] hover:border-[var(--t-green)] hover:bg-[var(--t-green-bg)]/30 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-[var(--t-green-bg)] flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-[var(--t-green)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)] truncate">{tpl.nome}</p>
                  <p className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wide">{tpl.categoria}</p>
                </div>
              </div>
              <p className="text-[var(--text-caption)] text-[var(--t-text-secondary)] line-clamp-3">
                {tpl.data.descricao}
              </p>
              <p className="mt-2 text-[var(--text-caption)] text-[var(--t-text-muted)]">
                {tpl.data.nodes.length} etapas
              </p>
            </button>
          ))}

          {/* Card "em branco" */}
          <button
            onClick={() => onEscolher(undefined)}
            className="text-left p-4 rounded-xl border border-dashed border-[var(--t-border)] bg-transparent hover:border-[var(--t-green)] transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--t-sidebar-item-hover)] flex items-center justify-center">
                <Plus className="w-4 h-4 text-[var(--t-text-muted)]" />
              </div>
              <div>
                <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">Funil em branco</p>
                <p className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wide">Do zero</p>
              </div>
            </div>
            <p className="text-[var(--text-caption)] text-[var(--t-text-secondary)]">
              Comece com um canvas vazio e arraste os blocos que precisar.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}
