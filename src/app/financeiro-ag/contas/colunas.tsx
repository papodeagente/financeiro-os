'use client';

import * as React from 'react';
import { ArrowDownLeft, ArrowUpRight, Ellipsis, Layers } from 'lucide-react';

import type { FinColuna } from '@/components/fin/FinTable';
import { statusChipVariants, type StatusTone } from '@/components/fin/StatusChip';
import { rotuloDaSituacao, ROTULO_DO_TIPO, type LinhaDeConta, type OrdemDaLista } from '@/lib/contas-pagar-receber';
import type { StatusDaCobranca } from '@/lib/cobranca/contrato-telas';
import { ROTULO_NA_CONTA, situacaoNaConta, type SituacaoDaCobrancaNaConta } from '@/lib/cobranca/regras-telas';
import { cn, formatBRL } from '@/lib/utils';

/**
 * Colunas da lista Contas a Pagar/Receber (05/11/2026). A pessoa escolhe
 * quais aparecem ("Colunas"); a escolha fica guardada neste navegador.
 */

export type ColunaId =
  | 'tipo' | 'situacao' | 'vencimento' | 'emissao' | 'liquidacao' | 'pessoa' | 'descricao' | 'documento'
  | 'parcela' | 'categoria' | 'centro' | 'conta' | 'forma' | 'valor' | 'baixado' | 'saldo' | 'cobranca' | 'acoes';

export const COLUNAS_ESCOLHIVEIS: ReadonlyArray<{ id: ColunaId; rotulo: string }> = [
  { id: 'tipo', rotulo: 'Tipo' },
  { id: 'vencimento', rotulo: 'Vencimento' },
  { id: 'emissao', rotulo: 'Emissão' },
  { id: 'liquidacao', rotulo: 'Liquidação' },
  { id: 'pessoa', rotulo: 'Pessoa' },
  { id: 'descricao', rotulo: 'Descrição' },
  { id: 'documento', rotulo: 'Documento' },
  { id: 'parcela', rotulo: 'Parcela' },
  { id: 'categoria', rotulo: 'Categoria' },
  { id: 'centro', rotulo: 'Centro de custo' },
  { id: 'conta', rotulo: 'Conta bancária' },
  { id: 'forma', rotulo: 'Forma' },
  { id: 'situacao', rotulo: 'Situação' },
  { id: 'cobranca', rotulo: 'Cobrança' },
  { id: 'valor', rotulo: 'Valor' },
  { id: 'baixado', rotulo: 'Pago/Recebido' },
  { id: 'saldo', rotulo: 'Saldo em aberto' },
];

/** Valor e o menu da linha nunca saem. */
export const COLUNAS_FIXAS: readonly ColunaId[] = ['valor', 'acoes'];
// O saldo em aberto aparece embaixo do valor quando difere dele; a coluna
// própria continua em Colunas.
export const COLUNAS_PADRAO: readonly ColunaId[] = ['tipo', 'vencimento', 'pessoa', 'descricao', 'categoria', 'situacao', 'cobranca', 'valor', 'acoes'];

const CHAVE_SALVA = 'contas-pagar-receber-colunas';

export function colunasSalvas(): ColunaId[] {
  if (typeof window === 'undefined') return [...COLUNAS_PADRAO];
  try {
    const s = JSON.parse(window.localStorage.getItem(CHAVE_SALVA) ?? 'null');
    if (Array.isArray(s)) {
      const validas = COLUNAS_ESCOLHIVEIS.map(c => c.id).filter(c => s.includes(c));
      if (validas.length) return [...new Set([...validas, ...COLUNAS_FIXAS])];
    }
  } catch { /* preferência corrompida: volta ao padrão */ }
  return [...COLUNAS_PADRAO];
}

export function salvarColunas(ids: readonly ColunaId[]): void {
  try { window.localStorage.setItem(CHAVE_SALVA, JSON.stringify(ids)); } catch { /* sem armazenamento */ }
}

/** Coluna da tela → ordem do servidor. */
export const ORDEM_DA_COLUNA: Partial<Record<ColunaId, OrdemDaLista>> = {
  tipo: 'tipo', situacao: 'situacao', vencimento: 'vencimento', emissao: 'emissao', liquidacao: 'liquidacao',
  pessoa: 'pessoa', descricao: 'descricao', documento: 'documento', categoria: 'categoria', centro: 'centro',
  conta: 'conta', valor: 'valor', saldo: 'saldo',
};

