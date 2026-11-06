'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Columns3, Download, Info, Landmark, TriangleAlert, X } from 'lucide-react';

import type {
  AgrupamentoDoExtrato, MovimentoCaixa, OrdemDoExtrato, OrigemDoMovimento, TipoDoMovimento,
} from '@/lib/movimentos-caixa';
import type { ContaBancaria } from '@/lib/crm-types';
import { loadEntities } from '@/lib/crm-storage';
import { lerAtalhos } from '@/lib/atalho-da-url';
import { hojeISO } from '@/lib/money';
import { cn, formatBRL } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataState } from '@/components/fin/DataState';
import { EmptyLesson } from '@/components/fin/EmptyLesson';
import { FilterBar } from '@/components/fin/FilterBar';
import { MolduraDaPagina, RITMO_DA_PAGINA } from '@/components/fin/MolduraDaPagina';
import { PageHeader } from '@/components/fin/PageHeader';
import { COLUNAS, GradeDeMovimentos, ROTULO_DA_ORIGEM, type ColunaId } from './GradeDeMovimentos';
import { DetalheDoMovimento } from './DetalheDoMovimento';
import { ATALHOS_DE_PERIODO, atalhoDoIntervalo, dataCurta, intervaloDoAtalho, type AtalhoDePeriodo } from './periodos';
import { exportarMovimentos, useMovimentos } from './useMovimentos';

/**
 * Extrato de conta e Movimentações (05/11/2026): a mesma fonte
 * (/api/movimentos-caixa) e a mesma grade, com leiautes diferentes.
 *  · Extrato: uma ou várias contas, período livre, saldo anterior, saldo
 *    linha a linha e saldo final, em ordem cronológica.
 *  · Movimentações: todas as contas, a mais recente primeiro, com venda,
 *    forma, cheque/cartão e moeda de origem.
 * Filtros, ordem e página andam no servidor; a seleção soma no navegador.
 */

export type Leiaute = 'extrato' | 'movimentacoes';

const CARTAO = 'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e-card)]';
const CAMPO = 'h-11 rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] fin-t-body text-[var(--fin-text)] lg:h-10';
const SELECT = cn(CAMPO, 'border px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]');

const COLUNAS_DO_LEIAUTE: Record<Leiaute, { todas: ColunaId[]; padrao: ColunaId[] }> = {
  extrato: {
    todas: ['data', 'conta', 'numero', 'descricao', 'documento', 'pessoa', 'cpf', 'informacoes', 'forma', 'valor', 'saldo'],
    padrao: ['data', 'conta', 'numero', 'descricao', 'documento', 'pessoa', 'cpf', 'informacoes', 'valor', 'saldo'],
  },
  movimentacoes: {
    todas: ['data', 'numero', 'venda', 'conta', 'forma', 'pessoa', 'documento', 'cartao', 'moeda', 'movimento', 'valor', 'descricao', 'saldo'],
    padrao: ['data', 'numero', 'venda', 'conta', 'forma', 'pessoa', 'documento', 'cartao', 'moeda', 'movimento', 'valor'],
  },
};

const ROTULO_AGRUPAR: Record<AgrupamentoDoExtrato, string> = {
  nenhum: 'Sem grupos', dia: 'Por dia', conta: 'Por conta', pessoa: 'Por pessoa', forma: 'Por forma', origem: 'Por origem',
};

function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = React.useState(valor);
  React.useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

function colunasSalvas(leiaute: Leiaute): ColunaId[] {
  const { todas, padrao } = COLUNAS_DO_LEIAUTE[leiaute];
  if (typeof window === 'undefined') return padrao;
  try {
    const s = JSON.parse(window.localStorage.getItem(`movimentos-colunas-${leiaute}`) ?? 'null');
    if (Array.isArray(s)) {
      const validas = todas.filter(c => s.includes(c));
      if (validas.length) return validas;
    }
  } catch { /* preferência corrompida: volta ao padrão */ }
  return padrao;
}

