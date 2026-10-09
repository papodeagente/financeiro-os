'use client';

import * as React from 'react';
import { LoaderCircle, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

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
  /** null esconde o botão: gaveta só informativa tem uma saída, a primária. */
  acaoSecundaria?: { rotulo: string; onClick: () => void } | null;
  /** Avisa antes de fechar com alteração pendente. */
  sujo?: boolean;
  largura?: 480 | 640 | 960;
};

// No centro a janela tem mais respiro que a gaveta tinha: os formulários de
// duas colunas deixam de ficar espremidos.
const LARGURA: Record<480 | 640 | 960, string> = {
  480: 'sm:max-w-[560px]',
  640: 'sm:max-w-[720px]',
  // Para formulário com linhas lado a lado (a venda com os fornecedores).
  960: 'sm:max-w-[960px]',
};

const ALTURA_ACAO = 'h-11 lg:h-10';

/**
 * Janela de registro: formulário ou detalhe com cabeçalho, corpo rolável e
 * ações no rodapé.
 *
 * Abre no CENTRO da tela (pedido do Bruno, 08/10/2026: "todo popup deve abrir
 * no centro"). O nome ficou do tempo em que era gaveta lateral, para as telas
 * não precisarem mudar. Fechar com alteração pendente pede confirmação.
 */
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
    <Dialog open={aberto} onOpenChange={pedirFechamento}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 text-[var(--fin-text)]',
          LARGURA[largura]
        )}
      >
        <header className="flex flex-col gap-1 border-b border-[var(--fin-border)] px-5 py-4 pr-14">
          <DialogTitle className="fin-t-subhead text-[var(--fin-text)]">{titulo}</DialogTitle>
          {descricao && (
            <DialogDescription className="fin-t-caption text-[var(--fin-text-2)]">
              {descricao}
            </DialogDescription>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        <footer className="flex flex-col gap-3 border-t border-[var(--fin-border)] bg-[var(--fin-surface)] px-5 py-4">
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

                {acaoSecundaria !== null && (
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
                )}
              </div>
            </>
          )}
        </footer>

        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Fechar"
              className="absolute top-3 right-3 size-11 lg:size-9"
            />
          }
        >
          <X className="size-4" aria-hidden="true" />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export default RecordSheet;