function tomDaSituacao(l: LinhaDeConta): StatusTone {
  if (l.situacao === 'em_atraso') return 'negativo';
  if (l.situacao === 'liquidado') return 'positivo';
  if (l.parcial) return 'aviso';
  return 'neutro';
}

const PONTO: Record<StatusTone, string> = {
  neutro: 'bg-[var(--fin-text-3)]',
  positivo: 'bg-[var(--fin-positive)]',
  negativo: 'bg-[var(--fin-negative)]',
  aviso: 'bg-[var(--fin-warning)]',
  info: 'bg-[var(--fin-info)]',
};

export function ChipDaSituacao({ linha }: { linha: LinhaDeConta }) {
  const tom = tomDaSituacao(linha);
  return (
    <span className={statusChipVariants({ tone: tom })}>
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', PONTO[tom])} />
      {rotuloDaSituacao(linha)}
      {linha.dias_atraso > 0 ? <span className="font-normal tabular-nums">· {linha.dias_atraso} d</span> : null}
    </span>
  );
}

const TOM_NA_CONTA: Record<SituacaoDaCobrancaNaConta, StatusTone> = {
  sem_boleto: 'neutro', emitida: 'info', vencida: 'negativo', paga: 'positivo', falhou: 'aviso', nao_se_aplica: 'neutro',
};

/** Situação da cobrança (boleto/Pix) da conta a receber; conta a pagar fica em branco. */
export function cobrancaDaLinha(l: LinhaDeConta): SituacaoDaCobrancaNaConta {
  return situacaoNaConta(l, (l.cobranca_status || null) as StatusDaCobranca | null);
}

export function ChipDaCobranca({ linha }: { linha: LinhaDeConta }) {
  const s = cobrancaDaLinha(linha);
  if (s === 'nao_se_aplica') return <Fraco>—</Fraco>;
  if (s === 'sem_boleto') return <span className="whitespace-nowrap fin-t-caption text-[var(--fin-text-3)]">{ROTULO_NA_CONTA[s]}</span>;
  return <span className={statusChipVariants({ tone: TOM_NA_CONTA[s] })}>{ROTULO_NA_CONTA[s]}</span>;
}

function Fraco({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--fin-text-3)]">{children}</span>;
}

function Texto({ valor, max = 'max-w-[170px]' }: { valor: string; max?: string }) {
  return valor ? <span className={cn('block truncate', max)} title={valor}>{valor}</span> : <Fraco>—</Fraco>;
}

