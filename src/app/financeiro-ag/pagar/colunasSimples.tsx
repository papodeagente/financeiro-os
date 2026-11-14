'use client';

import { Paperclip, Pencil, Trash2 } from 'lucide-react';

import type { ContaPagar } from '@/lib/crm-types';
import type { FinColuna } from '@/components/fin/FinTable';
import { Money } from '@/components/fin/Money';
import { StatusChip, rotuloStatus } from '@/components/fin/StatusChip';
import { Button } from '@/components/ui/button';
import { num } from '@/lib/money';
import { cn, formatDate } from '@/lib/utils';

/**
 * Colunas da tabela de Contas a pagar. Camada de apresentação apenas: todo
 * número vem pronto das funções auditadas da página, passadas aqui como
 * dependências. Nenhum cálculo nasce neste arquivo.
 */
export type DependenciasDasColunas = {
  /** valorBRLDaConta da página. */
  valorBRL: (i: ContaPagar) => number;
  /** saldoDevedor da página. */
  saldo: (i: ContaPagar) => number;
  /** ehVencidoEmAberto(i, hoje) da página. */
  vencidaEmAberto: (i: ContaPagar) => boolean;
  /** Mesma condição de hoje: PENDENTE, VENCIDO ou PARCIAL. */
  podePagar: (i: ContaPagar) => boolean;
  onPagar: (i: ContaPagar) => void;
  onEditar: (i: ContaPagar) => void;
  onExcluir: (i: ContaPagar) => void;
};

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

/** Ação de linha é sempre contornada, nunca preenchida (seção 8.2). */
const BOTAO_LINHA = cn(
  'fin-t-body h-11 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)]',
  'px-3 text-[var(--fin-text)] shadow-none hover:bg-[var(--fin-surface-2)] lg:h-10',
  FOCO,
);

/** Ação destrutiva e ação secundária: fantasma, com rótulo acessível. */
const BOTAO_ICONE = cn(
  'size-11 rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] shadow-none',
  'hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] lg:size-10',
  FOCO,
);

/**
 * Conta cujo custo veio do CRM sem dizer a quem pagar. A dívida é real (o
 * dinheiro vai sair), só falta o fornecedor — e quem resolve isso é o
 * financeiro, editando a conta.
 */
export function semFornecedor(i: ContaPagar): boolean {
  return !(i.fornecedor_nome || '').trim();
}

function nomeDoFornecedor(i: ContaPagar): string {
  const nome = (i.fornecedor_nome || '').trim();
  if (nome) return nome;
  return i.fornecedor_pendente || i.origem === 'VENDA'
    ? 'Sem fornecedor no CRM'
    : 'Sem fornecedor';
}

