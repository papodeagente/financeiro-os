'use client';

import { X, FileImage, Type, Calendar, Clock } from 'lucide-react';
import type { Proposta } from '@/lib/crm-types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  proposta: Proposta;
  onUpdate: (fn: (p: Proposta) => Proposta) => void;
  onClose: () => void;
}

// Editor lateral direito para a CAPA da proposta. Aberto quando o
// usuario clica na secao de capa no canvas. Edita campos do
// proposta.cabecalho + proposta.visual.imagem_capa + estilo_capa.
// Usa os mesmos hooks de update do PropostaEditor (auto-save + undo).
export function PageHeaderEditor({ proposta, onUpdate, onClose }: Props) {
  return (
    <aside
      className="w-[320px] xl:w-[360px] shrink-0 border-l border-[var(--t-border)] bg-[var(--t-surface)] flex flex-col overflow-hidden"
      aria-label="Editar capa da proposta"
    >
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-[var(--t-border)] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md flex items-center justify-center bg-purple-500/10">
            <FileImage className="w-4 h-4 text-purple-500" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-[var(--t-text-muted)]">Editando</div>
            <div className="text-sm font-medium text-[var(--t-text)] truncate">Capa da proposta</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded text-[var(--t-text-muted)] hover:bg-[var(--t-surface-hover)] hover:text-[var(--t-text)]"
          title="Fechar (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Estilo da capa */}
        <div>
          <Label className="flex items-center gap-1.5 text-xs">
            <Type className="w-3 h-3" /> Estilo da capa
          </Label>
          <div className="grid grid-cols-3 gap-1.5 mt-1.5">
            {(['FULLSCREEN', 'SPLIT', 'MINIMAL'] as const).map(estilo => (
              <button
                key={estilo}
                onClick={() => onUpdate(p => { p.visual.estilo_capa = estilo; return p; })}
                className={`px-2 py-2 rounded-md border text-[10px] uppercase tracking-wider font-medium transition-all ${
                  proposta.visual.estilo_capa === estilo
                    ? 'border-purple-500 bg-purple-500/10 text-purple-700 dark:text-purple-400'
                    : 'border-[var(--t-border)] text-[var(--t-text-secondary)] hover:border-purple-300'
                }`}
              >
                {estilo}
              </button>
            ))}
          </div>
        </div>

        {/* Titulo */}
        <div>
          <Label>Título</Label>
          <Input
            value={proposta.cabecalho.titulo || ''}
            onChange={e => onUpdate(p => { p.cabecalho.titulo = e.target.value; return p; })}
            placeholder="Sua viagem dos sonhos"
          />
        </div>

        {/* Subtitulo */}
        <div>
          <Label>Subtítulo</Label>
          <Input
            value={proposta.cabecalho.subtitulo || ''}
            onChange={e => onUpdate(p => { p.cabecalho.subtitulo = e.target.value; return p; })}
            placeholder="Preparada especialmente para..."
          />
        </div>

        {/* Mensagem de abertura */}
        <div>
          <Label>Mensagem de abertura</Label>
          <Textarea
            rows={4}
            value={proposta.cabecalho.mensagem_abertura || ''}
            onChange={e => onUpdate(p => { p.cabecalho.mensagem_abertura = e.target.value; return p; })}
            placeholder="Mensagem personalizada que aparece logo depois da capa..."
            className="resize-none"
          />
          <p className="text-[10px] text-[var(--t-text-muted)] mt-1">
            Aparece em itálico, logo abaixo da capa.
          </p>
        </div>

        {/* Imagem da capa (URL) */}
        <div>
          <Label className="flex items-center gap-1.5 text-xs">
            <FileImage className="w-3 h-3" /> URL da imagem de capa
          </Label>
          <Input
            value={proposta.visual.imagem_capa || ''}
            onChange={e => onUpdate(p => { p.visual.imagem_capa = e.target.value; return p; })}
            placeholder="https://..."
          />
          {proposta.visual.imagem_capa && (
            <div className="mt-2 rounded-md overflow-hidden border border-[var(--t-border)] aspect-video bg-[var(--t-bg)]">
              <img
                src={proposta.visual.imagem_capa}
                alt="Preview capa"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}
        </div>

        {/* Datas */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="flex items-center gap-1.5 text-xs">
              <Calendar className="w-3 h-3" /> Data
            </Label>
            <Input
              type="date"
              value={proposta.cabecalho.data_proposta || ''}
              onChange={e => onUpdate(p => { p.cabecalho.data_proposta = e.target.value; return p; })}
            />
          </div>
          <div>
            <Label className="flex items-center gap-1.5 text-xs">
              <Clock className="w-3 h-3" /> Validade
            </Label>
            <Input
              type="date"
              value={proposta.cabecalho.validade || ''}
              onChange={e => onUpdate(p => { p.cabecalho.validade = e.target.value; return p; })}
            />
          </div>
        </div>
      </div>
    </aside>
  );
}
