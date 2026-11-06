'use client';

import * as React from 'react';
import { ArrowDownLeft, ArrowUpRight, Ellipsis, Layers } from 'lucide-react';

import type { FinColuna } from '@/components/fin/FinTable';
import { statusChipVariants, type StatusTone } from '@/components/fin/StatusChip';
import {
  dataHoraBR, rotuloDaSituacao, ROTULO_DO_TIPO, textoDoCampo, type CampoDaLista, type LinhaDeConta, type OrdemDaLista,
} from '@/lib/contas-pagar-receber';
import type { StatusDaCobranca } from '@/lib/cobranca/contrato-telas';
import { ROTULO_NA_CONTA, situacaoNaConta, type SituacaoDaCobrancaNaConta } from '@/lib/cobranca/regras-telas';
import { cn, formatBRL } from '@/lib/utils';

/**
 * Colunas da lista Contas a Pagar/Receber (05/11/2026). A pessoa escolhe
 * quais aparecem ("Colunas"). Desde 06/11/2026 a escolha fica guardada no
 * servidor, por pessoa (vale em qualquer computador); este navegador guarda
 * uma cópia, que vale quando o servidor não responde.
 */

export type ColunaFixaId =
  | 'numero' | 'tipo' | 'situacao' | 'vencimento' | 'emissao' | 'liquidacao' | 'pessoa' | 'descricao' | 'documento'
  | 'parcela' | 'categoria' | 'centro' | 'conta' | 'forma' | 'moeda' | 'valor' | 'baixado' | 'saldo' | 'cobranca'
  | 'venda' | 'fatura' | 'vendedor' | 'cadastrado_em' | 'cadastrado_por' | 'acoes';
/** Campo personalizado da agência: `campo:<id>`. */
export type ColunaDeCampoId = `campo:${string}`;
export type ColunaId = ColunaFixaId | ColunaDeCampoId;

export const COLUNAS_ESCOLHIVEIS: ReadonlyArray<{ id: ColunaFixaId; rotulo: string }> = [
  { id: 'numero', rotulo: 'Nº' },
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
  { id: 'venda', rotulo: 'Venda Nº' },
  { id: 'fatura', rotulo: 'Fatura Nº' },
  { id: 'vendedor', rotulo: 'Vendedor' },
  { id: 'moeda', rotulo: 'Moeda' },
  { id: 'valor', rotulo: 'Valor' },
  { id: 'baixado', rotulo: 'Pago/Recebido' },
  { id: 'saldo', rotulo: 'Saldo em aberto' },
  { id: 'cadastrado_em', rotulo: 'Cadastrado em' },
  { id: 'cadastrado_por', rotulo: 'Cadastrado por' },
];

/** Valor e o menu da linha nunca saem. */
export const COLUNAS_FIXAS: readonly ColunaId[] = ['valor', 'acoes'];
// O saldo em aberto aparece embaixo do valor quando difere dele; a coluna
// própria continua em Colunas.
export const COLUNAS_PADRAO: readonly ColunaId[] = ['tipo', 'vencimento', 'pessoa', 'descricao', 'categoria', 'situacao', 'cobranca', 'valor', 'acoes'];

const CHAVE_SALVA = 'contas-pagar-receber-colunas';
/** Chave da preferência no servidor (GET/PUT /api/preferencias). */
export const PREFERENCIA_DAS_COLUNAS = 'contas-pagar-receber.colunas';

const ehCampo = (c: string): c is ColunaDeCampoId => /^campo:[^\s]{1,80}$/.test(c);

/**
 * A escolha guardada, só com colunas que existem (as de campo personalizado
 * valem se o campo ainda está ativo) e com as fixas sempre presentes. Fora
 * de forma = null (a tela usa o padrão).
 */
export function normalizarColunas(s: unknown, campos: readonly CampoDaLista[] = []): ColunaId[] | null {
  if (!Array.isArray(s)) return null;
  const pedidas = s.filter((c): c is string => typeof c === 'string');
  const fixas = COLUNAS_ESCOLHIVEIS.map(c => c.id).filter(c => pedidas.includes(c));
  const ativos = new Set(campos.map(c => `campo:${c.id}`));
  const deCampo = pedidas.filter(c => ehCampo(c) && (campos.length === 0 || ativos.has(c))) as ColunaDeCampoId[];
  const validas: ColunaId[] = [...fixas, ...deCampo];
  if (!validas.length) return null;
  return [...new Set<ColunaId>([...validas, ...COLUNAS_FIXAS])];
}

