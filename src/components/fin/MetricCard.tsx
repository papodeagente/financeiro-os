'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Info, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { comAlfa } from '@/lib/cor';
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
  /**
   * O que o número É.
   *
   * O padrão é dinheiro porque era a única coisa que este cartão media, e
   * mudar o default reescreveria todas as telas que já existem. Mas cartão de
   * CONTAGEM é necessidade real — "7 negociações" saía como "R$ 7,00", que é
   * errado de um jeito que ninguém defende — e passar a unidade é mais honesto
   * do que pedir ao chamador que formate por fora e perca o tratamento de
   * carregando/indisponível que o <Money> dá.
   */
  formato?: 'dinheiro' | 'contagem';
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

/** A cor CHEIA de cada tom. A casquinha deriva o degradê dela. */
const COR_DO_TOM: Record<TomDoIcone, string> = {
  acento: 'var(--fin-accent)',
  positivo: 'var(--fin-positive)',
  negativo: 'var(--fin-negative-text)',
  aviso: 'var(--fin-warning-text)',
  violeta: 'var(--fin-violet)',
  info: 'var(--fin-info)',
};

/**
 * A casquinha do ícone: quadrado arredondado com tinta suave em degradê.
 *
 * O degradê é a assinatura visual do Entur OS. Fundo chapado lê como selo;
 * degradê lê como superfície. O raio tem token próprio (--fin-r-tile, 10px):
 * em 8px o quadrado parece um botão, acima de 14px vira bolha.
 *
 * A cor vem do TOM, nunca de uma paleta decorativa. Cor de estado continua
 * querendo dizer estado — um ícone verde escolhido por gosto ensina a
 * ignorar o verde que quer dizer recebido.
 */
export function IconeDeIndicador({ icone: Icone, tom = 'acento', tamanho = 'md' }: {
  icone: LucideIcon;
  tom?: TomDoIcone;
  /** sm 36px · md 40px · lg 48px */
  tamanho?: 'sm' | 'md' | 'lg';
}) {
  const cor = COR_DO_TOM[tom];
  const medida = tamanho === 'sm' ? 'size-9' : tamanho === 'lg' ? 'size-12' : 'size-10';
  const corpo = tamanho === 'lg' ? 'size-5' : 'size-4';
  return (
    <span
      aria-hidden="true"
      className={cn('grid shrink-0 place-items-center rounded-[var(--fin-r-tile)]', medida)}
      style={{
        backgroundImage: `linear-gradient(to bottom right, ${comAlfa(cor, 15)}, ${comAlfa(cor, 5)})`,
        color: cor,
      }}
    >
      <Icone className={corpo} />
    </span>
  );
}

/**
 * Contagem no mesmo degrau tipográfico do dinheiro, para a linha de cartões
 * alinhar. Carregando e indisponível NÃO pintam número, pela mesma razão que
 * no <Money>: um "0" de placeholder é uma afirmação falsa.
 */
function Contagem({ valor, estado, emphasis }: {
  valor: number | null;
  estado: MoneyEstado;
  emphasis: 'destaque' | 'padrao';
}) {
  const degrau = emphasis === 'destaque' ? 'fin-t-metric' : 'fin-t-metric-sm';
  if (estado !== 'ok' || valor === null || valor === undefined) {
    return <span className={`${degrau} tabular-nums text-[var(--fin-text-3)]`}>{'—'}</span>;
  }
  return (
    <span className={`${degrau} tabular-nums text-[var(--fin-text)]`}>
      {valor.toLocaleString('pt-BR')}
    </span>
  );
}

export function MetricCard({
  rotulo,
  valor,
  estado,
  contexto,
  emphasis = 'padrao',
  formato = 'dinheiro',
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

      {/* A pilha do Entur OS: casquinha em cima, rótulo em maiúsculas, número
          grande, legenda. O ícone ao LADO do texto empurrava o número para
          fora do eixo e encolhia o rótulo numa coluna estreita. */}
      <div className={cn('relative flex flex-col', interativo && 'pointer-events-none')}>
        {Icone && (
          <div className="mb-[var(--fin-s-4)]">
            <IconeDeIndicador icone={Icone} tom={tomIcone} />
          </div>
        )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <h3 className="fin-t-overline text-[var(--fin-text-2)]">{rotulo}</h3>
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

        {formato === 'contagem' ? (
          <Contagem valor={valor} estado={estado} emphasis={emphasis} />
        ) : (
          <Money
            valor={valor}
            estado={estado}
            size={emphasis === 'destaque' ? 'metric' : 'metricSm'}
            tone={tone}
            align="esquerda"
          />
        )}

        {delta && estado === 'ok' && <DeltaIndicator {...delta} />}

        <p className="fin-t-caption text-[var(--fin-text-3)]">{contexto}</p>
      </div>
      </div>
    </div>
  );
}

export default MetricCard;
