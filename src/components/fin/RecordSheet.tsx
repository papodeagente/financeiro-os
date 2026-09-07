'use client';

import * as React from 'react';
import { LoaderCircle, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';

export type RecordSheetProps = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  titulo: string;
  descricao?: string;
  children: React.ReactNode;
  /** Texto por extenso do que vai acontecer, antes do botão. */
  resumo?: React.ReactNode;
  acaoPrimaria: {
    rotulo: string;
    onClick: () => Promise<void> | void;
    carregando?: boolean;
    desabilitado?: boolean;
  };
  /** Fluxo de alto volume: mantém o painel aberto e limpa os campos. */
  acaoSalvarEOutro?: { rotulo: string; onClick: () => Promise<void> };
  acaoSecundaria?: { rotulo: string; onClick: () => void };
  /** Avisa antes de fechar com alteração pendente. */
  sujo?: boolean;
  largura?: 480 | 640;
};

const LARGURA: Record<480 | 640, string> = {
  480: 'data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]',
  640: 'data-[side=right]:w-full data-[side=right]:sm:max-w-[640px]',
};

const ALTURA_ACAO = 'h-11 lg:h-10';

export function RecordSheet({
  aberto,
  onOpenChange,
  titulo,
  descricao,
  children,
  resumo,
  acaoPrimaria,
  acaoSalvarEOutro,
  acaoSecundaria,
  sujo = false,
  largura = 480,
}: RecordSheetProps) {
  const [confirmandoDescarte, setConfirmandoDescarte] = React.useState(false);

  React.useEffect(() => {
    if (!aberto) setConfirmandoDescarte(false);
  }, [aberto]);

  const pedirFechamento = React.useCallback(
    (proximo: boolean) => {
      if (proximo) {
        onOpenChange(true);
        return;
      }
      if (sujo) {
        setConfirmandoDescarte(true);
        return;
      }
      onOpenChange(false);
    },
    [onOpenChange, sujo]
  );

  const [salvandoEOutro, setSalvandoEOutro] = React.useState(false);
  const ocupado = Boolean(acaoPrimaria.carregando) || salvandoEOutro;

  async function executarSalvarEOutro() {
    if (!acaoSalvarEOutro) return;
    setSalvandoEOutro(true);
    try {
      await acaoSalvarEOutro.onClick();
    } finally {
      setSalvandoEOutro(false);
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={pedirFechamento}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn(
          'gap-0 border-l border-[var(--fin-border)] bg-[var(--fin-surface)] p-0 text-[var(--fin-text)] shadow-[var(--fin-e2)]',
          LARGURA[largura]
        )}
      >
        <header className="flex flex-col gap-1 border-b border-[var(--fin-border)] px-4 py-4 pr-14">
          <SheetTitle className="fin-t-subhead text-[var(--fin-text)]">{titulo}</SheetTitle>
          {descricao && (
            <SheetDescription className="fin-t-caption text-[var(--fin-text-2)]">
              {descricao}
            </SheetDescription>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>

        <footer className="flex flex-col gap-3 border-t border-[var(--fin-border)] bg-[var(--fin-surface)] px-4 py-4">
          {confirmandoDescarte ? (
            <div
              role="alertdialog"
              aria-label="Alterações não salvas"
              className="flex flex-col gap-3 rounded-[var(--fin-r-md)] border border-[var(--fin-warning)]/24 bg-[var(--fin-warning-soft)] p-3"
            >
              <p className="fin-t-body text-[var(--fin-warning-text)]">
                Este formulário tem alterações que ainda não foram salvas. Fechar agora descarta o
                que você preencheu.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  className={cn(ALTURA_ACAO, 'w-full sm:w-auto')}
                  onClick={() => setConfirmandoDescarte(false)}
                >
                  Continuar editando
                </Button>
                <Button
                  variant="ghost"
                  className={cn(
                    ALTURA_ACAO,
                    'w-full text-[var(--fin-negative-text)] sm:w-auto'
                  )}
                  onClick={() => {
                    setConfirmandoDescarte(false);
                    onOpenChange(false);
                  }}
                >
                  Descartar e fechar
                </Button>
              </div>
            </div>
          ) : (
            <>
              {resumo && (
                <div className="fin-t-caption rounded-[var(--fin-r-md)] bg-[var(--fin-surface-sunken)] p-3 text-[var(--fin-text-2)]">
                  {resumo}
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-start">
                <Button
                  className={cn(
                    ALTURA_ACAO,
                    'w-full bg-[var(--fin-accent)] px-4 text-[var(--fin-text-on-fill)] hover:bg-[var(--fin-accent-hover)] sm:w-auto'
                  )}
                  disabled={Boolean(acaoPrimaria.desabilitado) || ocupado}
                  aria-busy={Boolean(acaoPrimaria.carregando)}
                  onClick={() => {
                    void acaoPrimaria.onClick();
                  }}
                >
                  {acaoPrimaria.carregando && (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  )}
                  {acaoPrimaria.rotulo}
                </Button>

                {acaoSalvarEOutro && (
                  <Button
                    variant="outline"
                    className={cn(ALTURA_ACAO, 'w-full px-4 sm:w-auto')}
                    disabled={ocupado}
                    aria-busy={salvandoEOutro}
                    onClick={() => {
                      void executarSalvarEOutro();
                    }}
                  >
                    {salvandoEOutro && (
                      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    )}
                    {acaoSalvarEOutro.rotulo}
                  </Button>
                )}

                <Button
                  variant="ghost"
                  className={cn(ALTURA_ACAO, 'w-full px-4 sm:w-auto')}
                  disabled={ocupado}
                  onClick={() => {
                    if (acaoSecundaria) {
                      acaoSecundaria.onClick();
                      return;
                    }
                    pedirFechamento(false);
                  }}
                >
                  {acaoSecundaria ? acaoSecundaria.rotulo : 'Cancelar'}
                </Button>
              </div>
            </>
          )}
        </footer>

        <SheetClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Fechar painel"
              className="absolute top-3 right-3 size-11 lg:size-9"
            />
          }
        >
          <X className="size-4" aria-hidden="true" />
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}

export default RecordSheet;
