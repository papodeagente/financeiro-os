'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Info, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Money, type MoneyEstado } from '@/components/fin/Money';
import { DeltaIndicator, type DeltaIndicatorProps } from '@/components/fin/DeltaIndicator';

export const metricCardVariants = cva(
  'relative flex flex-col gap-1 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-5 text-left shadow-[var(--fin-e-card)]',
  {
    variants: {
      emphasis: { destaque: '', padrao: '' },
      interativo: {
        sim: 'transition-colors has-[>button:hover]:bg-[var(--fin-surface-2)] has-[>button:focus-visible]:outline-2 has-[>button:focus-visible]:outline-offset-2 has-[>button:focus-visible]:outline-[var(--fin-accent)]',
        nao: '',
      },
      ativo: { sim: 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]', nao: '' },
    },
    defaultVariants: { emphasis: 'padrao', interativo: 'nao', ativo: 'nao' },
  }
);

export type MetricCardVariants = VariantProps<typeof metricCardVariants>;

export type MetricCardProps = {
  rotulo: string;
  valor: number | null;
  estado: MoneyEstado;
  /**
   * OBRIGATÓRIO e não vazio. Recorte ("vencendo até 30/09, 12 contas"),
   * comparação ("R$ 4.100 a mais que em agosto") ou composição ("em 3 contas").
   * O TypeScript quebra sem ele: é impossível publicar um número solto.
   */
  contexto: string;
  /** 'destaque' renderiza em fin-t-metric (30px). NO MÁXIMO UM POR TELA. */
  emphasis?: 'destaque' | 'padrao';
  tone?: 'neutro' | 'positivo' | 'negativo';
  delta?: DeltaIndicatorProps | null;
  explicacao?: string;
  onClick?: () => void;
  ativo?: boolean;
  /**
   * Ícone do indicador, num quadrado de cor suave à esquerda (direção do
   * painel de referência). A cor segue o PAPEL do número: tone positivo
   * pinta de verde, negativo de vermelho, o resto do azul de destaque.
   * `tomDoIcone` só existe para o caso em que o número é neutro mas o
   * assunto tem cor própria (ex.: violeta para comissão).
   */
  icone?: LucideIcon;
  tomDoIcone?: 'acento' | 'positivo' | 'negativo' | 'aviso' | 'violeta' | 'info';
};

export type TomDoIcone = NonNullable<MetricCardProps['tomDoIcone']>;

const TOM_DO_ICONE: Record<TomDoIcone, string> = {
  acento: 'bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
  positivo: 'bg-[var(--fin-positive-soft)] text-[var(--fin-positive)]',
  negativo: 'bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)]',
  aviso: 'bg-[var(--fin-warning-soft)] text-[var(--fin-warning-text)]',
  violeta: 'bg-[var(--fin-violet-soft)] text-[var(--fin-violet)]',
  info: 'bg-[var(--fin-info-soft)] text-[var(--fin-info)]',
};

/** O quadrado de ícone dos indicadores. Compartilhado com cartões que não
 *  podem ser MetricCard (ex.: os do painel, que escondem o valor). */
export function IconeDeIndicador({ icone: Icone, tom = 'acento' }: { icone: LucideIcon; tom?: TomDoIcone }) {
  return (
    <span aria-hidden="true" className={cn('grid size-10 shrink-0 place-items-center rounded-[var(--fin-r-md)]', TOM_DO_ICONE[tom])}>
      <Icone className="size-5" />
    </span>
  );
}

export function MetricCard({
  rotulo,
  valor,
  estado,
  contexto,
  emphasis = 'padrao',
  tone = 'neutro',
  delta = null,
  explicacao,
  onClick,
  ativo = false,
  icone: Icone,
  tomDoIcone,
}: MetricCardProps) {
  const tomIcone = tomDoIcone ?? (tone === 'positivo' ? 'positivo' : tone === 'negativo' ? 'negativo' : 'acento');
  const interativo = typeof onClick === 'function';

  return (
    <div
      data-fin-metric-card=""
      className={metricCardVariants({
        emphasis,
        interativo: interativo ? 'sim' : 'nao',
        ativo: ativo ? 'sim' : 'nao',
      })}
    >
      {interativo && (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={ativo}
          className="absolute inset-0 cursor-pointer rounded-[var(--fin-r-lg)] outline-none"
        >
          <span className="sr-only">{`${rotulo}. ${contexto}`}</span>
        </button>
      )}

      <div className={cn('relative flex items-start gap-[var(--fin-s-3)]', interativo && 'pointer-events-none')}>
        {Icone && <IconeDeIndicador icone={Icone} tom={tomIcone} />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <h3 className="fin-t-body font-medium text-[var(--fin-text-2)]">{rotulo}</h3>
          {explicacao && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`O que é ${rotulo}`}
                    className="pointer-events-auto relative grid size-6 place-items-center rounded-[var(--fin-r-sm)] text-[var(--fin-text-3)] before:absolute before:-inset-[10px] before:content-[''] hover:text-[var(--fin-text-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
                  />
                }
              >
                <Info className="size-4" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>{explicacao}</TooltipContent>
            </Tooltip>
          )}
        </div>

        <Money
          valor={valor}
          estado={estado}
          size={emphasis === 'destaque' ? 'metric' : 'metricSm'}
          tone={tone}
          align="esquerda"
        />

        {delta && estado === 'ok' && <DeltaIndicator {...delta} />}

        <p className="fin-t-caption text-[var(--fin-text-3)]">{contexto}</p>
      </div>
      </div>
    </div>
  );
}

export default MetricCard;
