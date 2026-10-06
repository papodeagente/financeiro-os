'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, FileEdit, Send, CheckCircle2, XCircle } from 'lucide-react';

export type StatusProposta = 'RASCUNHO' | 'ENVIADO' | 'ACEITO' | 'REJEITADO';

interface Props {
  value: StatusProposta | undefined;
  onChange: (status: StatusProposta) => void;
  disabled?: boolean;
}

// Status da proposta visual (documento entregue ao cliente). É diferente
// do status_pipeline do produto — uma proposta pode estar em RASCUNHO mesmo
// quando o produto já foi para PROPOSTA no funil.
const OPTIONS: Array<{
  key: StatusProposta;
  label: string;
  icon: typeof FileEdit;
  descricao: string;
  classes: { badge: string; dot: string; hover: string };
}> = [
  {
    key: 'RASCUNHO',
    label: 'Rascunho',
    icon: FileEdit,
    descricao: 'Editando — ainda não enviada ao cliente',
    classes: { badge: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]', dot: 'bg-[var(--fin-text-3)]', hover: 'hover:bg-[var(--fin-surface-2)]' },
  },
  {
    key: 'ENVIADO',
    label: 'Enviada',
    icon: Send,
    descricao: 'Link compartilhado com o cliente',
    classes: { badge: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]', dot: 'bg-[var(--fin-accent)]', hover: 'hover:bg-[var(--fin-accent-soft)]' },
  },
  {
    key: 'ACEITO',
    label: 'Aceita',
    icon: CheckCircle2,
    descricao: 'Cliente aceitou — pronta para virar venda',
    classes: { badge: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]', dot: 'bg-[var(--fin-positive)]', hover: 'hover:bg-[var(--fin-positive-soft)]' },
  },
  {
    key: 'REJEITADO',
    label: 'Rejeitada',
    icon: XCircle,
    descricao: 'Cliente não aceitou',
    classes: { badge: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]', dot: 'bg-[var(--fin-negative)]', hover: 'hover:bg-[var(--fin-negative-soft)]' },
  },
];

export function PropostaStatusSelector({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = value ?? 'RASCUNHO';
  const currentOpt = OPTIONS.find(o => o.key === current) ?? OPTIONS[0];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${currentOpt.classes.badge} ${disabled ? 'cursor-default opacity-70' : 'cursor-pointer hover:brightness-95'}`}
        title="Status da proposta visual — clique para alterar"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${currentOpt.classes.dot}`} />
        {currentOpt.label}
        {!disabled && <ChevronDown className="w-3 h-3 opacity-70" />}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1.5 z-50 w-72 rounded-xl bg-[var(--t-surface)] border border-[var(--t-border)] overflow-hidden"
          style={{ boxShadow: 'var(--elevation-4)' }}
        >
          <div className="px-3 py-2 border-b border-[var(--t-border)]">
            <p className="text-[10px] uppercase tracking-wide text-[var(--t-text-muted)] font-semibold">Status da proposta visual</p>
            <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">
              O CRM é notificado automaticamente ao mudar.
            </p>
          </div>
          {OPTIONS.map(opt => {
            const Icon = opt.icon;
            const selected = opt.key === current;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  onChange(opt.key);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2.5 flex items-start gap-2.5 text-left transition-colors ${opt.classes.hover} ${selected ? 'bg-[var(--t-surface-hover)]' : ''}`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${opt.classes.badge} shrink-0 mt-0.5`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-[var(--t-text)]">{opt.label}</span>
                  <p className="text-[11px] text-[var(--t-text-muted)] leading-snug mt-0.5">{opt.descricao}</p>
                </div>
                {selected && <Check className="w-4 h-4 text-[var(--t-green)] shrink-0 mt-1.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
