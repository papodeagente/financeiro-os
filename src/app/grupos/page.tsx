'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { GrupoViagem } from '@/lib/types';
import { createGrupoViagem } from '@/lib/defaults';
import { loadGrupos, saveGrupos, deleteGrupo, exportGrupoJSON, importGrupoJSON } from '@/lib/storage';
import { formatDate } from '@/lib/utils';
import { useApp } from '@/contexts/AppContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Plus, Copy, Download, Upload, Trash2, FolderOpen, Filter, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { toast } from '@/lib/toast';

const PIPELINE_COLORS: Record<string, string> = {
  PRODUTO: 'bg-gray-200 text-gray-700',
  PROPOSTA: 'bg-blue-100 text-blue-700',
  ORCAMENTO: 'bg-amber-100 text-amber-700',
  RESERVA: 'bg-purple-100 text-purple-700',
  VENDA: 'bg-green-100 text-green-700',
};

const PIPELINE_OPTIONS = ['TODOS', 'PRODUTO', 'PROPOSTA', 'ORCAMENTO', 'RESERVA', 'VENDA'] as const;

const TARIFA_OPTIONS = [
  { key: 'sgl' as const, label: 'SGL', desc: 'Single — 1 pessoa' },
  { key: 'dbl' as const, label: 'DBL', desc: 'Duplo — 2 pessoas' },
  { key: 'tpl' as const, label: 'TPL', desc: 'Triplo — 3 pessoas' },
  { key: 'qdp' as const, label: 'QDP', desc: 'Quádruplo — 4 pessoas' },
] as const;

export default function GruposPage() {
  const router = useRouter();
  const [grupos, setGrupos] = useState<GrupoViagem[]>([]);
  const [filtroStatus, setFiltroStatus] = useState<string>('TODOS');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTarifas, setNewTarifas] = useState<Set<'sgl' | 'dbl' | 'tpl' | 'qdp'>>(new Set(['dbl']));
  const [newNome, setNewNome] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setActiveGrupo } = useApp();

  useEffect(() => { loadGrupos().then(setGrupos); }, []);

  const gruposFiltrados = filtroStatus === 'TODOS'
    ? grupos
    : grupos.filter(g => (g.status_pipeline || 'PRODUTO') === filtroStatus);

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
    novo.tarifas_ativas = Array.from(newTarifas);
    novo.origem_destino = newNome.trim();
    const updated = [...grupos, novo];
    setGrupos(updated);
    await saveGrupos(updated);
    setShowNewModal(false);
    setNewTarifas(new Set(['dbl']));
    setNewNome('');
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

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <PageShell
        header={
          <PageHeader
            title="Produtos"
            subtitle="Crie e configure produtos de viagem para vender"
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
        {/* Filtros */}
        {grupos.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--t-text-muted)]" />
            {PIPELINE_OPTIONS.map(opt => (
              <button
                key={opt}
                onClick={() => setFiltroStatus(opt)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filtroStatus === opt
                    ? 'bg-[var(--t-accent)] text-white'
                    : 'bg-[var(--t-bg)] text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)]'
                }`}
              >
                {opt === 'TODOS' ? `Todos (${grupos.length})` : `${opt} (${grupos.filter(g => (g.status_pipeline || 'PRODUTO') === opt).length})`}
              </button>
            ))}
          </div>
        )}

        {grupos.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="w-7 h-7" />}
            title="Nenhum produto criado"
            description="Crie seu primeiro produto de viagem para começar a montar propostas e fechar vendas."
            action={{ label: 'Novo Produto', onClick: () => setShowNewModal(true) }}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {gruposFiltrados.map(g => {
              const pipelineStatus = g.status_pipeline || 'PRODUTO';
              return (
              <Card key={g.id} className="hover:shadow-lg transition-shadow border-l-4 border-l-[#d4a853]">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-lg text-[var(--t-text)]">{g.grp_id || 'Sem ID'}</h3>
                      <p className="text-sm text-[var(--t-text-secondary)]">{g.origem_destino || <span className="italic text-[var(--t-text-muted)]">Destino não definido</span>}</p>
                    </div>
                    <Badge className={`text-[10px] ${PIPELINE_COLORS[pipelineStatus] || PIPELINE_COLORS.PRODUTO}`}>
                      {pipelineStatus}
                    </Badge>
                  </div>
                  <div className="text-xs text-[var(--t-text-secondary)] mb-4">
                    <div>Criado: {formatDate(g.created_at?.split('T')[0])}</div>
                    <div>Atualizado: {formatDate(g.updated_at?.split('T')[0])}</div>
                    <div>{g.periodos.length} periodo(s) | {g.trechos.length} trecho(s)</div>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/grupo/${g.id}`}
                      className="flex-1"
                      onClick={() => setActiveGrupo(g.id, g.grp_id || 'Sem ID')}
                    >
                      <Button className="w-full bg-[var(--t-green)] hover:opacity-90 text-white" size="sm">
                        <FolderOpen className="w-4 h-4 mr-1" /> Abrir
                      </Button>
                    </Link>
                    <Button variant="outline" size="sm" onClick={() => duplicarGrupo(g)} title="Duplicar"><Copy className="w-4 h-4" /></Button>
                    <Button variant="outline" size="sm" onClick={() => exportar(g)} title="Exportar JSON"><Download className="w-4 h-4" /></Button>
                    <Button variant="outline" size="sm" onClick={() => removerGrupo(g.id)} title="Excluir" className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </CardContent>
              </Card>
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
