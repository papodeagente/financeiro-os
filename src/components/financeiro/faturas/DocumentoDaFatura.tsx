'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { INFO_DO_MODELO, MODELOS_DE_FATURA, type ModeloDeFatura } from '@/lib/fatura-regras';
import { colunasDoModelo, ROTULO_DA_COLUNA, TEXTO_DE_ABERTURA, valorDaColuna } from '@/lib/fatura-documento';
import { cn } from '@/lib/utils';
import type { DadosDaFolhaDaFatura } from '@/lib/cobranca/portal-fatura';
import { apiFaturas, type FichaDaFatura } from './api';
import { dataBR, periodoBR, reais } from './comum';

/**
 * A fatura para imprimir ou salvar em PDF (E5, parte B), nos três modelos:
 * Padrão (cada produto com passageiros, datas, localizador e centro de custo,
 * as retenções e o total líquido), Personalizada (as colunas escolhidas) e
 * Simplificada (descrição e passageiros). Fora da moldura do sistema, para a
 * folha sair limpa.
 */
export function DocumentoDaFatura({ faturaId, modeloPedido }: { faturaId: string; modeloPedido: string | null }) {
  const [ficha, setFicha] = React.useState<FichaDaFatura | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    apiFaturas.ficha(faturaId, ac.signal)
      .then(f => { setFicha(f); document.title = `Fatura Nº ${f.fatura.numero} - ${f.fatura.pessoa_nome}`; })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'Não foi possível abrir a fatura.'); });
    return () => ac.abort();
  }, [faturaId]);

  const modelo: ModeloDeFatura = (MODELOS_DE_FATURA as readonly string[]).includes(String(modeloPedido))
    ? modeloPedido as ModeloDeFatura : ficha?.fatura.modelo ?? 'PADRAO';

  return (
    <main className="min-h-dvh bg-[var(--fin-bg)] px-[var(--fin-s-3)] pb-[var(--fin-s-6)] sm:px-[var(--fin-s-4)] print:bg-[var(--fin-surface)] print:p-0">
      <div className="fin-no-print mx-auto flex w-full max-w-[880px] flex-wrap items-center justify-between gap-[var(--fin-s-2)] pt-[var(--fin-s-4)]">
        <Link
          href={`/financeiro-ag/faturas/${encodeURIComponent(faturaId)}`}
          className="inline-flex h-11 items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-2 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:h-9"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Voltar à fatura
        </Link>
        <span className="flex items-center gap-[var(--fin-s-3)]">
          <span className="fin-t-caption text-[var(--fin-text-3)]">Modelo {INFO_DO_MODELO[modelo].rotulo}</span>
          <Button type="button" onClick={() => window.print()} disabled={!ficha} className="gap-[var(--fin-s-2)]">
            <Printer aria-hidden="true" className="size-4" /> Imprimir ou salvar em PDF
          </Button>
        </span>
      </div>

      {ficha ? <FolhaDaFatura ficha={ficha} modelo={modelo} /> : erro ? (
        <div role="alert" className="mx-auto my-[var(--fin-s-6)] flex max-w-[560px] flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] text-center">
          <p className="fin-t-subhead text-[var(--fin-text)]">Sem fatura para mostrar</p>
          <p className="fin-t-body text-[var(--fin-text-2)]">{erro}</p>
        </div>
      ) : (
        <div aria-busy="true" className="mx-auto my-[var(--fin-s-4)] flex w-full max-w-[880px] flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-6)]">
          <span className="block h-8 w-1/2 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-24 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-48 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="sr-only" role="status">Montando a fatura.</span>
        </div>
      )}
    </main>
  );
}

/**
 * A folha da fatura. Serve à ficha interna e ao portal do cliente (E7), que
 * recebe só os campos da folha (`DadosDaFolhaDaFatura`).
 */
