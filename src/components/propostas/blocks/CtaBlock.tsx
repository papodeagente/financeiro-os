'use client';

import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/propostas/ImageUpload';
import type { BlockProps } from './types';

export function CtaBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as { texto_botao?: string; tipo_acao?: string; numero_whatsapp?: string; mensagem_predefinida?: string; cor_botao?: string; imagem_fundo?: string };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-1 block">Tipo de acao</label>
          <select
            value={c.tipo_acao || 'WHATSAPP'}
            onChange={e => onChange({ ...conteudo, tipo_acao: e.target.value })}
            className="w-full bg-[var(--t-bg)] border border-[var(--t-border)] text-[var(--t-text)] rounded-md px-3 py-2 text-sm"
          >
            <option value="WHATSAPP">WhatsApp</option>
            <option value="LINK">Link externo</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-1 block">Cor do botao</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={c.cor_botao || '#004aad'}
              onChange={e => onChange({ ...conteudo, cor_botao: e.target.value })}
              className="w-8 h-8 rounded cursor-pointer border border-[var(--t-border)]"
            />
            <Input
              value={c.cor_botao || '#004aad'}
              onChange={e => onChange({ ...conteudo, cor_botao: e.target.value })}
              className="flex-1 bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-xs"
            />
          </div>
        </div>
      </div>
      <Input
        value={c.texto_botao || ''}
        onChange={e => onChange({ ...conteudo, texto_botao: e.target.value })}
        placeholder="Texto do botao"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <Input
        value={c.numero_whatsapp || ''}
        onChange={e => onChange({ ...conteudo, numero_whatsapp: e.target.value })}
        placeholder="Numero WhatsApp (com DDD)"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <Input
        value={c.mensagem_predefinida || ''}
        onChange={e => onChange({ ...conteudo, mensagem_predefinida: e.target.value })}
        placeholder="Mensagem predefinida"
        className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)]"
      />
      <div>
        <label className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-1 block">Imagem de fundo (opcional)</label>
        <ImageUpload
          compact
          currentUrl={c.imagem_fundo}
          onUpload={urls => onChange({ ...conteudo, imagem_fundo: urls[0] })}
          onRemove={() => onChange({ ...conteudo, imagem_fundo: '' })}
        />
      </div>
    </div>
  );
}
