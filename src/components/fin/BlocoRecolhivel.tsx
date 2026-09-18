'use client';

/**
 * Bloco recolhível de formulário longo, com o título e a seta à direita.
 *
 * Existe porque o formulário de emissão de nota tem três blocos que a maioria
 * das empresas nunca preenche (reforma tributária, retenção na fonte, outras
 * deduções) e um que todas preenchem. Mostrar os quatro abertos transforma uma
 * tarefa de trinta segundos numa tela de rolagem, e é assim que o usuário
 * comum desiste de emitir e liga para a contabilidade.
 *
 * O bloco ABRE SOZINHO quando já tem conteúdo: quem preencheu retenção uma vez
 * não precisa procurar onde foi que preencheu. É `<details>` nativo, então
 * busca do navegador e leitor de tela continuam achando o que está dentro.
 */
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function BlocoRecolhivel({
  titulo, opcional = true, descricao, preenchido, children, id,
}: {
  titulo: string;
  /** Acrescenta "(Opcional)" ao título, como no modelo. */
  opcional?: boolean;
  descricao?: ReactNode;
  /** Há algo preenchido aqui dentro? Então o bloco nasce aberto. */
  preenchido?: boolean;
  children: ReactNode;
  id?: string;
}) {
  return (
    <details
      id={id}
      open={preenchido}
      className="group border-t border-[var(--fin-border)] pt-3 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="fin-t-subhead text-[var(--fin-text)]">
          {titulo}
          {opcional ? (
            <span className="fin-t-body font-normal text-[var(--fin-text-3)]"> (Opcional)</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-[var(--fin-text-3)] transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {descricao ? (
          <p className="fin-t-caption text-[var(--fin-text-2)]">{descricao}</p>
        ) : null}
        {children}
      </div>
    </details>
  );
}
