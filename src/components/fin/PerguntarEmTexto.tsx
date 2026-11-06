'use client';

/**
 * Perguntar em texto (E7, fechamento): a caixa.
 *
 * A pessoa escreve a pergunta como falaria ("quanto tenho a receber da
 * operadora X este mês?"). A IA escolhe uma das consultas fixas do servidor
 * e o resultado volta em cartões: o número, o filtro usado por extenso e o
 * link para a tela com o filtro aplicado. O texto da IA é o resumo; o número
 * que vale é o do cartão.
 *
 * Sem a chave de IA da agência, a caixa explica como ligar. Sem o direito a
 * um dado, o cartão diz qual acesso falta e não mostra número.
 */
import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, MessageSquareText, ShieldOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Callout } from '@/components/fin/Callout';
import { cn, formatBRL } from '@/lib/utils';
import type { NumeroDaResposta, ResultadoDaFerramenta } from '@/lib/perguntar/definicoes';

interface Estado { chave_ligada: boolean; pode_perguntar: boolean; uso: { usados: number; limite: number }; como_ligar: string }
interface Resposta { texto: string; resultados: ResultadoDaFerramenta[]; uso?: { usados: number; limite: number } }

const EXEMPLOS = [
  'Quanto tenho a receber das operadoras este mês?',
  'Quais contas vencem esta semana?',
  'Qual a receita de outubro por vendedor?',
  'Qual o saldo das contas hoje?',
] as const;

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';

