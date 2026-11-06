'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, FileStack, Layers, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterBar } from '@/components/fin/FilterBar';
import { FinTable, type FinColuna } from '@/components/fin/FinTable';
import { MetricCard } from '@/components/fin/MetricCard';
import { MolduraDaPagina } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { RecordSheet } from '@/components/fin/RecordSheet';
import type { PeriodoChave } from '@/components/fin/PeriodPicker';
import { Field } from '@/components/fin/Field';
import { usePermissoes } from '@/app/financeiro-ag/contas/useContas';
import {
  apiFaturas, ErroDaFatura, type AjusteDaFatura, type ItemAFaturar, type RespostaDaLista, type ResumoDaFatura,
} from '@/components/financeiro/faturas/api';
import { MOTIVO_DO_ITEM, dataBR, hojeBR, periodoBR, reais, somarDias } from '@/components/financeiro/faturas/comum';
import { Abas, Aviso, LINK, SECAO, TituloDaSecao } from '@/components/financeiro/faturas/pecas';
import { ROTULO_COBRANCA_CURTO } from '@/components/financeiro/faturas/rotulos';
import { deCentavos } from '@/lib/money';
import { toast } from '@/lib/toast';

/**
 * Faturas ao cliente (E5, parte B): a fatura corporativa junta, por pagante,
 * os itens da forma "Faturar" conforme a Regra de faturamento dele. A lista
 * trabalha como as outras do financeiro: período, situação, busca, Esc limpa,
 * totais do filtro e duplo clique abre a ficha. A aba "Itens a faturar" mostra
 * o que ainda não está em fatura e por quê, e fatura à parte quando preciso.
 */

const PERIODOS: PeriodoChave[] = ['TUDO', 'MES_ATUAL', 'PROX_30', 'MES_PASSADO', 'PERSONALIZADO'];
const SITUACOES = [
  { valor: 'em_aberto', rotulo: 'Em aberto' },
  { valor: '', rotulo: 'Todas (menos canceladas)' },
  { valor: 'ABERTA', rotulo: 'Aberta' },
  { valor: 'FECHADA', rotulo: 'Fechada' },
  { valor: 'EM_ATRASO', rotulo: 'Em atraso' },
  { valor: 'PARCIAL', rotulo: 'Paga em parte' },
  { valor: 'PAGA', rotulo: 'Paga' },
  { valor: 'CANCELADA', rotulo: 'Cancelada' },
];
const CAMPOS = [
  { valor: 'vencimento', rotulo: 'Vencimento' },
  { valor: 'emissao', rotulo: 'Emissão' },
];

type Aba = 'faturas' | 'a_faturar';
type Filtros = { periodo: PeriodoChave; de: string; ate: string; campo: 'vencimento' | 'emissao'; situacao: string; busca: string };
const padrao = (): Filtros => ({ periodo: 'TUDO', de: '', ate: '', campo: 'vencimento', situacao: 'em_aberto', busca: '' });

function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = React.useState(valor);
  React.useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

