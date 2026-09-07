'use client';

import * as React from 'react';

import { Label } from '@/components/ui/label';

export type FieldProps = {
  rotulo: string;
  obrigatorio?: boolean;
  ajuda?: string;
  erro?: string | null;
  /** O id é gerado por useId e injetado. Impossível esquecer. */
  children: (a: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => React.ReactNode;
};

export function Field({ rotulo, obrigatorio = false, ajuda, erro, children }: FieldProps) {
  const base = React.useId();
  const id = `${base}-campo`;
  const idAjuda = `${base}-ajuda`;
  const idErro = `${base}-erro`;

  const temErro = Boolean(erro);
  const descritores = [ajuda ? idAjuda : null, temErro ? idErro : null].filter(Boolean) as string[];
  const describedBy = descritores.length > 0 ? descritores.join(' ') : undefined;

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="fin-t-body-strong gap-1 text-[var(--fin-text)]">
        {rotulo}
        {obrigatorio && (
          <>
            <span aria-hidden="true" className="text-[var(--fin-negative)]">
              *
            </span>
            <span className="sr-only">obrigatório</span>
          </>
        )}
      </Label>

      {children({ id, 'aria-invalid': temErro, 'aria-describedby': describedBy })}

      {ajuda && (
        <p id={idAjuda} className="fin-t-caption text-[var(--fin-text-3)]">
          {ajuda}
        </p>
      )}

      {temErro && (
        <p id={idErro} role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">
          {erro}
        </p>
      )}
    </div>
  );
}

export default Field;
