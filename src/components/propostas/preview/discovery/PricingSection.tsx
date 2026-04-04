'use client';

import type { SecaoProposta } from '@/lib/crm-types';
import { t, type IdiomaProposal } from '@/lib/i18n-proposta';

interface ValorOpcao {
  titulo: string;
  valor_total: number;
  destaque: boolean;
  parcelas: { forma: string; valor_parcela: number; valor_total: number; destaque: boolean }[];
}

interface Props {
  valoresSecoes: SecaoProposta[];
  inclusosSecoes: SecaoProposta[];
  idioma: IdiomaProposal;
  corPrimaria: string;
}

function formatCurrency(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function PricingSection({ valoresSecoes, inclusosSecoes, idioma, corPrimaria }: Props) {
  const i18n = t(idioma);

  if (valoresSecoes.length === 0) return null;

  // Collect all opcoes from VALORES blocks
  const opcoes: ValorOpcao[] = [];
  let observacoes = '';
  for (const s of valoresSecoes) {
    const c = s.conteudo as { opcoes?: ValorOpcao[]; observacoes_valores?: string };
    if (c.opcoes) opcoes.push(...c.opcoes);
    if (c.observacoes_valores) observacoes = c.observacoes_valores;
  }

  // Collect inclusos/nao_inclusos
  let inclusos: string[] = [];
  let naoInclusos: string[] = [];
  for (const s of inclusosSecoes) {
    const c = s.conteudo as { inclusos?: string[]; nao_inclusos?: string[] };
    if (c.inclusos) inclusos = [...inclusos, ...c.inclusos.filter(Boolean)];
    if (c.nao_inclusos) naoInclusos = [...naoInclusos, ...c.nao_inclusos.filter(Boolean)];
  }

  return (
    <section id="discovery-pricing" className="py-16 bg-white">
      <div className="max-w-4xl mx-auto px-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-8 text-center">{i18n.precos}</h2>

        {/* Pricing cards */}
        <div className={`grid gap-6 ${opcoes.length > 1 ? 'sm:grid-cols-2' : 'max-w-md mx-auto'}`}>
          {opcoes.map((op, i) => (
            <div
              key={i}
              className={`rounded-[20px] border-2 p-6 text-center transition-all ${
                op.destaque
                  ? 'border-current shadow-lg scale-[1.02]'
                  : 'border-gray-200'
              }`}
              style={op.destaque ? { borderColor: corPrimaria } : {}}
            >
              <h3 className="text-lg font-semibold text-gray-800">{op.titulo}</h3>
              <div className="mt-3 text-3xl font-bold" style={{ color: corPrimaria }}>
                {formatCurrency(op.valor_total)}
              </div>
              <div className="text-xs text-gray-500 mt-1">por pessoa</div>

              {op.parcelas.length > 0 && (
                <div className="mt-4 space-y-2">
                  {op.parcelas.map((parc, j) => (
                    <div key={j} className={`text-sm ${parc.destaque ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                      {parc.forma}: {formatCurrency(parc.valor_total || parc.valor_parcela)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {observacoes && (
          <p className="mt-6 text-center text-sm text-gray-500 italic">{observacoes}</p>
        )}

        {/* Includes / Not includes */}
        {(inclusos.length > 0 || naoInclusos.length > 0) && (
          <div className="mt-12 grid sm:grid-cols-2 gap-8">
            {inclusos.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">{i18n.oQueEstaIncluso}</h3>
                <ul className="space-y-2">
                  {inclusos.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="mt-0.5 text-green-500">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {naoInclusos.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">{i18n.naoIncluso}</h3>
                <ul className="space-y-2">
                  {naoInclusos.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-500">
                      <span className="mt-0.5 text-red-400">✗</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 text-center">
          <button
            onClick={() => document.getElementById('discovery-footer')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-8 py-3 rounded-full text-white font-bold text-sm transition-all hover:scale-105 shadow-lg"
            style={{ backgroundColor: corPrimaria }}
          >
            {i18n.reserveAgora}
          </button>
        </div>
      </div>
    </section>
  );
}
