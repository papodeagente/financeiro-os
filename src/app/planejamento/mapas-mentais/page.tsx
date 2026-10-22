'use client';

import { useEffect, useState } from 'react';
import { IconeDeIndicador } from '@/components/fin/MetricCard';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Sparkles, Trash2, ArrowRight, GitBranch, X, FilePlus2 } from 'lucide-react';
import { createMindMap, type MapaMentalData, getChildren } from '@/lib/mapa-mental';
import { MODELOS_DE_MAPA, CATEGORIAS, construirDoModelo, type ModeloDeMapa } from '@/lib/mapa-mental-templates';

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

  const [escolhendo, setEscolhendo] = useState(false);

  const criar = async (nome: string, modelo?: ModeloDeMapa) => {
    if (creating) return;
    setCreating(true);
    setEscolhendo(false);
    // Modelo é uma pergunta já feita: SWOT vem com as quatro palavras,
    // roteiro vem com os dias. Em branco continua sendo uma opção.
    const mapa = modelo ? construirDoModelo(modelo, nome) : createMindMap(nome);
    try {
      const res = await fetch('/api/mapas-mentais', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mapa),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('[criar mapa] POST falhou', res.status, errText);
        alert(`Erro ao criar mapa: ${res.status} ${errText.slice(0, 200) || 'sem detalhe'}`);
        setCreating(false);
        return;
      }
      // POST OK — guarda em sessionStorage pra o editor pegar imediato
      // (evita race com a leitura no GET da rota [id]). Entrada com
      // timestamp: o editor só aceita se for recente (15s).
      try {
        sessionStorage.setItem(`mapa-mental:${mapa.id}`, JSON.stringify({ t: Date.now(), data: mapa }));
      } catch { /* ignore */ }
      router.push(`/planejamento/mapas-mentais/${mapa.id}`);
    } catch (e) {
      console.error('[criar mapa] erro de rede', e);
      alert(`Erro de rede: ${e instanceof Error ? e.message : 'desconhecido'}`);
      setCreating(false);
    }
  };

  const remover = async (id: string, nome: string) => {
    if (!confirm(`Remover o mapa "${nome}"? Esta ação não pode ser desfeita.`)) return;
    await fetch(`/api/mapas-mentais/${id}`, { method: 'DELETE' });
    carregar();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--fin-text-3)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-[var(--fin-page-pad)] py-[var(--fin-page-pad)]">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-[var(--fin-s-3)]">
            <IconeDeIndicador icone={Sparkles} tamanho="lg" />
            <h1 className="fin-t-title text-[var(--fin-text)]">Mapas mentais</h1>
          </div>
          <p className="text-sm text-[var(--fin-text-2)] mt-1">
            Crie e organize ideias visualmente. Tab/Enter adiciona nós; arraste pra reorganizar.
          </p>
        </div>
        <button
          onClick={() => setEscolhendo(true)}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] text-sm font-semibold hover:bg-[var(--fin-accent-hover)] disabled:opacity-60"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Novo mapa
        </button>
      </div>

      {mapas.length === 0 ? (
        <div className="bg-[var(--fin-surface)] rounded-2xl border-2 border-dashed border-[var(--fin-border)] p-12 text-center shadow-[var(--fin-e-card)]">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--fin-accent)] to-[var(--fin-positive)] flex items-center justify-center mx-auto mb-3">
            <GitBranch className="w-6 h-6 text-white" />
          </div>
          <h3 className="font-semibold text-[var(--fin-text)] mb-1">Comece seu primeiro mapa</h3>
          <p className="text-sm text-[var(--fin-text-3)] max-w-sm mx-auto mb-5">
            Organize ideias em uma estrutura radial. Brainstorms, planejamento estratégico, decomposição de projetos — tudo no mesmo formato.
          </p>
          <button
            onClick={() => setEscolhendo(true)}
            disabled={creating}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--fin-text)] text-[var(--fin-text-on-fill)] text-sm font-semibold hover:bg-[var(--fin-text)] disabled:opacity-60"
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
      {escolhendo && (
        <EscolhedorDeModelo
          criando={creating}
          onFechar={() => setEscolhendo(false)}
          onEscolher={(modelo) => criar(modelo ? modelo.nome : 'Novo mapa mental', modelo ?? undefined)}
        />
      )}
    </div>
  );
}

