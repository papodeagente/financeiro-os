'use client';

/**
 * Notas fiscais e retenção na fonte da venda (E7, 06/11/2026), na aba
 * Cliente da ficha. Só leitura: emitir e registrar notas continuam em
 * Notas fiscais; a retenção nasce da regra do cliente ao salvar a venda.
 */
import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, FileText } from 'lucide-react';

import type { FiscalDaVenda, NotaNaFicha, TomFiscal } from '@/lib/venda-fiscal';
import { formatBRL, cn } from '@/lib/utils';
import { dataBR, LINK, SECAO } from './comum';

const TOM: Record<TomFiscal, string> = {
  positivo: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
  aviso: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
  negativo: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
  neutro: 'bg-[var(--fin-surface-2)] text-[var(--fin-text-2)]',
};

function Selo({ nota }: { nota: NotaNaFicha }) {
  return <span className={cn('inline-flex whitespace-nowrap rounded-[var(--fin-r-sm)] px-1.5 py-0.5 fin-t-caption font-medium', TOM[nota.tom])}>{nota.rotulo}</span>;
}

export function NotasERetencoes({ vendaId }: { vendaId: string }) {
  const [dados, setDados] = React.useState<FiscalDaVenda | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const carregar = React.useCallback(() => {
    const ac = new AbortController();
    setErro(null);
    fetch(`/api/vendas/completa/${encodeURIComponent(vendaId)}/fiscal`, { signal: ac.signal })
      .then(async r => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof j?.error === 'string' ? j.error : 'Não foi possível ler as notas.');
        setDados(j as FiscalDaVenda);
      })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'Não foi possível ler as notas.'); });
    return () => ac.abort();
  }, [vendaId]);
  React.useEffect(() => carregar(), [carregar]);

  if (erro) {
    return (
      <section aria-label="Notas e retenção" className={SECAO}>
        <p className="fin-t-body text-[var(--fin-text-2)]">{erro} <button type="button" onClick={() => carregar()} className={LINK}>Tentar de novo</button></p>
      </section>
    );
  }
  if (!dados) {
    return <div aria-busy="true" className="h-28 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]"><span className="sr-only" role="status">Lendo as notas da venda.</span></div>;
  }

  const { notas, retencoes, totais } = dados;
  return (
    <section aria-labelledby="t-notas-venda" className={SECAO}>
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--fin-s-2)]">
        <h2 id="t-notas-venda" className="fin-t-subhead text-[var(--fin-text)]">Notas fiscais e retenção</h2>
        <Link href="/financeiro-ag/notas/gerar" className={cn(LINK, 'fin-t-caption')}>Gerar notas das vendas</Link>
      </div>

      {notas.length ? (
        <div className="flex flex-col gap-[var(--fin-s-2)]">
          <p className="fin-t-caption text-[var(--fin-text-2)]">
            Autorizadas: <span className="tabular-nums text-[var(--fin-text)]">{formatBRL(totais.autorizado)}</span>
            {totais.em_andamento > 0 ? <> · na prefeitura ou em rascunho: <span className="tabular-nums text-[var(--fin-text)]">{formatBRL(totais.em_andamento)}</span></> : null}
          </p>
          <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
            {notas.map(n => (
              <li key={n.id} className="flex flex-col gap-1 py-[var(--fin-s-2)] sm:flex-row sm:items-center sm:justify-between sm:gap-[var(--fin-s-3)]">
                <div className="flex min-w-0 items-start gap-[var(--fin-s-2)]">
                  <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--fin-text-3)]" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)]">
                      {n.numero ? <>Nota <span className="tabular-nums">{n.numero}</span></> : 'Nota sem número'}
                      <Selo nota={n} />
                      {n.externa ? <span className="fin-t-caption text-[var(--fin-text-3)]">emitida fora do sistema</span> : null}
                    </span>
                    <span className="truncate fin-t-caption text-[var(--fin-text-3)]">
                      {n.tomador || 'Tomador não informado'}{n.data ? ` · ${dataBR(n.data)}` : ''}
                    </span>
                    {n.erro ? <span className="fin-t-caption text-[var(--fin-negative-text)]">{n.erro}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-[var(--fin-s-3)] pl-6 sm:pl-0">
                  <span className="fin-t-body-strong tabular-nums">{formatBRL(n.valor_servicos)}</span>
                  {n.link_pdf ? (
                    <a href={n.link_pdf} target="_blank" rel="noopener noreferrer" className={cn(LINK, 'inline-flex items-center gap-1 fin-t-caption')}>
                      PDF <ExternalLink aria-hidden="true" className="size-3" /><span className="sr-only"> da nota (abre em outra aba)</span>
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="fin-t-body text-[var(--fin-text-2)]">Nenhuma nota fiscal desta venda ainda. As notas saem pelas regras da nota, em Notas fiscais.</p>
      )}

      {retencoes.length ? (
        <div className="flex flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)]">
          <p className="fin-t-body text-[var(--fin-text)]">
            O cliente retém <strong className="font-medium tabular-nums">{formatBRL(totais.retido)}</strong> na fonte; a conta a receber já sai pelo valor líquido.
          </p>
          <dl className="grid grid-cols-2 gap-[var(--fin-s-3)] sm:grid-cols-4">
            {(['IR', 'CSLL', 'PIS', 'COFINS'] as const).map(t => (
              <div key={t} className="flex flex-col gap-0.5">
                <dt className="fin-t-caption text-[var(--fin-text-3)]">{t}</dt>
                <dd className="fin-t-body-strong tabular-nums">{formatBRL(totais[t])}</dd>
              </div>
            ))}
          </dl>
          {retencoes.length > 1 ? (
            <ul className="flex flex-col gap-1">
              {retencoes.map(r => (
                <li key={r.conta_id} className="flex flex-wrap justify-between gap-x-[var(--fin-s-3)] fin-t-caption text-[var(--fin-text-2)]">
                  <span className="min-w-0 truncate">{r.descricao || 'Conta a receber'}{r.pagante ? ` · ${r.pagante}` : ''}</span>
                  <span className="tabular-nums">{formatBRL(r.valor_bruto)} − {formatBRL(r.total)} = {formatBRL(r.liquido)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">
              {formatBRL(retencoes[0].valor_bruto)} − {formatBRL(retencoes[0].total)} retidos = {formatBRL(retencoes[0].liquido)} a receber
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
