'use client';

import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

// Head de página padrão do tema minimal — usado em todas as telas dentro
// de .min-shell para consistência visual entre módulos.
//
// Estrutura:
//   ┌─────────────────────────────────┬──────────────────────────┐
//   │ H1 42px Inter Tight             │  segmented period control │
//   │ meta: greeting · data · reload  │       OR right actions    │
//   └─────────────────────────────────┴──────────────────────────┘
//   ──── hairline ────────────────────────────────────────────────
//
// Props mantidas opcionais para que cada página decida o que mostrar.

type PeriodoKey = string;

export interface PeriodoOption {
  key: PeriodoKey;
  label: string;
}

interface Props {
  title: string;
  /** Linha de meta abaixo do título (greeting, data, etc). React node pra flexibilidade. */
  meta?: ReactNode;
  /** Botão Recarregar (mostra se passado). */
  onRecarregar?: () => void;
  recarregando?: boolean;
  /** Quando recarregar acabou — usado para hint "Atualizado às HH:MM" */
  atualizadoEm?: Date | null;
  /** Segmented period control à direita. Não passa = não renderiza. */
  periodos?: PeriodoOption[];
  periodoAtivo?: PeriodoKey;
  onPeriodoChange?: (key: PeriodoKey) => void;
  /** Actions à direita (ex: + Nova, Exportar). Não passa = só period control. */
  actions?: ReactNode;
}

export function MinimalPageHead({
  title,
  meta,
  onRecarregar,
  recarregando,
  atualizadoEm,
  periodos,
  periodoAtivo,
  onPeriodoChange,
  actions,
}: Props) {
  // Constrói meta padrão se não houver meta custom
  const metaPadrao =
    meta ||
    (atualizadoEm ? (
      <div className="mt-2.5 text-[12px] flex items-center gap-4" style={{ color: 'var(--ink-3)' }}>
        <span>
          Atualizado às{' '}
          <b className="mono" style={{ fontSize: '11px', color: 'var(--ink-2)' }}>
            {atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </b>
        </span>
        {onRecarregar && (
          <>
            <span style={{ color: 'var(--ink-4)' }}>·</span>
            <button
              onClick={onRecarregar}
              disabled={recarregando}
              className="inline-flex items-center gap-1 transition-colors disabled:opacity-50"
              style={{
                color: 'var(--ink)',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                textDecorationColor: 'var(--ink-4)',
              }}
            >
              <RefreshCw className={`w-3 h-3 ${recarregando ? 'animate-spin' : ''}`} />
              <span>{recarregando ? 'Atualizando…' : 'Recarregar'}</span>
            </button>
          </>
        )}
      </div>
    ) : null);

  return (
    <div className="flex items-end justify-between pb-6 mb-8 border-b flex-wrap gap-4" style={{ borderColor: 'var(--line)' }}>
      <div>
        <h1 style={{ fontSize: '42px', fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1, margin: 0 }}>
          {title}
        </h1>
        {metaPadrao}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {actions}
        {periodos && periodos.length > 0 && (
          <div
            className="flex items-stretch lg-glass-regular overflow-hidden"
            style={{ height: '34px', borderRadius: 'var(--lg-radius-md)' }}
          >
            {periodos.map((p, i, arr) => {
              const isActive = periodoAtivo === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => onPeriodoChange?.(p.key)}
                  className="px-4 text-[12px] transition-all duration-200"
                  style={{
                    color: isActive ? 'var(--lg-accent)' : 'var(--ink-3)',
                    fontWeight: isActive ? 500 : 400,
                    background: isActive ? 'var(--lg-accent-fill)' : 'transparent',
                    borderRight: i < arr.length - 1 ? '1px solid var(--lg-border-base)' : 'none',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const PERIODOS_PADRAO: PeriodoOption[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: '7d', label: '7d' },
  { key: 'mes', label: 'Mês' },
  { key: 'trimestre', label: 'Trimestre' },
  { key: 'ano', label: 'Ano' },
];

// Section header padrão (uppercase + bold em var(--ink)). Usado em todas
// as páginas dentro de .min-shell.
interface SectionHeaderProps {
  /** Label principal (bold) */
  label: string;
  /** Sub-label opcional após o bold */
  sub?: string;
  /** Botão/link à direita */
  action?: ReactNode;
  className?: string;
}

export function MinimalSectionHeader({ label, sub, action, className }: SectionHeaderProps) {
  return (
    <div className={`flex items-baseline justify-between mb-4 ${className || ''}`}>
      <span className="min-section-title">
        <b>{label}</b>
        {sub && ` ${sub}`}
      </span>
      {action}
    </div>
  );
}

// Footer padrão do tema minimal. Mostra rastro de pagina + locale.
interface FooterProps {
  /** Identificador da página, ex: 'visão geral', 'contas a pagar'. */
  pageId?: string;
  build?: string;
}

export function MinimalFooter({ pageId = '', build }: FooterProps) {
  const buildLabel = build || new Date().toISOString().slice(0, 10);
  return (
    <div
      className="pt-6 mt-4 border-t flex justify-between mono text-[11px]"
      style={{ borderColor: 'var(--line)', color: 'var(--ink-3)', letterSpacing: '0.02em' }}
    >
      <span>
        enturos / fin{pageId && ' · '}
        <b style={{ color: 'var(--ink-2)', fontWeight: 400 }}>{pageId}</b>
      </span>
      <span>build {buildLabel}</span>
      <span>
        <b style={{ color: 'var(--ink-2)', fontWeight: 400 }}>BRL</b> · UTC−3
      </span>
    </div>
  );
}
