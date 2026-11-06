'use client';

import { useCotacoes } from '@/components/fin/useCotacoes';
import { equivalenteMensalPct, mesPorExtenso, ultimoDoIndice } from '@/lib/cambio';

/**
 * Referência para os juros ao mês (05/11/2026, E6): a Selic do último mês
 * fechado e a meta do Copom convertida para o mês, do Banco Central. Só
 * oferece; o campo continua sendo o que a agência escrever.
 */
export function ReferenciaDeJuros({ valorAtual, onUsar }: { valorAtual: number; onUsar: (pctAoMes: number) => void }) {
  const { painel } = useCotacoes();
  const indices = painel?.indices ?? [];
  const mes = ultimoDoIndice(indices, 'selic_mes', true);
  const meta = ultimoDoIndice(indices, 'selic_meta');
  if (!mes && !meta) return null;
  const fmt = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  const opcoes = [
    mes && { rotulo: `Selic de ${mesPorExtenso(mes.referencia)}`, valor: Math.round(mes.valor * 100) / 100 },
    meta && { rotulo: `Meta Selic (${fmt(meta.valor)} ao ano)`, valor: equivalenteMensalPct(meta.valor) },
  ].filter(Boolean) as Array<{ rotulo: string; valor: number }>;
  return (
    <div className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
      <p className="fin-t-caption text-[var(--fin-text-2)]">Referência do Banco Central para os juros ao mês:</p>
      <div className="flex flex-wrap gap-[var(--fin-s-2)]">
        {opcoes.map(o => (
          <button
            key={o.rotulo}
            type="button"
            aria-pressed={valorAtual === o.valor}
            onClick={() => onUsar(o.valor)}
            className="fin-t-caption min-h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 font-medium text-[var(--fin-text-2)] transition-colors duration-[var(--fin-dur-rapida)] hover:bg-[var(--fin-accent-soft)] hover:text-[var(--fin-accent)] aria-pressed:border-[var(--fin-accent)] aria-pressed:text-[var(--fin-accent)] lg:min-h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
          >
            Usar {o.rotulo}: {fmt(o.valor)} ao mês
          </button>
        ))}
      </div>
    </div>
  );
}

export default ReferenciaDeJuros;
