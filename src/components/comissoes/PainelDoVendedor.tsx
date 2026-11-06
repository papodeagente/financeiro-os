'use client';

import * as React from 'react';
import Link from 'next/link';
import { CircleHelp, Target } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusChip } from '@/components/fin/StatusChip';
import type { ItemDoPainel, PainelDoVendedor } from '@/lib/comissao-funcoes-servidor';
import type { ResumoDoParticipante } from '@/lib/comissao-funcoes';
import { cn } from '@/lib/utils';

/**
 * O painel do vendedor (E5, parte F), feito para o celular: quanto a pessoa
 * tem de comissão no mês, onde está na meta, quanto falta para a próxima
 * faixa e, venda a venda, "por que recebi isto?" com a conta aberta.
 * Só desenha: quem busca os dados é a página (/equipe/minhas-comissoes).
 */

export const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (p: number) => `${p.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const dataBR = (s: string) => (s ? s.split('-').reverse().join('/') : '');

export const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';

/** Frase da meta para o topo do cartão da função. */
export function fraseDaMeta(r: ResumoDoParticipante): string {
  if (r.erros.length) return r.erros.join(' ');
  if (r.meta_centavos === null) return 'Seu plano não depende de meta neste mês.';
  if (r.proxima_faixa !== null && r.falta_para_proxima_centavos !== null) {
    return `Faltam ${reais(r.falta_para_proxima_centavos)} para a faixa de ${pct(r.proxima_faixa)} da meta.`;
  }
  if (r.meta_nao_atingida) return 'Ainda abaixo da primeira faixa do plano.';
  return 'Você está na faixa mais alta do plano.';
}

function BarraDaMeta({ r }: { r: ResumoDoParticipante }) {
  if (r.meta_centavos === null || r.percentual === null) return null;
  // A régua vai até a próxima faixa (ou um pouco além do que já foi feito).
  const teto = Math.max(r.proxima_faixa ?? 0, r.percentual, 100) * 1.1;
  const largura = Math.min(100, (r.percentual / teto) * 100);
  const marca = r.proxima_faixa !== null ? Math.min(100, (r.proxima_faixa / teto) * 100) : null;
  return (
    <div className="flex flex-col gap-[var(--fin-s-1)]">
      <div
        className="relative h-2.5 overflow-hidden rounded-full bg-[var(--fin-surface-2)]"
        role="meter" aria-valuemin={0} aria-valuemax={Math.round(teto)} aria-valuenow={Math.round(r.percentual)}
        aria-label={`Meta atingida: ${pct(r.percentual)}`}
      >
        <div className="h-full rounded-full bg-[var(--fin-accent)] transition-[width] duration-[var(--fin-dur-base)] ease-[var(--fin-curva)]" style={{ width: `${largura}%` }} />
        {marca !== null ? <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-[var(--fin-text)]" style={{ left: `${marca}%` }} /> : null}
      </div>
      <div className="flex justify-between fin-t-caption text-[var(--fin-text-3)] tabular-nums">
        <span>{reais(r.atingida_centavos)} de {reais(r.meta_centavos)}</span>
        <span>{pct(r.percentual)}</span>
      </div>
    </div>
  );
}

export function CartaoDaFuncao({ r }: { r: ResumoDoParticipante }) {
  const temErro = r.erros.length > 0;
  return (
    <section aria-label={`Comissão como ${r.funcao_nome}`} className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]')}>
      <div className="flex items-start justify-between gap-[var(--fin-s-3)]">
        <div className="flex min-w-0 flex-col">
          <h2 className="fin-t-subhead text-[var(--fin-text)]">{r.funcao_nome}</h2>
          <p className="fin-t-caption text-[var(--fin-text-3)]">{r.plano_nome || 'Sem plano'} · {r.quantidade_vendas} {r.quantidade_vendas === 1 ? 'venda' : 'vendas'}</p>
        </div>
        <span className="fin-t-metric-sm tabular-nums text-[var(--fin-text)]">{reais(r.saldo_centavos)}</span>
      </div>
      <BarraDaMeta r={r} />
      <p className={cn('flex items-start gap-[var(--fin-s-2)] fin-t-body', temErro ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text-2)]')}>
        <Target aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{fraseDaMeta(r)}</span>
      </p>
      {r.retido_centavos ? <p className="fin-t-caption text-[var(--fin-text-3)]">Já retido ao receber do cliente: {reais(r.retido_centavos)}.</p> : null}
    </section>
  );
}

export function ItemDoExtrato({ i, onPorQue }: { i: ItemDoPainel; onPorQue: (i: ItemDoPainel) => void }) {
  return (
    <li className="flex flex-col gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] last:border-b-0">
      <div className="flex items-start justify-between gap-[var(--fin-s-3)]">
        <div className="flex min-w-0 flex-col">
          <Link href={`/vendas/${encodeURIComponent(i.venda_id)}/ficha`} className="fin-t-body-strong text-[var(--fin-text)] underline-offset-4 hover:underline">
            {i.venda_numero || 'Venda'} · {i.descricao}
          </Link>
          <span className="fin-t-caption text-[var(--fin-text-3)]">{i.cliente_nome || 'Sem cliente'} · {dataBR(i.data_venda)} · {i.funcao_nome}</span>
        </div>
        <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{reais(i.valor_centavos - i.retido_centavos)}</span>
      </div>
      <div className="flex items-center justify-between gap-[var(--fin-s-2)]">
        <StatusChip dominio="comissao_item" valor={i.situacao} />
        <Button type="button" variant="ghost" size="sm" onClick={() => onPorQue(i)} className="h-11 lg:h-8">
          <CircleHelp aria-hidden="true" className="size-4" />
          Por que recebi isto?
        </Button>
      </div>
    </li>
  );
}

export function PainelDoVendedorView({ painel }: { painel: PainelDoVendedor }) {
  const [aberto, setAberto] = React.useState<ItemDoPainel | null>(null);
  const t = painel.totais;
  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      <section aria-label="Comissão do mês" className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)] sm:p-[var(--fin-s-5)]')}>
        <p className="fin-t-body text-[var(--fin-text-2)]">Sua comissão em {painel.rotulo_mes}</p>
        <p className="fin-t-resposta tabular-nums text-[var(--fin-text)]">{reais(t.previsto)}</p>
        <dl className="grid grid-cols-3 gap-[var(--fin-s-2)]">
          {[['Liberada', t.liberado], ['Fechada', t.fechado], ['Paga', t.pago]].map(([rotulo, v]) => (
            <div key={rotulo as string} className="flex flex-col">
              <dt className="fin-t-caption text-[var(--fin-text-3)]">{rotulo}</dt>
              <dd className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{reais(v as number)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {painel.resumos.map(r => <CartaoDaFuncao key={`${r.pessoa_funcao_id}-${r.mes}`} r={r} />)}

      <section aria-labelledby="t-extrato" className={CARTAO}>
        <h2 id="t-extrato" className="fin-t-subhead px-[var(--fin-s-4)] pt-[var(--fin-s-4)] pb-[var(--fin-s-2)] text-[var(--fin-text)]">Venda a venda</h2>
        {painel.itens.length ? (
          <ul>{painel.itens.map(i => <ItemDoExtrato key={i.chave} i={i} onPorQue={setAberto} />)}</ul>
        ) : (
          <p className="px-[var(--fin-s-4)] pb-[var(--fin-s-4)] fin-t-body text-[var(--fin-text-2)]">Nenhuma venda com comissão neste mês.</p>
        )}
      </section>

      <Dialog open={aberto !== null} onOpenChange={o => { if (!o) setAberto(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Por que recebi isto?</DialogTitle>
            <DialogDescription>{aberto ? `${aberto.venda_numero} · ${aberto.descricao}` : ''}</DialogDescription>
          </DialogHeader>
          <ol className="flex flex-col gap-[var(--fin-s-2)]">
            {(aberto?.por_que ?? []).map((f, k) => (
              <li key={k} className="fin-t-body text-[var(--fin-text)] tabular-nums">{f}</li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}