/** A cópia deste navegador (reserva quando o servidor não responde). */
export function colunasSalvas(): ColunaId[] {
  if (typeof window === 'undefined') return [...COLUNAS_PADRAO];
  try {
    return normalizarColunas(JSON.parse(window.localStorage.getItem(CHAVE_SALVA) ?? 'null')) ?? [...COLUNAS_PADRAO];
  } catch { /* preferência corrompida: volta ao padrão */ }
  return [...COLUNAS_PADRAO];
}

/** Guarda neste navegador e no servidor (o servidor falhar não atrapalha a tela). */
export function salvarColunas(ids: readonly ColunaId[]): void {
  try { window.localStorage.setItem(CHAVE_SALVA, JSON.stringify(ids)); } catch { /* sem armazenamento */ }
  void fetch('/api/preferencias', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chave: PREFERENCIA_DAS_COLUNAS, valor: ids }),
  }).catch(() => undefined);
}

/** A escolha guardada no servidor; null quando não há ou o servidor não respondeu. */
export async function colunasDoServidor(): Promise<unknown | null> {
  try {
    const r = await fetch(`/api/preferencias?chave=${encodeURIComponent(PREFERENCIA_DAS_COLUNAS)}`);
    if (!r.ok) return null;
    const corpo = (await r.json().catch(() => null)) as { valor?: unknown } | null;
    return corpo?.valor ?? null;
  } catch {
    return null;
  }
}

/** Coluna da tela → ordem do servidor. */
export const ORDEM_DA_COLUNA: Partial<Record<ColunaFixaId, OrdemDaLista>> = {
  tipo: 'tipo', situacao: 'situacao', vencimento: 'vencimento', emissao: 'emissao', liquidacao: 'liquidacao',
  pessoa: 'pessoa', descricao: 'descricao', documento: 'documento', categoria: 'categoria', centro: 'centro',
  conta: 'conta', valor: 'valor', saldo: 'saldo', numero: 'numero', venda: 'venda', vendedor: 'vendedor', cadastrado_em: 'cadastrado',
};

/** Ordem do servidor para a coluna (as de campo personalizado não ordenam). */
export function ordemDaColuna(c: ColunaId): OrdemDaLista | undefined {
  return ehCampo(c) ? undefined : ORDEM_DA_COLUNA[c];
}

function tomDaSituacao(l: LinhaDeConta): StatusTone {
  if (l.situacao === 'excluido') return 'neutro';
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
  const chip = (
    <span className={statusChipVariants({ tone: tom })}>
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', PONTO[tom])} />
      {rotuloDaSituacao(linha)}
      {linha.dias_atraso > 0 ? <span className="font-normal tabular-nums">· {linha.dias_atraso} d</span> : null}
    </span>
  );
  if (linha.situacao !== 'excluido') return chip;
  const quem = [dataHoraBR(linha.excluido_em), linha.excluido_por].filter(Boolean).join(' · ');
  return (
    <span className="flex flex-col items-start gap-0.5">
      {chip}
      {quem ? <span className="whitespace-nowrap fin-t-caption tabular-nums text-[var(--fin-text-3)]">{quem}</span> : null}
    </span>
  );
}

const TOM_NA_CONTA: Record<SituacaoDaCobrancaNaConta, StatusTone> = {
  sem_boleto: 'neutro', emitida: 'info', vencida: 'negativo', paga: 'positivo', falhou: 'aviso', nao_se_aplica: 'neutro',
};

