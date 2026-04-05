'use client';

import { useEffect, useState } from 'react';
import { TemplateProposta } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { FileText, Search, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (template: TemplateProposta | null) => void;
}

export function TemplatePickerModal({ open, onClose, onSelect }: Props) {
  const [templates, setTemplates] = useState<TemplateProposta[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // Seed then load
    fetch('/api/templates-proposta/seed', { method: 'POST' })
      .then(() => loadEntities<TemplateProposta>('templates-proposta'))
      .then(t => { setTemplates(t); setLoading(false); })
      .catch(() => {
        loadEntities<TemplateProposta>('templates-proposta')
          .then(t => { setTemplates(t); setLoading(false); });
      });
  }, [open]);

  if (!open) return null;

  const filtered = templates.filter(t => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.nome.toLowerCase().includes(q) || t.descricao.toLowerCase().includes(q) || t.tipo_viagem.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--t-surface)] border border-[var(--t-border)] rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col" style={{ boxShadow: 'var(--elevation-4)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--t-border)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--t-text)]">Escolha o template da proposta</h2>
            <p className="text-xs text-[var(--t-text-secondary)] mt-0.5">O layout, cores e estilo do template serao aplicados a proposta gerada</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-[var(--t-border)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--t-text-muted)]" />
            <Input
              placeholder="Buscar template..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--t-green)]" />
              <span className="ml-2 text-sm text-[var(--t-text-secondary)]">Carregando templates...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Classic default option */}
              <button
                onClick={() => onSelect(null)}
                className="text-left rounded-xl border-2 border-dashed border-[var(--t-border)] hover:border-[var(--t-green)] transition-colors group overflow-hidden"
              >
                <div className="h-28 bg-[var(--t-bg)] flex items-center justify-center">
                  <FileText className="w-10 h-10 text-[var(--t-text-muted)] group-hover:text-[var(--t-green)] transition-colors" />
                </div>
                <div className="p-3">
                  <h3 className="text-sm font-semibold text-[var(--t-text)]">Classico Padrao</h3>
                  <p className="text-[10px] text-[var(--t-text-secondary)] mt-0.5">Layout classico com cores padrao</p>
                </div>
              </button>

              {/* Template cards */}
              {filtered.map(t => (
                <button
                  key={t.id}
                  onClick={() => onSelect(t)}
                  className="text-left rounded-xl border border-[var(--t-border)] hover:border-[var(--t-green)] transition-colors group overflow-hidden"
                >
                  <div className="h-28 bg-cover bg-center relative" style={{
                    backgroundImage: t.imagem_preview ? `url(${t.imagem_preview})` : undefined,
                    backgroundColor: t.imagem_preview ? undefined : t.visual.cor_primaria,
                  }}>
                    <div className="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors" />
                    <div className="absolute top-2 left-2">
                      <span className="text-xl">{t.icone}</span>
                    </div>
                    <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                      <span className="text-[9px] bg-white/20 backdrop-blur-sm text-white px-1.5 py-0.5 rounded-full">
                        {t.visual.layout}
                      </span>
                    </div>
                  </div>
                  <div className="p-3">
                    <h3 className="text-sm font-semibold text-[var(--t-text)]">{t.nome}</h3>
                    <p className="text-[10px] text-[var(--t-text-secondary)] mt-0.5 line-clamp-2">{t.descricao}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