export function criarColunas(dep: DependenciasDasColunas): FinColuna<ContaPagar>[] {
  return [
    {
      id: 'fornecedor',
      cabecalho: 'Fornecedor',
      tipo: 'texto',
      sortable: true,
      minWidth: 220,
      acessor: (i) => i.fornecedor_nome || '',
      render: (i) => (
        <span className="flex min-w-0 flex-col gap-1">
          <span
            className={cn(
              'fin-t-body-strong truncate',
              semFornecedor(i) ? 'text-[var(--fin-warning-text)]' : 'text-[var(--fin-text)]',
            )}
          >
            {nomeDoFornecedor(i)}
          </span>
          {i.descricao ? (
            <span className="fin-t-caption truncate text-[var(--fin-text-3)]">{i.descricao}</span>
          ) : null}
          <span className="flex flex-wrap items-center gap-1">
            {/* Abaixo de 900px a coluna Status colapsa e o estado vem para cá. */}
            <span className="hidden max-[900px]:inline-flex">
              <StatusChip valor={i.status} dominio="pagar" dot />
            </span>
            {i.origem === 'VENDA' || i.origem === 'GRUPO' ? (
              <StatusChip valor={i.origem} dominio="origem" />
            ) : null}
            {/* Comprovante anexado na baixa. Sem isto, o arquivo seria
                enviado e nunca mais visto. */}
            {(i.anexos ?? []).length > 0 ? (
              <a
                href={i.anexos[i.anexos.length - 1].url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 fin-t-caption text-[var(--fin-accent)] underline underline-offset-2"
                title={
                  i.anexos.length === 1
                    ? `Comprovante: ${i.anexos[0].nome}`
                    : `${i.anexos.length} comprovantes. Abre o mais recente.`
                }
              >
                <Paperclip className="h-3 w-3" aria-hidden />
                {i.anexos.length === 1 ? 'Comprovante' : `${i.anexos.length} comprovantes`}
              </a>
            ) : null}
            {i.is_custo_comercial ? (
              <span className="fin-t-caption text-[var(--fin-text-3)]">
                Custo para conseguir cliente
              </span>
            ) : null}
            {semFornecedor(i) ? (
              <button
                type="button"
                onClick={() => dep.onEditar(i)}
                className={cn(
                  'fin-t-caption rounded-[var(--fin-r-sm)] border border-[var(--fin-warning)] px-2 py-0.5',
                  'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)] hover:opacity-80',
                  FOCO,
                )}
              >
                Informar fornecedor
              </button>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      id: 'vencimento',
      cabecalho: 'Vencimento',
      tipo: 'texto',
      sortable: true,
      minWidth: 132,
      acessor: (i) => i.data_vencimento || '',
      render: (i) => {
        const vencida = dep.vencidaEmAberto(i);
        return (
          <span className="flex flex-col gap-1">
            <span
              className={cn(
                'fin-t-body whitespace-nowrap tabular-nums',
                vencida ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]',
              )}
            >
              {i.data_vencimento ? formatDate(i.data_vencimento) : 'Sem data'}
            </span>
            {vencida ? (
              <span className="fin-t-caption text-[var(--fin-negative-text)]">Vencida</span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'valor',
      cabecalho: 'Valor',
      tipo: 'dinheiro',
      sortable: true,
      minWidth: 140,
      valor: (i) => dep.valorBRL(i),
      sub: (i) => {
        const estrangeira = i.moeda !== 'BRL';
        const parcial = i.status === 'PARCIAL';
        if (!estrangeira && !parcial) return null;
        return (
          <span className="flex flex-col items-end gap-1">
            {estrangeira ? (
              <Money
                valor={num(i.valor_original)}
                moeda={i.moeda}
                size="caption"
                tone="suave"
                aria-label={`Valor original em ${i.moeda}`}
              />
            ) : null}
            {parcial ? (
              <span className="flex flex-wrap items-center justify-end gap-1">
                <span>Pago</span>
                <Money valor={num(i.valor_pago)} size="caption" tone="suave" />
                <span aria-hidden="true">·</span>
                <span>falta</span>
                <Money valor={dep.saldo(i)} size="caption" tone="suave" />
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'status',
      cabecalho: 'Situação',
      tipo: 'status',
      dominio: 'pagar',
      prioridade: 2,
      valor: (i) => i.status,
    },
    {
      id: 'natureza',
      cabecalho: 'Tipo de despesa',
      tipo: 'texto',
      prioridade: 1,
      minWidth: 148,
      render: (i) =>
        i.natureza_custo ? (
          <StatusChip valor={i.natureza_custo} dominio="natureza" />
        ) : (
          <span className="fin-t-caption text-[var(--fin-text-3)]">Sem classificação</span>
        ),
    },
    {
      id: 'acoes',
      cabecalho: 'Ações',
      tipo: 'acoes',
      minWidth: 176,
      render: (i) => (
        <>
          {dep.podePagar(i) ? (
            <Button
              type="button"
              variant="ghost"
              className={BOTAO_LINHA}
              aria-label={`Pagar a conta de ${nomeDoFornecedor(i)}`}
              onClick={() => dep.onPagar(i)}
            >
              Pagar
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={BOTAO_ICONE}
            aria-label={`Editar a conta de ${nomeDoFornecedor(i)}`}
            onClick={() => dep.onEditar(i)}
          >
            <Pencil aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(BOTAO_ICONE, 'text-[var(--fin-negative)] hover:text-[var(--fin-negative-text)]')}
            aria-label={`Excluir a conta de ${nomeDoFornecedor(i)}, situação ${rotuloStatus('pagar', i.status)}`}
            onClick={() => dep.onExcluir(i)}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
        </>
      ),
    },
  ];
}
