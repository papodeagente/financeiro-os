'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import type { AtrasosEPrazos as Resumo, Contagem, PrazoMedio } from '@/lib/atrasos-e-prazos';
import { cn, formatBRL } from '@/lib/utils';
import { diaMes } from '@/lib/visao-geral';
import { Money } from '@/components/fin/Money';

/**
 * Atrasos, prazos e projeção (05/11/2026): o que vence hoje e o que está em
 * atraso dos dois lados, o saldo de cada conta, a idade dos atrasos, os
 * prazos médios e o caixa projetado. Fica abaixo da visão geral, sem mexer no
 * que ela já mostra.
 */

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const LINK = 'inline-flex items-center gap-1 fin-t-caption font-medium text-[var(--fin-accent)] underline-offset-2 hover:underline';
const CABECALHO = 'fin-t-overline text-[var(--fin-text-3)]';

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

function Celula({ c, alerta = false, href }: { c: Contagem; alerta?: boolean; href?: string }) {
  const corpo = (
    <>
      <Money valor={c.valor} estado="ok" size="strong" tone={alerta && c.valor > 0 ? 'negativo' : 'neutro'} />
      <span className="block text-right fin-t-caption text-[var(--fin-text-3)]">{plural(c.quantidade, 'conta', 'contas')}</span>
    </>
  );
  return (
    <td className="px-3 py-2.5 align-top last:pr-[var(--fin-s-5)]">
      {href && c.quantidade > 0 ? (
        <Link href={href} className="block rounded-[var(--fin-r-sm)] hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]">
          {corpo}
        </Link>
      ) : corpo}
    </td>
  );
}

function Prazo({ rotulo, p, explicacao }: { rotulo: string; p: PrazoMedio; explicacao: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={CABECALHO}>{rotulo}</span>
      <span className="fin-t-metric-sm tabular-nums text-[var(--fin-text)]">
        {p.dias === null ? 'Sem base' : `${p.dias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${p.dias === 1 ? 'dia' : 'dias'}`}
      </span>
      <span className="fin-t-caption text-[var(--fin-text-3)]">
        {p.dias === null ? explicacao : `${plural(p.baixas, 'baixa', 'baixas')} nos últimos 90 dias, ${formatBRL(p.valor)}`}
      </span>
    </div>
  );
}

