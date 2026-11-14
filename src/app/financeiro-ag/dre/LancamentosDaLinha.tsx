'use client';

import Link from 'next/link';

import { RecordSheet } from '@/components/fin/RecordSheet';
import { Money } from '@/components/fin/Money';
import type { LancamentoDRE, RegimeDRE } from '@/lib/resultado-dre';
import { cn, formatDate } from '@/lib/utils';

const ONDE: Record<LancamentoDRE['tabela'], { rotulo: string; href: string }> = {
  contas_receber: { rotulo: 'Conta a receber', href: '/financeiro-ag/receber' },
  contas_pagar: { rotulo: 'Conta a pagar', href: '/financeiro-ag/pagar' },
  vendas_crm: { rotulo: 'Venda', href: '/vendas' },
};

/**
 * Os lançamentos que formam um número do demonstrativo (05/11/2026). Janela
 * no centro, só de leitura: quem quer mexer vai à tela de origem pelo link.
 */
export function LancamentosDaLinha({
  aberta, regime, rotuloMes, onFechar,
}: {
  aberta: { titulo: string; lancamentos: LancamentoDRE[]; valor: number } | null;
  regime: RegimeDRE;
  rotuloMes: string;
  onFechar: () => void;
}) {
  const lista = aberta ? [...aberta.lancamentos].sort((a, b) => b.valor - a.valor) : [];
  return (
    <RecordSheet
      aberto={aberta !== null}
      onOpenChange={v => { if (!v) onFechar(); }}
      titulo={aberta?.titulo ?? ''}
      descricao={`${rotuloMes}, ${regime === 'caixa' ? 'pela data do recebimento e do pagamento' : 'pelo vencimento e pela data da venda'}. ${lista.length === 1 ? '1 lançamento' : `${lista.length} lançamentos`}.`}
      largura={640}
      acaoPrimaria={{ rotulo: 'Fechar', onClick: onFechar }}
      acaoSecundaria={null}
      resumo={aberta ? (
        <span className="flex items-baseline justify-between gap-[var(--fin-s-3)]">
          <span className="fin-t-caption text-[var(--fin-text-3)]">Soma dos lançamentos</span>
          <Money valor={aberta.valor} estado="ok" size="strong" />
        </span>
      ) : null}
    >
      <ul className="flex flex-col">
        {lista.map(l => (
          <li
            key={`${l.tabela}-${l.id}`}
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[var(--fin-s-3)] gap-y-0.5',
              'border-b border-[var(--fin-border)] py-[var(--fin-s-2)] last:border-b-0',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate fin-t-body font-medium text-[var(--fin-text)]">
                {l.descricao || ONDE[l.tabela].rotulo}
              </span>
              <span className="block truncate fin-t-caption text-[var(--fin-text-3)]">
                {[l.pessoa, l.data ? formatDate(l.data) : '', ONDE[l.tabela].rotulo].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="flex flex-col items-end">
              <Money valor={l.valor} estado="ok" size="body" />
              <Link
                href={l.tabela === 'vendas_crm' ? ONDE[l.tabela].href : `${ONDE[l.tabela].href}?abrir=${encodeURIComponent(l.id)}`}
                className="fin-t-caption text-[var(--fin-accent)] underline-offset-2 hover:underline"
              >
                Abrir
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </RecordSheet>
  );
}

export default LancamentosDaLinha;
