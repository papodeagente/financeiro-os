'use client';

import * as React from 'react';
import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { dataPorExtenso, type Recibo } from '@/lib/cobranca/recibo';
import { formatBRL } from '@/lib/utils';

/**
 * A folha do recibo (05/11/2026): uma página que imprime limpa (ou vira PDF
 * pelo "Salvar como PDF" do navegador). A mesma folha serve a agência
 * (/recibo/[conta]) e o cliente no portal (/c/[token]/recibo/[conta]).
 *
 * O texto é o de um recibo comum: quem recebeu, de quem, quanto (em número
 * e por extenso), referente a quê, a forma e a data, a cidade e a assinatura.
 */

function dataCurta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function BarraDoRecibo({ voltar }: { voltar?: React.ReactNode }) {
  return (
    <div className="fin-no-print mx-auto flex w-full max-w-[760px] flex-wrap items-center justify-between gap-[var(--fin-s-2)] pt-[var(--fin-s-4)]">
      <div>{voltar}</div>
      <Button type="button" onClick={() => window.print()} className="gap-[var(--fin-s-2)]">
        <Printer aria-hidden="true" className="size-4" /> Imprimir ou salvar em PDF
      </Button>
    </div>
  );
}

export function FolhaDoRecibo({ recibo }: { recibo: Recibo }) {
  const { emitente, pagador } = recibo;
  return (
    <article
      aria-label={`Recibo ${recibo.numero}`}
      className="mx-auto my-[var(--fin-s-4)] flex w-full max-w-[760px] flex-col gap-[var(--fin-s-5)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] text-[var(--fin-text)] shadow-[var(--fin-e-card)] sm:p-[var(--fin-s-6)] print:my-0 print:rounded-none print:border-0 print:shadow-none"
    >
      <header className="flex flex-col gap-[var(--fin-s-4)] border-b border-[var(--fin-border)] pb-[var(--fin-s-4)] sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-[var(--fin-s-3)]">
          {emitente.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- logotipo da agência, endereço de fora
            <img src={emitente.logo} alt="" className="size-12 shrink-0 rounded-[var(--fin-r-md)] object-contain" />
          ) : null}
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="fin-t-subhead">{emitente.nome}</span>
            {emitente.documento ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">{emitente.documento}</span> : null}
            {emitente.endereco ? <span className="fin-t-caption text-[var(--fin-text-3)]">{emitente.endereco}</span> : null}
            {emitente.contato ? <span className="fin-t-caption text-[var(--fin-text-3)]">{emitente.contato}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1 sm:items-end">
          <h1 className="fin-t-title tracking-[0.04em]">RECIBO</h1>
          <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">Nº {recibo.numero}</span>
          <span className="mt-1 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] px-[var(--fin-s-3)] py-[var(--fin-s-1)] fin-t-metric-sm tabular-nums">
            {formatBRL(recibo.valor)}
          </span>
        </div>
      </header>

      <p className="fin-t-body max-w-[68ch] text-[15px] leading-relaxed">
        Recebemos de <strong className="font-medium">{pagador.nome}</strong>
        {pagador.documento ? <>, CPF/CNPJ <span className="whitespace-nowrap tabular-nums">{pagador.documento}</span></> : null}, a quantia de{' '}
        <strong className="font-medium">{formatBRL(recibo.valor)}</strong> ({recibo.valor_por_extenso.charAt(0).toLowerCase() + recibo.valor_por_extenso.slice(1)}),
        referente a <strong className="font-medium">{recibo.referente}</strong>, pela qual damos quitação.
      </p>

      <dl className="grid grid-cols-1 gap-x-[var(--fin-s-5)] gap-y-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-4)] fin-t-body sm:grid-cols-2">
        <div className="flex flex-col"><dt className="fin-t-caption text-[var(--fin-text-3)]">Forma de pagamento</dt><dd>{recibo.forma}</dd></div>
        <div className="flex flex-col"><dt className="fin-t-caption text-[var(--fin-text-3)]">Data do pagamento</dt><dd className="tabular-nums">{dataCurta(recibo.data)}</dd></div>
        {recibo.encargos.map(e => (
          <div key={e.rotulo} className="flex flex-col">
            <dt className="fin-t-caption text-[var(--fin-text-3)]">{e.rotulo} {e.valor < 0 ? '(abatido)' : '(incluído)'}</dt>
            <dd className="tabular-nums">{formatBRL(Math.abs(e.valor))}</dd>
          </div>
        ))}
      </dl>

      <footer className="flex flex-col gap-[var(--fin-s-6)] pt-[var(--fin-s-3)]">
        <p className="fin-t-body text-[var(--fin-text-2)]">{dataPorExtenso(recibo.data, recibo.cidade)}.</p>
        <div className="flex flex-col items-center gap-1 self-center pt-[var(--fin-s-5)]">
          <span aria-hidden="true" className="block h-px w-72 bg-[var(--fin-text-3)]" />
          <span className="fin-t-body">{emitente.nome}</span>
          {emitente.documento ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{emitente.documento}</span> : null}
        </div>
      </footer>
    </article>
  );
}
