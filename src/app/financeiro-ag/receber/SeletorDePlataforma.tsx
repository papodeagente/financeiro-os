'use client';

import { useMemo, useState } from 'react';

import { SEM_PLATAFORMA, opcoesDePlataforma } from '@/lib/taxa-plataforma';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Valor sentinela do item "Outra…". Nunca é gravado. */
const OUTRA = '__outra__';

const CONTROLE = [
  'fin-t-body h-11 w-full rounded-[var(--fin-r-md)] border-[var(--fin-border-strong)]',
  'bg-[var(--fin-surface)] text-[var(--fin-text)] lg:h-10',
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0',
].join(' ');

export type SeletorDePlataformaProps = {
  valor: string;
  /** Plataformas que a agência já usou. Entram na lista junto com as conhecidas. */
  usadas?: string[];
  onChange: (v: string) => void;
  id?: string;
};

/**
 * Quem reteve a taxa.
 *
 * Lista semeada com as adquirentes comuns mais as que a agência já usou, e
 * uma saída para digitar outra — o nome digitado passa a aparecer nas
 * próximas vezes, sem exigir uma tela de cadastro. A normalização acontece na
 * gravação, e é ela que impede o relatório de rachar em várias linhas por
 * causa de caixa ou acento.
 */
export function SeletorDePlataforma({
  valor,
  usadas = [],
  onChange,
  id,
}: SeletorDePlataformaProps) {
  const opcoes = useMemo(() => opcoesDePlataforma([], usadas), [usadas]);
  const naLista = valor !== '' && opcoes.includes(valor);
  const [digitando, setDigitando] = useState(valor !== '' && !naLista);

  if (digitando) {
    return (
      <div className="flex gap-[var(--fin-s-2)]">
        <Input
          id={id}
          autoFocus
          value={valor}
          onChange={e => onChange(e.target.value)}
          placeholder="Nome da plataforma"
          className={CONTROLE}
        />
        <button
          type="button"
          onClick={() => { setDigitando(false); onChange(''); }}
          className={[
            'fin-t-body h-11 shrink-0 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)]',
            'px-3 text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] lg:h-10',
            'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2',
          ].join(' ')}
        >
          Voltar à lista
        </button>
      </div>
    );
  }

  return (
    <Select
      value={valor}
      onValueChange={v => {
        if (v === OUTRA) { setDigitando(true); onChange(''); return; }
        onChange(v ?? '');
      }}
    >
      <SelectTrigger id={id} className={CONTROLE}>
        <SelectValue>{() => (valor === '' ? SEM_PLATAFORMA : valor)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="" className="fin-t-body">{SEM_PLATAFORMA}</SelectItem>
        {opcoes.map(o => (
          <SelectItem key={o} value={o} className="fin-t-body">{o}</SelectItem>
        ))}
        <SelectItem value={OUTRA} className="fin-t-body">Outra…</SelectItem>
      </SelectContent>
    </Select>
  );
}

export default SeletorDePlataforma;