function CardMapa({ mapa, onRemove }: { mapa: MapaMentalData; onRemove: () => void }) {
  const totalNodes = mapa.nodes ? Object.keys(mapa.nodes).length : 0;
  const rootNode = mapa.rootId ? mapa.nodes?.[mapa.rootId] : null;
  const firstChildren = mapa.rootId && mapa.nodes ? getChildren(mapa, mapa.rootId).slice(0, 4) : [];

  return (
    <div className="group relative bg-[var(--fin-surface)] rounded-2xl border border-[var(--fin-border)] p-5 hover:border-[var(--fin-accent)]/30 hover:shadow-lg transition-all">
      <Link href={`/planejamento/mapas-mentais/${mapa.id}`} className="block">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-[var(--fin-text)] truncate">{mapa.nome || 'Sem título'}</h3>
            <p className="text-[11px] text-[var(--fin-text-3)] mt-0.5">
              {totalNodes} {totalNodes === 1 ? 'nó' : 'nós'}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-[var(--fin-text-3)] group-hover:text-[var(--fin-accent)] transition-colors shrink-0 mt-1" />
        </div>

        {/* Mini-preview da arvore */}
        <div className="bg-[var(--fin-surface-2)] rounded-lg p-3 mb-3 border border-[var(--fin-border)]">
          <div className="text-xs font-bold text-[var(--fin-text-2)] mb-1 truncate">
            {rootNode?.text || 'Ideia central'}
          </div>
          <div className="space-y-0.5">
            {firstChildren.map(c => (
              <div key={c.id} className="text-[11px] text-[var(--fin-text-3)] truncate pl-3 relative">
                <span className="absolute left-0 top-1.5 w-1.5 h-px bg-[var(--fin-border-strong)]" />
                {c.text || '...'}
              </div>
            ))}
            {firstChildren.length === 0 && (
              <div className="text-[11px] text-[var(--fin-text-3)] italic">sem ramos ainda</div>
            )}
          </div>
        </div>
      </Link>

      <button
        onClick={(e) => { e.preventDefault(); onRemove(); }}
        className="absolute top-2 right-2 p-1.5 rounded-lg text-[var(--fin-text-3)] hover:text-[var(--fin-negative-text)] hover:bg-[var(--fin-negative-soft)] opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remover mapa"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ============================================================
// Escolhedor de modelo
// ============================================================
/**
 * Janela central com os modelos em cartões: ícone, nome, uma frase e a
 * categoria. Em branco vem primeiro, porque é o que a pessoa já esperava
 * encontrar — o modelo é um ganho, não um pedágio.
 */
function EscolhedorDeModelo({ criando, onFechar, onEscolher }: {
  criando: boolean;
  onFechar: () => void;
  onEscolher: (modelo: ModeloDeMapa | null) => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onFechar]);

  const CARTAO = 'group flex flex-col items-start gap-3 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4 text-left transition-colors hover:border-[var(--fin-accent)] hover:bg-[var(--fin-accent-soft)] focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 disabled:opacity-60';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="escolher-modelo-titulo"
    >
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onFechar} />
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--fin-r-lg)] bg-[var(--fin-bg)] shadow-[var(--fin-e-card)]">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--fin-border)] bg-[var(--fin-surface)] px-6 py-5">
          <div>
            <h2 id="escolher-modelo-titulo" className="fin-t-subhead text-[var(--fin-text)]">Como você quer começar?</h2>
            <p className="fin-t-caption mt-1 text-[var(--fin-text-3)]">Um modelo já vem com a pergunta feita. Dá para mudar tudo depois.</p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="grid size-9 shrink-0 place-items-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-3 overflow-y-auto p-6 sm:grid-cols-2 lg:grid-cols-3">
          <button type="button" disabled={criando} onClick={() => onEscolher(null)} className={CARTAO}>
            <IconeDeIndicador icone={FilePlus2} tom="acento" />
            <span>
              <span className="block fin-t-body-strong text-[var(--fin-text)]">Em branco</span>
              <span className="block fin-t-caption text-[var(--fin-text-3)]">Só a ideia central. Você monta o resto.</span>
            </span>
          </button>
          {MODELOS_DE_MAPA.map(modelo => (
            <button key={modelo.id} type="button" disabled={criando} onClick={() => onEscolher(modelo)} className={CARTAO}>
              <div className="flex w-full items-start justify-between gap-2">
                <IconeDeIndicador icone={modelo.icone} tom={modelo.categoria === 'viagens' ? 'info' : modelo.categoria === 'estrategia' ? 'violeta' : 'acento'} />
                <span className="fin-t-overline rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)] px-1.5 py-0.5 text-[var(--fin-text-3)]">{CATEGORIAS[modelo.categoria]}</span>
              </div>
              <span>
                <span className="block fin-t-body-strong text-[var(--fin-text)]">{modelo.nome}</span>
                <span className="block fin-t-caption text-[var(--fin-text-3)]">{modelo.descricao}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
