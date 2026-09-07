'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { parseMoneyBR } from '@/lib/money';
import { cn, formatBRL } from '@/lib/utils';

export type MoneyFieldProps = {
  rotulo: string;
  valor: number;
  onChange: (v: number) => void;
  obrigatorio?: boolean;
  ajuda?: string;
  erro?: string | null;
  maximo?: number;
  moeda?: string;
  /** "Saldo devedor", "Valor cheio". Preenche o campo com um clique. */
  atalhos?: { rotulo: string; valor: number }[];
  autoFocus?: boolean;
};

function simboloDaMoeda(moeda: string): string {
  return moeda === 'BRL' ? 'R$' : moeda;
}

function paraTexto(valor: number, moeda: string): string {
  if (!Number.isFinite(valor) || valor === 0) return '';
  if (moeda === 'BRL') return formatBRL(valor).replace(/[^\d.,-]/g, '');
  try {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(valor);
  } catch {
    return formatBRL(valor).replace(/[^\d.,-]/g, '');
  }
}

export function MoneyField({
  rotulo,
  valor,
  onChange,
  obrigatorio = false,
  ajuda,
  erro,
  maximo,
  moeda = 'BRL',
  atalhos,
  autoFocus = false,
}: MoneyFieldProps) {
  const id = React.useId();
  const ajudaId = `${id}-ajuda`;
  const maximoId = `${id}-maximo`;
  const erroId = `${id}-erro`;

  const [focado, setFocado] = React.useState(false);
  const [texto, setTexto] = React.useState(() => paraTexto(valor, moeda));

  React.useEffect(() => {
    if (focado) return;
    setTexto(paraTexto(valor, moeda));
  }, [valor, moeda, focado]);

  const excedeuMaximo = maximo !== undefined && Number.isFinite(valor) && valor > maximo;
  const invalido = Boolean(erro) || excedeuMaximo;

  const descritores = [
    ajuda ? ajudaId : null,
    maximo !== undefined ? maximoId : null,
    erro ? erroId : null,
  ].filter((v): v is string => v !== null);

  function aoDigitar(bruto: string) {
    setTexto(bruto);
    if (bruto.trim() === '') {
      onChange(0);
      return;
    }
    const parseado = parseMoneyBR(bruto);
    if (parseado !== null) onChange(parseado);
  }

  function aoSair() {
    setFocado(false);
    setTexto(paraTexto(valor, moeda));
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="fin-t-body-strong text-[var(--fin-text)]">
        {rotulo}
        {obrigatorio ? (
          <>
            <span aria-hidden="true" className="text-[var(--fin-negative)]">
              *
            </span>
            <span className="sr-only">obrigatório</span>
          </>
        ) : null}
      </Label>

      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center fin-t-body text-[var(--fin-text-3)]"
        >
          {simboloDaMoeda(moeda)}
        </span>
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="0,00"
          value={texto}
          required={obrigatorio}
          aria-required={obrigatorio || undefined}
          aria-invalid={invalido || undefined}
          aria-describedby={descritores.length > 0 ? descritores.join(' ') : undefined}
          onFocus={() => setFocado(true)}
          onBlur={aoSair}
          onChange={(e) => aoDigitar(e.target.value)}
          className={cn(
            'h-11 rounded-[var(--fin-r-md)] pl-11 text-right fin-t-body tabular-nums md:h-10',
            invalido && 'border-[var(--fin-negative)]',
          )}
        />
      </div>

      {atalhos && atalhos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {atalhos.map((atalho) => (
            <Button
              key={`${atalho.rotulo}-${atalho.valor}`}
              type="button"
              variant="outline"
              onClick={() => onChange(atalho.valor)}
              className="h-11 rounded-[var(--fin-r-md)] px-3 fin-t-caption md:h-10"
            >
              {atalho.rotulo}
            </Button>
          ))}
        </div>
      ) : null}

      {ajuda ? (
        <span id={ajudaId} className="fin-t-caption text-[var(--fin-text-3)]">
          {ajuda}
        </span>
      ) : null}

      {maximo !== undefined ? (
        <span
          id={maximoId}
          className={cn(
            'fin-t-caption tabular-nums',
            excedeuMaximo ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]',
          )}
        >
          {`Máximo ${formatBRL(maximo)}`}
        </span>
      ) : null}

      {erro ? (
        <span id={erroId} role="alert" className="fin-t-caption text-[var(--fin-negative-text)]">
          {erro}
        </span>
      ) : null}
    </div>
  );
}

export default MoneyField;
