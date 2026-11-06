'use client';

import * as React from 'react';
import { Check, ChevronDown, CircleAlert, MessageSquareReply, ThumbsUp } from 'lucide-react';

import type { FaturaNoPortal } from '@/lib/fatura-servidor';
import { ROTULO_SITUACAO } from '@/lib/fatura-regras';
import { dataBR } from '@/lib/cobranca/regras-telas';
import { cn, formatBRL } from '@/lib/utils';

/**
 * Faturas para conferir, no portal do cliente (E5, parte B, 05/11/2026).
 * A agência fecha a fatura e o cliente confere aqui, no celular: abre os
 * itens (passageiro, localizador, centro de custo), aprova a fatura ou
 * contesta item a item com o motivo. A resposta da agência aparece no item.
 * O pagamento continua em "Para pagar" (a fatura é uma das contas dali).
 */

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';
const reais = (c: number) => formatBRL(c / 100);
const BOTAO = cn('inline-flex min-h-12 w-full items-center justify-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-4 fin-t-body-strong transition-colors duration-[var(--fin-dur-rapida)] disabled:opacity-60 sm:w-auto', FOCO);
const PRIMARIO = cn(BOTAO, 'bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)]');
const SECUNDARIO = cn(BOTAO, 'border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]');
const CAMPO = cn('w-full rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 py-2 text-[16px] text-[var(--fin-text)] placeholder:text-[var(--fin-text-3)]', FOCO);

function periodoDa(f: FaturaNoPortal): string {
  if (!f.periodo_inicio) return '';
  return f.periodo_fim && f.periodo_fim !== f.periodo_inicio ? `Itens de ${dataBR(f.periodo_inicio)} a ${dataBR(f.periodo_fim)}` : `Itens de ${dataBR(f.periodo_inicio)}`;
}

function SeloDaConferencia({ f }: { f: FaturaNoPortal }) {
  const semResposta = f.itens.some(i => i.contestacao && !i.resposta);
  const [texto, tom] = f.conferencia === 'APROVADA' ? ['Aprovada por você', 'positivo']
    : f.conferencia === 'CONTESTADA' ? [semResposta ? 'Contestada: a agência vai responder' : 'Contestada: a agência respondeu', 'aviso']
      : ['Aguardando a sua conferência', 'acento'];
  return (
    <span className={cn(
      'inline-flex w-fit items-center gap-1 rounded-[var(--fin-r-sm)] px-2 py-0.5 fin-t-caption',
      tom === 'positivo' && 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
      tom === 'aviso' && 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
      tom === 'acento' && 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
    )}>
      {tom === 'positivo' ? <Check aria-hidden="true" className="size-3.5" /> : null}
      {texto}
    </span>
  );
}

