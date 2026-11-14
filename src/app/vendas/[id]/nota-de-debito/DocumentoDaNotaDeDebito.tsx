'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { dataBR } from '@/lib/cobranca/regras-telas';
import type { Emitente, NotaDeDebito, Sacado } from '@/lib/fatura-documento';
import { formatBRL } from '@/lib/utils';

/**
 * Nota de débito da venda (E5, parte B, 05/11/2026): uma folha por venda que
 * o cliente confere ANTES do faturamento. Produtos com fornecedor,
 * localizador, datas e passageiros; taxas, serviços (Taxa DU, RAV, Fee) e
 * descontos; as formas de pagamento com os vencimentos; as retenções e o
 * valor a faturar líquido. Imprime limpa ou vira PDF pelo navegador.
 */

interface Resposta { nota: NotaDeDebito; emitente: Emitente; sacado: Sacado; instrucoes: string }

const reais = (c: number) => formatBRL(c / 100);
const TH = 'px-[var(--fin-s-2)] py-[var(--fin-s-1)] text-left fin-t-overline text-[var(--fin-text-3)]';
const TD = 'px-[var(--fin-s-2)] py-[var(--fin-s-1)] align-top fin-t-body';
const NUM = 'text-right tabular-nums whitespace-nowrap';

function periodo(ini: string, fim: string): string {
  if (!ini) return '';
  return fim && fim !== ini ? `${dataBR(ini)} a ${dataBR(fim)}` : dataBR(ini);
}