export function FolhaDaFatura({ ficha, modelo }: { ficha: DadosDaFolhaDaFatura; modelo: ModeloDeFatura }) {
  const f = ficha.fatura;
  const t = ficha.totais;
  const { emitente, sacado } = ficha;
  const colunas = colunasDoModelo(modelo, f.campos);
  const numeros = new Set(['valor']);
  const celula = 'border-b border-[var(--fin-border)] px-[var(--fin-s-2)] py-[var(--fin-s-2)] align-top';

  return (
    <article
      aria-label={`Fatura Nº ${f.numero}`}
      className="mx-auto my-[var(--fin-s-4)] flex w-full max-w-[880px] flex-col gap-[var(--fin-s-5)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] text-[var(--fin-text)] shadow-[var(--fin-e-card)] sm:p-[var(--fin-s-6)] print:my-0 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
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
        <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-[var(--fin-s-3)] gap-y-0.5 sm:text-right">
          <dt className="sr-only">Documento</dt>
          <dd className="col-span-2 fin-t-title tabular-nums">Fatura Nº {f.numero}</dd>
          <dt className="fin-t-caption text-[var(--fin-text-2)]">Emissão</dt><dd className="fin-t-body tabular-nums">{dataBR(f.emissao ?? f.criado_em)}</dd>
          <dt className="fin-t-caption text-[var(--fin-text-2)]">Vencimento</dt><dd className="fin-t-body-strong tabular-nums">{dataBR(f.vencimento)}</dd>
          {f.periodo_inicio ? <><dt className="fin-t-caption text-[var(--fin-text-2)]">Período</dt><dd className="fin-t-body tabular-nums">{periodoBR(f.periodo_inicio, f.periodo_fim)}</dd></> : null}
        </dl>
      </header>

      <section aria-label="Cliente" className="grid gap-[var(--fin-s-3)] sm:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="fin-t-caption text-[var(--fin-text-2)]">Cliente</span>
          <span className="fin-t-body-strong">{sacado.nome || f.pessoa_nome}</span>
          {sacado.documento ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">{sacado.documento}</span> : null}
          {sacado.endereco ? <span className="fin-t-caption text-[var(--fin-text-3)]">{sacado.endereco}</span> : null}
        </div>
        {f.solicitante || f.centro_custo ? (
          <div className="flex flex-col gap-0.5 sm:text-right">
            {f.solicitante ? <span className="fin-t-caption text-[var(--fin-text-2)]">Solicitante: <span className="text-[var(--fin-text)]">{f.solicitante}</span></span> : null}
            {f.centro_custo ? <span className="fin-t-caption text-[var(--fin-text-2)]">Centro de custo: <span className="text-[var(--fin-text)]">{f.centro_custo}</span></span> : null}
          </div>
        ) : null}
      </section>

      {modelo !== 'SIMPLIFICADA' ? <p className="fin-t-body text-[var(--fin-text-2)]">{TEXTO_DE_ABERTURA}</p> : null}

      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse fin-t-caption" data-fin-table>
          <thead>
            <tr className="text-left">
              {colunas.map(c => (
                <th key={c} scope="col" className={cn('border-b border-[var(--fin-border-strong)] px-[var(--fin-s-2)] py-[var(--fin-s-2)] fin-t-overline text-[var(--fin-text-2)]', numeros.has(c) && 'text-right')}>
                  {modelo === 'SIMPLIFICADA' && c === 'produto' ? 'Descrição' : ROTULO_DA_COLUNA[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ficha.itens.map(i => (
              <tr key={i.conta_id}>
                {colunas.map(c => (
                  <td key={c} className={cn(celula, numeros.has(c) ? 'whitespace-nowrap text-right tabular-nums' : c === 'data_venda' || c === 'viagem' ? 'whitespace-nowrap tabular-nums' : '')}>
                    {c === 'valor' ? reais(i.valor_centavos) : valorDaColuna(i, c) || '—'}
                  </td>
                ))}
              </tr>
            ))}
            {!ficha.itens.length ? <tr><td colSpan={colunas.length} className={cn(celula, 'text-[var(--fin-text-3)]')}>Sem itens: a fatura traz só as notas abaixo.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {ficha.notas.length ? (
        <section aria-label="Notas de crédito e débito" className="flex flex-col gap-[var(--fin-s-2)]">
          <h2 className="fin-t-body-strong">Notas de crédito e débito</h2>
          <ul className="flex flex-col">
            {ficha.notas.map(n => (
              <li key={n.id} className="flex items-start justify-between gap-[var(--fin-s-3)] border-b border-[var(--fin-border)] py-[var(--fin-s-1)] fin-t-caption">
                <span><span className="font-medium">{n.tipo === 'CREDITO' ? 'Crédito' : 'Débito'}:</span> {n.motivo}</span>
                <span className="shrink-0 tabular-nums">{n.tipo === 'CREDITO' ? '− ' : '+ '}{reais(n.valor_centavos)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Totais" className="flex flex-col items-end gap-0.5 self-end text-right sm:min-w-[340px]">
        <Linha rotulo="Total dos itens" valor={reais(t.itens)} />
        {t.creditos ? <Linha rotulo="Notas de crédito" valor={`− ${reais(t.creditos)}`} /> : null}
        {t.debitos ? <Linha rotulo="Notas de débito" valor={`+ ${reais(t.debitos)}`} /> : null}
        {t.creditos || t.debitos ? <Linha rotulo="Total da fatura" valor={reais(t.bruto)} forte /> : null}
        {t.retencoes.length && modelo !== 'SIMPLIFICADA' ? (
          <>
            <span className="mt-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-2)]">Retenções na fonte{f.retencoes.base === 'TAXAS' ? ' (sobre as taxas de serviço)' : ''}</span>
            {t.retencoes.map(r => <Linha key={r.id} rotulo={`${r.nome} ${String(r.percentual).replace('.', ',')}%`} valor={`− ${reais(r.valor_centavos)}`} />)}
          </>
        ) : t.total_retencoes ? <Linha rotulo="Retenções na fonte" valor={`− ${reais(t.total_retencoes)}`} /> : null}
        <div className="mt-[var(--fin-s-2)] flex w-full items-baseline justify-between gap-[var(--fin-s-4)] border-t border-[var(--fin-border-strong)] pt-[var(--fin-s-2)]">
          <span className="fin-t-body-strong">Total a pagar</span>
          <span className="fin-t-metric-sm tabular-nums">{reais(t.liquido)}</span>
        </div>
      </section>

      {ficha.cobranca?.linha_digitavel || ficha.cobranca?.pix_copia_cola ? (
        <section aria-label="Pagamento" className="flex flex-col gap-0.5 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-[var(--fin-s-3)]">
          <span className="fin-t-caption text-[var(--fin-text-2)]">Pague pelo boleto ou pelo Pix até {dataBR(ficha.cobranca.vencimento ?? f.vencimento)}</span>
          {ficha.cobranca.linha_digitavel ? <span className="break-all fin-t-body tabular-nums">Linha digitável: {ficha.cobranca.linha_digitavel}</span> : null}
          {ficha.cobranca.pix_copia_cola ? <span className="break-all fin-t-caption text-[var(--fin-text-2)]">Pix copia e cola: {ficha.cobranca.pix_copia_cola}</span> : null}
        </section>
      ) : null}

      {ficha.instrucoes || f.observacoes ? (
        <section aria-label="Instruções" className="flex flex-col gap-[var(--fin-s-1)]">
          {ficha.instrucoes ? <p className="whitespace-pre-line fin-t-caption text-[var(--fin-text-2)]">{ficha.instrucoes}</p> : null}
          {f.observacoes ? <p className="whitespace-pre-line fin-t-caption text-[var(--fin-text-2)]">{f.observacoes}</p> : null}
        </section>
      ) : null}

      {modelo !== 'SIMPLIFICADA' ? (
        <footer className="mt-[var(--fin-s-4)] grid grid-cols-1 gap-[var(--fin-s-5)] pt-[var(--fin-s-4)] sm:grid-cols-[2fr_1fr] print:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-1">
            <span className="h-10 border-b border-[var(--fin-text-2)]" aria-hidden="true" />
            <span className="fin-t-caption text-[var(--fin-text-2)]">De acordo (nome e assinatura de quem confere pelo cliente)</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="h-10 border-b border-[var(--fin-text-2)]" aria-hidden="true" />
            <span className="fin-t-caption text-[var(--fin-text-2)]">Data</span>
          </div>
        </footer>
      ) : null}
    </article>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="flex w-full items-baseline justify-between gap-[var(--fin-s-4)]">
      <span className={cn('fin-t-caption', forte ? 'font-medium text-[var(--fin-text)]' : 'text-[var(--fin-text-2)]')}>{rotulo}</span>
      <span className={cn('tabular-nums', forte ? 'fin-t-body-strong' : 'fin-t-body')}>{valor}</span>
    </div>
  );
}
