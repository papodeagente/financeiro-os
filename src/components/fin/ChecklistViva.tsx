'use client';

/**
 * A lista do que o sistema está fazendo enquanto a pessoa espera.
 *
 * Uma barra de carregamento diz "espere"; esta lista diz o que está
 * acontecendo e o que já deu certo. Numa configuração que fala com três
 * serviços (emissor, Receita, prefeitura), a diferença entre "deu erro" e
 * "deu erro NO QUÊ" é o que permite agir.
 *
 * aria-live="polite" para quem usa leitor de tela ouvir o avanço sem ser
 * interrompido a cada item.
 */

import { AlertCircle, Check, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type EstadoDoItem = 'aguardando' | 'fazendo' | 'feito' | 'falhou';

export interface ItemDaChecklist {
  chave: string;
  titulo: string;
  estado: EstadoDoItem;
  /** O que foi descoberto, ou o motivo da falha. */
  detalhe?: string;
  acao?: { rotulo: string; onClick: () => void };
}

const ICONE: Record<EstadoDoItem, { Componente: typeof Check; classe: string; girando?: boolean }> = {
  aguardando: { Componente: Circle, classe: 'text-[var(--fin-text-3)] opacity-50' },
  fazendo: { Componente: Loader2, classe: 'text-[var(--fin-accent)]', girando: true },
  feito: { Componente: Check, classe: 'text-[var(--fin-positive)]' },
  falhou: { Componente: AlertCircle, classe: 'text-[var(--fin-negative)]' },
};

const ROTULO_ESTADO: Record<EstadoDoItem, string> = {
  aguardando: 'aguardando',
  fazendo: 'fazendo agora',
  feito: 'concluído',
  falhou: 'falhou',
};

export function ChecklistViva({ itens }: { itens: ItemDaChecklist[] }) {
  return (
    <ul className="flex flex-col gap-1" aria-live="polite">
      {itens.map(item => {
        const { Componente, classe, girando } = ICONE[item.estado];
        return (
          <li key={item.chave} className="flex min-h-11 items-start gap-3 py-1.5">
            <Componente
              aria-hidden="true"
              className={cn('mt-0.5 size-5 shrink-0', classe, girando && 'animate-spin')}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  'fin-t-body',
                  item.estado === 'aguardando'
                    ? 'text-[var(--fin-text-3)]'
                    : 'text-[var(--fin-text)]',
                )}
              >
                {item.titulo}
                <span className="sr-only">: {ROTULO_ESTADO[item.estado]}</span>
              </span>
              {item.detalhe ? (
                <span
                  className={cn(
                    'fin-t-caption break-words',
                    item.estado === 'falhou'
                      ? 'text-[var(--fin-negative)]'
                      : 'text-[var(--fin-text-2)]',
                  )}
                >
                  {item.detalhe}
                </span>
              ) : null}
              {item.acao ? (
                <button
                  type="button"
                  onClick={item.acao.onClick}
                  className="fin-t-caption self-start text-[var(--fin-accent)] underline"
                >
                  {item.acao.rotulo}
                </button>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
