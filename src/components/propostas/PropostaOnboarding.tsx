'use client';

import { useState } from 'react';
import { Sparkles, ArrowRight, Loader2, Plus, FileText, Layers, X } from 'lucide-react';

interface Props {
  open: boolean;
  onApplyExample: () => void;
  onUseAI: () => void;
  onStartFromScratch: () => void;
  generatingAI: boolean;
}

// Modal de onboarding mostrado quando o usuario abre a 1a proposta vazia.
// Oferece 3 caminhos pra "comecar a construir":
//   1. Aplicar proposta exemplo (instantaneo, mostra todos os elementos)
//   2. Gerar com IA (baseado nos destinos da viagem)
//   3. Comecar do zero (apenas fecha)
//
// Aparece SO na 1a vez (flag localStorage no PropostaEditor controla).
// Backdrop blur grande, card central animado.
export function PropostaOnboarding({
  open, onApplyExample, onUseAI, onStartFromScratch, generatingAI,
}: Props) {
  const [step, setStep] = useState<'welcome' | 'options'>('welcome');

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="relative bg-[var(--fin-surface)] rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Close button */}
        <button
          onClick={onStartFromScratch}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-[var(--fin-surface)]/80 hover:bg-[var(--fin-surface)] text-[var(--fin-text-2)] hover:text-[var(--fin-text)] transition-colors shadow-sm"
          aria-label="Pular onboarding"
          title="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        {step === 'welcome' ? (
          // ============ Step 1: Welcome ============
          <div className="p-8 sm:p-10">
            <div className="flex items-center justify-center w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-[var(--fin-accent)] to-[var(--fin-positive)] shadow-lg">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h2 id="onboarding-title" className="text-2xl font-bold text-[var(--fin-text)] text-center mb-2">
              Bem-vindo ao editor de propostas!
            </h2>
            <p className="text-sm text-[var(--fin-text-2)] text-center mb-6 max-w-md mx-auto leading-relaxed">
              Esta é sua primeira proposta. Posso te ajudar a começar — vou montar uma proposta exemplo com{' '}
              <strong>todos os elementos</strong> que você tem disponível: hospedagem, voos, roteiro, valores, depoimentos, FAQ e mais.
            </p>
            <div className="flex flex-col gap-2.5 max-w-sm mx-auto">
              <button
                onClick={() => setStep('options')}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-gradient-to-r from-[var(--fin-accent)] to-[var(--fin-positive)] text-white font-semibold text-sm hover:shadow-lg transition-all hover:scale-[1.02]"
              >
                <ArrowRight className="w-4 h-4" /> Quero ser guiado
              </button>
              <button
                onClick={onStartFromScratch}
                className="w-full flex items-center justify-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] transition-colors"
              >
                Pular — vou começar do zero
              </button>
            </div>
            <div className="mt-6 pt-5 border-t border-[var(--fin-border)] text-center">
              <p className="text-[11px] text-[var(--fin-text-3)]">
                ⏱️ Você economiza ~15 minutos. Tudo é editável depois.
              </p>
            </div>
          </div>
        ) : (
          // ============ Step 2: Choose path ============
          <div className="p-8 sm:p-10">
            <h2 id="onboarding-title" className="text-xl font-bold text-[var(--fin-text)] mb-1 text-center">
              Como prefere começar?
            </h2>
            <p className="text-sm text-[var(--fin-text-2)] text-center mb-6">
              Escolha a melhor forma para sua primeira proposta.
            </p>
            <div className="grid gap-3">
              {/* Opcao 1: Proposta exemplo */}
              <button
                onClick={onApplyExample}
                className="group flex items-start gap-4 p-4 rounded-xl border-2 border-[var(--fin-accent)]/30 bg-gradient-to-br from-[var(--fin-accent-soft)] to-[var(--fin-positive-soft)] hover:border-[var(--fin-accent)] hover:shadow-lg transition-all text-left"
              >
                <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--fin-accent)] flex items-center justify-center shadow-sm">
                  <Layers className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-[var(--fin-text)]">Proposta exemplo completa</h3>
                    <span className="px-1.5 py-0.5 bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] text-[9px] uppercase tracking-wider font-bold rounded">
                      Recomendado
                    </span>
                  </div>
                  <p className="text-xs text-[var(--fin-text-2)] leading-relaxed mb-2">
                    Crio uma proposta com hospedagem, voo, roteiro, valores, depoimento, FAQ, CTA — todos pré-preenchidos com exemplo realista (Santiago/Chile). Você só edita.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {['Hospedagem', 'Voo', 'Roteiro 3 dias', 'Valores', 'Depoimento', 'FAQ', 'CTA'].map(b => (
                      <span key={b} className="px-1.5 py-0.5 text-[9px] font-medium bg-[var(--fin-surface)]/80 text-[var(--fin-text-2)] rounded">
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRight className="shrink-0 w-5 h-5 text-[var(--fin-accent)] group-hover:translate-x-1 transition-transform" />
              </button>

              {/* Opcao 2: Gerar com IA */}
              <button
                onClick={onUseAI}
                disabled={generatingAI}
                className="group flex items-start gap-4 p-4 rounded-xl border-2 border-[var(--fin-violet)]/30 bg-[var(--fin-violet-soft)] hover:border-[var(--fin-violet)] hover:shadow-lg transition-all text-left disabled:opacity-60 disabled:cursor-wait"
              >
                <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--fin-violet)] flex items-center justify-center shadow-sm">
                  {generatingAI ? (
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  ) : (
                    <Sparkles className="w-6 h-6 text-white" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-[var(--fin-text)]">Gerar com IA</h3>
                  </div>
                  <p className="text-xs text-[var(--fin-text-2)] leading-relaxed">
                    {generatingAI
                      ? 'Gerando proposta... pode levar até 2 minutos.'
                      : 'Eu monto uma proposta inteira baseada nos destinos da viagem que você definiu. Precisa de destinos preenchidos antes.'}
                  </p>
                </div>
                {!generatingAI && (
                  <ArrowRight className="shrink-0 w-5 h-5 text-[var(--fin-violet)] group-hover:translate-x-1 transition-transform" />
                )}
              </button>

              {/* Opcao 3: Em branco */}
              <button
                onClick={onStartFromScratch}
                className="group flex items-start gap-4 p-4 rounded-xl border-2 border-[var(--fin-border)] bg-[var(--fin-surface-2)]/40 hover:border-[var(--fin-border-strong)] hover:bg-[var(--fin-surface-2)] transition-all text-left"
              >
                <div className="shrink-0 w-12 h-12 rounded-lg bg-[var(--fin-border-strong)] flex items-center justify-center">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-[var(--fin-text)] mb-1">Começar do zero</h3>
                  <p className="text-xs text-[var(--fin-text-2)] leading-relaxed">
                    Construa do jeito que quiser usando linhas e colunas da paleta. Mais controle, mais trabalho.
                  </p>
                </div>
                <ArrowRight className="shrink-0 w-5 h-5 text-[var(--fin-text-3)] group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
            <button
              onClick={() => setStep('welcome')}
              className="block mx-auto mt-5 text-[11px] text-[var(--fin-text-3)] hover:text-[var(--fin-text-2)] transition-colors"
            >
              ← Voltar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