function Linha({ rotulo, valor, forte, negativo }: { rotulo: string; valor: number; forte?: boolean; negativo?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-[var(--fin-s-3)] ${forte ? 'border-t border-[var(--fin-border-strong)] pt-[var(--fin-s-2)]' : ''}`}>
      <dt className={forte ? 'fin-t-body-strong' : 'fin-t-body text-[var(--fin-text-2)]'}>{rotulo}</dt>
      <dd className={`${forte ? 'fin-t-metric-sm' : 'fin-t-body'} tabular-nums`}>{negativo && valor ? `− ${reais(valor)}` : reais(valor)}</dd>
    </div>
  );
}

function Folha({ dados }: { dados: Resposta }) {
  const { nota, emitente, sacado, instrucoes } = dados;
  const t = nota.totais;
  return (
    <article
      aria-label={`Nota de débito da venda ${nota.venda.numero}`}
      className="mx-auto my-[var(--fin-s-4)] flex w-full max-w-[860px] flex-col gap-[var(--fin-s-5)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] text-[var(--fin-text)] shadow-[var(--fin-e-card)] sm:p-[var(--fin-s-6)] print:my-0 print:rounded-none print:border-0 print:p-0 print:shadow-none"
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
          <h1 className="fin-t-title">Nota de débito</h1>
          <span className="fin-t-body tabular-nums text-[var(--fin-text-2)]">Venda {nota.venda.numero || '—'}</span>
          {nota.venda.data_venda ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">Data da venda {dataBR(nota.venda.data_venda)}</span> : null}
        </div>
      </header>

      <p className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-warning)] bg-[var(--fin-warning-soft)] p-[var(--fin-s-3)] fin-t-body-strong text-[var(--fin-warning-text)] print:bg-transparent">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {nota.aviso}
      </p>

      <section aria-label="Pagante" className="grid grid-cols-1 gap-x-[var(--fin-s-5)] gap-y-[var(--fin-s-2)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-4)] sm:grid-cols-2 print:bg-transparent print:p-0">
        <div className="flex flex-col">
          <span className="fin-t-caption text-[var(--fin-text-3)]">Pagante</span>
          <span className="fin-t-body-strong">{sacado.nome || nota.pagante.nome}</span>
          {sacado.documento || nota.pagante.documento ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">CPF/CNPJ {sacado.documento || nota.pagante.documento}</span> : null}
          {sacado.endereco ? <span className="fin-t-caption text-[var(--fin-text-3)]">{sacado.endereco}</span> : null}
        </div>
        <div className="flex flex-col gap-1">
          {nota.solicitante ? <span className="fin-t-body"><span className="text-[var(--fin-text-3)]">Solicitante: </span>{nota.solicitante}</span> : null}
          {nota.venda.centro_custo ? <span className="fin-t-body"><span className="text-[var(--fin-text-3)]">Centro de custo: </span>{nota.venda.centro_custo}</span> : null}
        </div>
      </section>

      <section aria-labelledby="nd-produtos" className="flex flex-col gap-[var(--fin-s-3)]">
        <h2 id="nd-produtos" className="fin-t-subhead">Produtos e serviços</h2>
        {nota.produtos.length ? nota.produtos.map((p, i) => (
          <div key={i} className="flex flex-col gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)] first-of-type:border-t-0 first-of-type:pt-0 [break-inside:avoid]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-[var(--fin-s-3)]">
              <span className="fin-t-body-strong">{p.tipo}{p.descricao ? ` · ${p.descricao}` : ''}</span>
              <span className="fin-t-body-strong tabular-nums">{reais(p.total_centavos)}</span>
            </div>
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              {[p.fornecedor ? `Fornecedor ${p.fornecedor}` : '', p.localizador ? `Localizador ${p.localizador}` : '', periodo(p.data_inicio, p.data_fim), p.moeda && p.moeda !== 'BRL' ? `Valores convertidos de ${p.moeda}` : '']
                .filter(Boolean).join(' · ')}
            </p>
            {p.passageiros.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse">
                  <thead><tr className="border-b border-[var(--fin-border)]"><th className={TH}>Passageiro</th><th className={`${TH} ${NUM}`}>Tarifa</th><th className={`${TH} ${NUM}`}>Taxas</th></tr></thead>
                  <tbody>
                    {p.passageiros.map((x, j) => (
                      <tr key={j} className="border-b border-[var(--fin-border)] last:border-b-0">
                        <td className={TD}>{x.nome}</td>
                        <td className={`${TD} ${NUM}`}>{reais(x.tarifa_centavos)}</td>
                        <td className={`${TD} ${NUM}`}>{reais(x.taxas_centavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <dl className="ml-auto flex w-full max-w-[320px] flex-col gap-0.5">
              <Linha rotulo="Tarifa" valor={p.tarifa_centavos} />
              {p.taxas_centavos ? <Linha rotulo="Taxas" valor={p.taxas_centavos} /> : null}
              {p.servicos.map(s => <Linha key={s.nome} rotulo={s.nome} valor={s.valor_centavos} />)}
              {p.descontos_centavos ? <Linha rotulo="Desconto" valor={p.descontos_centavos} negativo /> : null}
            </dl>
          </div>
        )) : <p className="fin-t-body text-[var(--fin-text-3)]">A venda ainda não tem produto.</p>}
      </section>

      <section aria-labelledby="nd-pagamentos" className="flex flex-col gap-[var(--fin-s-2)] [break-inside:avoid]">
        <h2 id="nd-pagamentos" className="fin-t-subhead">Formas de pagamento</h2>
        {nota.pagamentos.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead><tr className="border-b border-[var(--fin-border)]"><th className={TH}>Forma</th><th className={TH}>Pagante</th><th className={TH}>Vencimento</th><th className={`${TH} ${NUM}`}>Valor</th></tr></thead>
              <tbody>
                {nota.pagamentos.map((pg, i) => (
                  <tr key={i} className="border-b border-[var(--fin-border)] last:border-b-0">
                    <td className={TD}>{pg.forma}{pg.parcelas > 1 ? ` em ${pg.parcelas}x` : ''}</td>
                    <td className={TD}>{pg.pagante}</td>
                    <td className={`${TD} tabular-nums`}>{pg.vencimentos.length ? pg.vencimentos.map(dataBR).join(', ') : '—'}</td>
                    <td className={`${TD} ${NUM}`}>{reais(pg.valor_centavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="fin-t-body text-[var(--fin-text-3)]">Nenhuma forma de pagamento informada.</p>}
      </section>

      <section aria-label="Totais" className="flex flex-col gap-[var(--fin-s-4)] sm:flex-row sm:justify-end [break-inside:avoid]">
        <dl className="flex w-full flex-col gap-1 sm:max-w-[360px]">
          <Linha rotulo="Produtos (tarifas)" valor={t.produtos_centavos} />
          <Linha rotulo="Taxas" valor={t.taxas_centavos} />
          <Linha rotulo="Serviços (Taxa DU, RAV, Fee)" valor={t.servicos_centavos} />
          {t.descontos_centavos ? <Linha rotulo="Descontos" valor={t.descontos_centavos} negativo /> : null}
          <Linha rotulo="Total da venda" valor={t.total_centavos} forte />
          {t.a_faturar_centavos ? (
            <>
              <Linha rotulo="A faturar" valor={t.a_faturar_centavos} />
              {nota.retencoes.map(r => <Linha key={r.id} rotulo={`Retenção ${r.nome} ${String(r.percentual).replace('.', ',')}%`} valor={r.valor_centavos} negativo />)}
              <Linha rotulo={nota.retencoes.length ? 'A faturar, líquido das retenções' : 'Valor a faturar'} valor={nota.a_faturar_liquido_centavos} forte />
            </>
          ) : null}
        </dl>
      </section>

      {instrucoes ? <p className="whitespace-pre-line fin-t-body text-[var(--fin-text-2)]">{instrucoes}</p> : null}

      <footer className="grid grid-cols-1 gap-[var(--fin-s-6)] pt-[var(--fin-s-5)] sm:grid-cols-2 [break-inside:avoid]">
        {['Conferido por', 'Data'].map(r => (
          <div key={r} className="flex flex-col gap-1">
            <span aria-hidden="true" className="block h-px w-full bg-[var(--fin-text-3)]" />
            <span className="fin-t-caption text-[var(--fin-text-3)]">{r}</span>
          </div>
        ))}
      </footer>
    </article>
  );
}

export function DocumentoDaNotaDeDebito({ vendaId }: { vendaId: string }) {
  const [dados, setDados] = React.useState<Resposta | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/vendas/completa/${encodeURIComponent(vendaId)}/nota-de-debito`, { signal: ac.signal, cache: 'no-store' })
      .then(async r => {
        const corpo = await r.json().catch(() => null);
        if (!r.ok) throw new Error(r.status === 404 ? 'Venda não encontrada.' : typeof corpo?.error === 'string' ? corpo.error : 'Não foi possível montar a nota de débito.');
        setDados(corpo as Resposta);
        document.title = `Nota de débito ${(corpo as Resposta).nota.venda.numero}`;
      })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'Não foi possível montar a nota de débito.'); });
    return () => ac.abort();
  }, [vendaId]);

  return (
    <main className="min-h-dvh bg-[var(--fin-bg)] px-[var(--fin-s-3)] pb-[var(--fin-s-6)] sm:px-[var(--fin-s-4)] print:bg-[var(--fin-surface)] print:p-0">
      <div className="fin-no-print mx-auto flex w-full max-w-[860px] flex-wrap items-center justify-between gap-[var(--fin-s-2)] pt-[var(--fin-s-4)]">
        <Link
          href={`/vendas/${encodeURIComponent(vendaId)}/ficha`}
          className="inline-flex min-h-11 items-center gap-1 rounded-[var(--fin-r-md)] px-2 fin-t-body text-[var(--fin-accent)] hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:min-h-10"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Voltar para a venda
        </Link>
        <Button type="button" onClick={() => window.print()} disabled={!dados} className="gap-[var(--fin-s-2)]">
          <Printer aria-hidden="true" className="size-4" /> Imprimir ou salvar em PDF
        </Button>
      </div>
      {dados ? <Folha dados={dados} /> : erro ? (
        <div role="alert" className="mx-auto my-[var(--fin-s-6)] flex max-w-[560px] flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] text-center">
          <p className="fin-t-subhead text-[var(--fin-text)]">Sem nota de débito para mostrar</p>
          <p className="fin-t-body text-[var(--fin-text-2)]">{erro}</p>
        </div>
      ) : (
        <div aria-busy="true" className="mx-auto my-[var(--fin-s-4)] flex w-full max-w-[860px] flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-6)]">
          <span className="block h-8 w-1/2 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-12 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="block h-40 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
          <span className="sr-only" role="status">Montando a nota de débito.</span>
        </div>
      )}
    </main>
  );
}
