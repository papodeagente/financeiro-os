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
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Close button */}
        <button
          onClick={onStartFromScratch}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/80 hover:bg-white text-gray-600 hover:text-gray-900 transition-colors shadow-sm"
          aria-label="Pular onboarding"
          title="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        {step === 'welcome' ? (
          // ============ Step 1: Welcome ============
          <div className="p-8 sm:p-10">
            <div className="flex items-center justify-center w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-blue-500 to-emerald-500 shadow-lg shadow-blue-500/30">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h2 id="onboarding-title" className="text-2xl font-bold text-gray-900 text-center mb-2">
              Bem-vindo ao editor de propostas!
            </h2>
            <p className="text-sm text-gray-600 text-center mb-6 max-w-md mx-auto leading-relaxed">
              Esta é sua primeira proposta. Posso te ajudar a começar — vou montar uma proposta exemplo com{' '}
              <strong>todos os elementos</strong> que você tem disponível: hospedagem, voos, roteiro, valores, depoimentos, FAQ e mais.
            </p>
            <div className="flex flex-col gap-2.5 max-w-sm mx-auto">
              <button
                onClick={() => setStep('options')}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-emerald-600 text-white font-semibold text-sm hover:shadow-lg transition-all hover:scale-[1.02]"
              >
                <ArrowRight className="w-4 h-4" /> Quero ser guiado
              </button>
              <button
                onClick={onStartFromScratch}
                className="w-full flex items-center justify-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Pular — vou começar do zero
              </button>
            </div>
            <div className="mt-6 pt-5 border-t border-gray-100 text-center">
              <p className="text-[11px] text-gray-500">
                ⏱️ Você economiza ~15 minutos. Tudo é editável depois.
              </p>
            </div>
          </div>
        ) : (
          // ============ Step 2: Choose path ============
          <div className="p-8 sm:p-10">
            <h2 id="onboarding-title" className="text-xl font-bold text-gray-900 mb-1 text-center">
              Como prefere começar?
            </h2>
            <p className="text-sm text-gray-600 text-center mb-6">
              Escolha a melhor forma para sua primeira proposta.
            </p>
            <div className="grid gap-3">
              {/* Opcao 1: Proposta exemplo */}
              <button
                onClick={onApplyExample}
                className="group flex items-start gap-4 p-4 rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-emerald-50 hover:border-blue-500 hover:shadow-lg transition-all text-left"
              >
                <div className="shrink-0 w-12 h-12 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
                  <Layers className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900">Proposta exemplo completa</h3>
                    <span className="px-1.5 py-0.5 bg-blue-600 text-white text-[9px] uppercase tracking-wider font-bold rounded">
                      Recomendado
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed mb-2">
                    Crio uma proposta com hospedagem, voo, roteiro, valores, depoimento, FAQ, CTA — todos pré-preenchidos com exemplo realista (Santiago/Chile). Você só edita.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {['Hospedagem', 'Voo', 'Roteiro 3 dias', 'Valores', 'Depoimento', 'FAQ', 'CTA'].map(b => (
                      <span key={b} className="px-1.5 py-0.5 text-[9px] font-medium bg-white/80 text-gray-700 rounded">
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRight className="shrink-0 w-5 h-5 text-blue-600 group-hover:translate-x-1 transition-transform" />
              </button>

              {/* Opcao 2: Gerar com IA */}
              <button
                onClick={onUseAI}
                disabled={generatingAI}
                className="group flex items-start gap-4 p-4 rounded-xl border-2 border-purple-200 bg-purple-50/40 hover:border-purple-500 hover:shadow-lg transition-all text-left disabled:opacity-60 disabled:cursor-wait"
              >
                <div className="shrink-0 w-12 h-12 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm">
                  {generatingAI ? (
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  ) : (
                    <Sparkles className="w-6 h-6 text-white" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900">Gerar com IA</h3>
                  </div>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    {generatingAI
                      ? 'Gerando proposta... pode levar até 2 minutos.'
                      : 'Eu monto uma proposta inteira baseada nos destinos da viagem que você definiu. Precisa de destinos preenchidos antes.'}
                  </p>
                </div>
                {!generatingAI && (
                  <ArrowRight className="shrink-0 w-5 h-5 text-purple-600 group-hover:translate-x-1 transition-transform" />
                )}
              </button>

              {/* Opcao 3: Em branco */}
              <button
                onClick={onStartFromScratch}
                className="group flex items-start gap-4 p-4 rounded-xl border-2 border-gray-200 bg-gray-50/40 hover:border-gray-400 hover:bg-gray-50 transition-all text-left"
              >
                <div className="shrink-0 w-12 h-12 rounded-lg bg-gray-400 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-gray-900 mb-1">Começar do zero</h3>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Construa do jeito que quiser usando linhas e colunas da paleta. Mais controle, mais trabalho.
                  </p>
                </div>
                <ArrowRight className="shrink-0 w-5 h-5 text-gray-400 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
            <button
              onClick={() => setStep('welcome')}
              className="block mx-auto mt-5 text-[11px] text-gray-500 hover:text-gray-700 transition-colors"
            >
              ← Voltar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
