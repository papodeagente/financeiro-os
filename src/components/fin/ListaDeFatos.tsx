'use client';

/**
 * Rótulo e valor, com a origem do dado dita ao lado.
 *
 * A tela fiscal mostra coisas que o sistema descobriu sozinho — CNPJ do
 * certificado, cidade da Receita, serviço deduzido da atividade. Quem confere
 * precisa saber DE ONDE cada linha veio: o que a Receita informou tem peso
 * diferente do que o sistema propôs, e é o proposto que merece um segundo
 * olhar antes de virar nota.
 *
 * Empilhado no celular, três colunas a partir de lg.
 */

import { cn } from '@/lib/utils';

export type FonteDoFato = 'certificado' | 'receita' | 'proposto' | 'voce' | 'emissor';

const ROTULO_FONTE: Record<FonteDoFato, string> = {
  certificado: 'do certificado',
  receita: 'da Receita',
  proposto: 'proposto pelo sistema',
  voce: 'informado por você',
  emissor: 'do emissor',
};

export interface Fato {
  rotulo: string;
  valor: React.ReactNode;
  fonte?: FonteDoFato;
  /** Chip curto ao lado do valor: "Válido", "Vence em breve". */
  chip?: { texto: string; tom: 'positivo' | 'aviso' | 'negativo' | 'neutro' };
  /** O recorte do número: "em 2 contas, saldo de agora". Um número sozinho
   *  não se lê — dá para conferir, mas não dá para decidir com ele. */
  contexto?: string;
  acao?: { rotulo: string; onClick?: () => void; href?: string };
}

const TOM_CHIP = {
  positivo: 'border-[var(--fin-positive)] text-[var(--fin-positive)]',
  aviso: 'border-[var(--fin-warning)] text-[var(--fin-warning-text)]',
  negativo: 'border-[var(--fin-negative)] text-[var(--fin-negative)]',
  neutro: 'border-[var(--fin-border-strong)] text-[var(--fin-text-3)]',
};

export function ListaDeFatos({ itens }: { itens: Fato[] }) {
  return (
    <dl className="flex flex-col divide-y divide-[var(--fin-border)]">
      {itens.map(fato => (
        <div
          key={fato.rotulo}
          className="flex flex-col gap-1 py-3 lg:flex-row lg:items-baseline lg:gap-4"
        >
          <dt className="fin-t-caption text-[var(--fin-text-3)] lg:w-40 lg:shrink-0">
            {fato.rotulo}
          </dt>
          <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="fin-t-body-strong min-w-0 break-words text-[var(--fin-text)]">
              {fato.valor}
            </span>
            {fato.chip ? (
              <span
                className={cn(
                  'fin-t-caption rounded-full border px-2 py-0.5',
                  TOM_CHIP[fato.chip.tom],
                )}
              >
                {fato.chip.texto}
              </span>
            ) : null}
            {fato.fonte ? (
              <span className="fin-t-caption text-[var(--fin-text-3)]">
                {ROTULO_FONTE[fato.fonte]}
              </span>
            ) : null}
            {fato.acao ? (
              fato.acao.href ? (
                <a
                  href={fato.acao.href}
                  className="fin-t-caption ml-auto shrink-0 text-[var(--fin-accent)] underline"
                >
                  {fato.acao.rotulo}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={fato.acao.onClick}
                  className="fin-t-caption ml-auto shrink-0 text-[var(--fin-accent)] underline"
                >
                  {fato.acao.rotulo}
                </button>
              )
            ) : null}
            {fato.contexto ? (
              <span className="fin-t-caption w-full text-[var(--fin-text-3)]">{fato.contexto}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
