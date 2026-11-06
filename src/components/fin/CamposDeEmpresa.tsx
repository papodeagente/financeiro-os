'use client';

/**
 * Campos de empresa dos cadastros (06/11/2026, E7 G2): "Empresa" (de quem é
 * a conta, o cartão, o lançamento) e "Disponível também em" (conta bancária
 * usada por mais de uma empresa). Com uma empresa só, não desenham nada e o
 * formulário fica exatamente como era.
 */
import * as React from 'react';

import { Field } from '@/components/fin/Field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EMPRESA_PRINCIPAL_ID } from '@/lib/empresas';
import { cn } from '@/lib/utils';
import { useEmpresas } from './useEmpresas';

const CONTROLE =
  'fin-t-body h-11 min-h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-3 text-[var(--fin-text)] lg:h-10 lg:min-h-10 focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

/** A empresa sugerida para um cadastro novo: a única marcada no seletor, senão a principal. */
export function useEmpresaSugerida(): string {
  const { visiveis } = useEmpresas();
  return visiveis && visiveis.length === 1 ? visiveis[0] : EMPRESA_PRINCIPAL_ID;
}

export function CampoEmpresa({
  valor, onChange, rotulo = 'Empresa', ajuda, desabilitado,
}: {
  valor: string | undefined;
  onChange: (empresaId: string) => void;
  rotulo?: string;
  ajuda?: string;
  desabilitado?: boolean;
}) {
  const { multi, empresas, carregando } = useEmpresas();
  if (carregando || !multi) return null;
  const atual = valor || EMPRESA_PRINCIPAL_ID;
  return (
    <Field rotulo={rotulo} ajuda={ajuda}>
      {a => (
        <Select value={atual} onValueChange={v => onChange(String(v ?? EMPRESA_PRINCIPAL_ID))} disabled={desabilitado}>
          <SelectTrigger id={a.id} aria-describedby={a['aria-describedby']} className={CONTROLE}>
            <SelectValue>{() => empresas.find(e => e.id === atual)?.nome ?? 'Empresa principal'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {empresas.map(e => (
              <SelectItem key={e.id} value={e.id} className="fin-t-body">{e.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/** "Disponível também em": as outras empresas que podem usar esta conta. */
export function CampoEmpresasDisponiveis({
  dona, valor, onChange,
}: {
  dona: string | undefined;
  valor: readonly string[];
  onChange: (empresas: string[]) => void;
}) {
  const { multi, empresas, carregando } = useEmpresas();
  if (carregando || !multi) return null;
  const outras = empresas.filter(e => e.id !== (dona || EMPRESA_PRINCIPAL_ID));
  if (outras.length === 0) return null;
  const marcadas = new Set(valor);
  return (
    <fieldset className="flex flex-col gap-[var(--fin-s-2)]">
      <legend className="fin-t-body-strong mb-[var(--fin-s-1)] text-[var(--fin-text)]">Disponível também em</legend>
      <p className="fin-t-caption -mt-[var(--fin-s-1)] text-[var(--fin-text-3)]">
        Outras empresas que podem receber e pagar por esta conta. Ela aparece nas listas delas.
      </p>
      <div className="flex flex-wrap gap-[var(--fin-s-2)]">
        {outras.map(e => {
          const marcada = marcadas.has(e.id);
          return (
            <label
              key={e.id}
              className={cn(
                'fin-t-body flex cursor-pointer items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border px-3 py-2',
                marcada
                  ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-text)]'
                  : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)]',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--fin-accent)] has-[:focus-visible]:outline-offset-2',
              )}
            >
              <input
                type="checkbox"
                checked={marcada}
                onChange={() => {
                  const nova = new Set(marcadas);
                  if (marcada) nova.delete(e.id); else nova.add(e.id);
                  onChange([...nova]);
                }}
                className="size-4 cursor-pointer accent-[var(--fin-accent)] focus-visible:outline-none"
              />
              {e.nome}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
