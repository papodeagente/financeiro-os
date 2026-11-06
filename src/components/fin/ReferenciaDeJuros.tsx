'use client';

import { useCotacoes } from '@/components/fin/useCotacoes';
import { opcoesDeJurosPelaSelic, type OpcaoDeJurosSelic } from '@/lib/juros-selic';

/**
 * Referência para os juros ao mês (05/11/2026, E6; fonte e data na E7): a
 * Selic do último mês fechado e a meta do Copom convertida para o mês, do
 * Banco Central (cache da E6). Só oferece; o campo continua sendo o que a
 * agência escrever. `avisarSemIndice`: sem o índice no cache, diz isso em
 * vez de sumir.
 */
export function ReferenciaDeJuros({ valorAtual, onUsar, avisarSemIndice = false }: {
  valorAtual: number;
  onUsar: (pctAoMes: number, opcao: OpcaoDeJurosSelic) => void;
  avisarSemIndice?: boolean;
}) {
  const { painel, estado } = useCotacoes();
  const opcoes = opcoesDeJurosPelaSelic(painel?.indices ?? []);
  const fmt = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  if (!opcoes.length) {
    if (!avisarSemIndice || estado === 'carregando') return null;
    return (
      <p className="fin-t-caption text-[var(--fin-text-3)]">
        A Selic ainda não chegou do Banco Central para sugerir os juros. O campo vale como está; a sugestão aparece aqui quando o índice chegar.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
      <p className="fin-t-caption text-[var(--fin-text-2)]">Referência do Banco Central para os juros ao mês:</p>
      <div className="flex flex-wrap gap-[var(--fin-s-2)]">
        {opcoes.map(o => (
          <button
            key={o.indice}
            type="button"
            aria-pressed={valorAtual === o.valor_am_pct}
            title={`${o.conta} Fonte: ${o.fonte}.`}
            onClick={() => onUsar(o.valor_am_pct, o)}
            className="fin-t-caption min-h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 font-medium text-[var(--fin-text-2)] transition-colors duration-[var(--fin-dur-rapida)] hover:bg-[var(--fin-accent-soft)] hover:text-[var(--fin-accent)] aria-pressed:border-[var(--fin-accent)] aria-pressed:text-[var(--fin-accent)] lg:min-h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
          >
            Usar {o.rotulo}: {fmt(o.valor_am_pct)} ao mês
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-0.5">
        {opcoes.map(o => (
          <li key={o.indice} className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{o.conta} Fonte: {o.fonte}.</li>
        ))}
      </ul>
    </div>
  );
}

export default ReferenciaDeJuros;
