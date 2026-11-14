'use client';

/**
 * O que a IA leu do voucher, na ficha da venda nova (E7, fechamento): o que
 * falta conferir antes de salvar e, campo a campo, o trecho do documento de
 * onde o valor saiu. Nada aqui grava; a ficha só salva no "Salvar".
 */
import * as React from 'react';
import { ChevronDown, ScanText } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { OrigemDoRascunho } from '@/lib/venda-voucher';

const CADASTRO: Record<NonNullable<OrigemDoRascunho['cadastro']>, { rotulo: string; classe: string }> = {
  documento: { rotulo: 'Cadastro achado pelo CPF/CNPJ', classe: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]' },
  nome: { rotulo: 'Cadastro achado pelo nome', classe: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]' },
  sem_cadastro: { rotulo: 'Sem cadastro', classe: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]' },
};

export function LidoDoVoucher({
  arquivo, origens, avisos, vazios,
}: { arquivo: string; origens: OrigemDoRascunho[]; avisos: string[]; vazios: string[] }) {
  const [aberto, setAberto] = React.useState(true);
  const idLista = React.useId();
  return (
    <section
      aria-label="Lido do voucher"
      className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--fin-s-2)]">
        <div className="flex min-w-0 items-start gap-[var(--fin-s-2)]">
          <ScanText aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--fin-accent)]" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="fin-t-subhead text-[var(--fin-text)]">Rascunho lido de {arquivo}</h2>
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              Confira os campos abaixo e o resto da ficha. Nada foi gravado: a venda só nasce quando você salvar.
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={idLista}
          onClick={() => setAberto(a => !a)}
          className="inline-flex items-center gap-1 rounded-[var(--fin-r-md)] px-2 py-1 fin-t-caption font-medium text-[var(--fin-accent)] hover:bg-[var(--fin-accent-soft)]"
        >
          {aberto ? 'Esconder a origem' : `Ver de onde veio cada campo (${origens.length})`}
          <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform duration-[var(--fin-dur-rapida)]', aberto && 'rotate-180')} />
        </button>
      </div>

      {avisos.length ? (
        <ul aria-label="Conferir antes de salvar" className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)]">
          {avisos.map(a => <li key={a} className="fin-t-body text-[var(--fin-warning-text)]">{a}</li>)}
        </ul>
      ) : null}

      {aberto ? (
        <div id={idLista} className="flex flex-col gap-[var(--fin-s-2)]">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <caption className="sr-only">Cada campo lido e o trecho do documento de onde ele saiu</caption>
            <thead>
              <tr className="border-b border-[var(--fin-border)] text-left">
                <th scope="col" className="py-1.5 pr-[var(--fin-s-3)] fin-t-overline text-[var(--fin-text-3)]">Campo</th>
                <th scope="col" className="py-1.5 pr-[var(--fin-s-3)] fin-t-overline text-[var(--fin-text-3)]">Valor lido</th>
                <th scope="col" className="py-1.5 fin-t-overline text-[var(--fin-text-3)]">No documento</th>
              </tr>
            </thead>
            <tbody>
              {origens.map((o, i) => (
                <tr key={`${o.campo}-${i}`} className="border-b border-[var(--fin-border)] align-top last:border-b-0">
                  <td className="py-1.5 pr-[var(--fin-s-3)] fin-t-caption text-[var(--fin-text-2)]">{o.campo}</td>
                  <td className="py-1.5 pr-[var(--fin-s-3)] fin-t-body text-[var(--fin-text)]">
                    <span className="tabular-nums">{o.valor}</span>
                    {o.cadastro ? (
                      <span className={cn('ml-2 inline-block rounded-[var(--fin-r-sm)] px-1.5 py-0.5 fin-t-caption', CADASTRO[o.cadastro].classe)}>
                        {CADASTRO[o.cadastro].rotulo}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 fin-t-caption text-[var(--fin-text-3)]">
                    <q className="italic">{o.fonte}</q>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {vazios.length ? (
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Não estavam no documento (ficaram vazios): {vazios.join(', ')}.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
