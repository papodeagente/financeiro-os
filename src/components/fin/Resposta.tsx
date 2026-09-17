'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A resposta da tela: o número que ela existe para dar, o julgamento desse
 * número e a régua contra a qual ele se lê — na mesma peça.
 *
 * POR QUE EXISTE. O teste é de dez segundos: quem abre precisa sair sabendo
 * como o mês está indo sem rolar e sem tocar. Nas telas que este componente
 * substitui o número aparece em cima e o julgamento ("dentro do limite",
 * "abaixo do ritmo") cai três blocos abaixo, então a pessoa lê um fato sem
 * saber se é bom. Aqui fato, julgamento e régua nascem juntos.
 *
 * SEM CARTÃO E SEM BORDA, direto sobre o fundo da página. A hierarquia é
 * tipográfica. A regra de contenção do pilar: borda só existe onde há item
 * repetido para comparar.
 */

export type TomDoChip = 'positivo' | 'aviso' | 'negativo' | 'neutro';

export type RespostaProps = {
  /** 'FICOU COM A AGÊNCIA EM SETEMBRO' — o recorte, sempre com o período. */
  overline: string;
  /**
   * String vira .fin-t-resposta direto (percentual, contagem, multiplicador).
   * ReactNode para dinheiro: <Money size="resposta" />, que sabe não pintar
   * R$ 0,00 quando o valor não é conhecido.
   */
  valor: string | React.ReactNode;
  /** A leitura em linguagem de dono. No máximo três linhas em 375px. */
  frase: string;
  /** Ícone MAIS rótulo visível: cor de status sozinha nunca é sinal. */
  chip?: { icone: LucideIcon; rotulo: string; tom: TomDoChip } | null;
  /** UMA marca gráfica, encostada no número. Nunca duas. */
  marca?: React.ReactNode;
  acao?: { rotulo: string; onClick: () => void; carregando?: boolean } | null;
  className?: string;
};

const TOM_DO_CHIP: Record<TomDoChip, string> = {
  positivo: 'text-[var(--fin-positive)] bg-[var(--fin-positive-soft)]',
  aviso: 'text-[var(--fin-warning-text)] bg-[var(--fin-warning-soft)]',
  negativo: 'text-[var(--fin-negative-text)] bg-[var(--fin-negative-soft)]',
  neutro: 'text-[var(--fin-text-2)] bg-[var(--fin-surface-2)]',
};

/** Contador de montagens. Duas respostas na mesma tela é duas manchetes. */
let montadas = 0;

export function Resposta({
  overline,
  valor,
  frase,
  chip = null,
  marca,
  acao = null,
  className,
}: RespostaProps) {
  const id = React.useId();

  React.useEffect(() => {
    montadas += 1;
    if (montadas > 1 && process.env.NODE_ENV !== 'production') {
      console.warn(
        '[fin] Duas Resposta montadas na mesma tela. A tela responde UMA pergunta; ' +
          'o segundo número vira MetricCard ou entra na frase.',
      );
    }
    return () => {
      montadas -= 1;
    };
  }, []);

  const Icone = chip?.icone;

  return (
    <section
      data-fin-resposta=""
      aria-labelledby={id}
      className={cn(
        'flex flex-col gap-2',
        // As duas colunas só existem quando há marca. Sem ela, a linha de flex
        // mantinha a coluna de texto presa em 380px e deixava o resto do quadro
        // VAZIO — uma frase quebrando em três linhas com meia tela em branco ao
        // lado. Sem marca, a resposta é um bloco só.
        marca && 'lg:flex-row lg:items-center lg:gap-8',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-col gap-2',
          // Com marca, largura fixa para a marca ter o resto. Sem marca, um
          // limite de LEITURA: a frase não deve atravessar 1280px de monitor.
          marca ? 'lg:w-[380px] lg:shrink-0' : 'max-w-[62ch]',
        )}
      >
        <h2 id={id} className="fin-t-overline text-[var(--fin-text-3)]">
          {overline}
        </h2>

        {typeof valor === 'string' ? (
          <p className="fin-t-resposta text-[var(--fin-text)]">{valor}</p>
        ) : (
          <div className="flex">{valor}</div>
        )}

        <p className="fin-t-body text-[var(--fin-text-2)]">{frase}</p>

        {(chip || acao) && (
          <div className="flex flex-wrap items-center gap-2">
            {chip && Icone ? (
              <span
                data-fin-chip={chip.tom}
                className={cn(
                  'fin-t-caption inline-flex items-center gap-1.5 rounded-[var(--fin-r-sm)] px-2 py-1 font-semibold',
                  TOM_DO_CHIP[chip.tom],
                )}
              >
                <Icone className="size-4 shrink-0" aria-hidden="true" />
                {chip.rotulo}
              </span>
            ) : null}

            {acao ? (
              <button
                type="button"
                onClick={acao.onClick}
                disabled={acao.carregando}
                className="fin-t-body-strong inline-flex h-11 items-center rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-4 text-[var(--fin-text)] transition-colors hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] disabled:opacity-60"
              >
                {acao.carregando ? 'Aguarde…' : acao.rotulo}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* A marca cresce com a largura; o número não. */}
      {marca ? <div className="min-w-0 flex-1">{marca}</div> : null}
    </section>
  );
}

export default Resposta;
