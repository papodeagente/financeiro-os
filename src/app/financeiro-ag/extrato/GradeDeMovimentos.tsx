'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, Lock } from 'lucide-react';

import type {
  AgrupamentoDoExtrato, GrupoDoExtrato, MovimentoCaixa, OrdemDoExtrato, OrigemDoMovimento,
} from '@/lib/movimentos-caixa';
import { cn, formatBRL } from '@/lib/utils';
import { dataCurta } from './periodos';
import { rotuloDaForma } from '@/lib/formas-pagamento';

/**
 * A grade do Extrato de conta e das Movimentações (05/11/2026).
 *
 * Por que não a FinTable: aqui a ordem é do SERVIDOR (a lista é paginada e o
 * saldo de cada linha é o cronológico, não o da posição na tela), há seleção
 * com soma, agrupamento com subtotal do recorte inteiro e as linhas de saldo
 * anterior e final. Estender a FinTable com tudo isso mudaria o contrato
 * dela para as telas que já a usam.
 */

export const ROTULO_DA_ORIGEM: Record<OrigemDoMovimento, string> = {
  receber: 'Conta a receber',
  pagar: 'Conta a pagar',
  transferencia: 'Transferência',
  taxa: 'Taxa retida',
};

export type ColunaId =
  | 'data' | 'conta' | 'numero' | 'venda' | 'descricao' | 'documento' | 'pessoa' | 'cpf'
  | 'informacoes' | 'forma' | 'cartao' | 'moeda' | 'movimento' | 'valor' | 'saldo' | 'fechado';

export interface DefinicaoDeColuna {
  id: ColunaId;
  cabecalho: string;
  ordem?: OrdemDoExtrato;
  direita?: boolean;
  /** Classe de largura mínima: a célula nunca estoura. */
  largura?: string;
}

export const COLUNAS: Record<ColunaId, DefinicaoDeColuna> = {
  data: { id: 'data', cabecalho: 'Data', ordem: 'data', largura: 'min-w-[92px]' },
  conta: { id: 'conta', cabecalho: 'Conta', ordem: 'conta', largura: 'min-w-[120px]' },
  numero: { id: 'numero', cabecalho: 'Número', ordem: 'numero', largura: 'min-w-[72px]' },
  venda: { id: 'venda', cabecalho: 'Venda', largura: 'min-w-[88px]' },
  descricao: { id: 'descricao', cabecalho: 'Descrição', ordem: 'descricao', largura: 'min-w-[220px]' },
  documento: { id: 'documento', cabecalho: 'Documento', largura: 'min-w-[110px]' },
  pessoa: { id: 'pessoa', cabecalho: 'Pessoa', ordem: 'pessoa', largura: 'min-w-[160px]' },
  cpf: { id: 'cpf', cabecalho: 'CPF/CNPJ', largura: 'min-w-[140px]' },
  informacoes: { id: 'informacoes', cabecalho: 'Informações', largura: 'min-w-[180px]' },
  forma: { id: 'forma', cabecalho: 'Forma', ordem: 'forma', largura: 'min-w-[96px]' },
  cartao: { id: 'cartao', cabecalho: 'Cheque/Cartão', largura: 'min-w-[100px]' },
  moeda: { id: 'moeda', cabecalho: 'Moeda · Origem · Câmbio', largura: 'min-w-[170px]' },
  movimento: { id: 'movimento', cabecalho: 'Movimento', largura: 'min-w-[150px]' },
  valor: { id: 'valor', cabecalho: 'Valor', ordem: 'valor', direita: true, largura: 'min-w-[120px]' },
  saldo: { id: 'saldo', cabecalho: 'Saldo', direita: true, largura: 'min-w-[128px]' },
  fechado: { id: 'fechado', cabecalho: 'Fechado', largura: 'min-w-[88px]' },
};

function Valor({ v, forte = false }: { v: number; forte?: boolean }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap tabular-nums',
        forte ? 'fin-t-body-strong' : 'fin-t-body',
        v > 0 ? 'text-[var(--fin-positive)]' : v < 0 ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]',
      )}
    >
      {v > 0 ? '+' : v < 0 ? '−' : ''}{formatBRL(Math.abs(v))}
    </span>
  );
}