function Fatura({ f, token, onMudou }: { f: FaturaNoPortal; token: string; onMudou: (f: FaturaNoPortal) => void }) {
  const [aberta, setAberta] = React.useState(f.conferencia === 'AGUARDANDO');
  const [modo, setModo] = React.useState<'ver' | 'aprovar' | 'contestar'>('ver');
  const [nome, setNome] = React.useState('');
  const [motivos, setMotivos] = React.useState<Record<string, string>>({});
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const corpoId = React.useId();

  const paga = f.situacao === 'PAGA';
  const podeResponder = !paga && f.conferencia !== 'APROVADA';
  const marcados = Object.entries(motivos).filter(([, m]) => m !== undefined);
  const faltaMotivo = marcados.some(([, m]) => m.trim().length < 5);

  async function enviar(acao: 'aprovar' | 'contestar') {
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/portal/${encodeURIComponent(token)}/faturas/${encodeURIComponent(f.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acao === 'aprovar'
          ? { acao, nome: nome.trim() }
          : { acao, nome: nome.trim(), itens: marcados.map(([conta_id, motivo]) => ({ conta_id, motivo: motivo.trim() })) }),
      });
      const corpo = await r.json().catch(() => null) as { fatura?: FaturaNoPortal | null; error?: string } | null;
      if (!r.ok) throw new Error(corpo?.error ?? 'Não foi possível enviar agora. Tente de novo em alguns minutos.');
      if (corpo?.fatura) onMudou(corpo.fatura);
      setModo('ver');
      setMotivos({});
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar agora.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <li className="flex flex-col rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]">
      <button
        type="button"
        aria-expanded={aberta}
        aria-controls={corpoId}
        onClick={() => setAberta(a => !a)}
        className={cn('flex w-full items-start justify-between gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] p-[var(--fin-s-4)] text-left', FOCO)}
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="fin-t-body-strong text-[var(--fin-text)]">Fatura Nº {f.numero}</span>
          <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">
            {[periodoDa(f), `vence em ${dataBR(f.vencimento)}`].filter(Boolean).join(' · ')}
          </span>
          <SeloDaConferencia f={f} />
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="fin-t-metric-sm tabular-nums text-[var(--fin-text)]">{reais(f.totais.liquido)}</span>
          {f.situacao === 'PAGA' || f.situacao === 'EM_ATRASO' || f.situacao === 'PARCIAL' ? (
            <span className={cn('fin-t-caption', f.situacao === 'PAGA' ? 'text-[var(--fin-positive)]' : f.situacao === 'EM_ATRASO' ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-2)]')}>
              {ROTULO_SITUACAO[f.situacao]}
            </span>
          ) : null}
          <ChevronDown aria-hidden="true" className={cn('size-5 text-[var(--fin-text-3)] transition-transform duration-[var(--fin-dur-base)]', aberta && 'rotate-180')} />
        </span>
      </button>

      {aberta ? (
        <div id={corpoId} className="flex flex-col gap-[var(--fin-s-4)] border-t border-[var(--fin-border)] p-[var(--fin-s-4)]">
          <ul className="flex flex-col gap-[var(--fin-s-3)]">
            {f.itens.map(i => {
              const marcado = motivos[i.conta_id] !== undefined;
              return (
                <li key={i.conta_id} className="flex flex-col gap-[var(--fin-s-2)] border-b border-[var(--fin-border)] pb-[var(--fin-s-3)] last:border-b-0 last:pb-0">
                  <div className="flex items-start justify-between gap-[var(--fin-s-3)]">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {modo === 'contestar' ? (
                        <label className="flex min-h-11 items-start gap-[var(--fin-s-2)]">
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={e => setMotivos(m => {
                              const n = { ...m };
                              if (e.target.checked) n[i.conta_id] = ''; else delete n[i.conta_id];
                              return n;
                            })}
                            className="mt-1 size-5 shrink-0 accent-[var(--fin-accent)]"
                          />
                          <span className="fin-t-body-strong text-[var(--fin-text)]">{i.produtos.map(p => p.descricao).filter(Boolean).join(' + ') || i.descricao}</span>
                        </label>
                      ) : (
                        <span className="fin-t-body-strong text-[var(--fin-text)]">{i.produtos.map(p => p.descricao).filter(Boolean).join(' + ') || i.descricao}</span>
                      )}
                      <span className="fin-t-caption text-[var(--fin-text-2)]">
                        {[i.venda ? `Venda ${i.venda}` : '', i.data_venda ? dataBR(i.data_venda) : '', i.centro_custo ? `Centro de custo ${i.centro_custo}` : ''].filter(Boolean).join(' · ')}
                      </span>
                      {i.produtos.map((p, k) => (
                        <span key={k} className="fin-t-caption text-[var(--fin-text-3)]">
                          {[p.passageiros.join(', '), p.localizador ? `localizador ${p.localizador}` : '', p.data_inicio ? (p.data_fim && p.data_fim !== p.data_inicio ? `${dataBR(p.data_inicio)} a ${dataBR(p.data_fim)}` : dataBR(p.data_inicio)) : ''].filter(Boolean).join(' · ')}
                        </span>
                      ))}
                    </div>
                    <span className="shrink-0 fin-t-body-strong tabular-nums text-[var(--fin-text)]">{reais(i.valor_centavos)}</span>
                  </div>
                  {modo === 'contestar' && marcado ? (
                    <textarea
                      aria-label={`O que não está certo em ${i.descricao}`}
                      value={motivos[i.conta_id]}
                      onChange={e => setMotivos(m => ({ ...m, [i.conta_id]: e.target.value }))}
                      maxLength={500}
                      rows={2}
                      placeholder="Ex.: este passageiro não viajou; o valor combinado era outro"
                      className={CAMPO}
                    />
                  ) : null}
                  {i.contestacao ? (
                    <div className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
                      <span className="inline-flex items-center gap-1 fin-t-caption text-[var(--fin-warning-text)]"><CircleAlert aria-hidden="true" className="size-3.5" /> Você contestou</span>
                      <span className="fin-t-body text-[var(--fin-text)]">{i.contestacao}</span>
                      {i.resposta ? (
                        <>
                          <span className="mt-1 inline-flex items-center gap-1 fin-t-caption text-[var(--fin-accent)]"><MessageSquareReply aria-hidden="true" className="size-3.5" /> Resposta da agência</span>
                          <span className="fin-t-body text-[var(--fin-text)]">{i.resposta}</span>
                        </>
                      ) : <span className="fin-t-caption text-[var(--fin-text-3)]">A agência ainda vai responder.</span>}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {f.notas.length || f.totais.retencoes.length ? (
            <dl className="flex flex-col gap-1 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)]">
              <div className="flex justify-between gap-[var(--fin-s-3)] fin-t-body"><dt className="text-[var(--fin-text-2)]">Itens</dt><dd className="tabular-nums">{reais(f.totais.itens)}</dd></div>
              {f.notas.map((n, k) => (
                <div key={k} className="flex justify-between gap-[var(--fin-s-3)] fin-t-body">
                  <dt className="min-w-0 text-[var(--fin-text-2)]">{n.tipo === 'CREDITO' ? 'Nota de crédito' : 'Nota de débito'}: {n.motivo}</dt>
                  <dd className="shrink-0 tabular-nums">{n.tipo === 'CREDITO' ? '− ' : '+ '}{reais(n.valor_centavos)}</dd>
                </div>
              ))}
              {f.totais.retencoes.map(r => (
                <div key={r.id} className="flex justify-between gap-[var(--fin-s-3)] fin-t-body">
                  <dt className="text-[var(--fin-text-2)]">Retenção {r.nome} ({String(r.percentual).replace('.', ',')}%)</dt>
                  <dd className="tabular-nums">− {reais(r.valor_centavos)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-1 fin-t-body-strong"><dt>A pagar</dt><dd className="tabular-nums">{reais(f.totais.liquido)}</dd></div>
            </dl>
          ) : null}

          {!paga ? <p className="fin-t-caption text-[var(--fin-text-3)]">Para pagar, use a Fatura Nº {f.numero} em “Para pagar”, no começo desta página.</p> : null}

          {erro ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">{erro}</p> : null}

          {podeResponder ? (
            modo === 'ver' ? (
              <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row">
                <button type="button" className={PRIMARIO} onClick={() => setModo('aprovar')}><ThumbsUp aria-hidden="true" className="size-5" /> Aprovar fatura</button>
                <button type="button" className={SECUNDARIO} onClick={() => setModo('contestar')}>Contestar item</button>
              </div>
            ) : (
              <div className="flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] p-[var(--fin-s-3)]">
                <p className="fin-t-body text-[var(--fin-text)]">
                  {modo === 'aprovar'
                    ? `Você confirma que os itens da fatura Nº ${f.numero} estão certos.`
                    : marcados.length ? `Escreva o que não está certo em ${marcados.length === 1 ? 'cada item marcado' : `cada um dos ${marcados.length} itens marcados`}.` : 'Marque acima os itens que não estão certos.'}
                </p>
                <label className="flex flex-col gap-1 fin-t-caption text-[var(--fin-text-2)]">
                  Seu nome (opcional)
                  <input value={nome} onChange={e => setNome(e.target.value)} maxLength={120} autoComplete="name" className={cn(CAMPO, 'min-h-11')} />
                </label>
                <div className="flex flex-col gap-[var(--fin-s-2)] sm:flex-row">
                  <button
                    type="button"
                    className={PRIMARIO}
                    disabled={enviando || (modo === 'contestar' && (!marcados.length || faltaMotivo))}
                    onClick={() => { void enviar(modo); }}
                  >
                    {enviando ? 'Enviando…' : modo === 'aprovar' ? 'Confirmar aprovação' : 'Enviar contestação'}
                  </button>
                  <button type="button" className={SECUNDARIO} disabled={enviando} onClick={() => { setModo('ver'); setMotivos({}); setErro(null); }}>Voltar</button>
                </div>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function FaturasParaConferir({ token }: { token: string }) {
  const [faturas, setFaturas] = React.useState<FaturaNoPortal[] | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/portal/${encodeURIComponent(token)}/faturas`, { signal: ac.signal, cache: 'no-store' })
      .then(async r => {
        const corpo = await r.json().catch(() => null) as { faturas?: FaturaNoPortal[] } | null;
        setFaturas(r.ok && Array.isArray(corpo?.faturas) ? corpo!.faturas! : []);
      })
      // Sem as faturas, o resto do portal continua: a seção só não aparece.
      .catch(() => { if (!ac.signal.aborted) setFaturas([]); });
    return () => ac.abort();
  }, [token]);

  if (!faturas?.length) return null;
  const aguardando = faturas.filter(f => f.conferencia === 'AGUARDANDO' && f.situacao !== 'PAGA').length;

  return (
    <section aria-labelledby="t-faturas" className="flex flex-col gap-[var(--fin-s-3)]">
      <div className="flex flex-col gap-1">
        <h2 id="t-faturas" className="fin-t-subhead text-[var(--fin-text)]">Faturas para conferir</h2>
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          {aguardando
            ? `${aguardando === 1 ? 'Uma fatura espera' : `${aguardando} faturas esperam`} a sua conferência. Abra, confira os itens e aprove, ou conteste o que não estiver certo.`
            : 'Os itens de cada fatura, com passageiro, localizador e centro de custo.'}
        </p>
      </div>
      <ul className="flex flex-col gap-[var(--fin-s-3)]">
        {faturas.map(f => (
          <Fatura key={f.id} f={f} token={token} onMudou={nova => setFaturas(lista => (lista ?? []).map(x => (x.id === nova.id ? nova : x)))} />
        ))}
      </ul>
    </section>
  );
}
