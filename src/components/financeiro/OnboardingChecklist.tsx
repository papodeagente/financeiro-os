'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Circle, X, Sparkles, ChevronRight } from 'lucide-react';

// Checklist de configuração inicial do módulo Financeiro.
// Aparece no topo do hub /financeiro-ag quando há passos pendentes.
// Some sozinho quando 4/4 completos ou se o usuário clicar Dispensar.
//
// Os 4 passos são detectados via inputs (passados como prop). O componente
// não busca dados — confia no que o hub já carregou.

export interface OnboardingStep {
  key: 'caixa' | 'plano-contas' | 'primeira-despesa' | 'primeiro-pagamento';
  label: string;
  description: string;
  done: boolean;
  href: string;
}

interface Props {
  steps: OnboardingStep[];
}

const STORAGE_KEY = 'onboarding-financeiro-dismissed';

export function OnboardingChecklist({ steps }: Props) {
  const [dismissed, setDismissed] = useState(false);

  // Lê dismissed do localStorage no mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === 'true');
    }
  }, []);

  const completos = steps.filter(s => s.done).length;
  const total = steps.length;
  const tudoCompleto = completos === total;

  // Não mostra se já dispensou OU se completou tudo
  if (dismissed || tudoCompleto) return null;

  const handleDispensar = () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    setDismissed(true);
  };

  return (
    <div
      className="rounded-[var(--t-card-radius)] border-2 border-[var(--t-green)]/30 bg-gradient-to-br from-[var(--t-green)]/5 to-transparent p-5 mb-6"
      role="region"
      aria-label="Configuração inicial do financeiro"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[var(--t-green)]" />
          <div>
            <h3 className="text-base font-semibold text-[var(--t-text)]">
              Comece por aqui
            </h3>
            <p className="text-xs text-[var(--t-text-muted)] mt-0.5">
              {completos} de {total} passos concluídos · configure o financeiro em poucos minutos
            </p>
          </div>
        </div>
        <button
          onClick={handleDispensar}
          className="text-[var(--t-text-muted)] hover:text-[var(--t-text)] text-xs flex items-center gap-1"
          title="Dispensar checklist"
          aria-label="Dispensar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Barra de progresso */}
      <div className="mb-4 h-1.5 rounded-full bg-[var(--t-border)] overflow-hidden">
        <div
          className="h-full bg-[var(--t-green)] transition-all"
          style={{ width: `${(completos / total) * 100}%` }}
        />
      </div>

      {/* Passos */}
      <div className="space-y-2">
        {steps.map(step => (
          <Link
            key={step.key}
            href={step.href}
            className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
              step.done
                ? 'bg-[var(--t-green)]/5 text-[var(--t-text-muted)]'
                : 'bg-[var(--t-surface)] hover:bg-[var(--t-surface-hover)] text-[var(--t-text)]'
            }`}
          >
            <div className="shrink-0">
              {step.done ? (
                <div className="w-5 h-5 rounded-full bg-[var(--t-green)] flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              ) : (
                <Circle className="w-5 h-5 text-[var(--t-border)]" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${step.done ? 'line-through' : ''}`}>
                {step.label}
              </p>
              <p className="text-[11px] text-[var(--t-text-muted)] mt-0.5">
                {step.description}
              </p>
            </div>
            {!step.done && (
              <ChevronRight className="w-4 h-4 text-[var(--t-text-muted)] shrink-0" />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
