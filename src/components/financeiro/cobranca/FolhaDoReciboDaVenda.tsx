'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, Info } from 'lucide-react';

import { dataPorExtenso } from '@/lib/cobranca/recibo';
import type { LinhaRecebida, PaganteDoRecibo, ReciboDaFatura, ReciboDaVenda } from '@/lib/recibo-da-venda';
import { formatBRL } from '@/lib/utils';
import { BarraDoRecibo } from './FolhaDoRecibo';

/**
 * Recibo da venda (por pagante) e recibo consolidado da fatura (E7,
 * 06/11/2026). A mesma folha do recibo da conta: cabeçalho da agência,
 * a declaração, o detalhe e a assinatura; imprime limpa ou vira PDF.
 *
 * Recibo PARCIAL (a venda ainda tem saldo): a faixa diz que o documento
 * cobre só o que já foi pago, e quanto falta. Ela sai na impressão também,
 * para o recibo nunca parecer quitação total.
 */

function dataCurta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

const FOLHA = 'mx-auto my-[var(--fin-s-4)] flex w-full max-w-[760px] flex-col gap-[var(--fin-s-5)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] text-[var(--fin-text)] shadow-[var(--fin-e-card)] sm:p-[var(--fin-s-6)] print:my-0 print:rounded-none print:border-0 print:shadow-none';
const TH = 'py-[var(--fin-s-2)] pr-[var(--fin-s-3)] text-left fin-t-caption font-medium text-[var(--fin-text-3)]';
const TD = 'py-[var(--fin-s-2)] pr-[var(--fin-s-3)] align-top fin-t-body';