export function criarColunas(opcoes: { onMenu: (l: LinhaDeConta, posicao: { x: number; y: number }) => void }): FinColuna<LinhaDeConta>[] {
  return [
    {
      id: 'tipo', cabecalho: 'Tipo', tipo: 'texto', sortable: true,
      render: l => (
        <span title={ROTULO_DO_TIPO[l.tipo]} className="inline-flex items-center whitespace-nowrap text-[var(--fin-text-2)]">
          {l.tipo === 'receber'
            ? <ArrowDownLeft aria-hidden="true" className="size-4 text-[var(--fin-positive)]" />
            : <ArrowUpRight aria-hidden="true" className="size-4 text-[var(--fin-text-3)]" />}
          <span className="sr-only">{ROTULO_DO_TIPO[l.tipo]}</span>
        </span>
      ),
    },
    { id: 'vencimento', cabecalho: 'Vencimento', tipo: 'data', sortable: true, valor: l => l.vencimento || null },
    { id: 'emissao', cabecalho: 'Emissão', tipo: 'data', sortable: true, prioridade: 1, valor: l => l.emissao || null },
    { id: 'liquidacao', cabecalho: 'Liquidação', tipo: 'data', sortable: true, prioridade: 1, valor: l => l.liquidacao || null },
    {
      id: 'pessoa', cabecalho: 'Pessoa', tipo: 'texto', sortable: true, minWidth: 140,
      render: l => <Texto valor={l.pessoa} />,
    },
    {
      id: 'descricao', cabecalho: 'Descrição', tipo: 'texto', sortable: true, minWidth: 160, prioridade: 2,
      render: l => (
        <span className="flex min-w-0 items-center gap-[var(--fin-s-1)]">
          <Texto valor={l.descricao} max="max-w-[210px]" />
          {l.rateio ? (
            <span title="Dividida entre centros de custo (rateio)" className="inline-flex shrink-0 text-[var(--fin-text-3)]">
              <Layers aria-hidden="true" className="size-3.5" />
              <span className="sr-only">Com rateio</span>
            </span>
          ) : null}
        </span>
      ),
    },
    { id: 'documento', cabecalho: 'Documento', tipo: 'texto', sortable: true, prioridade: 1, render: l => <Texto valor={l.documento} max="max-w-[160px]" /> },
    { id: 'parcela', cabecalho: 'Parcela', tipo: 'texto', prioridade: 1, render: l => (l.parcela ? <span className="tabular-nums">{l.parcela}</span> : <Fraco>—</Fraco>) },
    { id: 'categoria', cabecalho: 'Categoria', tipo: 'texto', sortable: true, prioridade: 2, minWidth: 120, render: l => <Texto valor={l.categoria} max="max-w-[160px]" /> },
    { id: 'centro', cabecalho: 'Centro de custo', tipo: 'texto', sortable: true, prioridade: 1, render: l => <Texto valor={l.centro_custo} max="max-w-[160px]" /> },
    { id: 'conta', cabecalho: 'Conta bancária', tipo: 'texto', sortable: true, prioridade: 1, render: l => <Texto valor={l.conta_bancaria} max="max-w-[160px]" /> },
    { id: 'forma', cabecalho: 'Forma', tipo: 'texto', prioridade: 1, render: l => <Texto valor={l.forma} max="max-w-[120px]" /> },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'texto', sortable: true, minWidth: 128, render: l => <ChipDaSituacao linha={l} /> },
    { id: 'cobranca', cabecalho: 'Cobrança', tipo: 'texto', prioridade: 2, minWidth: 128, render: l => <ChipDaCobranca linha={l} /> },
    {
      id: 'valor', cabecalho: 'Valor', tipo: 'dinheiro', sortable: true, valor: l => l.valor,
      tone: l => (l.tipo === 'receber' && l.situacao !== 'cancelado' ? 'positivo' : 'neutro'),
      sub: l => {
        const partes: string[] = [];
        if (l.saldo > 0.005 && Math.abs(l.saldo - l.valor) > 0.005 && l.situacao !== 'cancelado') partes.push(`em aberto ${formatBRL(l.saldo)}`);
        if (l.moeda !== 'BRL') partes.push(`em reais · origem ${l.moeda}`);
        return partes.length ? partes.join(' · ') : null;
      },
    },
    { id: 'baixado', cabecalho: 'Pago/Recebido', tipo: 'dinheiro', prioridade: 1, valor: l => l.baixado },
    { id: 'saldo', cabecalho: 'Saldo em aberto', tipo: 'dinheiro', sortable: true, valor: l => l.saldo },
    {
      id: 'acoes', cabecalho: '', tipo: 'acoes',
      render: l => (
        <button
          type="button"
          aria-label={`Ações da conta ${l.descricao || l.pessoa}`}
          aria-haspopup="menu"
          onClick={e => {
            const caixa = e.currentTarget.getBoundingClientRect();
            opcoes.onMenu(l, { x: caixa.right - 8, y: caixa.bottom + 4 });
          }}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] max-lg:size-11',
            'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
          )}
        >
          <Ellipsis aria-hidden="true" className="size-4" />
        </button>
      ),
    },
  ];
}

/** Linhas como texto separado por tabulação: cola certinho no Excel ou numa mensagem. */
export function linhasParaCopiar(linhas: readonly LinhaDeConta[]): string {
  const dataBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
  const n = (v: number) => v.toFixed(2).replace('.', ',');
  const limpo = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
  const cab = ['Tipo', 'Vencimento', 'Pessoa', 'Descrição', 'Situação', 'Valor', 'Saldo em aberto'];
  return [cab, ...linhas.map(l => [ROTULO_DO_TIPO[l.tipo], dataBR(l.vencimento), limpo(l.pessoa), limpo(l.descricao), rotuloDaSituacao(l), n(l.valor), n(l.saldo)])]
    .map(c => c.join('\t')).join('\n');
}
