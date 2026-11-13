'use client';

import * as React from 'react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

export type ConfirmDialogProps = {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  titulo: string;
  /** O que vai acontecer, por extenso. Não "Confirmar exclusão?". */
  oQueVaiAcontecer: string;
  /** Contexto do objeto: [{rotulo:'Fornecedor', valor:'CVC Turismo'}, ...] */
  detalhes?: { rotulo: string; valor: React.ReactNode }[];
  /** Efeito da operação escrito por extenso. Ver seção 9.10. */
  previa?: React.ReactNode;
  confirmarRotulo: string;
  tone?: 'padrao' | 'destrutivo';
  processando?: boolean;
  onConfirmar: () => Promise<void> | void;
};

const ALTURA_ACAO = 'h-11 lg:h-10';

export function ConfirmDialog({
  aberto,
  onOpenChange,
  titulo,
  oQueVaiAcontecer,
  detalhes,
  previa,
  confirmarRotulo,
  tone = 'padrao',
  processando = false,
  onConfirmar,
}: ConfirmDialogProps) {
  const destrutivo = tone === 'destrutivo';

  return (
    <Dialog
      open={aberto}
      onOpenChange={(proximo) => {
        if (processando && !proximo) return;
        onOpenChange(proximo);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          'gap-4 rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4 text-[var(--fin-text)] shadow-[var(--fin-e2)] sm:max-w-[480px]'
        )}
      >
        <div className="flex items-start gap-3">
          {destrutivo && (
            <span
              aria-hidden="true"
              className="mt-1 grid size-6 shrink-0 place-items-center rounded-[var(--fin-r-sm)] bg-[var(--fin-negative-soft)] text-[var(--fin-negative)]"
            >
              <TriangleAlert className="size-4" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="fin-t-subhead text-[var(--fin-text)]">{titulo}</DialogTitle>
            <DialogDescription className="fin-t-body text-[var(--fin-text-2)]">
              {oQueVaiAcontecer}
            </DialogDescription>
          </div>
        </div>

        {detalhes && detalhes.length > 0 && (
          <dl className="flex flex-col gap-2 rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface-sunken)] p-3">
            {detalhes.map((item) => (
              <div
                key={item.rotulo}
                className="flex items-baseline justify-between gap-4"
              >
                <dt className="fin-t-caption shrink-0 text-[var(--fin-text-3)]">{item.rotulo}</dt>
                <dd className="fin-t-body-strong min-w-0 text-right tabular-nums text-[var(--fin-text)]">
                  {item.valor}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {previa && (
          <div className="fin-t-body rounded-[var(--fin-r-md)] border border-[var(--fin-info)]/24 bg-[var(--fin-info-soft)] p-3 text-[var(--fin-text-2)]">
            {previa}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            className={cn(ALTURA_ACAO, 'w-full px-4 sm:w-auto')}
            disabled={processando}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            className={cn(
              ALTURA_ACAO,
              'w-full px-4 text-[var(--fin-text-on-fill)] sm:w-auto',
              destrutivo
                ? 'bg-[var(--fin-negative)] hover:bg-[var(--fin-negative-text)]'
                : 'bg-[var(--fin-accent)] hover:bg-[var(--fin-accent-hover)]'
            )}
            disabled={processando}
            aria-busy={processando}
            onClick={() => {
              void onConfirmar();
            }}
          >
            {processando && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {confirmarRotulo}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmDialog;