function Cabecalho({ emitente, titulo, numero, valor, substitui }: { emitente: ReciboDaVenda['emitente']; titulo: string; numero: string; valor: number; substitui?: string | null }) {
  return (
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
        <h1 className="fin-t-title tracking-[0.04em]">{titulo}</h1>
        <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">Nº {numero}</span>
        {substitui ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">Substitui o recibo Nº {substitui}</span> : null}
        <span className="mt-1 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] px-[var(--fin-s-3)] py-[var(--fin-s-1)] fin-t-metric-sm tabular-nums">
          {formatBRL(valor)}
        </span>
      </div>
    </header>
  );
}

function FaixaParcial({ emAberto, data }: { emAberto: number; data: string }) {
  return (
    <p className="flex items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-warning)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body text-[var(--fin-warning-text)] print:bg-transparent">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        Recibo parcial: cobre só o que foi pago até {dataCurta(data)}. Ainda falta pagar <strong className="font-medium tabular-nums">{formatBRL(emAberto)}</strong>.
      </span>
    </p>
  );
}

function Assinatura({ emitente, data, cidade }: { emitente: ReciboDaVenda['emitente']; data: string; cidade: string }) {
  return (
    <footer className="flex flex-col gap-[var(--fin-s-6)] pt-[var(--fin-s-3)]">
      <p className="fin-t-body text-[var(--fin-text-2)]">{dataPorExtenso(data, cidade)}.</p>
      <div className="flex flex-col items-center gap-1 self-center pt-[var(--fin-s-5)]">
        <span aria-hidden="true" className="block h-px w-72 bg-[var(--fin-text-3)]" />
        <span className="fin-t-body">{emitente.nome}</span>
        {emitente.documento ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{emitente.documento}</span> : null}
      </div>
    </footer>
  );
}

function TabelaDePagamentos({ titulo, linhas, total, rotuloTotal }: { titulo: string; linhas: LinhaRecebida[]; total: number; rotuloTotal: string }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-[var(--fin-s-1)]">
      <h2 className="fin-t-body-strong">{titulo}</h2>
      <table className="w-full border-collapse">
        <thead className="border-b border-[var(--fin-border)]">
          <tr><th className={TH}>Data</th><th className={TH}>Forma</th><th className={TH}>Referência</th><th className={`${TH} pr-0 text-right`}>Valor</th></tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={`${l.data}-${i}`} className="border-b border-[var(--fin-border)] last:border-b-0">
              <td className={`${TD} tabular-nums`}>{dataCurta(l.data)}</td>
              <td className={TD}>{l.forma}</td>
              <td className={`${TD} text-[var(--fin-text-2)]`}>{l.referencia || '—'}</td>
              <td className={`${TD} pr-0 text-right tabular-nums`}>{formatBRL(l.valor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--fin-border-strong)]">
            <td colSpan={3} className={`${TD} fin-t-body-strong`}>{rotuloTotal}</td>
            <td className={`${TD} pr-0 text-right fin-t-body-strong tabular-nums`}>{formatBRL(total)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

export function FolhaDoReciboDaVenda({ recibo }: { recibo: ReciboDaVenda }) {
  const fornecedor = recibo.pagos_ao_fornecedor.reduce((s, l) => s + l.valor, 0);
  return (
    <article aria-label={`Recibo ${recibo.numero}`} className={FOLHA}>
      <Cabecalho emitente={recibo.emitente} titulo="RECIBO" numero={recibo.numero} valor={recibo.valor} substitui={recibo.substitui} />
      {recibo.parcial ? <FaixaParcial emAberto={recibo.em_aberto} data={recibo.data} /> : null}
      <p className="fin-t-body max-w-[68ch] whitespace-pre-line text-[15px] leading-relaxed">{recibo.declaracao}</p>

      {recibo.servicos.length ? (
        <section aria-label="Serviços" className="flex flex-col gap-[var(--fin-s-1)]">
          <h2 className="fin-t-body-strong">Serviços</h2>
          <ul className="flex flex-col divide-y divide-[var(--fin-border)] rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] px-[var(--fin-s-4)] print:bg-transparent print:px-0">
            {recibo.servicos.map((s, i) => (
              <li key={`${s.descricao}-${i}`} className="flex flex-col gap-0.5 py-[var(--fin-s-2)]">
                <span className="flex flex-wrap items-baseline justify-between gap-x-[var(--fin-s-3)]">
                  <span className="fin-t-body">
                    <span className="text-[var(--fin-text-3)]">{s.tipo} · </span>{s.descricao}
                  </span>
                  {s.periodo ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">{s.periodo}</span> : null}
                </span>
                {s.passageiros.length || s.localizador ? (
                  <span className="fin-t-caption text-[var(--fin-text-2)]">
                    {s.passageiros.length ? `${s.passageiros.length === 1 ? 'Passageiro' : 'Passageiros'}: ${s.passageiros.join(', ')}` : ''}
                    {s.passageiros.length && s.localizador ? ' · ' : ''}
                    {s.localizador ? `Localizador ${s.localizador}` : ''}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recibo.recebimentos.length ? (
        <TabelaDePagamentos titulo="Recebido pela agência" linhas={recibo.recebimentos} total={recibo.valor} rotuloTotal="Total recebido" />
      ) : null}
      {recibo.pagos_ao_fornecedor.length ? (
        <TabelaDePagamentos titulo="Pago diretamente ao fornecedor" linhas={recibo.pagos_ao_fornecedor} total={fornecedor} rotuloTotal="Total pago ao fornecedor" />
      ) : null}
      {recibo.pagos_ao_fornecedor.length && recibo.recebimentos.length ? (
        <p className="flex items-baseline justify-between border-t border-[var(--fin-border-strong)] pt-[var(--fin-s-2)] fin-t-body-strong">
          <span>Total quitado</span><span className="tabular-nums">{formatBRL(recibo.total_quitado)}</span>
        </p>
      ) : null}

      {recibo.complemento ? <p className="fin-t-caption max-w-[68ch] whitespace-pre-line text-[var(--fin-text-2)]">{recibo.complemento}</p> : null}
      <Assinatura emitente={recibo.emitente} data={recibo.data} cidade={recibo.cidade} />
    </article>
  );
}

export function FolhaDoReciboDaFatura({ recibo }: { recibo: ReciboDaFatura }) {
  const encargos = recibo.recebimentos.some(r => r.juros > 0 || r.multa > 0 || r.desconto > 0);
  return (
    <article aria-label={`Recibo ${recibo.numero}`} className={FOLHA}>
      <Cabecalho emitente={recibo.emitente} titulo="RECIBO" numero={recibo.numero} valor={recibo.valor} />
      {recibo.parcial ? <FaixaParcial emAberto={recibo.em_aberto} data={recibo.data} /> : null}
      <p className="fin-t-body max-w-[68ch] text-[15px] leading-relaxed">
        Recebemos de <strong className="font-medium">{recibo.pagador.nome}</strong>
        {recibo.pagador.documento ? <>, CPF/CNPJ <span className="whitespace-nowrap tabular-nums">{recibo.pagador.documento}</span></> : null}, a quantia de{' '}
        <strong className="font-medium">{formatBRL(recibo.valor)}</strong> ({recibo.valor_por_extenso.charAt(0).toLowerCase() + recibo.valor_por_extenso.slice(1)}),
        referente à <strong className="font-medium">{recibo.referente}</strong>, nos pagamentos abaixo, pela qual damos quitação.
      </p>
      <section aria-label="Recebimentos" className="flex flex-col gap-[var(--fin-s-1)]">
        <h2 className="fin-t-body-strong">Recebimentos</h2>
        <table className="w-full border-collapse">
          <thead className="border-b border-[var(--fin-border)]">
            <tr>
              <th className={TH}>Data</th><th className={TH}>Forma</th><th className={TH}>Conta</th>
              {encargos ? <th className={`${TH} text-right`}>Juros e multa</th> : null}
              {encargos ? <th className={`${TH} text-right`}>Desconto</th> : null}
              <th className={`${TH} pr-0 text-right`}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {recibo.recebimentos.map((l, i) => (
              <tr key={`${l.data}-${i}`} className="border-b border-[var(--fin-border)] last:border-b-0">
                <td className={`${TD} tabular-nums`}>{dataCurta(l.data)}</td>
                <td className={TD}>{l.forma}</td>
                <td className={`${TD} text-[var(--fin-text-2)]`}>{l.conta || '—'}</td>
                {encargos ? <td className={`${TD} text-right tabular-nums`}>{l.juros + l.multa > 0 ? formatBRL(l.juros + l.multa) : '—'}</td> : null}
                {encargos ? <td className={`${TD} text-right tabular-nums`}>{l.desconto > 0 ? formatBRL(l.desconto) : '—'}</td> : null}
                <td className={`${TD} pr-0 text-right tabular-nums`}>{formatBRL(l.valor)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--fin-border-strong)]">
              <td colSpan={encargos ? 5 : 3} className={`${TD} fin-t-body-strong`}>Total recebido</td>
              <td className={`${TD} pr-0 text-right fin-t-body-strong tabular-nums`}>{formatBRL(recibo.valor)}</td>
            </tr>
            {recibo.parcial ? (
              <tr>
                <td colSpan={encargos ? 5 : 3} className={`${TD} text-[var(--fin-text-2)]`}>Valor da fatura</td>
                <td className={`${TD} pr-0 text-right tabular-nums text-[var(--fin-text-2)]`}>{formatBRL(recibo.total_da_fatura)}</td>
              </tr>
            ) : null}
          </tfoot>
        </table>
      </section>
      <Assinatura emitente={recibo.emitente} data={recibo.data} cidade={recibo.cidade} />
    </article>
  );
}

function Erro({ mensagem }: { mensagem: string }) {
  return (
    <div role="alert" className="mx-auto my-[var(--fin-s-6)] flex max-w-[560px] flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-5)] text-center">
      <p className="fin-t-subhead text-[var(--fin-text)]">Sem recibo para mostrar</p>
      <p className="fin-t-body text-[var(--fin-text-2)]">{mensagem}</p>
    </div>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" className="mx-auto my-[var(--fin-s-4)] flex w-full max-w-[760px] flex-col gap-[var(--fin-s-4)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-6)]">
      <span className="block h-8 w-1/2 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
      <span className="block h-20 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
      <span className="block h-32 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
      <span className="sr-only" role="status">Montando o recibo.</span>
    </div>
  );
}

const VOLTAR = 'inline-flex items-center gap-1 rounded-[var(--fin-r-md)] px-2 py-1.5 fin-t-body text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

/** Página do recibo da venda, com a escolha do pagante quando há mais de um. */
export function PaginaDoReciboDaVenda({ vendaId, pagante, onPagante }: { vendaId: string; pagante: string | null; onPagante: (chave: string) => void }) {
  const [recibo, setRecibo] = React.useState<ReciboDaVenda | null>(null);
  const [pagantes, setPagantes] = React.useState<PaganteDoRecibo[]>([]);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    setRecibo(null);
    setErro(null);
    const qs = pagante ? `?pagante=${encodeURIComponent(pagante)}` : '';
    // Abrir o recibo para imprimir ou mandar = emitir (E7): POST registra o número e a versão.
    fetch(`/api/vendas/completa/${encodeURIComponent(vendaId)}/recibo${qs}`, { method: 'POST', signal: ac.signal })
      .then(async r => {
        const corpo = await r.json().catch(() => null);
        if (Array.isArray(corpo?.pagantes)) setPagantes(corpo.pagantes as PaganteDoRecibo[]);
        if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : 'Não foi possível abrir o recibo.');
        setRecibo(corpo.recibo as ReciboDaVenda);
        document.title = `Recibo ${(corpo.recibo as ReciboDaVenda).numero}`;
      })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'Não foi possível abrir o recibo.'); });
    return () => ac.abort();
  }, [vendaId, pagante]);

  const atual = pagante ?? (recibo ? pagantes.find(p => p.nome === recibo.pagador.nome)?.chave ?? pagantes[0]?.chave : pagantes[0]?.chave) ?? '';
  return (
    <main className="min-h-dvh bg-[var(--fin-bg)] px-[var(--fin-s-3)] pb-[var(--fin-s-6)] sm:px-0 print:bg-[var(--fin-surface)] print:p-0">
      <BarraDoRecibo voltar={<Link href={`/vendas/${encodeURIComponent(vendaId)}/ficha`} className={VOLTAR}><ChevronLeft aria-hidden="true" className="size-4" /> Voltar à venda</Link>} />
      {pagantes.length > 1 ? (
        <div className="fin-no-print mx-auto mt-[var(--fin-s-3)] flex w-full max-w-[760px] flex-wrap items-center gap-[var(--fin-s-2)]" role="radiogroup" aria-label="Recibo de quem pagou">
          <span className="fin-t-caption text-[var(--fin-text-2)]">Esta venda tem mais de um pagante. Recibo de:</span>
          {pagantes.map(p => {
            const ativo = p.chave === atual;
            return (
              <button
                key={p.chave} type="button" role="radio" aria-checked={ativo} onClick={() => onPagante(p.chave)}
                className={`inline-flex items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-3)] py-1.5 fin-t-body transition-colors duration-[var(--fin-dur-rapida)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] ${ativo ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-text)]' : 'border-[var(--fin-border)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]'}`}
              >
                {p.nome}
                <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{p.tem_recibo ? formatBRL(p.recebido_centavos / 100) : 'nada pago'}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {recibo ? <FolhaDoReciboDaVenda recibo={recibo} /> : erro ? <Erro mensagem={erro} /> : <Esqueleto />}
    </main>
  );
}

/** Página do recibo consolidado da fatura. */
export function PaginaDoReciboDaFatura({ faturaId }: { faturaId: string }) {
  const [recibo, setRecibo] = React.useState<ReciboDaFatura | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  React.useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/faturas/${encodeURIComponent(faturaId)}/recibo`, { signal: ac.signal })
      .then(async r => {
        const corpo = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : 'Não foi possível abrir o recibo.');
        setRecibo(corpo as ReciboDaFatura);
        document.title = `Recibo ${(corpo as ReciboDaFatura).numero}`;
      })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof Error ? e.message : 'Não foi possível abrir o recibo.'); });
    return () => ac.abort();
  }, [faturaId]);
  return (
    <main className="min-h-dvh bg-[var(--fin-bg)] px-[var(--fin-s-3)] pb-[var(--fin-s-6)] sm:px-0 print:bg-[var(--fin-surface)] print:p-0">
      <BarraDoRecibo voltar={<Link href={`/financeiro-ag/faturas/${encodeURIComponent(faturaId)}`} className={VOLTAR}><ChevronLeft aria-hidden="true" className="size-4" /> Voltar à fatura</Link>} />
      {recibo ? <FolhaDoReciboDaFatura recibo={recibo} /> : erro ? <Erro mensagem={erro} /> : <Esqueleto />}
    </main>
  );
}
