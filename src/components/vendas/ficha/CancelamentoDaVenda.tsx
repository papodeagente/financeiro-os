'use client';

/**
 * Cancelar produto ou passageiro (E5, parte D).
 *
 * Uma janela, de cima para baixo na ordem em que a pessoa pensa: o que
 * cancela (passageiro a passageiro, ou o produto inteiro), quando e por quê;
 * a multa (sugerida pela reserva ou pela política do fornecedor, sempre
 * editável); o que fazer com o saldo (as três escolhas, com as nossas
 * palavras); e a PRÉVIA de todas as contas que mudam, calculada pelo
 * servidor com a mesma regra da gravação. Confirmar só vale para a prévia à
 * vista: mudou um campo, a prévia se refaz antes.
 *
 * No alto, os cancelamentos já feitos na venda. O último que ainda vale pode
 * ser DESFEITO (a venda volta como era), com motivo e a mesma prévia das
 * contas antes de gravar.
 */
import * as React from 'react';
import { AlertTriangle, ArrowRight, CircleCheck, RefreshCw, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RecordSheet } from '@/components/fin/RecordSheet';
import { Segmentado } from '@/components/fin/Segmentado';
import { Field } from '@/components/fin/Field';
import { hojeISO } from '@/lib/money';
import { totaisDoProduto, ROTULO_TIPO_PRODUTO, type ProdutoDaVenda, type Venda } from '@/lib/venda-modelo';
import { sugerirMulta, type MultaSugerida, type PoliticaDeCancelamento } from '@/lib/cancelamento';
import type { CancelamentoNaLista, ContextoDoCancelamento, ResultadoDoCancelamento, ResultadoDoDesfazer, MudancaDeConta } from '@/lib/cancelamento-servidor';
import type { FichaDaVenda } from '@/lib/venda-rota';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { CampoReais, CONTROLE, dataBR, naMoeda, reais, ROTULO, SECAO } from './comum';

type Escolha = { pax: Set<string>; inteiro: boolean };
type Multa = { fornecedor: number | null; cliente: number | null };

async function chamar<T>(url: string, metodo: 'GET' | 'POST', corpo?: unknown): Promise<T> {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(String(j?.error ?? 'Não deu certo. Tente de novo.')), { codigo: String(j?.codigo ?? r.status) });
  return j as T;
}

/** O que a parte escolhida valia (na moeda do produto): base da multa sugerida. */
function parteEscolhida(p: ProdutoDaVenda, e: Escolha): { cliente: number; fornecedor: number } {
  const antes = totaisDoProduto(p);
  const copia: ProdutoDaVenda = {
    ...p,
    cancelado_em: e.inteiro ? hojeISO() : p.cancelado_em,
    passageiros: p.passageiros.map(x => ({ ...x, cancelado_em: x.cancelado_em || (e.inteiro || e.pax.has(x.id) ? hojeISO() : null) })),
  };
  const depois = totaisDoProduto(copia);
  return { cliente: antes.valor_cliente - depois.valor_cliente, fornecedor: antes.valor_fornecedor - depois.valor_fornecedor };
}

const ROTULO_STATUS: Record<string, string> = {
  PENDENTE: 'em aberto', ATRASADO: 'em atraso', PARCIAL: 'pago em parte', RECEBIDO: 'recebido', PAGO: 'pago', CANCELADO: 'cancelado',
};