export function TelaDeFaturas() {
  const router = useRouter();
  const pode = usePermissoes();
  const moldura = React.useRef<HTMLDivElement>(null);
  const [aba, setAba] = React.useState<Aba>('faturas');
  const [f, setF] = React.useState<Filtros>(padrao);
  const [dados, setDados] = React.useState<RespostaDaLista | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [recebida, setRecebida] = React.useState<string | null>(null);
  const [atualizadoEm, setAtualizadoEm] = React.useState<Date | null>(null);
  const [versao, setVersao] = React.useState(0);
  const [montando, setMontando] = React.useState(false);
  const [montagem, setMontagem] = React.useState<{ entraram: number; faturas: number; sem_regra: number } | null>(null);
  const [soltos, setSoltos] = React.useState<{ itens: ItemAFaturar[]; notas: AjusteDaFatura[] } | null>(null);
  const [erroSoltos, setErroSoltos] = React.useState<string | null>(null);

  const busca = useDebounce(f.busca.trim());
  const datasValidas = !f.de || !f.ate || f.de <= f.ate;
  const podeEditar = pode('editar_financeiro');

  // Carregando = a última resposta ainda não é a do filtro atual.
  const pedido = JSON.stringify([f.de, f.ate, f.campo, f.situacao, busca, versao]);
  const carregando = recebida !== pedido;
  React.useEffect(() => {
    if (!datasValidas) return;
    const ac = new AbortController();
    apiFaturas.listar({ de: f.de || undefined, ate: f.ate || undefined, campo_data: f.campo, situacao: f.situacao as never, busca: busca || undefined }, ac.signal)
      .then(r => { setDados(r); setErro(null); setAtualizadoEm(new Date()); })
      .catch(e => { if (!ac.signal.aborted) setErro(e instanceof ErroDaFatura ? e.message : 'A consulta não respondeu.'); })
      .finally(() => { if (!ac.signal.aborted) setRecebida(pedido); });
    return () => ac.abort();
  }, [f.de, f.ate, f.campo, f.situacao, busca, datasValidas, versao, pedido]);

  React.useEffect(() => {
    const ac = new AbortController();
    apiFaturas.aFaturar(ac.signal)
      .then(r => { setSoltos(r); setErroSoltos(null); })
      .catch(e => { if (!ac.signal.aborted) setErroSoltos(e instanceof ErroDaFatura ? e.message : 'A consulta não respondeu.'); });
    return () => ac.abort();
  }, [versao]);

  const recarregar = React.useCallback(async () => { setVersao(v => v + 1); }, []);
  const p = padrao();
  const ativos = (f.periodo !== p.periodo ? 1 : 0) + (f.campo !== p.campo ? 1 : 0) + (f.situacao !== p.situacao ? 1 : 0) + (f.busca ? 1 : 0);
  const limpar = React.useCallback(() => setF(padrao()), []);
  const mudar = (patch: Partial<Filtros>) => setF(atual => ({ ...atual, ...patch }));

  function teclado(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || aba !== 'faturas') return;
    if (!moldura.current?.contains(e.target as Node)) return;
    if (ativos > 0) { e.preventDefault(); limpar(); }
  }

  async function montar() {
    setMontando(true);
    try {
      const r = await apiFaturas.alocar();
      setMontagem({ entraram: r.alocados.length, faturas: r.faturas.length, sem_regra: r.sem_regra.length });
      if (r.alocados.length) toast.success(`${r.alocados.length} ${r.alocados.length === 1 ? 'item entrou' : 'itens entraram'} em ${r.faturas.length} ${r.faturas.length === 1 ? 'fatura' : 'faturas'}.`);
      await recarregar();
    } catch (e) {
      toast.error('As faturas não foram montadas', e instanceof Error ? e.message : undefined);
    } finally {
      setMontando(false);
    }
  }

  const abrir = React.useCallback((r: ResumoDaFatura) => router.push(`/financeiro-ag/faturas/${encodeURIComponent(r.id)}`), [router]);

  const colunas: FinColuna<ResumoDaFatura>[] = [
    {
      id: 'numero', cabecalho: 'Nº', tipo: 'texto', sortable: true, acessor: r => r.numero, minWidth: 64,
      render: r => <span className="tabular-nums fin-t-body-strong text-[var(--fin-text)]">{r.numero}</span>,
    },
    {
      id: 'cliente', cabecalho: 'Cliente', tipo: 'texto', sortable: true, minWidth: 200, acessor: r => r.pessoa_nome.toLowerCase(),
      render: r => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate fin-t-body-strong text-[var(--fin-text)]" title={r.pessoa_nome}>{r.pessoa_nome || 'Cliente'}</span>
          {r.avulsa || r.complementar_de || r.descricao ? (
            <span className="max-w-[40ch] truncate fin-t-caption text-[var(--fin-text-3)]">
              {[r.avulsa ? 'Avulsa' : '', r.complementar_de ? 'Complementar' : '', r.descricao].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'periodo', cabecalho: 'Período', tipo: 'texto', prioridade: 2, minWidth: 140,
      render: r => <span className="tabular-nums text-[var(--fin-text-2)]">{periodoBR(r.periodo_inicio, r.periodo_fim)}</span>,
    },
    { id: 'vencimento', cabecalho: 'Vencimento', tipo: 'data', sortable: true, valor: r => r.vencimento || null },
    {
      id: 'itens', cabecalho: 'Itens', tipo: 'texto', prioridade: 1, acessor: r => r.quantidade_itens,
      render: r => <span className="tabular-nums text-[var(--fin-text-2)]">{r.quantidade_itens}</span>,
    },
    {
      id: 'total', cabecalho: 'Total', tipo: 'dinheiro', sortable: true, valor: r => deCentavos(r.total_centavos),
      tone: r => (r.situacao_visivel === 'PAGA' ? 'positivo' : r.situacao_visivel === 'EM_ATRASO' ? 'negativo' : 'neutro'),
      sub: r => (r.situacao_visivel === 'PARCIAL' ? `entrou ${reais(r.recebido_centavos)}` : r.invalida ? 'Notas passam dos itens' : null),
    },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'status', sortable: true, valor: r => r.situacao_visivel, dominio: 'fatura' },
    { id: 'conferencia', cabecalho: 'Conferência do cliente', tipo: 'status', prioridade: 2, valor: r => r.conferencia, dominio: 'conferencia_fatura' },
    {
      id: 'cobranca', cabecalho: 'Cobrança', tipo: 'texto', prioridade: 1, minWidth: 120,
      render: r => <span className="fin-t-caption text-[var(--fin-text-2)]">{r.cobranca ? ROTULO_COBRANCA_CURTO[r.cobranca.status] ?? r.cobranca.status : 'Não emitida'}</span>,
    },
  ];

  const linhas = dados?.faturas ?? [];
  const t = dados?.totais;
  const estado: 'carregando' | 'erro' | 'ok' = !dados && carregando ? 'carregando' : !dados && erro ? 'erro' : 'ok';
  const numeros = dados ? 'ok' : carregando ? 'carregando' : 'indisponivel';
  const emAtraso = linhas.filter(l => l.situacao_visivel === 'EM_ATRASO');
  const abertas = linhas.filter(l => l.situacao_visivel === 'ABERTA');

  return (
    <MolduraDaPagina>
      <div ref={moldura} onKeyDown={teclado} className="flex flex-col gap-[var(--fin-s-5)]">
        <PageHeader
          icone={FileStack}
          titulo="Faturas"
          subtitulo="Cada cliente faturado recebe uma fatura por período, montada pela regra de faturamento dele. Feche, mande conferir no portal e cobre com boleto e Pix."
          atualizadoEm={atualizadoEm}
          onRecarregar={recarregar}
          acaoPrimaria={podeEditar ? { rotulo: montando ? 'Montando…' : 'Montar faturas agora', icone: Layers, onClick: () => { if (!montando) void montar(); } } : undefined}
          acoesSecundarias={[{ rotulo: 'Regras de faturamento', href: '/financeiro-ag/regras-faturamento' }]}
        />

        {montagem ? (
          <Aviso tom={montagem.sem_regra ? 'aviso' : 'positivo'}>
            {montagem.entraram
              ? `${montagem.entraram} ${montagem.entraram === 1 ? 'item entrou' : 'itens entraram'} em ${montagem.faturas} ${montagem.faturas === 1 ? 'fatura' : 'faturas'}.`
              : 'Nenhum item novo para juntar: as faturas já estavam em dia.'}
            {montagem.sem_regra ? (
              <> {montagem.sem_regra} {montagem.sem_regra === 1 ? 'item ficou de fora porque o pagante não tem' : 'itens ficaram de fora porque o pagante não tem'} regra de faturamento.{' '}
                <Link href="/financeiro-ag/regras-faturamento" className={LINK}>Criar regra</Link> ou{' '}
                <button type="button" className={LINK} onClick={() => setAba('a_faturar')}>ver os itens</button>.
              </>
            ) : null}
          </Aviso>
        ) : null}

        <div className="grid grid-cols-1 gap-[var(--fin-s-3)] sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard rotulo="Em aberto" icone={Wallet} valor={t ? deCentavos(t.em_aberto_centavos) : null} estado={numeros}
            contexto={t ? `${t.quantidade} ${t.quantidade === 1 ? 'fatura no filtro' : 'faturas no filtro'}, descontado o que já entrou.` : 'O que falta receber das faturas do filtro.'} />
          <MetricCard rotulo="Em atraso" icone={AlertTriangle} tone="negativo" tomDoIcone="negativo" estado={numeros}
            valor={dados ? deCentavos(emAtraso.reduce((a, l) => a + l.total_centavos - Math.min(l.recebido_centavos, l.total_centavos), 0)) : null}
            contexto={`${emAtraso.length} ${emAtraso.length === 1 ? 'fatura fechada passou' : 'faturas fechadas passaram'} do vencimento.`} />
          <MetricCard rotulo="Ainda abertas" icone={Layers} formato="contagem" estado={numeros} valor={dados ? abertas.length : null}
            contexto="Recebem itens novos até alguém fechar. Só a fatura fechada vai para o cliente." />
          <MetricCard rotulo="Itens a faturar" icone={CheckCircle2} formato="contagem" tomDoIcone="aviso" estado={soltos ? 'ok' : erroSoltos ? 'indisponivel' : 'carregando'}
            valor={soltos ? soltos.itens.length : null} onClick={() => setAba('a_faturar')}
            contexto={soltos ? `${reais(soltos.itens.reduce((a, i) => a + i.valor_centavos, 0))} da forma Faturar fora de fatura.` : 'Contas da forma Faturar ainda fora de fatura.'} />
        </div>

        <Abas<Aba>
          rotulo="Faturas e itens a faturar" idBase="faturas" valor={aba} onChange={setAba}
          abas={[{ id: 'faturas', rotulo: 'Faturas', contagem: dados ? linhas.length : undefined }, { id: 'a_faturar', rotulo: 'Itens a faturar', contagem: soltos?.itens.length }]}
        />

        <div id="faturas-painel" role="tabpanel" aria-labelledby={`faturas-aba-${aba}`} className="flex flex-col gap-[var(--fin-s-4)]">
          {aba === 'faturas' ? (
            <>
              <FilterBar
                busca={{ valor: f.busca, onChange: v => mudar({ busca: v }), placeholder: 'Pesquisar cliente, número, venda, passageiro ou localizador…' }}
                periodo={{ valor: f.periodo, de: f.de, ate: f.ate, opcoes: PERIODOS, onChange: (chave, range) => mudar({ periodo: chave, de: range.de, ate: range.ate }) }}
                selects={[
                  { id: 'fat-campo', rotulo: 'Data de', valor: f.campo, onChange: v => mudar({ campo: v === 'emissao' ? 'emissao' : 'vencimento' }), opcoes: CAMPOS },
                  { id: 'fat-situacao', rotulo: 'Situação', valor: f.situacao || 'todas', onChange: v => mudar({ situacao: v === 'todas' ? '' : v }), opcoes: SITUACOES.map(s => ({ ...s, valor: s.valor || 'todas' })) },
                ]}
                resumo={{ exibidos: linhas.length, total: linhas.length, substantivo: linhas.length === 1 ? 'fatura' : 'faturas', soma: t ? deCentavos(t.total_centavos) : undefined }}
                ativos={ativos}
                onLimpar={limpar}
              />
              {!datasValidas ? <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">A data inicial precisa ser igual ou anterior à final.</p> : null}
              <FinTable<ResumoDaFatura>
                linhas={linhas}
                colunas={colunas}
                chave={r => r.id}
                densidade="compacta"
                estado={estado}
                erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void recarregar(); } } : null}
                vazio={ativos > 0
                  ? { motivo: 'sem-resultado', titulo: 'Nenhuma fatura neste filtro', oQueE: 'As faturas continuam guardadas; o recorte atual é que não encontrou nenhuma.', acaoSecundaria: { rotulo: 'Limpar filtros', onClick: limpar } }
                  : {
                    motivo: 'sem-dado', titulo: 'Nenhuma fatura em aberto',
                    oQueE: 'A fatura junta, por cliente, as vendas pagas na forma "Faturar", conforme a regra de faturamento de cada um.',
                    comoComeca: [
                      'Crie a regra do cliente em Regras de faturamento (mensal, quinzenal, semanal IATA...).',
                      'Na venda, use a forma de pagamento "Faturar". O item entra sozinho na fatura do período.',
                      'Feche a fatura, mande o cliente conferir no portal e cobre com boleto e Pix.',
                    ],
                    acao: { rotulo: 'Criar regra de faturamento', href: '/financeiro-ag/regras-faturamento' },
                  }}
                totais={linhas.length && t ? [{ colunaId: 'total', valor: deCentavos(t.total_centavos), rotulo: 'Total no filtro' }] : undefined}
                onLinhaDuploClique={abrir}
              />
            </>
          ) : (
            <ItensAFaturar soltos={soltos} erro={erroSoltos} podeEditar={podeEditar} onMudou={recarregar} onAbrir={id => router.push(`/financeiro-ag/faturas/${encodeURIComponent(id)}`)} />
          )}
        </div>
      </div>
    </MolduraDaPagina>
  );
}

