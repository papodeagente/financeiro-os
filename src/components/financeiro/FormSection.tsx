'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// Wrapper colapsável para seções de formulário. Resolve forms muito longos
// dividindo em Essencial (sempre aberta) → Categorização → Avançado.

interface Props {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  /** Quando true, é a seção principal e nunca colapsa. */
  alwaysOpen?: boolean;
  /** Badge tipo "Avançado" ou "Opcional" no header. */
  badge?: string;
  badgeColor?: 'amber' | 'blue' | 'green';
  children: ReactNode;
}

export function FormSection({
  title,
  description,
  defaultOpen = false,
  alwaysOpen = false,
  badge,
  badgeColor = 'blue',
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen || alwaysOpen);
  const isOpen = alwaysOpen || open;

  const badgeStyles = {
    amber: 'bg-[var(--t-amber-bg)] text-[var(--t-amber)]',
    blue: 'bg-[var(--t-blue-bg)] text-[var(--t-blue)]',
    green: 'bg-[var(--t-green-bg)] text-[var(--t-green)]',
  }[badgeColor];

  return (
    <div className="rounded-lg border border-[var(--t-border)] overflow-hidden">
      <button
        type="button"
        onClick={() => !alwaysOpen && setOpen(o => !o)}
        disabled={alwaysOpen}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
          alwaysOpen
            ? 'bg-[var(--t-surface)] cursor-default'
            : 'bg-[var(--t-surface)] hover:bg-[var(--t-surface-hover)] cursor-pointer'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--t-text)]">{title}</span>
              {badge && (
                <span className={`text-[9px] font-medium uppercase px-1.5 py-0.5 rounded ${badgeStyles}`}>
                  {badge}
                </span>
              )}
            </div>
            {description && (
              <p className="text-[11px] text-[var(--t-text-muted)] mt-0.5">{description}</p>
            )}
          </div>
        </div>
        {!alwaysOpen && (
          isOpen
            ? <ChevronUp className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
            : <ChevronDown className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="p-4 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          {children}
        </div>
      )}
    </div>
  );
}