export function CancelamentoDaVenda({ ficha, aberto, onFechar, onConcluido }: {
  ficha: FichaDaVenda;
  aberto: boolean;
  onFechar: () => void;
  onConcluido: (f: FichaDaVenda) => void;
}) {
  const venda: Venda = ficha.venda;
  const ativos = venda.produtos.filter(p => !p.cancelado_em);
  const [contexto, setContexto] = React.useState<ContextoDoCancelamento | null>(null);
  const [escolhas, setEscolhas] = React.useState<Record<string, Escolha>>({});
  const [multas, setMultas] = React.useState<Record<string, Multa>>({});
  const [data, setData] = React.useState(hojeISO());
  const [motivo, setMotivo] = React.useState('');
  const [zerarFornecedor, setZerarFornecedor] = React.useState(true);
  const [zerarCliente, setZerarCliente] = React.useState(true);
  const [manterNaMeta, setManterNaMeta] = React.useState(false);
  const [sobra, setSobra] = React.useState<'reembolso' | 'credito'>('reembolso');
  const [prazo, setPrazo] = React.useState('');
  const [validade, setValidade] = React.useState('');
  const [previa, setPrevia] = React.useState<{ chave: string; r: ResultadoDoCancelamento } | null>(null);
  const [erroPrevia, setErroPrevia] = React.useState<string | null>(null);
  const [calculando, setCalculando] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);
  // Desfazer o último cancelamento.
  const [alvo, setAlvo] = React.useState<CancelamentoNaLista | null>(null);
  const [motivoDesfazer, setMotivoDesfazer] = React.useState('');
  const [previaDesfazer, setPreviaDesfazer] = React.useState<{ chave: string; r: ResultadoDoDesfazer } | null>(null);
  const [erroDesfazer, setErroDesfazer] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!aberto) return;
    setEscolhas({}); setMultas({}); setMotivo(''); setData(hojeISO()); setPrevia(null); setErroPrevia(null);
    setZerarFornecedor(true); setZerarCliente(true); setManterNaMeta(false); setSobra('reembolso'); setPrazo(''); setValidade('');
    setAlvo(null); setMotivoDesfazer(''); setPreviaDesfazer(null); setErroDesfazer(null);
    void chamar<ContextoDoCancelamento>(`/api/vendas/completa/${encodeURIComponent(venda.id)}/cancelamento`, 'GET').then(setContexto).catch(() => setContexto(null));
  }, [aberto, venda.id]);

  const selecionados = ativos.filter(p => escolhas[p.id] && (escolhas[p.id].inteiro || escolhas[p.id].pax.size > 0));

  function sugestaoDe(p: ProdutoDaVenda): MultaSugerida {
    const e = escolhas[p.id];
    const base = e ? parteEscolhida(p, e).fornecedor : 0;
    const politica: PoliticaDeCancelamento | null = contexto?.politicas[p.id] ?? null;
    return sugerirMulta(p, base, data, politica);
  }

  const pedido = {
    data, motivo,
    itens: selecionados.map(p => ({ produto_id: p.id, passageiro_ids: escolhas[p.id].inteiro ? null : [...escolhas[p.id].pax] })),
    multas: selecionados.map(p => {
      const m = multas[p.id];
      const sug = sugestaoDe(p).centavos;
      const forn = m?.fornecedor ?? sug;
      return { produto_id: p.id, fornecedor_centavos: forn, cliente_centavos: m?.cliente ?? null };
    }),
    zerar_fornecedor: zerarFornecedor, zerar_cliente: zerarCliente, manter_na_meta: manterNaMeta,
    sobra, ...(prazo ? { prazo_reembolso: prazo } : {}), ...(validade ? { validade_credito: validade } : {}),
  };
  const chave = JSON.stringify(pedido);
  const pronto = selecionados.length > 0 && motivo.trim().length >= 5;
  const previaVale = previa?.chave === chave;

  // A prévia se refaz sozinha quando o pedido muda (o servidor roda a mesma regra e desfaz).
  React.useEffect(() => {
    if (!aberto || !pronto) return;
    const t = setTimeout(() => {
      setCalculando(true);
      chamar<ResultadoDoCancelamento>(`/api/vendas/completa/${encodeURIComponent(venda.id)}/cancelamento`, 'POST', { modo: 'previa', pedido: JSON.parse(chave) })
        .then(r => { setPrevia({ chave, r }); setErroPrevia(null); })
        .catch(e => { setPrevia(null); setErroPrevia(e instanceof Error ? e.message : 'A prévia não respondeu.'); })
        .finally(() => setCalculando(false));
    }, 600);
    return () => clearTimeout(t);
  }, [aberto, pronto, chave, venda.id]);

  const urlDesfazer = `/api/vendas/completa/${encodeURIComponent(venda.id)}/cancelamento/desfazer`;
  const chaveDesfazer = alvo ? JSON.stringify([alvo.id, motivoDesfazer.trim()]) : '';
  const prontoDesfazer = Boolean(alvo) && motivoDesfazer.trim().length >= 5;
  const previaDesfazerVale = previaDesfazer?.chave === chaveDesfazer;

  // A prévia do desfazer também se refaz sozinha (o servidor desfaz e volta atrás).
  React.useEffect(() => {
    if (!aberto || !alvo || !prontoDesfazer) return;
    const t = setTimeout(() => {
      setCalculando(true);
      chamar<ResultadoDoDesfazer>(urlDesfazer, 'POST', { modo: 'previa', cancelamento_id: alvo.id, motivo: motivoDesfazer.trim() })
        .then(r => { setPreviaDesfazer({ chave: chaveDesfazer, r }); setErroDesfazer(null); })
        .catch(e => { setPreviaDesfazer(null); setErroDesfazer(e instanceof Error ? e.message : 'A prévia não respondeu.'); })
        .finally(() => setCalculando(false));
    }, 600);
    return () => clearTimeout(t);
  }, [aberto, alvo, prontoDesfazer, chaveDesfazer, motivoDesfazer, urlDesfazer]);

  async function confirmarDesfazer() {
    if (!alvo || !previaDesfazer || !previaDesfazerVale) return;
    setGravando(true);
    try {
      const r = await chamar<ResultadoDoDesfazer & { ficha: FichaDaVenda }>(urlDesfazer, 'POST', { modo: 'gravar', cancelamento_id: alvo.id, motivo: motivoDesfazer.trim(), assinatura: previaDesfazer.r.assinatura });
      const partes = [
        `${r.mudancas.length} ${r.mudancas.length === 1 ? 'conta mudou' : 'contas mudaram'}`,
        r.reembolsos_cancelados.length ? `${r.reembolsos_cancelados.length} reembolso${r.reembolsos_cancelados.length > 1 ? 's' : ''} cancelado${r.reembolsos_cancelados.length > 1 ? 's' : ''}` : '',
        r.creditos_cancelados.length ? `${reais(r.creditos_cancelados.reduce((a, c) => a + c.valor_centavos, 0))} saíram da carteira do cliente` : '',
      ].filter(Boolean);
      toast.success('Cancelamento desfeito', `${partes.join('; ')}.`);
      onConcluido(r.ficha);
    } catch (e) {
      const codigo = (e as { codigo?: string }).codigo;
      toast.error(codigo === 'MUDOU' ? 'A venda mudou' : 'O cancelamento não foi desfeito', e instanceof Error ? e.message : undefined);
      if (codigo === 'MUDOU') setPreviaDesfazer(null);
    } finally {
      setGravando(false);
    }
  }

  async function confirmar() {
    if (alvo) { await confirmarDesfazer(); return; }
    if (!previa || !previaVale) return;
    setGravando(true);
    try {
      const r = await chamar<ResultadoDoCancelamento & { ficha: FichaDaVenda }>(`/api/vendas/completa/${encodeURIComponent(venda.id)}/cancelamento`, 'POST', { modo: 'gravar', pedido: JSON.parse(chave), assinatura: previa.r.assinatura });
      const partes = [
        `${r.mudancas.length} ${r.mudancas.length === 1 ? 'conta mudou' : 'contas mudaram'}`,
        r.credito ? `${reais(r.credito.valor_centavos)} viraram crédito do cliente` : '',
        r.reembolsos.length ? `${r.reembolsos.length} reembolso${r.reembolsos.length > 1 ? 's' : ''} solicitado${r.reembolsos.length > 1 ? 's' : ''}` : '',
      ].filter(Boolean);
      toast.success('Cancelamento gravado', `${partes.join('; ')}.`);
      onConcluido(r.ficha);
    } catch (e) {
      const codigo = (e as { codigo?: string }).codigo;
      toast.error(codigo === 'MUDOU' ? 'A venda mudou' : 'O cancelamento não foi gravado', e instanceof Error ? e.message : undefined);
      if (codigo === 'MUDOU') setPrevia(null);
    } finally {
      setGravando(false);
    }
  }

  const marcar = (p: ProdutoDaVenda, paxId: string | null, ligado: boolean) => {
    setEscolhas(atual => {
      const e: Escolha = atual[p.id] ? { pax: new Set(atual[p.id].pax), inteiro: atual[p.id].inteiro } : { pax: new Set(), inteiro: false };
      const paxAtivos = p.passageiros.filter(x => !x.cancelado_em);
      if (paxId === null) { e.inteiro = ligado; e.pax = ligado ? new Set(paxAtivos.map(x => x.id)) : new Set(); }
      else {
        if (ligado) e.pax.add(paxId); else e.pax.delete(paxId);
        e.inteiro = paxAtivos.length > 0 && paxAtivos.every(x => e.pax.has(x.id));
      }
      return { ...atual, [p.id]: e };
    });
  };

  const r = previa?.r ?? null;
  const resumo = !pronto
    ? 'Escolha o que cancela e diga o motivo. A prévia aparece em seguida, antes de qualquer conta mudar.'
    : !previaVale
      ? (calculando ? 'Calculando o que muda…' : erroPrevia ?? 'Refazendo a prévia com o que você mudou…')
      : `${r!.mudancas.length ? `${r!.mudancas.length} ${r!.mudancas.length === 1 ? 'conta muda' : 'contas mudam'}` : 'Nenhuma conta muda'} · receita ${reais(r!.receita_antes_centavos)} → ${reais(r!.receita_depois_centavos)}.`;
  const rd = previaDesfazer?.r ?? null;
  const resumoDesfazer = !prontoDesfazer
    ? 'Diga por que o cancelamento está sendo desfeito. A prévia aparece em seguida.'
    : !previaDesfazerVale
      ? (calculando ? 'Calculando o que muda…' : erroDesfazer ?? 'Refazendo a prévia…')
      : `${rd!.mudancas.length ? `${rd!.mudancas.length} ${rd!.mudancas.length === 1 ? 'conta muda' : 'contas mudam'}` : 'Nenhuma conta muda'} · receita ${reais(rd!.receita_antes_centavos)} → ${reais(rd!.receita_depois_centavos)}.`;
  const cancelamentos = contexto?.cancelamentos ?? [];

  return (
    <RecordSheet
      aberto={aberto}
      onOpenChange={a => { if (!a) onFechar(); }}
      titulo={alvo ? 'Desfazer o cancelamento' : 'Cancelar produto ou passageiro'}
      descricao={`Venda ${venda.numero} · ${venda.cliente.nome}. Nada muda antes de você confirmar a prévia.`}
      largura={960}
      sujo={alvo ? motivoDesfazer.trim().length > 0 : selecionados.length > 0}
      resumo={<span aria-live="polite">{alvo ? resumoDesfazer : resumo}</span>}
      acaoPrimaria={alvo
        ? { rotulo: gravando ? 'Gravando…' : 'Desfazer cancelamento', onClick: confirmar, carregando: gravando, desabilitado: !prontoDesfazer || !previaDesfazerVale || calculando }
        : { rotulo: gravando ? 'Gravando…' : 'Confirmar cancelamento', onClick: confirmar, carregando: gravando, desabilitado: !pronto || !previaVale || calculando }}
      acaoSecundaria={alvo
        ? { rotulo: 'Voltar à lista', onClick: () => { setAlvo(null); setMotivoDesfazer(''); setPreviaDesfazer(null); setErroDesfazer(null); } }
        : { rotulo: 'Voltar', onClick: onFechar }}
    >
      {alvo ? (
        <div className="flex flex-col gap-[var(--fin-s-4)]">
          <section aria-labelledby="dx-qual" className={SECAO}>
            <h3 id="dx-qual" className="fin-t-subhead text-[var(--fin-text)]">Cancelamento de {dataBR(alvo.data)}</h3>
            <p className="fin-t-body text-[var(--fin-text-2)]">
              {resumoDoCancelamento(alvo)}. Motivo: “{alvo.motivo}”{alvo.usuario_nome ? `, por ${alvo.usuario_nome}` : ''}.
            </p>
            <p className="fin-t-caption text-[var(--fin-text-2)]">
              Desfazer devolve à venda os passageiros e produtos, tira a multa e devolve aos pagamentos o que saiu. Os reembolsos e o crédito que ele gerou são cancelados. Contas já recebidas ou pagas ficam como estão; a diferença se ajusta nas que estão em aberto.
            </p>
            <Field rotulo="Por que desfazer" obrigatorio ajuda="Fica no histórico da venda. Pelo menos 5 letras.">
              {a => <Textarea {...a} value={motivoDesfazer} maxLength={500} onChange={ev => setMotivoDesfazer(ev.target.value)} className="min-h-11 fin-t-body" placeholder="Ex.: o cliente decidiu viajar, afinal" />}
            </Field>
          </section>
          {prontoDesfazer ? (
            <section aria-labelledby="dx-previa" aria-busy={calculando} className={SECAO}>
              <div className="flex items-center justify-between gap-[var(--fin-s-3)]">
                <h3 id="dx-previa" className="fin-t-subhead text-[var(--fin-text)]">Prévia: o que muda</h3>
                {calculando ? <span className="inline-flex items-center gap-1 fin-t-caption text-[var(--fin-text-3)]"><RefreshCw aria-hidden="true" className="size-3.5 motion-safe:animate-spin" /> Calculando</span> : null}
              </div>
              {erroDesfazer && !previaDesfazerVale ? (
                <p role="alert" className="flex items-start gap-2 rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body text-[var(--fin-negative-text)]">
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {erroDesfazer}
                </p>
              ) : null}
              {rd ? <PreviaDoDesfazer r={rd} desatualizada={!previaDesfazerVale} /> : !erroDesfazer ? <div className="h-32 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" /> : null}
            </section>
          ) : null}
        </div>
      ) : (
      <div className="flex flex-col gap-[var(--fin-s-4)]">
        {cancelamentos.length ? (
          <section aria-labelledby="cx-feitos" className={SECAO}>
            <h3 id="cx-feitos" className="fin-t-subhead text-[var(--fin-text)]">Cancelamentos desta venda</h3>
            <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
              {cancelamentos.map(c => (
                <li key={c.id} className="flex flex-col gap-[var(--fin-s-2)] py-[var(--fin-s-2)] first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={cn('fin-t-body-strong', c.desfeito_em ? 'text-[var(--fin-text-2)] line-through decoration-[var(--fin-text-3)]' : 'text-[var(--fin-text)]')}>
                      {dataBR(c.data)} · {resumoDoCancelamento(c)}
                    </span>
                    <span className="fin-t-caption text-[var(--fin-text-3)]">
                      “{c.motivo}”{c.usuario_nome ? ` · ${c.usuario_nome}` : ''}
                      {c.desfeito_em ? ` · desfeito em ${dataBR(c.desfeito_em.slice(0, 10))}${c.desfeito_por ? ` por ${c.desfeito_por}` : ''}: “${c.motivo_desfazer}”` : ''}
                    </span>
                  </span>
                  {c.pode_desfazer ? (
                    <Button type="button" variant="outline" size="sm" className="shrink-0 self-start sm:self-center" onClick={() => { setAlvo(c); setMotivoDesfazer(''); setPreviaDesfazer(null); setErroDesfazer(null); }}>
                      <Undo2 aria-hidden="true" className="size-4" /> Desfazer
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section aria-labelledby="cx-o-que" className={SECAO}>
          <h3 id="cx-o-que" className="fin-t-subhead text-[var(--fin-text)]">O que cancela</h3>
          {ativos.length === 0 ? (
            <p className="fin-t-body text-[var(--fin-text-2)]">Todos os produtos desta venda já estão cancelados.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
              {ativos.map(p => {
                const e = escolhas[p.id];
                const paxAtivos = p.passageiros.filter(x => !x.cancelado_em);
                const t = totaisDoProduto(p);
                return (
                  <li key={p.id} className="flex flex-col gap-[var(--fin-s-2)] py-[var(--fin-s-3)] first:pt-0 last:pb-0">
                    <label className="flex cursor-pointer items-start gap-[var(--fin-s-3)]">
                      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--fin-accent)]" checked={Boolean(e?.inteiro)} onChange={ev => marcar(p, null, ev.target.checked)} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="fin-t-body-strong text-[var(--fin-text)]">{p.descricao || ROTULO_TIPO_PRODUTO[p.tipo]}{paxAtivos.length ? ' · produto inteiro' : ''}</span>
                        <span className="fin-t-caption text-[var(--fin-text-3)]">
                          {ROTULO_TIPO_PRODUTO[p.tipo]}{p.fornecedor?.nome ? ` · ${p.fornecedor.nome}` : ''}{p.quem_cobra === 'FORNECEDOR' ? ' · o fornecedor cobra direto' : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums fin-t-body text-[var(--fin-text-2)]">{naMoeda(t.valor_cliente, p.moeda)}</span>
                    </label>
                    {paxAtivos.length > 1 ? (
                      <div className="ml-7 grid grid-cols-1 gap-x-[var(--fin-s-4)] gap-y-1 sm:grid-cols-2">
                        {paxAtivos.map(x => (
                          <label key={x.id} className="flex cursor-pointer items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text)]">
                            <input type="checkbox" className="size-4 shrink-0 accent-[var(--fin-accent)]" checked={Boolean(e?.pax.has(x.id))} onChange={ev => marcar(p, x.id, ev.target.checked)} />
                            <span className="min-w-0 flex-1 truncate">{x.nome || 'Passageiro'}</span>
                            <span className="tabular-nums fin-t-caption text-[var(--fin-text-3)]">{naMoeda(x.tarifa_centavos + x.taxas_centavos + x.outras_taxas_centavos, p.moeda)}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-[200px_minmax(0,1fr)]">
            <Field rotulo="Data do cancelamento" obrigatorio>
              {a => <Input {...a} type="date" className={CONTROLE} value={data} min={venda.data_venda} onChange={ev => setData(ev.target.value || hojeISO())} />}
            </Field>
            <Field rotulo="Motivo" obrigatorio ajuda="Fica no histórico da venda. Pelo menos 5 letras.">
              {a => <Textarea {...a} value={motivo} maxLength={500} onChange={ev => setMotivo(ev.target.value)} className="min-h-11 fin-t-body" placeholder="Ex.: a passageira adoeceu e não vai viajar" />}
            </Field>
          </div>
        </section>

        {selecionados.length ? (
          <section aria-labelledby="cx-multa" className={SECAO}>
            <div className="flex flex-col gap-1">
              <h3 id="cx-multa" className="fin-t-subhead text-[var(--fin-text)]">Multa</h3>
              <p className="fin-t-caption text-[var(--fin-text-2)]">A sugestão vem da reserva ou da política de cancelamento do fornecedor. Mude se o fornecedor informou outro valor.</p>
            </div>
            {selecionados.map(p => {
              const sug = sugestaoDe(p);
              const m = multas[p.id] ?? { fornecedor: null, cliente: null };
              const forn = m.fornecedor ?? sug.centavos;
              const prefixo = p.moeda === 'BRL' ? 'R$' : p.moeda;
              const parte = parteEscolhida(p, escolhas[p.id]);
              return (
                <div key={p.id} className="grid grid-cols-1 gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] pt-[var(--fin-s-3)] first-of-type:border-t-0 first-of-type:pt-0 md:grid-cols-[minmax(0,1fr)_200px_200px]">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="fin-t-body-strong text-[var(--fin-text)]">{p.descricao || ROTULO_TIPO_PRODUTO[p.tipo]}</span>
                    <span className="fin-t-caption text-[var(--fin-text-2)]">
                      A parte cancelada valia {naMoeda(parte.cliente, p.moeda)} para o cliente e {naMoeda(parte.fornecedor, p.moeda)} para o fornecedor.
                    </span>
                    <span className={cn('fin-t-caption', sug.origem === 'sem_politica' ? 'text-[var(--fin-text-3)]' : 'text-[var(--fin-accent)]')}>
                      {sug.origem === 'sem_politica' ? sug.explicacao : `Sugerida: ${naMoeda(sug.centavos, p.moeda)}. ${sug.explicacao}`}
                      {m.fornecedor !== null && m.fornecedor !== sug.centavos && sug.origem !== 'sem_politica' ? (
                        <button type="button" className="ml-1 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]" onClick={() => setMultas(x => ({ ...x, [p.id]: { ...m, fornecedor: null } }))}>Usar a sugerida</button>
                      ) : null}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={ROTULO}>Multa do fornecedor</span>
                    <CampoReais rotulo={`Multa do fornecedor: ${p.descricao}`} prefixo={prefixo} centavos={forn} onChange={v => setMultas(x => ({ ...x, [p.id]: { ...m, fornecedor: v } }))} desabilitado={p.quem_cobra === 'FORNECEDOR'} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className={ROTULO}>Multa cobrada do cliente</span>
                    <CampoReais rotulo={`Multa cobrada do cliente: ${p.descricao}`} prefixo={prefixo} centavos={m.cliente ?? forn} onChange={v => setMultas(x => ({ ...x, [p.id]: { ...m, cliente: v } }))} desabilitado={p.quem_cobra === 'FORNECEDOR'} />
                  </div>
                </div>
              );
            })}
          </section>
        ) : null}

        {selecionados.length ? (
          <section aria-labelledby="cx-saldo" className={SECAO}>
            <h3 id="cx-saldo" className="fin-t-subhead text-[var(--fin-text)]">O que fazer com o saldo</h3>
            <div className="grid grid-cols-1 gap-[var(--fin-s-2)] md:grid-cols-3">
              <Escolher ligado={zerarFornecedor} onChange={setZerarFornecedor} titulo="Tirar do fornecedor o que falta pagar"
                texto="A agência passa a dever ao fornecedor só a multa dele. Sem marcar, ele continua recebendo o valor inteiro." />
              <Escolher ligado={zerarCliente} onChange={setZerarCliente} titulo="Tirar do cliente o que falta receber"
                texto="O cliente passa a dever só a multa cobrada dele. Sem marcar, ele continua devendo o valor inteiro." />
              <Escolher ligado={manterNaMeta} onChange={setManterNaMeta} titulo="Manter na meta de comissão"
                texto="O vendedor não perde comissão nem meta por este cancelamento. Sem marcar, a comissão dele sai na proporção da receita." />
            </div>
            <div className="grid grid-cols-1 gap-[var(--fin-s-3)] md:grid-cols-[minmax(0,1fr)_200px] md:items-end">
              <div className="flex flex-col gap-1">
                <span className={ROTULO}>Se o cliente já pagou mais do que fica devendo</span>
                <Segmentado<'reembolso' | 'credito'> rotulo="Destino do que o cliente pagou a mais" cheio valor={sobra} onChange={setSobra}
                  opcoes={[{ valor: 'reembolso', rotulo: 'Devolver (reembolso)' }, { valor: 'credito', rotulo: 'Guardar como crédito do cliente' }]} />
              </div>
              {sobra === 'reembolso' ? (
                <Field rotulo="Prazo do reembolso" ajuda="Padrão: 7 dias.">
                  {a => <Input {...a} type="date" className={CONTROLE} value={prazo} min={data} onChange={ev => setPrazo(ev.target.value)} />}
                </Field>
              ) : (
                <Field rotulo="Validade do crédito" ajuda="Padrão: um ano.">
                  {a => <Input {...a} type="date" className={CONTROLE} value={validade} min={hojeISO()} onChange={ev => setValidade(ev.target.value)} />}
                </Field>
              )}
            </div>
          </section>
        ) : null}

        {pronto ? (
          <section aria-labelledby="cx-previa" aria-busy={calculando} className={SECAO}>
            <div className="flex items-center justify-between gap-[var(--fin-s-3)]">
              <h3 id="cx-previa" className="fin-t-subhead text-[var(--fin-text)]">Prévia: o que muda</h3>
              {calculando ? <span className="inline-flex items-center gap-1 fin-t-caption text-[var(--fin-text-3)]"><RefreshCw aria-hidden="true" className="size-3.5 motion-safe:animate-spin" /> Calculando</span> : null}
            </div>
            {erroPrevia && !previaVale ? (
              <p role="alert" className="flex items-start gap-2 rounded-[var(--fin-r-md)] bg-[var(--fin-negative-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body text-[var(--fin-negative-text)]">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {erroPrevia}
              </p>
            ) : null}
            {r ? <Previa r={r} desatualizada={!previaVale} /> : !erroPrevia ? <div className="h-32 rounded-[var(--fin-r-md)] bg-[var(--fin-surface-2)]" /> : null}
          </section>
        ) : null}
      </div>
      )}
    </RecordSheet>
  );
}

/** "Hotel Mar: Ana, Bia" ou "Seguro (produto inteiro)", a partir do resumo gravado. */
function resumoDoCancelamento(c: CancelamentoNaLista): string {
  const itens = Array.isArray(c.resumo.itens) ? (c.resumo.itens as Array<{ produto?: string; produto_inteiro?: boolean; passageiros?: Array<string | { nome?: string }> }>) : [];
  if (!itens.length) return 'Cancelamento';
  const nome = (x: string | { nome?: string }) => (typeof x === 'string' ? x : x.nome ?? '');
  return itens.map(i => `${i.produto || 'Produto'}${i.produto_inteiro ? ' (produto inteiro)' : i.passageiros?.length ? `: ${i.passageiros.map(nome).filter(Boolean).join(', ')}` : ''}`).join('; ');
}

function Escolher({ ligado, onChange, titulo, texto }: { ligado: boolean; onChange: (v: boolean) => void; titulo: string; texto: string }) {
  return (
    <label className={cn(
      'flex cursor-pointer items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border px-[var(--fin-s-3)] py-[var(--fin-s-2)] transition-colors duration-[var(--fin-dur-rapida)]',
      ligado ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]' : 'border-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]',
    )}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]" checked={ligado} onChange={e => onChange(e.target.checked)} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="fin-t-body-strong text-[var(--fin-text)]">{titulo}</span>
        <span className="fin-t-caption text-[var(--fin-text-2)]">{texto}</span>
      </span>
    </label>
  );
}

function PreviaDoDesfazer({ r, desatualizada }: { r: ResultadoDoDesfazer; desatualizada: boolean }) {
  const devolvida = r.comissoes.reduce((a, c) => a + c.devolvido, 0);
  return (
    <div className={cn('flex flex-col gap-[var(--fin-s-3)] transition-opacity duration-[var(--fin-dur-base)]', desatualizada && 'opacity-50')}>
      <dl className="grid grid-cols-2 gap-[var(--fin-s-3)] sm:grid-cols-4">
        <Numero rotulo="Receita da venda" valor={`${reais(r.receita_antes_centavos)} → ${reais(r.receita_depois_centavos)}`} />
        <Numero rotulo="Volta à venda" valor={r.produtos.map(p => (p.produto_inteiro || !p.passageiros.length ? p.descricao : p.passageiros.join(', '))).join(' · ') || '—'} />
        <Numero rotulo="Sai da carteira do cliente" valor={r.creditos_cancelados.length ? reais(r.creditos_cancelados.reduce((a, c) => a + c.valor_centavos, 0)) : '—'} />
        <Numero rotulo="Comissão do vendedor" valor={devolvida > 0 ? `+${reais(Math.round(devolvida * 100))}` : 'sem mudança'} />
      </dl>
      {r.reembolsos_cancelados.length ? (
        <p className="fin-t-body text-[var(--fin-text-2)]">
          Reembolsos cancelados: {r.reembolsos_cancelados.map(x => `${x.tipo === 'CLIENTE' ? 'ao cliente' : 'com o fornecedor'} ${x.pessoa}, ${reais(x.valor_centavos)}`).join(' · ')}.
        </p>
      ) : null}
      {r.venda_reativada ? <p className="fin-t-body text-[var(--fin-text-2)]">A venda volta a contar nas vendas, na meta e na comissão.</p> : null}
      <TabelaDeMudancas linhas={r.mudancas} legenda="Contas que mudam ao desfazer o cancelamento" vazio="Nenhuma conta muda." />
      {r.avisos.length ? (
        <ul className="flex flex-col gap-1">
          {r.avisos.map((a, i) => (
            <li key={`${a.codigo}${i}`} className="flex items-start gap-2 rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body text-[var(--fin-warning-text)]">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {a.mensagem}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TabelaDeMudancas({ linhas, legenda, vazio }: { linhas: MudancaDeConta[]; legenda: string; vazio: string }) {
  if (!linhas.length) {
    return <p className="flex items-center gap-2 fin-t-body text-[var(--fin-text-2)]"><CircleCheck aria-hidden="true" className="size-4 text-[var(--fin-positive)]" /> {vazio}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)]">
      <table className="w-full min-w-[640px] border-collapse fin-t-body">
        <caption className="sr-only">{legenda}</caption>
        <thead className="bg-[var(--fin-surface-2)]">
          <tr className="text-left fin-t-overline text-[var(--fin-text-3)]">
            <th scope="col" className="px-3 py-2 font-medium">Conta</th>
            <th scope="col" className="px-3 py-2 font-medium">Vence</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Antes</th>
            <th scope="col" className="px-3 py-2"><span className="sr-only">para</span></th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Depois</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((m, i) => (
            <tr key={`${m.tabela}:${m.id ?? `n${i}`}`} className="border-t border-[var(--fin-border)]">
              <td className="px-3 py-2">
                <span className="block fin-t-body text-[var(--fin-text)]">{m.descricao || (m.tabela === 'contas_pagar' ? 'Conta a pagar' : 'Conta a receber')}</span>
                <span className="block fin-t-caption text-[var(--fin-text-3)]">
                  {m.tabela === 'contas_pagar' ? 'A pagar' : 'A receber'}{m.pessoa ? ` · ${m.pessoa}` : ''}
                  {m.tipo === 'criada' ? ' · nova' : m.tipo === 'removida' ? ' · sai' : m.status_antes !== m.status_depois && m.status_depois ? ` · fica ${ROTULO_STATUS[m.status_depois] ?? m.status_depois.toLowerCase()}` : ''}
                </span>
              </td>
              <td className="px-3 py-2 tabular-nums text-[var(--fin-text-2)]">{dataBR(m.vencimento)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[var(--fin-text-2)]">{m.antes === null ? '—' : reais(Math.round(m.antes * 100))}</td>
              <td className="px-1 py-2 text-[var(--fin-text-3)]"><ArrowRight aria-hidden="true" className="size-3.5" /></td>
              <td className={cn('px-3 py-2 text-right tabular-nums fin-t-body-strong', m.depois === null ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>{m.depois === null ? 'sai' : reais(Math.round(m.depois * 100))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Previa({ r, desatualizada }: { r: ResultadoDoCancelamento; desatualizada: boolean }) {
  const linhas: MudancaDeConta[] = r.mudancas;
  return (
    <div className={cn('flex flex-col gap-[var(--fin-s-3)] transition-opacity duration-[var(--fin-dur-base)]', desatualizada && 'opacity-50')}>
      <dl className="grid grid-cols-2 gap-[var(--fin-s-3)] sm:grid-cols-4">
        <Numero rotulo="Receita da venda" valor={`${reais(r.receita_antes_centavos)} → ${reais(r.receita_depois_centavos)}`} />
        <Numero rotulo="Crédito do cliente" valor={r.credito ? reais(r.credito.valor_centavos) : '—'} />
        <Numero rotulo="Reembolsos" valor={r.reembolsos.length ? r.reembolsos.map(x => `${x.tipo === 'CLIENTE' ? 'ao cliente' : 'do fornecedor'} ${reais(x.valor_centavos)}`).join(' · ') : '—'} />
        <Numero rotulo="Comissão do vendedor" valor={r.comissoes.some(c => c.estorno > 0) ? `−${reais(Math.round(r.comissoes.reduce((a, c) => a + c.estorno, 0) * 100))}` : 'sem mudança'} />
      </dl>
      <TabelaDeMudancas linhas={linhas} legenda="Contas que mudam com o cancelamento" vazio="Nenhuma conta muda: cliente e fornecedor seguem devendo o mesmo." />
      {r.credito_devolvido_centavos > 0 ? <p className="fin-t-caption text-[var(--fin-text-2)]">{reais(r.credito_devolvido_centavos)} de crédito do cliente usado nesta venda voltam para a carteira dele.</p> : null}
      {r.avisos.length ? (
        <ul className="flex flex-col gap-1">
          {r.avisos.map((a, i) => (
            <li key={`${a.codigo}${i}`} className="flex items-start gap-2 rounded-[var(--fin-r-md)] bg-[var(--fin-warning-soft)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] fin-t-body text-[var(--fin-warning-text)]">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> {a.mensagem}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="fin-t-caption text-[var(--fin-text-3)]">{rotulo}</dt>
      <dd className="tabular-nums fin-t-body-strong text-[var(--fin-text)]">{valor}</dd>
    </div>
  );
}
