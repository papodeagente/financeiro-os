'use client';

/**
 * Modal de geração de imagens via IA (OpenAI gpt-image-1 / DALL·E 3).
 *
 * Uso: passar `open`, `onClose` e `onPick(urls)` — quando o usuário
 * confirma a seleção, devolvemos as URLs locais já persistidas em
 * /api/uploads. Suporta n=1..4 e três formatos (quadrado, paisagem,
 * retrato). O sugestor de prompts ajuda o usuário a descrever a cena.
 */

import { useState } from 'react';
import { X, Sparkles, Loader2, Wand2, Check } from 'lucide-react';

interface AIImageGeneratorProps {
  open: boolean;
  onClose: () => void;
  onPick: (urls: string[]) => void;
  /** Prompt inicial sugerido (ex: nome do destino, hotel) */
  initialPrompt?: string;
  /** Quando true, devolve só 1 URL — útil para campos de imagem única. */
  singleSelect?: boolean;
  /** Texto do botão de inserir (default: "Usar selecionadas") */
  insertLabel?: string;
}

const SIZE_OPTIONS = [
  { value: '1024x1024', label: 'Quadrado', hint: '1:1' },
  { value: '1536x1024', label: 'Paisagem', hint: '16:9 aprox.' },
  { value: '1024x1536', label: 'Retrato', hint: '9:16 aprox.' },
];

const STYLE_OPTIONS = [
  { value: '', label: 'Padrão' },
  { value: 'fotografia profissional, iluminação natural, alta resolução, realista', label: 'Foto realista' },
  { value: 'fotografia editorial de viagem, golden hour, aspecto cinematográfico', label: 'Editorial cinematográfico' },
  { value: 'aquarela, ilustração suave, traço artístico', label: 'Aquarela' },
  { value: 'minimalista, fundo limpo, design moderno', label: 'Minimalista' },
];

const PROMPT_HINTS = [
  'Vista panorâmica de Jerusalém ao pôr do sol com a Cúpula da Rocha em destaque',
  'Lobby elegante de hotel cinco estrelas em estilo mediterrâneo, luz natural',
  'Casal jovem brindando taças de vinho em restaurante vista mar na Toscana',
  'Cidade do Cairo com pirâmides ao fundo, fotografia profissional',
  'Praia paradisíaca em Bora Bora com bangalôs sobre a água, céu azul',
];

export function AIImageGenerator({
  open,
  onClose,
  onPick,
  initialPrompt = '',
  singleSelect = false,
  insertLabel = 'Usar selecionadas',
}: AIImageGeneratorProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [estilo, setEstilo] = useState('');
  const [size, setSize] = useState('1536x1024');
  const [n, setN] = useState(2);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  if (!open) return null;

  const generate = async () => {
    if (!prompt.trim()) {
      setError('Descreva a imagem que você quer gerar.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/imagem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, estilo, n: singleSelect ? 1 : n, size }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Falha ao gerar imagem');
      } else if (Array.isArray(data.urls)) {
        setResults(prev => [...data.urls, ...prev]);
        setPicked(new Set(singleSelect && data.urls[0] ? [data.urls[0]] : []));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro de conexão');
    }
    setGenerating(false);
  };

  const togglePick = (url: string) => {
    if (singleSelect) {
      setPicked(new Set([url]));
      return;
    }
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const insert = () => {
    const urls = Array.from(picked);
    if (urls.length === 0) return;
    onPick(urls);
    onClose();
    // limpar para próxima abertura
    setPrompt('');
    setResults([]);
    setPicked(new Set());
    setError(null);
  };

  const close = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={close}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-3xl max-h-[90vh] bg-[var(--t-surface)] rounded-2xl shadow-2xl border border-[var(--t-border)] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--t-border)]">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-[var(--text-body-lg)] font-semibold text-[var(--t-text)]">Gerar imagem com IA</h3>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">
                Descreva a cena e a IA gera imagens em segundos
              </p>
            </div>
          </div>
          <button onClick={close} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--t-surface-hover)]">
            <X className="w-4 h-4 text-[var(--t-text-muted)]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Prompt */}
          <div>
            <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1.5">
              Descrição da imagem
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={3}
              placeholder="Ex: Vista panorâmica de Jerusalém ao pôr do sol com a Cúpula da Rocha em destaque"
              className="w-full px-3 py-2 rounded-lg shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)] resize-none"
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {PROMPT_HINTS.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setPrompt(h)}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--t-bg)] text-[var(--t-text-secondary)] border border-[var(--t-border)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"
                >
                  {h.length > 50 ? h.slice(0, 50) + '...' : h}
                </button>
              ))}
            </div>
          </div>

          {/* Opções */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1.5">Estilo</label>
              <select
                value={estilo}
                onChange={e => setEstilo(e.target.value)}
                className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
              >
                {STYLE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1.5">Formato</label>
              <select
                value={size}
                onChange={e => setSize(e.target.value)}
                className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
              >
                {SIZE_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label} ({s.hint})</option>)}
              </select>
            </div>
            {!singleSelect && (
              <div>
                <label className="text-[var(--text-caption)] text-[var(--t-text-muted)] block mb-1.5">Quantidade</label>
                <select
                  value={n}
                  onChange={e => setN(parseInt(e.target.value))}
                  className="w-full px-2 py-1.5 rounded-md shadow-[var(--t-card-shadow)] bg-[var(--t-input-bg)] text-[var(--text-body-sm)] text-[var(--t-text)]"
                >
                  {[1, 2, 3, 4].map(v => <option key={v} value={v}>{v} variação{v > 1 ? 'ões' : ''}</option>)}
                </select>
              </div>
            )}
          </div>

          <button
            onClick={generate}
            disabled={generating || !prompt.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {generating ? 'Gerando...' : 'Gerar imagens'}
          </button>

          {error && (
            <div className="p-2 rounded-md bg-red-500/10 text-red-500 text-[var(--text-caption)]">{error}</div>
          )}

          {/* Resultados */}
          {results.length > 0 && (
            <div>
              <p className="text-[var(--text-caption)] font-semibold text-[var(--t-text-secondary)] uppercase tracking-wider mb-2">
                Resultados — clique para selecionar
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {results.map(url => {
                  const isPicked = picked.has(url);
                  return (
                    <button
                      key={url}
                      type="button"
                      onClick={() => togglePick(url)}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                        isPicked ? 'border-[var(--t-green)] ring-2 ring-[var(--t-green)]/30' : 'border-transparent hover:border-[var(--t-border-hover)]'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Geração IA" className="w-full h-full object-cover" />
                      {isPicked && (
                        <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[var(--t-green)] flex items-center justify-center shadow-lg">
                          <Check className="w-3.5 h-3.5 text-white" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-[var(--t-border)]">
          <span className="text-[var(--text-caption)] text-[var(--t-text-muted)]">
            {picked.size > 0
              ? `${picked.size} imagem${picked.size > 1 ? 'ns' : ''} selecionada${picked.size > 1 ? 's' : ''}`
              : 'Nenhuma selecionada'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={close}
              className="px-3 py-1.5 text-[var(--text-body-sm)] text-[var(--t-text-secondary)] hover:bg-[var(--t-surface-hover)] rounded-lg"
            >
              Cancelar
            </button>
            <button
              onClick={insert}
              disabled={picked.size === 0}
              className="px-4 py-1.5 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {insertLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
