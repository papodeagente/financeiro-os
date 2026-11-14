'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useModulos } from '@/components/useModulos';
import { recentesDaConta, resultadosDaBusca, textoDaCaixa, type CommandItem } from '@/components/itens-da-busca';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Versão e módulos da agência (itens-da-busca.ts): a simples busca como sempre buscou.
  const { user } = useAuth();
  const modulos = useModulos();
  const ctx = useMemo(
    () => ({ modulos: { ligados: modulos.ligados, telasCompletas: modulos.telasCompletas }, ecossistema: user?.tenantPerfil === 'ecossistema' }),
    [modulos.ligados, modulos.telasCompletas, user?.tenantPerfil],
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const recents = useMemo(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = JSON.parse(localStorage.getItem('entur:recentes') || '[]') as string[];
      return recentesDaConta(stored, ctx);
    } catch { return []; }
  }, [open, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => resultadosDaBusca(query, recents, ctx), [query, recents, ctx]);

  const handleSelect = (item: CommandItem) => {
    onClose();
    router.push(item.href);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIdx]) {
      handleSelect(filtered[selectedIdx]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  const sectionLabels: Record<string, string> = {
    criar: 'Criar',
    recentes: 'Recentes',
    navegacao: 'Navegação',
    crm: 'Integração',
    mercado: 'Pelo nome que você já usa',
    glossario: 'Glossário da mudança',
  };

  let lastSection = '';
  let globalIdx = -1;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-lg bg-[var(--t-surface)] shadow-[var(--t-card-shadow)] rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--t-border)]">
          <Search className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={textoDaCaixa(ctx)}
            className="flex-1 bg-transparent text-[length:var(--text-body)] text-[var(--t-text)] outline-none placeholder:text-[var(--t-text-muted)]"
          />
          <kbd className="text-[10px] text-[var(--t-text-muted)] bg-[var(--t-sidebar-item-hover)] px-1.5 py-0.5 rounded">ESC</kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-[length:var(--text-body-sm)] text-[var(--t-text-muted)]">Nenhum resultado</p>
          )}
          {filtered.map((item) => {
            globalIdx++;
            const idx = globalIdx;
            const showSection = item.section !== lastSection;
            lastSection = item.section;

            return (
              <div key={item.id}>
                {showSection && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
                    {sectionLabels[item.section]}
                  </div>
                )}
                <button
                  className={`w-full flex items-center gap-3 px-4 py-2 text-[length:var(--text-body-sm)] transition-colors ${
                    idx === selectedIdx
                      ? 'bg-[var(--t-green)]/8 text-[var(--t-green)]'
                      : 'text-[var(--t-text-secondary)] hover:bg-[var(--t-sidebar-item-hover)]'
                  }`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                >
                  <item.icon className="w-4 h-4" />
                  {item.dica ? (
                    <span className="flex min-w-0 flex-col text-left">
                      <span>{item.label}</span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">{item.dica}</span>
                    </span>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
