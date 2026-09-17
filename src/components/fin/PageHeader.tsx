'use client';

import * as React from 'react';
import Link from 'next/link';
import { RefreshCw, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PageHeaderProps = {
  titulo: string;
  /** Uma linha em caption. Opcional e curta. Aceita <Jargao>. */
  subtitulo?: React.ReactNode;
  acaoPrimaria?: { rotulo: string; icone?: LucideIcon; href?: string; onClick?: () => void };
  acoesSecundarias?: { rotulo: string; href?: string; onClick?: () => void }[];
  badge?: React.ReactNode;
  /** Carimbo honesto: só é escrito quando load() TERMINOU com sucesso. */
  atualizadoEm?: Date | null;
  onRecarregar?: () => Promise<void>;
};

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

/**
 * 40px no desktop, 44px abaixo de 1024px (alvo de toque).
 *
 * No celular o botão ocupa a linha inteira. Antes eles eram do tamanho do
 * texto e quebravam linha em sequência: com o ícone de recarregar dividindo
 * a mesma faixa, cada botão começava num recuo diferente e a faixa de ações
 * ficava escalonada. Largura inteira dá uma borda esquerda só.
 */
const BOTAO_BASE = cn(
  'fin-t-body h-11 w-full gap-[var(--fin-s-1)] rounded-[var(--fin-r-md)] px-4 shadow-none lg:h-10 lg:w-auto',
  FOCO,
);

const BOTAO_PRIMARIA = cn(
  BOTAO_BASE,
  'bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] hover:text-[var(--fin-text-on-fill)]',
);

const BOTAO_SECUNDARIA = cn(
  BOTAO_BASE,
  'border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
);

function horaDoCarimbo(quando: Date): string {
  return quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Cabeçalho único das telas do financeiro. Uma linha, um H1, no máximo uma
 * ação primária. Filtro nunca entra aqui: vai para a FilterBar.
 * Sem margem própria; o ritmo vertical é do shell.
 *
 * Duas formas:
 *  - celular: grade de duas colunas. Título ocupa a coluna larga, recarregar
 *    fica no canto superior direito e as ações descem para uma faixa inteira.
 *  - a partir de lg: a linha única de sempre, título à esquerda e o grupo de
 *    ações à direita.
 */
export function PageHeader({
  titulo,
  subtitulo,
  acaoPrimaria,
  acoesSecundarias,
  badge,
  atualizadoEm,
  onRecarregar,
}: PageHeaderProps) {
  const [recarregando, setRecarregando] = React.useState(false);

  async function recarregar() {
    if (!onRecarregar || recarregando) return;
    setRecarregando(true);
    try {
      await onRecarregar();
    } finally {
      setRecarregando(false);
    }
  }

  const IconePrimaria = acaoPrimaria?.icone;

  return (
    <header
      data-slot="fin-page-header"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-[var(--fin-s-2)] gap-y-[var(--fin-s-3)]',
        'lg:flex lg:min-h-14 lg:flex-row lg:items-start lg:gap-[var(--fin-s-3)]',
      )}
    >
      <div className="flex min-w-0 flex-col gap-[var(--fin-s-1)] lg:flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-[var(--fin-s-2)]">
          <h1 className="fin-t-title min-w-0 truncate text-[var(--fin-text)]">{titulo}</h1>
          {badge}
        </div>
        {subtitulo ? (
          <p className="fin-t-caption text-[var(--fin-text-3)]">{subtitulo}</p>
        ) : null}
      </div>

      {/* Recarregar é utilitário, não ação: no celular fica ao lado do título
          e não rouba uma linha inteira da faixa de ações. */}
      {onRecarregar ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Recarregar dados"
          disabled={recarregando}
          onClick={recarregar}
          className={cn(
            'size-11 shrink-0 justify-self-end rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] shadow-none hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)] lg:order-2 lg:size-10',
            FOCO,
          )}
        >
          <RefreshCw aria-hidden="true" className={cn('size-4', recarregando && 'animate-spin')} />
        </Button>
      ) : null}

      <div className="col-span-2 flex flex-col gap-[var(--fin-s-1)] lg:order-3 lg:shrink-0 lg:items-end">
        <div className="flex flex-col gap-[var(--fin-s-2)] lg:flex-row lg:flex-wrap lg:items-center">
          {(acoesSecundarias ?? []).map((acao) =>
            acao.href ? (
              <Button
                key={acao.rotulo}
                variant="ghost"
                nativeButton={false}
                className={BOTAO_SECUNDARIA}
                render={<Link href={acao.href} />}
              >
                {acao.rotulo}
              </Button>
            ) : (
              <Button
                key={acao.rotulo}
                type="button"
                variant="ghost"
                className={BOTAO_SECUNDARIA}
                onClick={acao.onClick}
              >
                {acao.rotulo}
              </Button>
            ),
          )}

          {acaoPrimaria ? (
            acaoPrimaria.href ? (
              <Button
                variant="ghost"
                nativeButton={false}
                className={BOTAO_PRIMARIA}
                render={<Link href={acaoPrimaria.href} />}
              >
                {IconePrimaria ? <IconePrimaria aria-hidden="true" className="size-4" /> : null}
                {acaoPrimaria.rotulo}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className={BOTAO_PRIMARIA}
                onClick={acaoPrimaria.onClick}
              >
                {IconePrimaria ? <IconePrimaria aria-hidden="true" className="size-4" /> : null}
                {acaoPrimaria.rotulo}
              </Button>
            )
          ) : null}
        </div>

        {atualizadoEm ? (
          <p className="fin-t-caption text-[var(--fin-text-3)]">
            Atualizado às {horaDoCarimbo(atualizadoEm)}
          </p>
        ) : null}
      </div>
    </header>
  );
}

export default PageHeader;
