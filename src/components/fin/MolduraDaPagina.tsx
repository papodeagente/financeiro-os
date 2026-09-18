import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A moldura de uma página do sistema: respiro nas bordas, largura máxima e
 * ritmo vertical entre os blocos.
 *
 * POR QUE EXISTE. Dez telas repetiam essas três decisões à mão, e as do pilar
 * Equipe simplesmente não as tinham: o conteúdo nascia colado na barra lateral,
 * sem largura máxima, esticando a linha de texto pelo monitor inteiro — e sem
 * espaço nenhum entre um bloco e o seguinte, porque o ritmo vertical também era
 * responsabilidade de quem escrevia a página.
 *
 * Regra que a moldura encerra, uma vez: o respiro lateral é `--fin-page-pad`
 * (24px no desktop, 16px no celular), a leitura para em `--fin-page-max`, e
 * blocos irmãos ficam a `--fin-s-5` de distância. Quem escreve uma página nova
 * não escolhe nada disso, e por isso não erra.
 *
 * O NOME não é "PageShell" de propósito: já existe um
 * `@/components/PageShell`, do dialeto legado (tokens `--t-*`, largura
 * 1400px), usado por doze telas. Dois componentes de mesmo nome e mesmo
 * papel fazem o autocomplete importar o errado sem erro de compilação, e a
 * tela sai com o respiro e a largura de outro sistema.
 */
export function MolduraDaPagina({
  children,
  /** Desliga o ritmo vertical quando a página controla o próprio espaçamento. */
  semRitmo = false,
  className,
}: {
  children: React.ReactNode;
  semRitmo?: boolean;
  className?: string;
}) {
  return (
    <div className="w-full bg-[var(--fin-bg)] px-[var(--fin-page-pad)] py-[var(--fin-page-pad)] text-[var(--fin-text)]">
      <div
        className={cn(
          'mx-auto w-full max-w-[var(--fin-page-max)]',
          !semRitmo && 'flex flex-col gap-[var(--fin-s-5)]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * O ritmo vertical de um trecho da página.
 *
 * Existe para o conteúdo DENTRO de um DataState: o ramo 'ok' dele é um div
 * cru, então sem isto os blocos de uma tela inteira se encostam — que era o
 * defeito visível nas quatro telas do pilar Equipe.
 */
export const RITMO_DA_PAGINA = 'flex flex-col gap-[var(--fin-s-5)]';

export default MolduraDaPagina;