export function AtrasosEPrazos({ resumo }: { resumo: Resumo }) {
  const maior = Math.max(1, ...resumo.receber.faixas.map(f => f.valor), ...resumo.pagar.faixas.map(f => f.valor));
  const largura = (v: number) => `${Math.max(v > 0 ? 2 : 0, Math.round((v / maior) * 100))}%`;

  return (
    <section id="atrasos-e-prazos" aria-labelledby="t-atrasos-e-prazos" className={cn(CARTAO, 'scroll-mt-[var(--fin-s-6)] overflow-hidden')}>
      <div className="flex flex-col gap-0.5 border-b border-[var(--fin-border)] px-[var(--fin-s-5)] pb-[var(--fin-s-3)] pt-[var(--fin-s-4)]">
        <h2 id="t-atrasos-e-prazos" className="fin-t-subhead text-[var(--fin-text)]">Atrasos, prazos e projeção</h2>
        <p className="fin-t-caption text-[var(--fin-text-3)]">Contas de hoje e em atraso, saldo de cada conta, idade dos atrasos e o caixa pelos próximos 90 dias.</p>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:divide-x xl:divide-[var(--fin-border)]">
        <div className="flex min-w-0 flex-col divide-y divide-[var(--fin-border)]">
          {/* Hoje e em atraso */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="sr-only">Contas a receber e a pagar de hoje e em atraso</caption>
              <thead>
                <tr className="border-b border-[var(--fin-border)]">
                  <th scope="col" className={cn(CABECALHO, 'h-9 pl-[var(--fin-s-5)] pr-3 text-left')}>Contas</th>
                  <th scope="col" className={cn(CABECALHO, 'h-9 px-3 text-right')}>Vencem hoje</th>
                  <th scope="col" className={cn(CABECALHO, 'h-9 px-3 text-right')}>Em atraso</th>
                  <th scope="col" className={cn(CABECALHO, 'h-9 px-3 pr-[var(--fin-s-5)] text-right')}>Em aberto</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-b border-[var(--fin-border)]">
                  <th scope="row" className="py-2.5 pl-[var(--fin-s-5)] pr-3 text-left align-top fin-t-body font-medium text-[var(--fin-text)]">A receber</th>
                  <Celula c={resumo.receber.hoje} href="/financeiro-ag/receber" />
                  <Celula c={resumo.receber.emAtraso} alerta href="/financeiro-ag/receber?status=ATRASADO" />
                  <Celula c={resumo.receber.emAberto} href="/financeiro-ag/receber" />
                </tr>
                <tr>
                  <th scope="row" className="py-2.5 pl-[var(--fin-s-5)] pr-3 text-left align-top fin-t-body font-medium text-[var(--fin-text)]">A pagar</th>
                  <Celula c={resumo.pagar.hoje} href="/financeiro-ag/pagar" />
                  <Celula c={resumo.pagar.emAtraso} alerta href="/financeiro-ag/pagar" />
                  <Celula c={resumo.pagar.emAberto} href="/financeiro-ag/pagar" />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Faixas de atraso */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <caption className="px-[var(--fin-s-5)] pb-1 pt-[var(--fin-s-4)] text-left">
                <span className="block fin-t-body-strong text-[var(--fin-text)]">Idade do que está em aberto</span>
                <span className="block fin-t-caption font-normal text-[var(--fin-text-3)]">Dias desde o vencimento. Vence hoje conta como a vencer.</span>
              </caption>
              <thead>
                <tr className="border-b border-[var(--fin-border)]">
                  <th scope="col" className={cn(CABECALHO, 'h-9 pl-[var(--fin-s-5)] pr-3 text-left')}>Faixa</th>
                  <th scope="col" className={cn(CABECALHO, 'h-9 px-3 text-right')}>A receber</th>
                  <th scope="col" className={cn(CABECALHO, 'h-9 px-3 pr-[var(--fin-s-5)] text-right')}>A pagar</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {resumo.receber.faixas.map((f, i) => {
                  const p = resumo.pagar.faixas[i];
                  const atraso = f.id !== 'A_VENCER';
                  return (
                    <tr key={f.id} className="border-b border-[var(--fin-border)] last:border-b-0">
                      <th scope="row" className={cn('py-2 pl-[var(--fin-s-5)] pr-3 text-left fin-t-body font-normal', atraso ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-2)]')}>
                        {f.rotulo}
                      </th>
                      {[{ c: f, cor: 'bg-[var(--fin-serie-1)]' }, { c: p, cor: 'bg-[var(--fin-serie-2)]' }].map(({ c, cor }, j) => (
                        <td key={j} className="min-w-[9.5rem] px-3 py-2 last:pr-[var(--fin-s-5)]">
                          <span className="flex items-baseline justify-end gap-[var(--fin-s-2)]">
                            <span className="fin-t-caption text-[var(--fin-text-3)]">{c.quantidade || ''}</span>
                            <span className={cn('fin-t-body', c.valor > 0 ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]')}>{formatBRL(c.valor)}</span>
                          </span>
                          <span aria-hidden="true" className="mt-1 flex h-1 justify-end rounded-full bg-[var(--fin-surface-2)]">
                            <span className={cn('h-1 rounded-full', cor)} style={{ width: largura(c.valor) }} />
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex min-w-0 flex-col divide-y divide-[var(--fin-border)] border-t border-[var(--fin-border)] xl:border-t-0">
          {/* Saldo das contas */}
          <div className="flex flex-col gap-[var(--fin-s-2)] px-[var(--fin-s-5)] py-[var(--fin-s-4)]">
            <div className="flex items-baseline justify-between gap-[var(--fin-s-3)]">
              <h3 className="fin-t-body-strong text-[var(--fin-text)]">Saldo das contas</h3>
              <Link href="/financeiro-ag/extrato" className={LINK}>
                Extrato de conta
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </div>
            {resumo.contas.length === 0 ? (
              <p className="fin-t-body text-[var(--fin-text-2)]">Nenhuma conta bancária cadastrada.</p>
            ) : (
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-[var(--fin-s-3)] gap-y-1.5 tabular-nums">
                {resumo.contas.map(c => (
                  <div key={c.id} className="contents">
                    <dt className="truncate fin-t-body text-[var(--fin-text-2)]">{c.nome || 'Conta sem nome'}</dt>
                    <dd><Money valor={c.saldo} estado="ok" size="body" tone={c.saldo < 0 ? 'negativo' : 'neutro'} /></dd>
                  </div>
                ))}
                {resumo.semConta !== 0 ? (
                  <div className="contents">
                    <dt className="truncate fin-t-body text-[var(--fin-text-3)]">Baixas sem conta</dt>
                    <dd><Money valor={resumo.semConta} estado="ok" size="body" tone="suave" /></dd>
                  </div>
                ) : null}
                <dt className="border-t border-[var(--fin-border)] pt-2 fin-t-body font-medium text-[var(--fin-text)]">Total</dt>
                <dd className="border-t border-[var(--fin-border)] pt-2">
                  <Money valor={resumo.saldoTotal} estado="ok" size="strong" tone={resumo.saldoTotal < 0 ? 'negativo' : 'neutro'} />
                </dd>
              </dl>
            )}
          </div>

          {/* Prazos médios */}
          <div className="grid grid-cols-2 gap-[var(--fin-s-4)] px-[var(--fin-s-5)] py-[var(--fin-s-4)]">
            <Prazo rotulo="Prazo médio de recebimento" p={resumo.pmr} explicacao="Nenhum recebimento nos últimos 90 dias." />
            <Prazo rotulo="Prazo médio de pagamento" p={resumo.pmp} explicacao="Nenhum pagamento nos últimos 90 dias." />
          </div>

          {/* Caixa projetado */}
          <div className="flex flex-col gap-[var(--fin-s-2)] px-[var(--fin-s-5)] py-[var(--fin-s-4)]">
            <div className="flex items-baseline justify-between gap-[var(--fin-s-3)]">
              <h3 className="fin-t-body-strong text-[var(--fin-text)]">Caixa projetado</h3>
              <Link href="/financeiro-ag/fluxo-caixa" className={LINK}>
                Fluxo de caixa
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </div>
            <dl className="grid grid-cols-3 gap-[var(--fin-s-3)]">
              {resumo.projetado.map(p => (
                <div key={p.dias} className="flex min-w-0 flex-col gap-0.5">
                  <dt className={CABECALHO}>{p.dias} dias · {diaMes(p.data)}</dt>
                  <dd>
                    <Money valor={p.valor} estado="ok" size="strong" align="esquerda" tone={p.valor < 0 ? 'negativo' : 'neutro'} />
                  </dd>
                </div>
              ))}
            </dl>
            <p className="fin-t-caption text-[var(--fin-text-3)]">
              Saldo de hoje mais o que está lançado até cada data; o que venceu entra como hoje. Soma, não previsão.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