function ItensAFaturar({ soltos, erro, podeEditar, onMudou, onAbrir }: {
  soltos: { itens: ItemAFaturar[]; notas: AjusteDaFatura[] } | null;
  erro: string | null;
  podeEditar: boolean;
  onMudou: () => Promise<void>;
  onAbrir: (faturaId: string) => void;
}) {
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set());
  const [avulsa, setAvulsa] = React.useState<{ tipo: 'itens' } | { tipo: 'notas'; pessoa_id: string; pessoa_nome: string } | null>(null);
  const [vencimento, setVencimento] = React.useState(somarDias(hojeBR(), 7));
  const [gravando, setGravando] = React.useState(false);
  const itens = soltos?.itens ?? [];
  const escolhidos = itens.filter(i => marcados.has(i.conta_id));
  const pagantes = new Set(escolhidos.map(i => i.pessoa_id));
  const problemaDaSelecao = pagantes.size > 1 ? 'Escolha itens de um mesmo pagante.' : escolhidos.some(i => i.motivo === 'COBRANCA_EMITIDA') ? 'Item com boleto já emitido não entra: cancele a cobrança antes.' : null;

  const notasPorPessoa = React.useMemo(() => {
    const m = new Map<string, { nome: string; notas: AjusteDaFatura[] }>();
    for (const n of soltos?.notas ?? []) {
      if (!m.has(n.pessoa_id)) m.set(n.pessoa_id, { nome: n.pessoa_nome, notas: [] });
      m.get(n.pessoa_id)!.notas.push(n);
    }
    return [...m.entries()];
  }, [soltos]);

  async function faturar() {
    if (!avulsa) return;
    setGravando(true);
    try {
      const ficha = avulsa.tipo === 'itens'
        ? await apiFaturas.avulsaDeItens([...marcados], vencimento)
        : await apiFaturas.avulsaDeNotas(avulsa.pessoa_id, vencimento);
      toast.success(`Fatura Nº ${ficha.fatura.numero} criada`, 'Ela está aberta: confira e feche quando estiver certa.');
      setAvulsa(null);
      setMarcados(new Set());
      await onMudou();
      onAbrir(ficha.fatura.id);
    } catch (e) {
      toast.error('A fatura não foi criada', e instanceof Error ? e.message : undefined);
    } finally {
      setGravando(false);
    }
  }

  const colunas: FinColuna<ItemAFaturar>[] = [
    {
      id: 'pagante', cabecalho: 'Pagante', tipo: 'texto', sortable: true, minWidth: 180, acessor: i => i.pessoa_nome.toLowerCase(),
      render: i => <span className="truncate fin-t-body-strong text-[var(--fin-text)]">{i.pessoa_nome || 'Sem pagante'}</span>,
    },
    {
      id: 'descricao', cabecalho: 'Item', tipo: 'texto', minWidth: 220,
      render: i => (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-[48ch] truncate text-[var(--fin-text)]" title={i.descricao}>{i.descricao}</span>
          {i.venda_id ? <Link href={`/vendas/${encodeURIComponent(i.venda_id)}/ficha`} className={`fin-t-caption ${LINK}`}>Abrir a venda</Link> : null}
        </span>
      ),
    },
    { id: 'vencimento', cabecalho: 'Vencimento', tipo: 'data', sortable: true, valor: i => i.vencimento || null },
    { id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, valor: i => deCentavos(i.valor_centavos) },
    {
      id: 'motivo', cabecalho: 'Por que está fora', tipo: 'texto', minWidth: 220, prioridade: 2,
      render: i => (
        <span className="flex flex-col">
          <span className="fin-t-body-strong text-[var(--fin-text)]">{MOTIVO_DO_ITEM[i.motivo].rotulo}</span>
          <span className="max-w-[52ch] fin-t-caption text-[var(--fin-text-3)]">{MOTIVO_DO_ITEM[i.motivo].frase}</span>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--fin-s-4)]">
      {podeEditar && marcados.size ? (
        <div className="flex flex-col gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-[var(--fin-s-3)] py-[var(--fin-s-2)] sm:flex-row sm:items-center sm:justify-between">
          <p className="fin-t-body text-[var(--fin-text-2)]" aria-live="polite">
            {escolhidos.length} {escolhidos.length === 1 ? 'item escolhido' : 'itens escolhidos'}, {reais(escolhidos.reduce((a, i) => a + i.valor_centavos, 0))}.
            {problemaDaSelecao ? <span className="ml-1 text-[var(--fin-negative-text)]">{problemaDaSelecao}</span> : null}
          </p>
          <div className="flex gap-[var(--fin-s-2)]">
            <Button type="button" variant="ghost" onClick={() => setMarcados(new Set())}>Desmarcar</Button>
            <Button type="button" disabled={Boolean(problemaDaSelecao)} onClick={() => setAvulsa({ tipo: 'itens' })}>Faturar avulso</Button>
          </div>
        </div>
      ) : null}

      <FinTable<ItemAFaturar>
        linhas={itens}
        colunas={colunas}
        chave={i => i.conta_id}
        densidade="compacta"
        estado={!soltos && !erro ? 'carregando' : !soltos && erro ? 'erro' : 'ok'}
        erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void onMudou(); } } : null}
        selecao={podeEditar ? {
          selecionadas: marcados,
          onAlterar: (chaves, marcar) => setMarcados(atual => { const n = new Set(atual); for (const c of chaves) { if (marcar) n.add(c); else n.delete(c); } return n; }),
          rotulo: i => `Escolher ${i.descricao}`,
        } : undefined}
        vazio={{
          motivo: 'sem-dado', titulo: 'Nenhum item fora de fatura',
          oQueE: 'Toda conta da forma "Faturar" já está numa fatura. Quando um pagante não tiver regra, o item aparece aqui para você decidir.',
        }}
        totais={itens.length ? [{ colunaId: 'valor', valor: deCentavos(itens.reduce((a, i) => a + i.valor_centavos, 0)), rotulo: 'Fora de fatura' }] : undefined}
      />

      {notasPorPessoa.length ? (
        <section className={SECAO} aria-labelledby="notas-esperando">
          <TituloDaSecao id="notas-esperando" titulo="Notas esperando a próxima fatura" descricao="Créditos e débitos que entram sozinhos na próxima fatura aberta do cliente. Se não houver fatura a caminho, fature agora." />
          <ul className="flex flex-col divide-y divide-[var(--fin-border)]">
            {notasPorPessoa.map(([pessoa, g]) => {
              const saldo = g.notas.reduce((a, n) => a + (n.tipo === 'DEBITO' ? n.valor_centavos : -n.valor_centavos), 0);
              return (
                <li key={pessoa} className="flex flex-col gap-[var(--fin-s-2)] py-[var(--fin-s-3)] sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="fin-t-body-strong text-[var(--fin-text)]">{g.nome || 'Cliente'}</span>
                    {g.notas.map(n => (
                      <span key={n.id} className="fin-t-caption text-[var(--fin-text-2)]">
                        <span className={n.tipo === 'DEBITO' ? 'text-[var(--fin-text)]' : 'text-[var(--fin-positive)]'}>{n.tipo === 'DEBITO' ? 'Débito' : 'Crédito'} {reais(n.valor_centavos)}</span> · {n.motivo}
                      </span>
                    ))}
                  </div>
                  {podeEditar ? (
                    <Button type="button" variant="outline" disabled={saldo <= 0} title={saldo <= 0 ? 'Só créditos: eles esperam uma fatura com itens para abater.' : undefined}
                      onClick={() => setAvulsa({ tipo: 'notas', pessoa_id: pessoa, pessoa_nome: g.nome })}>
                      Faturar agora
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <RecordSheet
        aberto={avulsa !== null}
        onOpenChange={a => { if (!a) setAvulsa(null); }}
        titulo={avulsa?.tipo === 'notas' ? `Faturar as notas de ${avulsa.pessoa_nome || 'cliente'}` : 'Faturar avulso'}
        descricao={avulsa?.tipo === 'notas'
          ? 'As notas que esperavam viram uma fatura à parte, aberta, para você conferir e fechar.'
          : 'Os itens escolhidos viram uma fatura só deles, aberta, fora da regra do cliente.'}
        resumo={avulsa?.tipo === 'itens' ? `${escolhidos.length} ${escolhidos.length === 1 ? 'item' : 'itens'} · ${reais(escolhidos.reduce((a, i) => a + i.valor_centavos, 0))} · vence ${dataBR(vencimento)}` : `Vence ${dataBR(vencimento)}`}
        acaoPrimaria={{ rotulo: 'Criar fatura', onClick: faturar, carregando: gravando, desabilitado: !vencimento }}
        largura={480}
      >
        <Field rotulo="Vencimento" obrigatorio ajuda="A data em que o cliente paga esta fatura.">
          {a => <Input type="date" {...a} value={vencimento} onChange={e => setVencimento(e.target.value)} />}
        </Field>
      </RecordSheet>
    </div>
  );
}
