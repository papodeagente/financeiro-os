'use client';

import { useState, useRef } from 'react';
import { Upload, Loader2, ImageIcon, X, Sparkles } from 'lucide-react';
import { AIImageGenerator } from './AIImageGenerator';

interface Props {
  onUpload: (urls: string[]) => void;
  multiple?: boolean;
  currentUrl?: string;
  onRemove?: () => void;
  compact?: boolean;
  /** Sugestão inicial passada ao gerador de IA (ex: nome do hotel/destino) */
  aiHint?: string;
}

export function ImageUpload({ onUpload, multiple, currentUrl, onRemove, compact, aiHint }: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('files', f));
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (Array.isArray(data)) {
        onUpload(data.map((d: { url: string }) => d.url));
      } else if (data.error) {
        alert(data.error);
      }
    } catch {
      alert('Erro ao enviar imagem');
    }
    setUploading(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // Compact mode: small button for inline use
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {currentUrl && (
          <div className="relative w-16 h-12 rounded overflow-hidden shadow-[var(--t-card-shadow)]">
            <img src={currentUrl} alt="" className="w-full h-full object-cover" />
            {onRemove && (
              <button onClick={onRemove} className="absolute top-0 right-0 bg-black/60 rounded-bl p-0.5">
                <X className="w-3 h-3 text-white" />
              </button>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-dashed border-[var(--t-border)] text-[var(--t-text-secondary)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"
        >
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          {uploading ? 'Enviando...' : currentUrl ? 'Trocar' : 'Upload'}
        </button>
        <button
          type="button"
          onClick={() => setAiOpen(true)}
          disabled={uploading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-dashed border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 transition-colors"
          title="Gerar imagem com IA"
        >
          <Sparkles className="w-3 h-3" /> IA
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple={multiple}
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        <AIImageGenerator
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          onPick={(urls) => onUpload(urls)}
          initialPrompt={aiHint}
          singleSelect={!multiple}
        />
      </div>
    );
  }

  // Full drop zone
  return (
    <div className="space-y-2">
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
          dragOver
            ? 'border-[var(--t-green)] bg-[var(--t-green)]/5'
            : 'border-[var(--t-border)] hover:border-[var(--t-green)]/50 bg-[var(--t-bg)]'
        }`}
      >
        {uploading ? (
          <>
            <Loader2 className="w-6 h-6 text-[var(--t-green)] animate-spin" />
            <span className="text-xs text-[var(--t-text-secondary)]">Enviando...</span>
          </>
        ) : (
          <>
            <ImageIcon className="w-6 h-6 text-[var(--t-text-muted)]" />
            <span className="text-xs text-[var(--t-text-secondary)]">
              Arraste imagens aqui ou clique para selecionar
            </span>
            <span className="text-[10px] text-[var(--t-text-muted)]">
              JPG, PNG, WebP, GIF — max 10MB
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple={multiple}
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
      </div>
      <button
        type="button"
        onClick={() => setAiOpen(true)}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-dashed border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5" /> Gerar com IA
      </button>
      <AIImageGenerator
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onPick={(urls) => onUpload(urls)}
        initialPrompt={aiHint}
        singleSelect={!multiple}
      />
    </div>
  );
}
