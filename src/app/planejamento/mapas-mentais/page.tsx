'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Sparkles, Trash2, ArrowRight, GitBranch } from 'lucide-react';
import { createMindMap, type MapaMentalData, getChildren } from '@/lib/mapa-mental';

export default function ListaMapasMentaisPage() {
  const router = useRouter();
  const [mapas, setMapas] = useState<MapaMentalData[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const carregar = () => {
    fetch('/api/mapas-mentais').then(r => r.json()).then((data) => {
      if (Array.isArray(data)) {
        setMapas(data.filter((m: MapaMentalData) => m && m.id));
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(carregar, []);

  const criar = async (nome: string) => {
    if (creating) return;
    setCreating(true);
    const mapa = createMindMap(nome);
    try {
      const res = await fetch('/api/mapas-mentais', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapa),
      });
      if (res.ok) {
        router.push(`/planejamento/mapas-mentais/${mapa.id}`);
        return;
      }
    } catch { /* ignore */ }
    setCreating(false);
  };

  const remover = async (id: string, nome: string) => {
    if (!confirm(`Remover o mapa "${nome}"? Esta ação não pode ser desfeita.`)) return;
    await fetch(`/api/mapas-mentais/${id}`, { method: 'DELETE' });
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
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            Mapas mentais
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Crie e organize ideias visualmente. Tab/Enter adiciona nós; arraste pra reorganizar.
          </p>
        </div>
        <button
          onClick={() => criar('Novo mapa mental')}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Novo mapa
        </button>
      </div>

      {mapas.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center mx-auto mb-3">
            <GitBranch className="w-6 h-6 text-white" />
          </div>
          <h3 className="font-semibold text-slate-900 mb-1">Comece seu primeiro mapa</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-5">
            Organize ideias em uma estrutura radial. Brainstorms, planejamento estratégico, decomposição de projetos — tudo no mesmo formato.
          </p>
          <button
            onClick={() => criar('Meu primeiro mapa')}
            disabled={creating}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Criar mapa
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mapas.map(m => (
            <CardMapa key={m.id} mapa={m} onRemove={() => remover(m.id, m.nome)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CardMapa({ mapa, onRemove }: { mapa: MapaMentalData; onRemove: () => void }) {
  const totalNodes = mapa.nodes ? Object.keys(mapa.nodes).length : 0;
  const rootNode = mapa.rootId ? mapa.nodes?.[mapa.rootId] : null;
  const firstChildren = mapa.rootId && mapa.nodes ? getChildren(mapa, mapa.rootId).slice(0, 4) : [];

  return (
    <div className="group relative bg-white rounded-2xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-lg transition-all">
      <Link href={`/planejamento/mapas-mentais/${mapa.id}`} className="block">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 truncate">{mapa.nome || 'Sem título'}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {totalNodes} {totalNodes === 1 ? 'nó' : 'nós'}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-blue-600 transition-colors shrink-0 mt-1" />
        </div>

        {/* Mini-preview da arvore */}
        <div className="bg-slate-50 rounded-lg p-3 mb-3 border border-slate-100">
          <div className="text-xs font-bold text-slate-700 mb-1 truncate">
            {rootNode?.text || 'Ideia central'}
          </div>
          <div className="space-y-0.5">
            {firstChildren.map(c => (
              <div key={c.id} className="text-[11px] text-slate-500 truncate pl-3 relative">
                <span className="absolute left-0 top-1.5 w-1.5 h-px bg-slate-300" />
                {c.text || '...'}
              </div>
            ))}
            {firstChildren.length === 0 && (
              <div className="text-[11px] text-slate-400 italic">sem ramos ainda</div>
            )}
          </div>
        </div>
      </Link>

      <button
        onClick={(e) => { e.preventDefault(); onRemove(); }}
        className="absolute top-2 right-2 p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remover mapa"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