function valorDoNumero(n: NumeroDaResposta): string {
  if (n.tipo === 'contagem') return n.valor.toLocaleString('pt-BR');
  if (n.tipo === 'percentual') return `${n.valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (n.moeda && n.moeda !== 'BRL') return `${n.moeda} ${n.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return formatBRL(n.valor);
}

function CartaoDoResultado({ r }: { r: ResultadoDaFerramenta }) {
  if (r.recusado) {
    return (
      <div className={cn(CARTAO, 'flex items-start gap-[var(--fin-s-3)] p-[var(--fin-s-4)]')}>
        <ShieldOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--fin-text-3)]" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{r.titulo}</span>
          <span className="fin-t-caption text-[var(--fin-text-2)]">{r.recusado}</span>
        </div>
      </div>
    );
  }
  const [principal, ...outros] = r.numeros;
  return (
    <article className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-3)] p-[var(--fin-s-4)]')}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-[var(--fin-s-3)] gap-y-1">
        <h3 className="fin-t-body-strong text-[var(--fin-text)]">{r.titulo}</h3>
        {r.link ? (
          <Link
            href={r.link}
            className="inline-flex items-center gap-1 fin-t-caption font-medium text-[var(--fin-accent)] underline-offset-2 hover:underline"
          >
            Abrir com este filtro <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </header>

      {principal ? (
        <div className="flex flex-wrap items-end gap-x-[var(--fin-s-5)] gap-y-[var(--fin-s-2)]">
          <div className="flex flex-col">
            <span className="fin-t-caption text-[var(--fin-text-2)]">{principal.rotulo}</span>
            <span className="fin-t-metric tabular-nums text-[var(--fin-text)]">{valorDoNumero(principal)}</span>
          </div>
          {outros.map(n => (
            <div key={n.rotulo} className="flex flex-col">
              <span className="fin-t-caption text-[var(--fin-text-2)]">{n.rotulo}</span>
              <span className="fin-t-metric-sm tabular-nums text-[var(--fin-text)]">{valorDoNumero(n)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {r.filtro.length ? (
        <ul aria-label="Filtro usado" className="flex flex-wrap gap-[var(--fin-s-1)]">
          {r.filtro.map(f => (
            <li key={f} className="rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)] px-2 py-0.5 fin-t-caption text-[var(--fin-text-2)]">{f}</li>
          ))}
        </ul>
      ) : null}

      {r.linhas.length ? (
        <ul className="flex flex-col divide-y divide-[var(--fin-border)] border-t border-[var(--fin-border)]">
          {r.linhas.map((l, i) => (
            <li key={`${l.texto}-${i}`} className="flex items-baseline justify-between gap-[var(--fin-s-3)] py-1.5">
              <span className="min-w-0 truncate fin-t-caption text-[var(--fin-text-2)]" title={l.texto}>{l.texto}</span>
              <span className="shrink-0 fin-t-caption font-medium tabular-nums text-[var(--fin-text)]">
                {l.moeda && l.moeda !== 'BRL'
                  ? `${l.moeda} ${l.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : formatBRL(l.valor)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function PerguntarEmTexto({
  perguntaInicial = '', enviarAoAbrir = false, compacta = false, className,
}: { perguntaInicial?: string; enviarAoAbrir?: boolean; compacta?: boolean; className?: string }) {
  const [estado, setEstado] = React.useState<Estado | null>(null);
  const [pergunta, setPergunta] = React.useState(perguntaInicial);
  const [enviando, setEnviando] = React.useState(false);
  const [resposta, setResposta] = React.useState<Resposta | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const enviouAoAbrir = React.useRef(false);
  const idCampo = React.useId();

  React.useEffect(() => {
    let vivo = true;
    fetch('/api/perguntar').then(r => (r.ok ? r.json() : null)).then((e: Estado | null) => { if (vivo) setEstado(e); }).catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  const perguntar = React.useCallback(async (texto: string) => {
    const t = texto.trim();
    if (t.length < 3 || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch('/api/perguntar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pergunta: t }) });
      const j = await r.json().catch(() => ({}));
      if (j?.uso) setEstado(e => (e ? { ...e, uso: j.uso } : e));
      if (!r.ok) {
        if (j?.codigo === 'sem_chave_ia') setEstado(e => (e ? { ...e, chave_ligada: false } : e));
        setErro(String(j?.error ?? 'Não deu para responder agora. Tente de novo.'));
        setResposta(Array.isArray(j?.resultados) && j.resultados.length ? { texto: '', resultados: j.resultados } : null);
        return;
      }
      setResposta({ texto: String(j.texto ?? ''), resultados: Array.isArray(j.resultados) ? j.resultados : [] });
    } catch {
      setErro('Sem conexão com o servidor. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }, [enviando]);

  React.useEffect(() => {
    if (!enviarAoAbrir || enviouAoAbrir.current || !estado?.chave_ligada || !perguntaInicial.trim()) return;
    enviouAoAbrir.current = true;
    void perguntar(perguntaInicial);
  }, [enviarAoAbrir, estado, perguntaInicial, perguntar]);

  // Quem não tem financeiro nem relatórios não vê a caixa.
  if (estado && !estado.pode_perguntar) return null;
  const semChave = estado ? !estado.chave_ligada : false;
  const noLimite = estado ? estado.uso.usados >= estado.uso.limite : false;

  return (
    <section aria-label="Perguntar ao financeiro" className={cn('flex flex-col gap-[var(--fin-s-3)]', className)}>
      <form
        className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-2)] p-[var(--fin-s-3)] sm:p-[var(--fin-s-4)]')}
        onSubmit={e => { e.preventDefault(); void perguntar(pergunta); }}
      >
        <label htmlFor={idCampo} className="flex items-center gap-2 fin-t-body-strong text-[var(--fin-text)]">
          <MessageSquareText aria-hidden="true" className="size-4 text-[var(--fin-accent)]" />
          Pergunte ao financeiro
        </label>
        <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row">
          <input
            id={idCampo}
            value={pergunta}
            onChange={e => setPergunta(e.target.value)}
            maxLength={500}
            disabled={semChave || noLimite}
            placeholder="Quanto tenho a receber da operadora este mês?"
            className={cn(
              'h-[var(--fin-h-confortavel)] min-w-0 flex-1 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3',
              'text-base text-[var(--fin-text)] placeholder:text-[var(--fin-text-3)] focus-visible:border-[var(--fin-accent)] focus-visible:outline-none sm:text-sm lg:h-[var(--fin-h-padrao)]',
              'disabled:cursor-not-allowed disabled:bg-[var(--fin-surface-2)]',
            )}
          />
          <Button type="submit" disabled={enviando || semChave || noLimite || pergunta.trim().length < 3}>
            {enviando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {enviando ? 'Consultando…' : 'Perguntar'}
          </Button>
        </div>
        {!semChave && !resposta && !enviando && !compacta ? (
          <div className="flex flex-wrap gap-[var(--fin-s-1)]" aria-label="Exemplos">
            {EXEMPLOS.map(ex => (
              <button
                key={ex}
                type="button"
                onClick={() => { setPergunta(ex); void perguntar(ex); }}
                disabled={noLimite}
                className="rounded-[var(--fin-r-sm)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-2 py-1 fin-t-caption text-[var(--fin-text-2)] transition-colors duration-[var(--fin-dur-rapida)] hover:border-[var(--fin-accent)] hover:text-[var(--fin-accent)] disabled:opacity-50"
              >
                {ex}
              </button>
            ))}
          </div>
        ) : null}
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          A IA só escolhe entre consultas prontas e vê o que o seu acesso permite.
          {estado && !semChave ? ` ${estado.uso.usados} de ${estado.uso.limite} perguntas da agência nas últimas 24 horas.` : ''}
        </p>
      </form>

      {semChave ? (
        <Callout tom="info" titulo="Ligue a IA da agência para perguntar em texto">
          {estado?.como_ligar}{' '}
          <Link href="/config/integracoes/ia" className="font-medium text-[var(--fin-accent)] underline-offset-2 hover:underline">Abrir Integração com IA</Link>
        </Callout>
      ) : null}
      {erro && !semChave ? <Callout tom="negativo" titulo="Não deu para responder">{erro}</Callout> : null}

      {resposta ? (
        <div className="flex flex-col gap-[var(--fin-s-3)]" aria-live="polite">
          {resposta.texto ? <p className="fin-t-body text-[var(--fin-text)]">{resposta.texto}</p> : null}
          {resposta.resultados.length ? (
            <div className={cn('grid gap-[var(--fin-s-3)]', resposta.resultados.length > 1 && 'lg:grid-cols-2')}>
              {resposta.resultados.map((r, i) => <CartaoDoResultado key={`${r.ferramenta}-${i}`} r={r} />)}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
