'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, CircleSlash, Coins, Clock3 } from 'lucide-react';

import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { DataState } from '@/components/fin/DataState';
import { Segmentado } from '@/components/fin/Segmentado';
import { Money } from '@/components/fin/Money';
import { useCotacoes, type PainelDeCambioTela } from '@/components/fin/useCotacoes';
import { useMoedas } from '@/components/fin/useMoedas';
import { CadastroDeMoedas } from './CadastroDeMoedas';
import { cn } from '@/lib/utils';
import {
  MOEDAS_ESTRANGEIRAS, NOMES_DAS_FONTES, SERIES_SGS, equivalenteMensalPct, fonteEmPausa, formatarCambio, formatarNaMoeda,
  idadeEmMinutos, infoDaMoeda, mesPorExtenso, reajusteDosUltimos12Meses, rotuloDaVariacao, situacaoDaCotacao, sugestoesPara,
  textoDaIdade, ultimoDoIndice,
  type CodigoMoeda, type Cotacao, type EstadoDaFonte, type NomeDaFonte,
} from '@/lib/cambio';

/**
 * Moedas e câmbio (05/11/2026, E6). Só lê o cache que a consulta global de
 * 15 minutos grava; nada aqui chama a fonte. Cada número diz de onde veio e
 * há quanto tempo; fonte fora do ar continua mostrando a última cotação, com
 * a idade, e nunca é trocada por outra.
 */

const CARTAO = 'flex flex-col gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-[var(--fin-s-4)] shadow-[var(--fin-e-card)]';
const TH = 'fin-t-overline px-[var(--fin-s-3)] py-[var(--fin-s-2)] text-left font-medium text-[var(--fin-text-3)]';
const TD = 'px-[var(--fin-s-3)] py-[var(--fin-s-2)] align-top';

const fmtHora = (iso: string) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));
const fmtDia = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

function CelulaDeCotacao({ c, agora, pausada }: { c: Cotacao | null; agora: Date; pausada: boolean }) {
  if (!c) return <span className="fin-t-caption text-[var(--fin-text-3)]">Sem cotação guardada</span>;
  const situacao = situacaoDaCotacao(c, agora);
  const atrasada = situacao === 'atrasada' || pausada;
  return (
    <span className="flex flex-col">
      <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">R$ {formatarCambio(c.venda)}</span>
      <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">compra {formatarCambio(c.compra)}</span>
      <span className={cn('fin-t-caption flex items-center gap-1', atrasada ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text-3)]')}>
        {atrasada ? <Clock3 aria-hidden="true" className="size-3.5" /> : null}
        {c.tipo === 'ptax' ? `fechamento de ${fmtDia(c.referencia)}` : `${fmtHora(c.cotado_em)}, ${textoDaIdade(idadeEmMinutos(c.cotado_em, agora))}`}
        {atrasada ? (c.tipo === 'ptax' ? ', ainda sem a de hoje' : ', atrasada') : ''}
      </span>
    </span>
  );
}

function SituacaoDaFonte({ nome, e, agora }: { nome: NomeDaFonte; e: EstadoDaFonte | undefined; agora: Date }) {
  let tom: 'ok' | 'aviso' | 'parada' = 'ok';
  let texto = 'Aguardando a primeira consulta.';
  if (e?.sem_chave && nome === 'awesomeapi') {
    tom = 'parada';
    texto = 'Ainda não ligada pela equipe do EnturOS. Até lá, use a PTAX ou digite o câmbio.';
  } else if (e && fonteEmPausa(e, agora)) {
    tom = 'aviso';
    texto = `Fora do ar desde ${e.ultima_tentativa ? fmtHora(e.ultima_tentativa) : 'a última tentativa'}. As telas mostram a última cotação guardada, com a idade. Nova tentativa ${e.aberto_ate ? `às ${fmtHora(e.aberto_ate).slice(-5)}` : 'em breve'}.`;
  } else if (e && e.falhas_seguidas > 0) {
    tom = 'aviso';
    texto = `A última consulta falhou (${e.falhas_seguidas} seguida${e.falhas_seguidas > 1 ? 's' : ''}). Mostrando a última cotação guardada.`;
  } else if (e?.ultimo_sucesso) {
    texto = `Funcionando. Última consulta ${textoDaIdade(idadeEmMinutos(e.ultimo_sucesso, agora))}.`;
  }
  const Icone = tom === 'ok' ? CheckCircle2 : tom === 'aviso' ? AlertTriangle : CircleSlash;
  return (
    <li className="flex items-start gap-[var(--fin-s-2)] py-[var(--fin-s-2)]">
      <Icone
        aria-hidden="true"
        className={cn('mt-0.5 size-4 shrink-0', tom === 'ok' ? 'text-[var(--fin-positive)]' : tom === 'aviso' ? 'text-[var(--fin-warning)]' : 'text-[var(--fin-text-3)]')}
      />
      <span className="flex min-w-0 flex-col">
        <span className="fin-t-body-strong text-[var(--fin-text)]">{NOMES_DAS_FONTES[nome]}</span>
        <span className="fin-t-caption text-[var(--fin-text-2)]">{texto}</span>
      </span>
    </li>
  );
}

