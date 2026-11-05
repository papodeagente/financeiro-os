'use client';

import Link from 'next/link';

import { RecordSheet } from '@/components/fin/RecordSheet';
import { Money } from '@/components/fin/Money';
import type { LancamentoDoDemonstrativo } from '@/lib/resultado-por-categoria';
import { paraCentavos } from '@/lib/money';
import { cn, formatDate } from '@/lib/utils';

const ONDE: Record<LancamentoDoDemonstrativo['tabela'], { rotulo: string; href: string }> = {
  contas_receber: { rotulo: 'Conta a receber', href: '/financeiro-ag/receber' },
  contas_pagar: { rotulo: 'Conta a pagar', href: '/financeiro-ag/pagar' },
};

/** Os lançamentos por trás de uma célula da tabela dinâmica (05/11/2026). */
export function LancamentosDaCelula({
  aberta, onFechar,
}: {
  aberta: { titulo: string; lancamentos: LancamentoDoDemonstrativo[] } | null;
  onFechar: () => void;
}) {
  const lista = aberta ? [...aberta.lancamentos].sort((a, b) => a.data.localeCompare(b.data)) : [];
  // Soma em centavos: a mesma conta da célula.
  const somaCentavos = lista.reduce((s, l) => s + paraCentavos(l.valor), 0);
  return (
    <RecordSheet
      aberto={aberta !== null}
      onOpenChange={v => { if (!v) onFechar(); }}
      titulo={aberta?.titulo ?? ''}
      descricao={lista.length === 1 ? '1 lançamento' : `${lista.length} lançamentos`}
      largura={640}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={null}
      resumo={
        <span className="flex items-baseline justify-between gap-[var(--fin-s-3)]">
          <span className="fin-t-caption text-[var(--fin-text-3)]">Soma</span>
          <Money valor={somaCentavos / 100} estado="ok" size="strong" />
        </span>
      }
    >
      <ul className="flex flex-col">
        {lista.map((l, i) => (
          <li
            key={`${l.tabela}-${l.id}-${i}`}
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[var(--fin-s-3)]',
              'border-b border-[var(--fin-border)] py-[var(--fin-s-2)] last:border-b-0',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate fin-t-body font-medium text-[var(--fin-text)]">{l.descricao || ONDE[l.tabela].rotulo}</span>
              <span className="block truncate fin-t-caption text-[var(--fin-text-3)]">
                {[l.pessoa, formatDate(l.data), ONDE[l.tabela].rotulo, l.rateado ? 'parte do rateio' : ''].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="flex flex-col items-end">
              <Money valor={l.valor} estado="ok" size="body" />
              <Link href={`${ONDE[l.tabela].href}?abrir=${encodeURIComponent(l.id)}`} className="fin-t-caption text-[var(--fin-accent)] underline-offset-2 hover:underline">
                Abrir
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </RecordSheet>
  );
}

export default LancamentosDaCelula;