export function TelaDeMovimentos({ leiaute }: { leiaute: Leiaute }) {
  const hoje = hojeISO();
  const extrato = leiaute === 'extrato';
  const inicial = intervaloDoAtalho('este_mes', hoje)!;

  const [contasBancarias, setContasBancarias] = React.useState<ContaBancaria[]>([]);
  const [contas, setContas] = React.useState<string[]>([]);
  const [de, setDe] = React.useState(inicial.de);
  const [ate, setAte] = React.useState(inicial.ate);
  const [busca, setBusca] = React.useState('');
  const [pessoa, setPessoa] = React.useState('');
  const [tipo, setTipo] = React.useState<TipoDoMovimento | ''>('');
  const [origem, setOrigem] = React.useState<OrigemDoMovimento | ''>('');
  const [forma, setForma] = React.useState('');
  const [taxas, setTaxas] = React.useState(true);
  const [agrupar, setAgrupar] = React.useState<AgrupamentoDoExtrato>('nenhum');
  const [ordem, setOrdem] = React.useState<OrdemDoExtrato>('data');
  const [direcao, setDirecao] = React.useState<'asc' | 'desc'>(extrato ? 'asc' : 'desc');
  const [pagina, setPagina] = React.useState(1);
  const [porPagina, setPorPagina] = React.useState(100);
  const [colunas, setColunas] = React.useState<ColunaId[]>(COLUNAS_DO_LEIAUTE[leiaute].padrao);
  const [mostrarColunas, setMostrarColunas] = React.useState(false);
  const [selecionadas, setSelecionadas] = React.useState<Map<string, number>>(new Map());
  const [aberta, setAberta] = React.useState<MovimentoCaixa | null>(null);
  const [exportando, setExportando] = React.useState(false);
  const [erroExportar, setErroExportar] = React.useState<string | null>(null);

  // Preferências e atalho do endereço (?conta=<id>), uma vez, no navegador.
  React.useEffect(() => {
    setColunas(colunasSalvas(leiaute));
    const conta = lerAtalhos().get('conta');
    if (conta) setContas([conta]);
    loadEntities<ContaBancaria>('contas-bancarias').then(setContasBancarias).catch(() => setContasBancarias([]));
  }, [leiaute]);

  const buscaFinal = useDebounce(busca.trim());
  const pessoaFinal = useDebounce(pessoa.trim());

  const consulta = React.useMemo(() => {
    const p = new URLSearchParams({ de, ate, ordem, direcao, agrupar, pagina: String(pagina), por_pagina: String(porPagina) });
    if (contas.length) p.set('contas', contas.join(','));
    if (tipo) p.set('tipo', tipo);
    if (origem) p.set('origem', origem);
    if (forma) p.set('forma', forma);
    if (pessoaFinal) p.set('pessoa', pessoaFinal);
    if (buscaFinal) p.set('busca', buscaFinal);
    if (!taxas) p.set('taxas', '0');
    return p.toString();
  }, [de, ate, ordem, direcao, agrupar, pagina, porPagina, contas, tipo, origem, forma, pessoaFinal, buscaFinal, taxas]);

  const datasValidas = Boolean(de && ate && de <= ate);
  const { dados, carregando, erro, atualizadoEm, recarregar } = useMovimentos(datasValidas ? consulta : '');

  // Filtro mudou: volta à página 1 e esquece a seleção (ela era de outro recorte).
  const recorte = [de, ate, contas.join(','), tipo, origem, forma, pessoaFinal, buscaFinal, taxas, agrupar].join('|');
  React.useEffect(() => { setPagina(1); setSelecionadas(new Map()); }, [recorte]);

  function salvarColunas(novas: ColunaId[]) {
    setColunas(novas);
    try { window.localStorage.setItem(`movimentos-colunas-${leiaute}`, JSON.stringify(novas)); } catch { /* sem armazenamento */ }
  }

  function ordenar(o: OrdemDoExtrato) {
    if (o === ordem) setDirecao(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setOrdem(o); setDirecao(o === 'data' && !extrato ? 'desc' : 'asc'); }
    setPagina(1);
  }

  function selecionar(linhas: MovimentoCaixa[], marcar: boolean) {
    setSelecionadas(atual => {
      const nova = new Map(atual);
      for (const l of linhas) { if (marcar) nova.set(l.chave, l.valor); else nova.delete(l.chave); }
      return nova;
    });
  }

  const ativos = (tipo ? 1 : 0) + (origem ? 1 : 0) + (forma ? 1 : 0) + (pessoa ? 1 : 0) + (busca ? 1 : 0) + (agrupar !== 'nenhum' ? 1 : 0) + (contas.length ? 1 : 0);
  function limpar() {
    setTipo(''); setOrigem(''); setForma(''); setPessoa(''); setBusca(''); setAgrupar('nenhum'); setContas([]);
  }

  function trocarAtalho(a: AtalhoDePeriodo) {
    const iv = intervaloDoAtalho(a, hoje);
    if (iv) { setDe(iv.de); setAte(iv.ate); }
  }

  async function exportar() {
    setExportando(true);
    setErroExportar(null);
    const p = new URLSearchParams(consulta);
    p.delete('pagina'); p.delete('por_pagina');
    setErroExportar(await exportarMovimentos(p.toString(), leiaute));
    setExportando(false);
  }

  const multiConta = contas.length !== 1 && contasBancarias.length > 1;
  const visiveis = colunas.filter(c => c !== 'conta' || multiConta || !extrato);
  const saldoNoFim = visiveis[visiveis.length - 1] === 'saldo';
  // Saldo anterior e final só fazem sentido na leitura cronológica do extrato.
  const cronologico = ordem === 'data' && direcao === 'asc' && (agrupar === 'nenhum' || agrupar === 'dia') && saldoNoFim;
  const somaSelecionadas = [...selecionadas.values()].reduce((s, v) => s + v, 0);
  const comDiferenca = (dados?.contas ?? []).filter(c => Math.abs(c.diferenca) >= 0.01);
  const nomeDaConta = (id: string) => contasBancarias.find(c => c.id === id)?.nome ?? id;

  const titulo = extrato ? 'Extrato de conta' : 'Movimentações';
  const estado: 'carregando' | 'erro' | 'ok' = !dados && carregando ? 'carregando' : !dados && erro ? 'erro' : 'ok';

  return (
    <MolduraDaPagina>
      <PageHeader
        empresas
        icone={extrato ? Landmark : ArrowLeftRight}
        titulo={titulo}
        subtitulo={extrato
          ? 'Saldo anterior, cada entrada e saída com o saldo logo depois, e o saldo no fim do período. Uma conta ou várias.'
          : 'Tudo o que entrou e saiu de todas as contas, com forma de pagamento, venda e moeda de origem.'}
        atualizadoEm={atualizadoEm}
        onRecarregar={recarregar}
        acoesSecundarias={[
          extrato ? { rotulo: 'Movimentações', href: '/financeiro-ag/movimentacoes' } : { rotulo: 'Extrato de conta', href: '/financeiro-ag/extrato' },
          { rotulo: 'Contas bancárias', href: '/financeiro-ag/contas-bancarias' },
        ]}
      />

      <div className={RITMO_DA_PAGINA}>
        {/* Contas e período: o recorte do extrato. Esc limpa os filtros. */}
        <section
          aria-label="Contas e período"
          onKeyDown={e => { if (e.key === 'Escape' && ativos > 0) { e.preventDefault(); limpar(); } }}
          className={cn(CARTAO, 'flex flex-col gap-[var(--fin-s-4)] p-[var(--fin-s-4)]')}
        >
          {contasBancarias.length > 0 ? (
            <div className="flex flex-col gap-[var(--fin-s-2)]">
              <span id="rotulo-contas" className="fin-t-overline text-[var(--fin-text-3)]">Contas</span>
              <div role="group" aria-labelledby="rotulo-contas" className="flex flex-wrap gap-[var(--fin-s-2)]">
                <BotaoDeConta ativo={contas.length === 0} onClick={() => setContas([])}>Todas</BotaoDeConta>
                {contasBancarias.map(c => (
                  <BotaoDeConta
                    key={c.id}
                    ativo={contas.includes(c.id)}
                    onClick={() => setContas(atual => (atual.includes(c.id) ? atual.filter(x => x !== c.id) : [...atual, c.id]))}
                  >
                    {c.nome}
                  </BotaoDeConta>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-[var(--fin-s-3)] md:flex-row md:flex-wrap md:items-end">
            <label className="flex flex-col gap-1 fin-t-caption text-[var(--fin-text-3)]">
              Período
              <select
                value={atalhoDoIntervalo(de, ate, hoje)}
                onChange={e => trocarAtalho(e.target.value as AtalhoDePeriodo)}
                className={cn(SELECT, 'md:w-44')}
              >
                {ATALHOS_DE_PERIODO.map(a => <option key={a.valor} value={a.valor}>{a.rotulo}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 fin-t-caption text-[var(--fin-text-3)]">
              De
              <Input type="date" value={de} max={ate || undefined} onChange={e => setDe(e.target.value)} aria-invalid={!datasValidas} className={cn(CAMPO, 'md:w-40')} />
            </label>
            <label className="flex flex-col gap-1 fin-t-caption text-[var(--fin-text-3)]">
              Até
              <Input type="date" value={ate} min={de || undefined} onChange={e => setAte(e.target.value)} aria-invalid={!datasValidas} className={cn(CAMPO, 'md:w-40')} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 fin-t-caption text-[var(--fin-text-3)] md:w-56">
              Pessoa
              <Input type="search" value={pessoa} onChange={e => setPessoa(e.target.value)} placeholder="Cliente ou fornecedor" className={CAMPO} />
            </label>
            <label className="inline-flex min-h-11 items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)] lg:min-h-10">
              <input type="checkbox" checked={taxas} onChange={e => setTaxas(e.target.checked)} className="size-4 accent-[var(--fin-accent)]" />
              Mostrar taxas retidas como saída
            </label>
          </div>
          {!datasValidas ? (
            <p role="alert" className="fin-t-body text-[var(--fin-negative-text)]">A data inicial precisa ser igual ou anterior à final.</p>
          ) : null}
        </section>

        {/* Saldos do recorte. */}
        {dados ? (
          <section aria-label="Saldos do período" className={cn(CARTAO, 'grid grid-cols-2 divide-[var(--fin-border)] lg:grid-cols-4 lg:divide-x')}>
            <Termo rotulo={`Saldo anterior em ${dataCurta(dados.de)}`} valor={dados.saldo_anterior} />
            <Termo rotulo="Entradas" valor={dados.totais.entradas} sinal="+" tom="positivo" />
            <Termo rotulo="Saídas" valor={dados.totais.saidas} sinal="−" />
            <Termo rotulo={`Saldo em ${dataCurta(dados.ate)}`} valor={dados.saldo_final} destaque />
            {ativos > 0 ? (
              <p className="col-span-2 border-t border-[var(--fin-border)] px-[var(--fin-s-5)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-3)] lg:col-span-4">
                Entradas e saídas somam só o que passa pelos filtros. Os saldos são sempre os das contas escolhidas, com tudo.
              </p>
            ) : null}
          </section>
        ) : null}

        {extrato && dados && dados.contas.length > 1 ? (
          <section aria-label="Saldo de cada conta" className={cn(CARTAO, 'overflow-x-auto')}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--fin-border)]">
                  <th scope="col" className="px-[var(--fin-s-4)] py-2 text-left fin-t-overline text-[var(--fin-text-3)]">Conta</th>
                  <th scope="col" className="px-3 py-2 text-right fin-t-overline text-[var(--fin-text-3)]">Saldo anterior</th>
                  <th scope="col" className="px-3 py-2 text-right fin-t-overline text-[var(--fin-text-3)]">Movimento</th>
                  <th scope="col" className="px-[var(--fin-s-4)] py-2 text-right fin-t-overline text-[var(--fin-text-3)]">Saldo final</th>
                </tr>
              </thead>
              <tbody>
                {dados.contas.map(c => (
                  <tr key={c.id} className="border-b border-[var(--fin-border)] last:border-b-0">
                    <th scope="row" className="px-[var(--fin-s-4)] py-2 text-left fin-t-body font-medium text-[var(--fin-text)]">{c.nome}</th>
                    <td className="px-3 py-2 text-right fin-t-body tabular-nums text-[var(--fin-text-2)]">{formatBRL(c.saldo_anterior)}</td>
                    <td className="px-3 py-2 text-right fin-t-body tabular-nums text-[var(--fin-text-2)]">{formatBRL(c.saldo_final - c.saldo_anterior)}</td>
                    <td className={cn('px-[var(--fin-s-4)] py-2 text-right fin-t-body-strong tabular-nums', c.saldo_final < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>{formatBRL(c.saldo_final)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {extrato && comDiferenca.length > 0 ? (
          <aside className="flex items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-warning-soft)] p-[var(--fin-s-4)]">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--fin-warning-text)]" />
            <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)] fin-t-body text-[var(--fin-text-2)]">
              <p className="fin-t-body-strong text-[var(--fin-text)]">
                {comDiferenca.length === 1 ? 'Uma conta tem saldo gravado diferente dos lançamentos' : `${comDiferenca.length} contas têm saldo gravado diferente dos lançamentos`}
              </p>
              <ul className="flex flex-col gap-0.5">
                {comDiferenca.map(c => (
                  <li key={c.id} className="tabular-nums">
                    {c.nome}: gravado {formatBRL(c.saldo_gravado)}, pelos lançamentos {formatBRL(c.saldo_reconstruido)} (diferença {formatBRL(c.diferenca)}).
                  </li>
                ))}
              </ul>
              <p className="fin-t-caption text-[var(--fin-text-3)]">
                O extrato mostra o que os lançamentos dizem e não altera nada. A diferença costuma vir de saldo editado à mão, saldo inicial trocado depois dos lançamentos ou baixa numa conta que foi apagada.
                Em Contas bancárias, “Recalcular saldos” refaz o saldo gravado a partir dos lançamentos.
              </p>
            </div>
          </aside>
        ) : null}

        <FilterBar
          busca={{ valor: busca, onChange: setBusca, placeholder: 'Buscar descrição, documento, CPF/CNPJ, venda…' }}
          selects={[
            { id: 'mov-tipo', rotulo: 'Movimento', valor: tipo || 'todos', onChange: v => setTipo(v === 'todos' ? '' : (v as TipoDoMovimento)),
              opcoes: [{ valor: 'todos', rotulo: 'Entradas e saídas' }, { valor: 'entrada', rotulo: 'Só entradas' }, { valor: 'saida', rotulo: 'Só saídas' }] },
            { id: 'mov-origem', rotulo: 'Origem', valor: origem || 'todas', onChange: v => setOrigem(v === 'todas' ? '' : (v as OrigemDoMovimento)),
              opcoes: [{ valor: 'todas', rotulo: 'Todas' }, ...(['receber', 'pagar', 'transferencia', 'taxa'] as OrigemDoMovimento[]).map(o => ({ valor: o, rotulo: ROTULO_DA_ORIGEM[o] }))] },
            { id: 'mov-forma', rotulo: 'Forma', valor: forma || 'todas', onChange: v => setForma(v === 'todas' ? '' : v),
              opcoes: [{ valor: 'todas', rotulo: 'Todas' }, ...(dados?.formas ?? []).map(f => ({ valor: f, rotulo: f }))] },
            { id: 'mov-agrupar', rotulo: 'Agrupar', valor: agrupar, onChange: v => setAgrupar(v as AgrupamentoDoExtrato),
              opcoes: (Object.keys(ROTULO_AGRUPAR) as AgrupamentoDoExtrato[]).map(a => ({ valor: a, rotulo: ROTULO_AGRUPAR[a] })) },
          ]}
          resumo={{
            exibidos: dados?.linhas.length ?? 0,
            total: dados?.total ?? 0,
            substantivo: 'lançamentos',
            soma: dados?.totais.liquido,
            escopo: dados ? `de ${dataCurta(dados.de)} a ${dataCurta(dados.ate)}${contas.length ? ` em ${contas.map(nomeDaConta).join(', ')}` : ''}` : undefined,
          }}
          ativos={ativos}
          onLimpar={limpar}
        />

        <div className="flex flex-wrap items-center justify-between gap-[var(--fin-s-2)]">
          <Button type="button" variant="outline" size="sm" aria-expanded={mostrarColunas} onClick={() => setMostrarColunas(v => !v)} className="h-11 gap-[var(--fin-s-2)] lg:h-9">
            <Columns3 aria-hidden="true" className="size-4" />
            Colunas
          </Button>
          <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]">
            {erroExportar ? <span role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">{erroExportar}</span> : null}
            <Button type="button" variant="outline" size="sm" disabled={exportando || !dados?.total} onClick={() => { void exportar(); }} className="h-11 gap-[var(--fin-s-2)] lg:h-9">
              <Download aria-hidden="true" className="size-4" />
              {exportando ? 'Exportando…' : 'Exportar para Excel (CSV)'}
            </Button>
          </div>
        </div>

        {mostrarColunas ? (
          <fieldset className={cn(CARTAO, 'flex flex-wrap gap-x-[var(--fin-s-4)] gap-y-[var(--fin-s-2)] p-[var(--fin-s-4)]')}>
            <legend className="sr-only">Colunas visíveis</legend>
            {COLUNAS_DO_LEIAUTE[leiaute].todas.map(c => (
              <label key={c} className="inline-flex min-h-11 items-center gap-[var(--fin-s-2)] fin-t-body text-[var(--fin-text-2)] lg:min-h-8">
                <input
                  type="checkbox"
                  checked={colunas.includes(c)}
                  disabled={c === 'valor'}
                  onChange={e => salvarColunas(e.target.checked
                    ? COLUNAS_DO_LEIAUTE[leiaute].todas.filter(x => x === c || colunas.includes(x))
                    : colunas.filter(x => x !== c))}
                  className="size-4 accent-[var(--fin-accent)]"
                />
                {COLUNAS[c].cabecalho}
              </label>
            ))}
            <button type="button" onClick={() => salvarColunas(COLUNAS_DO_LEIAUTE[leiaute].padrao)} className="inline-flex min-h-11 items-center fin-t-body text-[var(--fin-accent)] underline-offset-2 hover:underline lg:min-h-8">
              Voltar ao padrão
            </button>
          </fieldset>
        ) : null}

        <DataState
          estado={estado}
          erro={erro ? { mensagem: erro, onTentarDeNovo: () => { void recarregar(); } } : null}
          esqueleto={<div className={cn(CARTAO, 'h-96 animate-pulse')} />}
        >
          {dados && dados.total === 0 ? (
            <EmptyLesson
              motivo={ativos > 0 ? 'sem-resultado' : 'sem-dado'}
              titulo={ativos > 0 ? 'Nenhum lançamento neste recorte' : 'Nada entrou nem saiu neste período'}
              oQueE={extrato
                ? 'O extrato lista os recebimentos, os pagamentos, as transferências e as taxas retidas das contas escolhidas, com o saldo depois de cada um.'
                : 'As movimentações listam tudo o que já se moveu nas contas da agência: recebimentos, pagamentos, transferências e taxas.'}
              comoComeca={ativos > 0 ? undefined : ['Escolha um período maior.', 'Confira se as baixas foram lançadas com a conta e a data.']}
              acaoSecundaria={ativos > 0 ? { rotulo: 'Limpar filtros', onClick: limpar } : undefined}
            />
          ) : dados ? (
            <section aria-label={titulo} className={cn(CARTAO, 'overflow-hidden')}>
              <GradeDeMovimentos
                linhas={dados.linhas}
                colunas={visiveis}
                ordem={ordem}
                direcao={direcao}
                onOrdenar={ordenar}
                agrupar={agrupar}
                grupos={dados.grupos}
                multiConta={multiConta}
                selecionadas={selecionadas}
                onSelecionar={selecionar}
                onAbrir={setAberta}
                saldoAnterior={cronologico && dados.pagina === 1 ? { data: dados.de, valor: dados.saldo_anterior } : null}
                saldoFinal={cronologico && dados.pagina === dados.total_paginas && ativos === 0 ? { data: dados.ate, valor: dados.saldo_final } : null}
                carregando={carregando}
                rotuloDaTabela={titulo}
              />

              <div className="flex flex-col gap-[var(--fin-s-3)] border-t border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] px-[var(--fin-s-4)] py-[var(--fin-s-3)] md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-x-[var(--fin-s-5)] gap-y-1 fin-t-body tabular-nums text-[var(--fin-text-2)]" aria-live="polite">
                  <span>No recorte: <b className="font-semibold text-[var(--fin-text)]">{formatBRL(dados.totais.liquido)}</b></span>
                  {selecionadas.size > 0 ? (
                    <span className="inline-flex items-center gap-[var(--fin-s-2)]">
                      {selecionadas.size === 1 ? '1 selecionado' : `${selecionadas.size} selecionados`}:
                      <b className="font-semibold text-[var(--fin-text)]">{formatBRL(somaSelecionadas)}</b>
                      <button type="button" onClick={() => setSelecionadas(new Map())} aria-label="Limpar a seleção" className="inline-flex size-8 items-center justify-center rounded-[var(--fin-r-sm)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]">
                        <X aria-hidden="true" className="size-4" />
                      </button>
                    </span>
                  ) : (
                    <span className="fin-t-caption text-[var(--fin-text-3)]">Marque linhas para somar. Espaço marca, Enter abre.</span>
                  )}
                </div>
                <nav aria-label="Páginas" className="flex items-center gap-[var(--fin-s-2)]">
                  <label className="inline-flex items-center gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-3)]">
                    Por página
                    <select value={porPagina} onChange={e => { setPorPagina(Number(e.target.value)); setPagina(1); }} className={cn(SELECT, 'h-9 w-20 lg:h-8')}>
                      {[50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <Button type="button" variant="ghost" size="icon" aria-label="Página anterior" disabled={dados.pagina <= 1} onClick={() => setPagina(p => Math.max(1, p - 1))}>
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <span className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">{dados.pagina} de {dados.total_paginas}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label="Próxima página" disabled={dados.pagina >= dados.total_paginas} onClick={() => setPagina(p => p + 1)}>
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </nav>
              </div>
            </section>
          ) : null}
        </DataState>

        {extrato ? (
          <p className="flex items-start gap-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-3)]">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Recebimento das plataformas entra pelo valor que caiu na conta. Baixa sem conta escolhida aparece na Caixa Geral.
              Para conferir com o banco linha a linha, use a <Link href="/financeiro-ag/conciliacao" className="text-[var(--fin-accent)] underline-offset-2 hover:underline">Conciliação</Link>.
            </span>
          </p>
        ) : null}
      </div>

      <DetalheDoMovimento linha={aberta} multiConta={multiConta} onFechar={() => setAberta(null)} />
    </MolduraDaPagina>
  );
}

function BotaoDeConta({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center rounded-[var(--fin-r-md)] border px-3 fin-t-body transition-colors duration-[var(--fin-dur-rapida)] lg:min-h-9',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
        ativo
          ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] font-medium text-[var(--fin-accent)]'
          : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]',
      )}
    >
      {children}
    </button>
  );
}

function Termo({ rotulo, valor, sinal, tom = 'neutro', destaque = false }: {
  rotulo: string; valor: number; sinal?: '+' | '−'; tom?: 'neutro' | 'positivo'; destaque?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-[var(--fin-s-5)] py-[var(--fin-s-4)]">
      <span className="fin-t-caption text-[var(--fin-text-3)]">{rotulo}</span>
      <span
        className={cn(
          'tabular-nums',
          destaque ? 'fin-t-metric-sm' : 'fin-t-subhead',
          valor < 0 && !sinal ? 'text-[var(--fin-negative-text)]' : tom === 'positivo' ? 'text-[var(--fin-positive)]' : 'text-[var(--fin-text)]',
        )}
      >
        {sinal ? `${sinal}${formatBRL(Math.abs(valor))}` : formatBRL(valor)}
      </span>
    </div>
  );
}