function Indices({ painel }: { painel: PainelDeCambioTela }) {
  const s = painel.indices;
  const meta = ultimoDoIndice(s, 'selic_meta');
  const selicMes = ultimoDoIndice(s, 'selic_mes', true);
  const ipca12 = reajusteDosUltimos12Meses(s, 'ipca');
  const igpm12 = reajusteDosUltimos12Meses(s, 'igpm');
  const ipcaMes = ultimoDoIndice(s, 'ipca', true);
  const igpmMes = ultimoDoIndice(s, 'igpm', true);
  const linhas = [
    meta && { nome: SERIES_SGS.selic_meta.nome, valor: `${pct(meta.valor)} ao ano`, nota: `≈ ${pct(equivalenteMensalPct(meta.valor))} ao mês · vigente em ${fmtDia(meta.referencia)}` },
    selicMes && { nome: SERIES_SGS.selic_mes.nome, valor: `${pct(selicMes.valor)} no mês`, nota: mesPorExtenso(selicMes.referencia) },
    ipcaMes && { nome: 'IPCA', valor: ipca12 ? `${pct(ipca12.percentual)} em 12 meses` : `${pct(ipcaMes.valor)} no mês`, nota: `${pct(ipcaMes.valor)} em ${mesPorExtenso(ipcaMes.referencia)}` },
    igpmMes && { nome: 'IGP-M', valor: igpm12 ? `${pct(igpm12.percentual)} em 12 meses` : `${pct(igpmMes.valor)} no mês`, nota: `${pct(igpmMes.valor)} em ${mesPorExtenso(igpmMes.referencia)}` },
  ].filter(Boolean) as Array<{ nome: string; valor: string; nota: string }>;
  if (!linhas.length) return <p className="fin-t-body text-[var(--fin-text-3)]">Os índices aparecem depois da primeira consulta ao Banco Central.</p>;
  return (
    <dl className="flex flex-col divide-y divide-[var(--fin-border)]">
      {linhas.map(l => (
        <div key={l.nome} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-[var(--fin-s-2)]">
          <dt className="fin-t-body text-[var(--fin-text-2)]">{l.nome}</dt>
          <dd className="flex flex-col items-end">
            <span className="fin-t-body-strong tabular-nums text-[var(--fin-text)]">{l.valor}</span>
            <span className="fin-t-caption text-[var(--fin-text-3)]">{l.nota}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

type LinhaDeVariacao = { titulo_tabela: string; titulo_id: string; data: string; moeda: string; valor_moeda: number; cambio_lancado: number; cambio_pago: number; resultado: number; estorno: boolean };

export default function MoedasECambioPage() {
  const { painel, estado, recarregar } = useCotacoes();
  // Catálogo da agência (E7, frente D): as moedas dela entram nas cotações
  // quando a PTAX as publica.
  const { moedas } = useMoedas();
  const [lido, setLido] = useState<{ moeda: CodigoMoeda; lista: Cotacao[] } | null>(null);
  const [moedaHist, setMoedaHist] = useState<CodigoMoeda>('USD');
  const [variacoes, setVariacoes] = useState<LinhaDeVariacao[] | null>(null);
  // Carimbo honesto: o horário em que o painel chegou (não o do relógio da tela).
  const atualizadoEm = useMemo(() => (painel ? new Date(painel.agora) : null), [painel]);
  // Trocar de moeda mostra "carregando" até a resposta daquela moeda chegar.
  const historico = lido && lido.moeda === moedaHist ? lido.lista : null;

  useEffect(() => {
    let vivo = true;
    fetch(`/api/cambio?historico=1&moeda=${moedaHist}&por_moeda=12`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((p: PainelDeCambioTela | null) => { if (vivo) setLido({ moeda: moedaHist, lista: p?.historico ?? [] }); })
      .catch(() => { if (vivo) setLido({ moeda: moedaHist, lista: [] }); });
    return () => { vivo = false; };
  }, [moedaHist, atualizadoEm]);

  useEffect(() => {
    fetch('/api/encargos-da-liquidacao')
      .then(r => (r.ok ? r.json() : null))
      .then((x: { variacoes?: LinhaDeVariacao[] } | null) => setVariacoes(Array.isArray(x?.variacoes) ? x!.variacoes! : []))
      .catch(() => setVariacoes([]));
  }, []);

  const agora = painel ? new Date(painel.agora) : new Date();
  const fontes = new Map((painel?.fontes ?? []).map(f => [f.fonte, f]));
  const turismoPausado = fonteEmPausa(fontes.get('awesomeapi'), agora);
  const ptaxPausada = fonteEmPausa(fontes.get('bcb_ptax'), agora);

  const moedasComDado = useMemo(() => {
    const comCotacao = new Set((painel?.cotacoes ?? []).map(c => c.moeda));
    const daAgencia = moedas.filter(m => m.da_agencia && m.ptax).map(m => m.codigo);
    return [...MOEDAS_ESTRANGEIRAS, ...daAgencia].filter(m => m === 'USD' || m === 'EUR' || comCotacao.has(m));
  }, [painel, moedas]);

  const doMes = useMemo(() => {
    const mes = new Date().toISOString().slice(0, 7);
    const lista = (variacoes ?? []).filter(v => v.data.slice(0, 7) === mes);
    const ganhos = lista.filter(v => v.resultado > 0).reduce((a, v) => a + v.resultado, 0);
    const perdas = lista.filter(v => v.resultado < 0).reduce((a, v) => a + v.resultado, 0);
    return { ganhos: Math.round(ganhos * 100) / 100, perdas: Math.round(perdas * 100) / 100 };
  }, [variacoes]);

  return (
    <MolduraDaPagina>
      <PageHeader
        icone={Coins}
        titulo="Moedas e câmbio"
        subtitulo="Cotações do câmbio turismo e da PTAX, atualizadas a cada 15 minutos. São sugestões: em todo lançamento o câmbio continua editável."
        atualizadoEm={atualizadoEm}
        onRecarregar={async () => recarregar()}
      />

      <DataState
        estado={estado === 'carregando' && !painel ? 'carregando' : estado === 'erro' && !painel ? 'erro' : 'ok'}
        erro={{ mensagem: 'As cotações não puderam ser lidas agora. Nada foi alterado.', onTentarDeNovo: recarregar }}
        esqueleto={
          <div className="grid grid-cols-1 gap-[var(--fin-s-4)] lg:grid-cols-3">
            {[0, 1].map(i => (
              <div key={i} className={cn(CARTAO, i === 0 && 'lg:col-span-2')}>
                <span className="block h-4 w-40 rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
                {[0, 1, 2].map(j => <span key={j} className="block h-10 w-full rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />)}
              </div>
            ))}
          </div>
        }
      >
        {painel ? (
          <div className="flex flex-col gap-[var(--fin-s-5)]">
            <div className="grid grid-cols-1 gap-[var(--fin-s-4)] lg:grid-cols-3">
              <section aria-labelledby="titulo-cotacoes" className={cn(CARTAO, 'lg:col-span-2')}>
                <div className="flex flex-col gap-1">
                  <h2 id="titulo-cotacoes" className="fin-t-subhead text-[var(--fin-text)]">Cotações agora</h2>
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    Em reais por 1 unidade da moeda. O valor grande é a venda (o que se paga para comprar a moeda).
                  </p>
                </div>
                <div className="-mx-[var(--fin-s-4)] overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--fin-border)]">
                        <th scope="col" className={cn(TH, 'pl-[var(--fin-s-4)]')}>Moeda</th>
                        <th scope="col" className={TH}>Turismo</th>
                        <th scope="col" className={cn(TH, 'pr-[var(--fin-s-4)]')}>PTAX (Banco Central)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--fin-border)]">
                      {moedasComDado.map(m => {
                        const s = sugestoesPara(m, painel.cotacoes);
                        const info = infoDaMoeda(m);
                        return (
                          <tr key={m}>
                            <th scope="row" className={cn(TD, 'pl-[var(--fin-s-4)] text-left')}>
                              <span className="flex flex-col">
                                <span className="fin-t-body-strong text-[var(--fin-text)]">{m}</span>
                                <span className="fin-t-caption font-normal text-[var(--fin-text-3)]">{info.nome}</span>
                              </span>
                            </th>
                            <td className={TD}>
                              {info.turismo
                                ? <CelulaDeCotacao c={s.turismo} agora={agora} pausada={turismoPausado} />
                                : <span className="fin-t-caption text-[var(--fin-text-3)]">Sem câmbio turismo para esta moeda</span>}
                            </td>
                            <td className={cn(TD, 'pr-[var(--fin-s-4)]')}>
                              <CelulaDeCotacao c={s.ptax} agora={agora} pausada={ptaxPausada} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="flex flex-col gap-[var(--fin-s-4)]">
                <section aria-labelledby="titulo-fontes" className={CARTAO}>
                  <h2 id="titulo-fontes" className="fin-t-subhead text-[var(--fin-text)]">De onde vêm</h2>
                  <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
                    {(['awesomeapi', 'bcb_ptax', 'bcb_sgs'] as NomeDaFonte[]).map(n => (
                      <SituacaoDaFonte key={n} nome={n} e={fontes.get(n)} agora={agora} />
                    ))}
                  </ul>
                  <p className="fin-t-caption text-[var(--fin-text-3)]">
                    Uma fonte que falha não é trocada por outra: ela some das sugestões até voltar, e o que já foi lançado guarda a fonte e o horário usados.
                  </p>
                </section>

                <section aria-labelledby="titulo-indices" className={CARTAO}>
                  <div className="flex flex-col gap-1">
                    <h2 id="titulo-indices" className="fin-t-subhead text-[var(--fin-text)]">Índices</h2>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">Do Banco Central. Aparecem como opção no reajuste das contas que se repetem e nos juros.</p>
                  </div>
                  <Indices painel={painel} />
                </section>
              </div>
            </div>

            <CadastroDeMoedas />

            <section aria-labelledby="titulo-historico" className={CARTAO}>
              <div className="flex flex-col gap-[var(--fin-s-3)] sm:flex-row sm:items-center sm:justify-between">
                <h2 id="titulo-historico" className="fin-t-subhead text-[var(--fin-text)]">Histórico recente</h2>
                <Segmentado
                  rotulo="Moeda do histórico"
                  opcoes={moedasComDado.map(m => ({ valor: m, rotulo: m }))}
                  valor={moedaHist}
                  onChange={setMoedaHist}
                />
              </div>
              {historico === null ? (
                <p className="fin-t-body text-[var(--fin-text-3)]">Carregando o histórico…</p>
              ) : historico.length === 0 ? (
                <p className="fin-t-body text-[var(--fin-text-3)]">Ainda não há cotações guardadas de {moedaHist}.</p>
              ) : (
                <div className="grid grid-cols-1 gap-[var(--fin-s-4)] md:grid-cols-2">
                  {(['turismo', 'ptax'] as const).map(tipo => {
                    const lista = historico.filter(h => h.tipo === tipo);
                    return (
                      <div key={tipo} className="flex flex-col gap-[var(--fin-s-2)]">
                        <h3 className="fin-t-body-strong text-[var(--fin-text-2)]">{tipo === 'turismo' ? 'Turismo' : 'PTAX (fechamento do dia)'}</h3>
                        {lista.length === 0 ? (
                          <p className="fin-t-caption text-[var(--fin-text-3)]">{tipo === 'turismo' && !infoDaMoeda(moedaHist).turismo ? 'Sem câmbio turismo para esta moeda.' : 'Nada guardado ainda.'}</p>
                        ) : (
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="border-b border-[var(--fin-border)]">
                                <th scope="col" className={cn(TH, 'pl-0')}>{tipo === 'ptax' ? 'Dia' : 'Horário'}</th>
                                <th scope="col" className={cn(TH, 'text-right')}>Compra</th>
                                <th scope="col" className={cn(TH, 'pr-0 text-right')}>Venda</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--fin-border)]">
                              {lista.map((h, i) => {
                                const anterior = lista[i + 1];
                                const subiu = anterior ? h.venda > anterior.venda : null;
                                return (
                                  <tr key={`${h.cotado_em}-${i}`}>
                                    <td className={cn(TD, 'fin-t-body pl-0 tabular-nums text-[var(--fin-text-2)]')}>{tipo === 'ptax' ? fmtDia(h.referencia) : fmtHora(h.cotado_em)}</td>
                                    <td className={cn(TD, 'fin-t-body text-right tabular-nums text-[var(--fin-text-2)]')}>{formatarCambio(h.compra)}</td>
                                    <td className={cn(TD, 'fin-t-body-strong pr-0 text-right tabular-nums text-[var(--fin-text)]')}>
                                      {formatarCambio(h.venda)}
                                      {subiu === null || anterior.venda === h.venda ? null : (
                                        <span className="sr-only">{subiu ? ' (subiu)' : ' (caiu)'}</span>
                                      )}
                                      {subiu === null || anterior.venda === h.venda ? null : (
                                        subiu
                                          ? <ArrowUp aria-hidden="true" className="ml-1 inline size-3.5 align-[-2px] text-[var(--fin-negative-text)]" />
                                          : <ArrowDown aria-hidden="true" className="ml-1 inline size-3.5 align-[-2px] text-[var(--fin-positive)]" />
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {variacoes && variacoes.length > 0 ? (
              <section aria-labelledby="titulo-variacoes" className={CARTAO}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <h2 id="titulo-variacoes" className="fin-t-subhead text-[var(--fin-text)]">Variação cambial nas liquidações</h2>
                    <p className="fin-t-caption text-[var(--fin-text-3)]">
                      Quando uma conta em moeda é paga ou recebida com câmbio diferente do lançado. Entra no resultado numa linha própria; o valor lançado não muda.
                    </p>
                  </div>
                  <p className="fin-t-caption flex gap-3 text-[var(--fin-text-2)]">
                    <span>Ganhos no mês <Money valor={doMes.ganhos} size="caption" estado="ok" tone="positivo" className="min-w-0" /></span>
                    <span>Perdas no mês <Money valor={doMes.perdas} size="caption" estado="ok" tone={doMes.perdas < 0 ? 'negativo' : 'neutro'} className="min-w-0" /></span>
                  </p>
                </div>
                <div className="-mx-[var(--fin-s-4)] overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--fin-border)]">
                        <th scope="col" className={cn(TH, 'pl-[var(--fin-s-4)]')}>Data</th>
                        <th scope="col" className={TH}>Conta</th>
                        <th scope="col" className={cn(TH, 'text-right')}>Na moeda</th>
                        <th scope="col" className={cn(TH, 'text-right')}>Câmbio lançado → pago</th>
                        <th scope="col" className={cn(TH, 'pr-[var(--fin-s-4)] text-right')}>Efeito</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--fin-border)]">
                      {[...variacoes].reverse().slice(0, 15).map((v, i) => (
                        <tr key={`${v.titulo_id}-${i}`}>
                          <td className={cn(TD, 'fin-t-body pl-[var(--fin-s-4)] tabular-nums text-[var(--fin-text-2)]')}>{fmtDia(v.data)}</td>
                          <td className={cn(TD, 'fin-t-body text-[var(--fin-text)]')}>
                            {v.titulo_tabela === 'contas_pagar' ? 'A pagar' : 'A receber'}
                            {v.estorno ? <span className="fin-t-caption text-[var(--fin-text-3)]"> · estorno</span> : null}
                          </td>
                          <td className={cn(TD, 'fin-t-body text-right tabular-nums text-[var(--fin-text-2)]')}>{formatarNaMoeda(v.valor_moeda, v.moeda)}</td>
                          <td className={cn(TD, 'fin-t-body text-right tabular-nums text-[var(--fin-text-2)]')}>{formatarCambio(v.cambio_lancado)} → {formatarCambio(v.cambio_pago)}</td>
                          <td className={cn(TD, 'pr-[var(--fin-s-4)] text-right')}>
                            <span className="flex flex-col items-end">
                              <Money valor={v.resultado} size="strong" estado="ok" sinal="sempre" tone={v.resultado > 0 ? 'positivo' : v.resultado < 0 ? 'negativo' : 'neutro'} className="min-w-0" />
                              <span className="fin-t-caption text-[var(--fin-text-3)]">{rotuloDaVariacao(v.resultado)}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </DataState>
    </MolduraDaPagina>
  );
}
