'use client';

/**
 * Pergunta ao alterar uma conta que se repete (05/11/2026):
 * Só esta / Esta e as próximas / Todas. Conta paga ou paga em parte
 * nunca muda, e o texto diz isso antes de confirmar.
 */
import * as React from 'react';
import { LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { EscopoDaEdicao } from '@/lib/recorrencia-cliente';
import { cn } from '@/lib/utils';

const OPCOES: { valor: EscopoDaEdicao; rotulo: string; explica: string }[] = [
  { valor: 'so_esta', rotulo: 'Só esta', explica: 'Só esta conta muda. As outras ficam como estão.' },
  { valor: 'esta_e_proximas', rotulo: 'Esta e as próximas', explica: 'Esta e as próximas mudam, inclusive as que ainda vão ser criadas.' },
  { valor: 'todas', rotulo: 'Todas', explica: 'Todas as contas em aberto da repetição mudam, também as anteriores.' },
];

export type EscopoDaSerieProps = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Texto da regra, "Todo dia 10, 12 vezes". */
  regra?: string | null;
  /** Quando o vencimento mudou: explica o que acontece nas outras. */
  avisoDeData?: string | null;
  processando: boolean;
  onConfirmar: (escopo: EscopoDaEdicao) => void;
};

export function EscopoDaSerie({ aberto, onOpenChange, regra, avisoDeData, processando, onConfirmar }: EscopoDaSerieProps) {
  const [escopo, setEscopo] = React.useState<EscopoDaEdicao>('so_esta');
  const nome = React.useId();

  React.useEffect(() => { if (aberto) setEscopo('so_esta'); }, [aberto]);

  return (
    <Dialog open={aberto} onOpenChange={p => { if (processando && !p) return; onOpenChange(p); }}>
      <DialogContent
        showCloseButton={false}
        className="gap-4 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4 text-[var(--fin-text)] shadow-[var(--fin-e2)] sm:max-w-[480px]"
      >
        <div className="flex flex-col gap-1">
          <DialogTitle className="fin-t-subhead text-[var(--fin-text)]">Esta conta faz parte de uma repetição</DialogTitle>
          <DialogDescription className="fin-t-body text-[var(--fin-text-2)]">
            Escolha quais contas recebem a alteração. Contas pagas ou pagas em parte ficam como estão.
          </DialogDescription>
          {regra ? <p className="fin-t-caption text-[var(--fin-text-3)]">{regra}</p> : null}
        </div>

        <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
          <legend className="sr-only">Aplicar a alteração em</legend>
          {OPCOES.map(o => {
            const ativo = escopo === o.valor;
            return (
              <label
                key={o.valor}
                className={cn(
                  'flex cursor-pointer items-start gap-[var(--fin-s-3)] rounded-[var(--fin-r-md)] border p-[var(--fin-s-3)]',
                  'transition-[border-color,background-color] duration-[var(--fin-dur-rapida)] motion-reduce:transition-none',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--fin-accent)]',
                  ativo
                    ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)]'
                    : 'border-[var(--fin-border)] bg-[var(--fin-surface)] hover:bg-[var(--fin-surface-2)]',
                )}
              >
                <input
                  type="radio"
                  name={nome}
                  value={o.valor}
                  checked={ativo}
                  onChange={() => setEscopo(o.valor)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--fin-accent)]"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="fin-t-body-strong text-[var(--fin-text)]">{o.rotulo}</span>
                  <span className="fin-t-caption text-[var(--fin-text-2)]">{o.explica}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {avisoDeData && escopo !== 'so_esta' ? (
          <p className="fin-t-caption rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-[var(--fin-s-3)] text-[var(--fin-text-2)]">
            {avisoDeData}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="h-11 w-full px-4 sm:w-auto lg:h-10" disabled={processando} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="h-11 w-full bg-[var(--fin-accent)] px-4 text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] sm:w-auto lg:h-10"
            disabled={processando}
            aria-busy={processando}
            onClick={() => onConfirmar(escopo)}
          >
            {processando ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            Salvar alteração
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default EscopoDaSerie;