/** Situação da cobrança (boleto/Pix) da conta a receber; conta a pagar fica em branco. */
export function cobrancaDaLinha(l: LinhaDeConta): SituacaoDaCobrancaNaConta {
  // Conta excluída não se cobra.
  if (l.situacao === 'excluido') return 'nao_se_aplica';
  return situacaoNaConta({ ...l, situacao: l.situacao }, (l.cobranca_status || null) as StatusDaCobranca | null);
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

export function criarColunas(opcoes: {
  onMenu: (l: LinhaDeConta, posicao: { x: number; y: number }) => void;
  /** Campos personalizados ativos da agência: viram colunas escolhíveis. */
  campos?: readonly CampoDaLista[];
}): FinColuna<LinhaDeConta>[] {
  const campos = opcoes.campos ?? [];
  return [
    {
      id: 'numero', cabecalho: 'Nº', tipo: 'texto', sortable: true,
      render: l => (l.numero !== null ? <span className="tabular-nums text-[var(--fin-text-2)]">{l.numero}</span> : <Fraco>—</Fraco>),
    },
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
      id: 'pessoa', cabecalho: 'Pessoa', tipo: 'texto', sortable: true, minWidth: 120,
      render: l => <Texto valor={l.pessoa} max="max-w-[140px]" />,
    },
    {
      id: 'descricao', cabecalho: 'Descrição', tipo: 'texto', sortable: true, minWidth: 140, prioridade: 2,
      render: l => (
        <span className="flex min-w-0 items-center gap-[var(--fin-s-1)]">
          <Texto valor={l.descricao} max="max-w-[160px]" />
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
    { id: 'categoria', cabecalho: 'Categoria', tipo: 'texto', sortable: true, prioridade: 2, minWidth: 110, render: l => <Texto valor={l.categoria} max="max-w-[140px]" /> },
    { id: 'centro', cabecalho: 'Centro de custo', tipo: 'texto', sortable: true, prioridade: 1, render: l => <Texto valor={l.centro_custo} max="max-w-[160px]" /> },
    { id: 'conta', cabecalho: 'Conta bancária', tipo: 'texto', sortable: true, prioridade: 1, render: l => <Texto valor={l.conta_bancaria} max="max-w-[160px]" /> },
    { id: 'forma', cabecalho: 'Forma', tipo: 'texto', prioridade: 1, render: l => <Texto valor={l.forma} max="max-w-[120px]" /> },
    { id: 'moeda', cabecalho: 'Moeda', tipo: 'texto', prioridade: 1, render: l => <span className="tabular-nums text-[var(--fin-text-2)]">{l.moeda}</span> },
    {
      id: 'venda', cabecalho: 'Venda Nº', tipo: 'texto', sortable: true, prioridade: 1,
      render: l => (l.venda_numero
        ? <span className="tabular-nums">{l.venda_numero}</span>
        : l.venda_id ? <span className="fin-t-caption text-[var(--fin-text-3)]">sem número</span> : <Fraco>—</Fraco>),
    },
    { id: 'fatura', cabecalho: 'Fatura Nº', tipo: 'texto', prioridade: 1, render: l => (l.fatura_numero ? <span className="tabular-nums">{l.fatura_numero}</span> : <Fraco>—</Fraco>) },
    { id: 'vendedor', cabecalho: 'Vendedor', tipo: 'texto', sortable: true, prioridade: 1, render: l => <Texto valor={l.vendedor} max="max-w-[150px]" /> },
    { id: 'situacao', cabecalho: 'Situação', tipo: 'texto', sortable: true, minWidth: 116, render: l => <ChipDaSituacao linha={l} /> },
    { id: 'cobranca', cabecalho: 'Cobrança', tipo: 'texto', prioridade: 2, minWidth: 116, render: l => <ChipDaCobranca linha={l} /> },
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
      id: 'cadastrado_em', cabecalho: 'Cadastrado em', tipo: 'texto', sortable: true, prioridade: 1,
      render: l => (l.cadastrado_em ? <span className="whitespace-nowrap tabular-nums">{dataHoraBR(l.cadastrado_em)}</span> : <Fraco>—</Fraco>),
    },
    {
      id: 'cadastrado_por', cabecalho: 'Cadastrado por', tipo: 'texto', prioridade: 1,
      render: l => (l.cadastrado_por ? <Texto valor={l.cadastrado_por} max="max-w-[150px]" /> : <Fraco>Sistema</Fraco>),
    },
    ...campos.map((c): FinColuna<LinhaDeConta> => ({
      id: `campo:${c.id}`, cabecalho: c.nome, tipo: 'texto', prioridade: 1,
      render: l => {
        if (c.aplica_a !== 'ambos' && c.aplica_a !== l.tipo) return <Fraco>—</Fraco>;
        return <Texto valor={textoDoCampo(c, l.campos_personalizados[c.id])} max="max-w-[160px]" />;
      },
    })),
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
  const cab = ['Nº', 'Tipo', 'Vencimento', 'Pessoa', 'Descrição', 'Situação', 'Valor', 'Saldo em aberto'];
  return [cab, ...linhas.map(l => [String(l.numero ?? ''), ROTULO_DO_TIPO[l.tipo], dataBR(l.vencimento), limpo(l.pessoa), limpo(l.descricao), rotuloDaSituacao(l), n(l.valor), n(l.saldo)])]
    .map(c => c.join('\t')).join('\n');
}