function Saldo({ v, forte = false }: { v: number; forte?: boolean }) {
  return (
    <span className={cn('whitespace-nowrap tabular-nums', forte ? 'fin-t-body-strong' : 'fin-t-body', v < 0 ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]')}>
      {formatBRL(v)}
    </span>
  );
}

function Fraco({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--fin-text-3)]">{children}</span>;
}

function celula(l: MovimentoCaixa, id: ColunaId, multiConta: boolean): React.ReactNode {
  switch (id) {
    case 'data': return <span className="whitespace-nowrap tabular-nums">{l.data ? dataCurta(l.data) : <Fraco>sem data</Fraco>}</span>;
    case 'conta': return <span className="block max-w-[180px] truncate" title={l.conta_nome}>{l.conta_nome}</span>;
    case 'numero': return l.numero ? <span className="tabular-nums">{l.numero}</span> : <Fraco>—</Fraco>;
    case 'venda': return l.venda_numero || l.venda_id ? <span className="block max-w-[120px] truncate" title={l.venda_numero || l.venda_id}>{l.venda_numero || l.venda_id}</span> : <Fraco>—</Fraco>;
    case 'descricao': return (
      <span className="block min-w-0">
        <span className="block max-w-[340px] truncate" title={l.descricao}>{l.descricao || ROTULO_DA_ORIGEM[l.origem]}</span>
        {l.origem === 'taxa' || l.origem === 'transferencia' ? null : (
          <span className="block fin-t-caption text-[var(--fin-text-3)]">{ROTULO_DA_ORIGEM[l.origem]}{l.plataforma ? ` · via ${l.plataforma}` : ''}</span>
        )}
      </span>
    );
    case 'documento': return l.documento ? <span className="block max-w-[160px] truncate" title={l.documento}>{l.documento}</span> : <Fraco>—</Fraco>;
    case 'pessoa': return l.pessoa_nome ? <span className="block max-w-[220px] truncate" title={l.pessoa_nome}>{l.pessoa_nome}</span> : <Fraco>—</Fraco>;
    case 'cpf': return l.cpf_cnpj ? <span className="whitespace-nowrap tabular-nums">{l.cpf_cnpj}</span> : <Fraco>—</Fraco>;
    case 'informacoes': return l.informacoes ? <span className="block max-w-[260px] truncate text-[var(--fin-text-2)]" title={l.informacoes}>{l.informacoes}</span> : <Fraco>—</Fraco>;
    case 'forma': return l.forma ? <span className="whitespace-nowrap">{rotuloDaForma(l.forma)}</span> : <Fraco>—</Fraco>;
    case 'cartao': return l.cartao_cheque ? <span className="tabular-nums">{l.cartao_cheque}</span> : <Fraco>—</Fraco>;
    case 'moeda': return l.moeda !== 'BRL' && l.valor_origem !== null ? (
      <span className="whitespace-nowrap tabular-nums">
        {l.moeda} {l.valor_origem.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        {l.cambio ? <Fraco> · {l.cambio.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</Fraco> : null}
      </span>
    ) : <Fraco>BRL</Fraco>;
    case 'movimento': return (
      <span className="whitespace-nowrap">
        {l.valor >= 0 ? 'Entrada' : 'Saída'}
        <Fraco> · {ROTULO_DA_ORIGEM[l.origem]}</Fraco>
      </span>
    );
    case 'valor': return <Valor v={l.valor} />;
    case 'fechado': return l.fechado
      ? <span className="inline-flex items-center gap-1 whitespace-nowrap text-[var(--fin-text-2)]" title="Período fechado pelo Fechar Caixa: só muda depois de reabrir"><Lock className="size-3.5" aria-hidden="true" />Fechado</span>
      : <Fraco>Aberto</Fraco>;
    case 'saldo': return (
      <span className="flex flex-col items-end">
        <Saldo v={l.saldo_total} />
        {multiConta ? <span className="whitespace-nowrap fin-t-caption tabular-nums text-[var(--fin-text-3)]">na conta {formatBRL(l.saldo_conta)}</span> : null}
      </span>
    );
  }
}

export function rotuloDoGrupo(agrupar: AgrupamentoDoExtrato, l: MovimentoCaixa): string {
  switch (agrupar) {
    case 'dia': return l.data ? dataCurta(l.data) : 'Sem data';
    case 'conta': return l.conta_nome || 'Sem conta';
    case 'pessoa': return l.pessoa_nome || 'Sem pessoa';
    case 'forma': return rotuloDaForma(l.forma) || 'Sem forma';
    case 'origem': return ROTULO_DA_ORIGEM[l.origem];
    default: return '';
  }
}

function chaveDoGrupo(agrupar: AgrupamentoDoExtrato, l: MovimentoCaixa): string {
  switch (agrupar) {
    case 'dia': return l.data;
    case 'conta': return l.conta_nome;
    case 'pessoa': return l.pessoa_nome;
    case 'forma': return l.forma;
    case 'origem': return l.origem;
    default: return '';
  }
}

export interface GradeProps {
  linhas: MovimentoCaixa[];
  colunas: ColunaId[];
  ordem: OrdemDoExtrato;
  direcao: 'asc' | 'desc';
  onOrdenar: (o: OrdemDoExtrato) => void;
  agrupar: AgrupamentoDoExtrato;
  grupos: GrupoDoExtrato[];
  multiConta: boolean;
  selecionadas: ReadonlyMap<string, number>;
  onSelecionar: (linhas: MovimentoCaixa[], marcar: boolean) => void;
  onAbrir: (l: MovimentoCaixa) => void;
  /** Linha "Saldo anterior" no topo e "Saldo final" no rodapé (extrato cronológico). */
  saldoAnterior?: { data: string; valor: number } | null;
  saldoFinal?: { data: string; valor: number } | null;
  carregando: boolean;
  rotuloDaTabela: string;
}

const TH = 'sticky top-0 z-[var(--fin-z-conteudo)] h-9 whitespace-nowrap border-b border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 fin-t-overline text-[var(--fin-text-3)] max-lg:h-11';
const TD = 'px-3 py-2 align-middle fin-t-body text-[var(--fin-text)]';

export function GradeDeMovimentos({
  linhas, colunas, ordem, direcao, onOrdenar, agrupar, grupos, multiConta, selecionadas, onSelecionar, onAbrir,
  saldoAnterior, saldoFinal, carregando, rotuloDaTabela,
}: GradeProps) {
  const defs = colunas.map(c => COLUNAS[c]);
  const total = defs.length + 1;
  const todasMarcadas = linhas.length > 0 && linhas.every(l => selecionadas.has(l.chave));
  const algumaMarcada = linhas.some(l => selecionadas.has(l.chave));
  const marcarTodas = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (marcarTodas.current) marcarTodas.current.indeterminate = algumaMarcada && !todasMarcadas;
  }, [algumaMarcada, todasMarcadas]);

  const grupoPorChave = new Map(grupos.map(g => [g.chave, g]));
  const corpo: React.ReactNode[] = [];
  let grupoAtual: string | null = null;

  if (saldoAnterior) {
    corpo.push(
      <tr key="saldo-anterior" className="border-b border-[var(--fin-border)] bg-[var(--fin-surface-sunken)]">
        <td className={TD} />
        <td className={cn(TD, 'fin-t-body-strong')} colSpan={Math.max(1, defs.length - 1)}>
          Saldo anterior em {dataCurta(saldoAnterior.data)}
        </td>
        <td className={cn(TD, 'text-right')}><Saldo v={saldoAnterior.valor} forte /></td>
      </tr>,
    );
  }

  for (const l of linhas) {
    if (agrupar !== 'nenhum') {
      const chave = chaveDoGrupo(agrupar, l);
      if (chave !== grupoAtual) {
        grupoAtual = chave;
        const g = grupoPorChave.get(chave);
        corpo.push(
          <tr key={`grupo-${chave}-${l.chave}`} className="border-b border-[var(--fin-border)] bg-[var(--fin-surface-2)]">
            <td colSpan={total} className="px-3 py-1.5">
              <span className="flex flex-wrap items-baseline justify-between gap-x-[var(--fin-s-4)] gap-y-0.5">
                <span className="fin-t-body-strong text-[var(--fin-text)]">{rotuloDoGrupo(agrupar, l)}</span>
                {g ? (
                  <span className="flex flex-wrap gap-x-[var(--fin-s-4)] fin-t-caption tabular-nums text-[var(--fin-text-2)]">
                    <span>{g.quantidade} {g.quantidade === 1 ? 'lançamento' : 'lançamentos'}</span>
                    <span>Entradas <b className="font-semibold text-[var(--fin-positive)]">{formatBRL(g.entradas)}</b></span>
                    <span>Saídas <b className="font-semibold text-[var(--fin-text)]">{formatBRL(g.saidas)}</b></span>
                    <span>Líquido <b className="font-semibold text-[var(--fin-text)]">{formatBRL(g.entradas - g.saidas)}</b></span>
                  </span>
                ) : null}
              </span>
            </td>
          </tr>,
        );
      }
    }
    const marcada = selecionadas.has(l.chave);
    corpo.push(
      <tr
        key={l.chave}
        tabIndex={0}
        aria-selected={marcada}
        onClick={() => onAbrir(l)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onAbrir(l); }
          if (e.key === ' ') { e.preventDefault(); onSelecionar([l], !marcada); }
        }}
        className={cn(
          'cursor-pointer border-b border-[var(--fin-border)] hover:bg-[var(--fin-surface-2)]',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
          marcada && 'bg-[var(--fin-accent-soft)] hover:bg-[var(--fin-accent-soft)]',
        )}
      >
        <td className="w-10 px-3 py-2 align-middle" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={marcada}
            onChange={e => onSelecionar([l], e.target.checked)}
            aria-label={`Selecionar ${l.descricao || ROTULO_DA_ORIGEM[l.origem]}, ${formatBRL(l.valor)}`}
            className="size-4 cursor-pointer accent-[var(--fin-accent)]"
          />
        </td>
        {defs.map(d => (
          <td key={d.id} className={cn(TD, d.largura, d.direita && 'text-right')}>{celula(l, d.id, multiConta)}</td>
        ))}
      </tr>,
    );
  }

  if (saldoFinal) {
    corpo.push(
      <tr key="saldo-final" className="bg-[var(--fin-surface-sunken)]">
        <td className={TD} />
        <td className={cn(TD, 'fin-t-body-strong')} colSpan={Math.max(1, defs.length - 1)}>
          Saldo em {dataCurta(saldoFinal.data)}
        </td>
        <td className={cn(TD, 'text-right')}><Saldo v={saldoFinal.valor} forte /></td>
      </tr>,
    );
  }

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={`${rotuloDaTabela}, rolagem horizontal disponível`}
      aria-busy={carregando}
      className={cn(
        'max-h-[70vh] w-full overflow-auto rounded-[var(--fin-r-lg)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
        carregando && 'opacity-60 transition-opacity duration-[var(--fin-dur-base)]',
      )}
    >
      <table className="w-full border-collapse" aria-label={rotuloDaTabela}>
        <thead>
          <tr>
            <th scope="col" className={cn(TH, 'w-10')}>
              <input
                ref={marcarTodas}
                type="checkbox"
                checked={todasMarcadas}
                onChange={e => onSelecionar(linhas, e.target.checked)}
                aria-label="Selecionar todas as linhas desta página"
                className="size-4 cursor-pointer accent-[var(--fin-accent)]"
              />
            </th>
            {defs.map(d => {
              const ativa = d.ordem && ordem === d.ordem;
              const Icone = !ativa ? ChevronsUpDown : direcao === 'asc' ? ChevronUp : ChevronDown;
              return (
                <th
                  key={d.id}
                  scope="col"
                  aria-sort={d.ordem ? (ativa ? (direcao === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  className={cn(TH, d.largura, d.direita ? 'text-right' : 'text-left')}
                >
                  {d.ordem ? (
                    <button
                      type="button"
                      onClick={() => onOrdenar(d.ordem!)}
                      className={cn(
                        'inline-flex h-9 w-full items-center gap-[var(--fin-s-1)] rounded-[var(--fin-r-sm)] fin-t-overline max-lg:h-11',
                        ativa ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]',
                        'hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]',
                        d.direita ? 'justify-end' : 'justify-start',
                      )}
                    >
                      {d.cabecalho}
                      <Icone aria-hidden="true" className="size-3 opacity-70" />
                    </button>
                  ) : d.cabecalho}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{corpo}</tbody>
      </table>
    </div>
  );
}
