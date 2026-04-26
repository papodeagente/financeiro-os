'use client';

import type { Proposta, SecaoProposta } from '@/lib/crm-types';
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
  proposta?: Proposta;
}

function formatCurrency(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function isPixOrCash(forma: string): boolean {
  const f = forma.toLowerCase();
  return f.includes('pix') || f.includes('vista') || f.includes('à vista') || f.includes('a vista');
}

function bestParcela(opcao: ValorOpcao) {
  if (!opcao.parcelas || opcao.parcelas.length === 0) return null;
  const pix = opcao.parcelas.find(p => isPixOrCash(p.forma));
  return pix || opcao.parcelas[0];
}

function calcEconomia(opcao: ValorOpcao): number {
  const pix = opcao.parcelas?.find(p => isPixOrCash(p.forma));
  if (!pix) return 0;
  const pixValue = pix.valor_total || pix.valor_parcela;
  const reference = opcao.valor_total;
  return Math.max(reference - pixValue, 0);
}

export function PricingSection({ valoresSecoes, inclusosSecoes, idioma, corPrimaria, proposta }: Props) {
  const i18n = t(idioma);

  if (valoresSecoes.length === 0) return null;

  const opcoes: ValorOpcao[] = [];
  let observacoes = '';
  let validade = '';
  for (const s of valoresSecoes) {
    const c = s.conteudo as { opcoes?: ValorOpcao[]; observacoes_valores?: string; validade?: string };
    if (c.opcoes) opcoes.push(...c.opcoes);
    if (c.observacoes_valores) observacoes = c.observacoes_valores;
    if (c.validade) validade = c.validade;
  }

  let inclusos: string[] = [];
  let naoInclusos: string[] = [];
  for (const s of inclusosSecoes) {
    const c = s.conteudo as { inclusos?: string[]; nao_inclusos?: string[] };
    if (c.inclusos) inclusos = [...inclusos, ...c.inclusos.filter(Boolean)];
    if (c.nao_inclusos) naoInclusos = [...naoInclusos, ...c.nao_inclusos.filter(Boolean)];
  }

  const whatsapp = proposta?.rodape.whatsapp_vendedor?.replace(/\D/g, '') || '';
  const titulo = proposta?.cabecalho.titulo || '';

  // Top inclusos for the inline benefits row (first 4)
  const topBenefits = inclusos.slice(0, 4);

  // Format validade nicely
  let validadeFormatada = '';
  if (validade) {
    try {
      const d = new Date(validade);
      validadeFormatada = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
    } catch {}
  }

  return (
    <section
      id="discovery-pricing"
      className="py-20 relative"
      style={{
        background: `linear-gradient(180deg, #ffffff 0%, ${corPrimaria}05 100%)`,
      }}
    >
      <div className="max-w-5xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-3">
          <span
            className="inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-widest uppercase"
            style={{ backgroundColor: `${corPrimaria}15`, color: corPrimaria }}
          >
            {i18n.precos}
          </span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3 text-center">
          Sua viagem começa aqui
        </h2>
        {validadeFormatada && (
          <p className="text-center text-sm text-gray-600 mb-12">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-semibold">Reserva válida até {validadeFormatada}</span>
            </span>
          </p>
        )}

        {/* Pricing cards */}
        <div className={`grid gap-6 ${opcoes.length > 1 ? (opcoes.length >= 3 ? 'lg:grid-cols-3 sm:grid-cols-2' : 'sm:grid-cols-2') : 'max-w-md mx-auto'}`}>
          {opcoes.map((op, i) => {
            const best = bestParcela(op);
            const economia = calcEconomia(op);
            const bestValor = best ? (best.valor_total || best.valor_parcela) : op.valor_total;

            return (
              <div
                key={i}
                className={`relative rounded-3xl p-6 sm:p-7 transition-all flex flex-col ${
                  op.destaque
                    ? 'bg-white shadow-xl ring-2 lg:scale-[1.04] z-10'
                    : 'bg-white shadow-md ring-1 ring-gray-200'
                }`}
                style={op.destaque ? { '--tw-ring-color': corPrimaria } as React.CSSProperties : undefined}
              >
                {/* Most chosen ribbon */}
                {op.destaque && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[11px] font-bold tracking-widest text-white shadow-md"
                    style={{ backgroundColor: corPrimaria }}
                  >
                    ★ MAIS ESCOLHIDO
                  </div>
                )}

                {/* Title */}
                <h3 className="text-base font-semibold text-gray-700 text-center mt-1 min-h-[3rem] flex items-center justify-center">
                  {op.titulo}
                </h3>

                {/* Reference price (struck) */}
                {economia > 0 && (
                  <div className="text-center mt-2">
                    <span className="text-sm text-gray-400 line-through">
                      {formatCurrency(op.valor_total)}
                    </span>
                  </div>
                )}

                {/* Best price */}
                <div className="text-center mt-1">
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-xs text-gray-500 font-medium">R$</span>
                    <span className="text-5xl font-extrabold tracking-tight" style={{ color: corPrimaria }}>
                      {formatBRL(bestValor)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {best && isPixOrCash(best.forma) ? 'à vista no PIX' : 'preço total'}
                  </div>
                </div>

                {/* Savings badge */}
                {economia > 0 && (
                  <div className="mt-3 flex justify-center">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      Economize {formatCurrency(economia)}
                    </span>
                  </div>
                )}

                {/* Parcelas */}
                {op.parcelas.length > 1 && (
                  <div className="mt-5 pt-5 border-t border-gray-100 space-y-1.5">
                    <div className="text-[10px] font-bold tracking-widest uppercase text-gray-400 text-center mb-2">
                      Outras formas
                    </div>
                    {op.parcelas.filter(p => !isPixOrCash(p.forma)).map((parc, j) => (
                      <div key={j} className="flex items-baseline justify-between text-sm">
                        <span className="text-gray-600">{parc.forma}</span>
                        <span className="font-semibold text-gray-800 tabular-nums">
                          {formatCurrency(parc.valor_parcela)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* CTA */}
                <div className="mt-6 pt-2 flex flex-col gap-2">
                  {whatsapp && (
                    <a
                      href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá! Tenho interesse na opção "${op.titulo}" da proposta ${titulo}.`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-bold transition-all hover:scale-[1.02] shadow-sm"
                      style={
                        op.destaque
                          ? { backgroundColor: corPrimaria, color: '#fff' }
                          : { backgroundColor: '#f3f4f6', color: '#111827' }
                      }
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                      </svg>
                      Quero esta opção
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Scarcity / observacoes */}
        {observacoes && (
          <p className="mt-8 text-center text-xs text-gray-500 italic max-w-2xl mx-auto">
            {observacoes}
          </p>
        )}

        {/* Trust strip — top benefits */}
        {topBenefits.length > 0 && (
          <div className="mt-14 pt-10 border-t border-gray-200">
            <div className="text-center mb-6">
              <span className="text-xs font-bold tracking-widest uppercase text-gray-500">
                Tudo isto está incluso
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {topBenefits.map((b, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span
                    className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full shrink-0"
                    style={{ backgroundColor: `${corPrimaria}15`, color: corPrimaria }}
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="leading-snug">{b}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Full Includes / Not includes */}
        {(inclusos.length > 0 || naoInclusos.length > 0) && (
          <details className="mt-10 group">
            <summary className="cursor-pointer text-center text-sm font-semibold text-gray-700 hover:text-gray-900 list-none">
              <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white border border-gray-200 hover:border-gray-300 transition-colors">
                Ver lista completa
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </summary>
            <div className="mt-8 grid sm:grid-cols-2 gap-8">
              {inclusos.length > 0 && (
                <div>
                  <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700">✓</span>
                    {i18n.oQueEstaIncluso}
                  </h3>
                  <ul className="space-y-2">
                    {inclusos.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 leading-snug">
                        <span className="mt-0.5 text-emerald-500 shrink-0">✓</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {naoInclusos.length > 0 && (
                <div>
                  <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-500">×</span>
                    {i18n.naoIncluso}
                  </h3>
                  <ul className="space-y-2">
                    {naoInclusos.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-500 leading-snug">
                        <span className="mt-0.5 text-gray-400 shrink-0">×</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Bottom mega-CTA */}
        <div className="mt-14 text-center">
          <button
            onClick={() => document.getElementById('discovery-footer')?.scrollIntoView({ behavior: 'smooth' })}
            className="px-10 py-4 rounded-full text-white font-bold text-base transition-all hover:scale-105 shadow-xl"
            style={{ backgroundColor: corPrimaria, boxShadow: `0 10px 30px -10px ${corPrimaria}` }}
          >
            {i18n.reserveAgora} →
          </button>
          <p className="mt-3 text-xs text-gray-500">
            Resposta em até 1 hora útil · Sem compromisso
          </p>
        </div>
      </div>
    </section>
  );
}
