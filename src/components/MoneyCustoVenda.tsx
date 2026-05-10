'use client';

import { MoneyInput } from './MoneyInput';
import { formatBRL } from '@/lib/utils';

interface Props {
  label: string;
  custo: number | null;
  venda?: number | null;
  onCustoChange: (v: number | null) => void;
  onVendaChange: (v: number | null) => void;
  highlightCusto?: boolean;
}

// Par "custo / venda" com margem inline calculada.
// Quando o usuario preenche venda > 0, calcProposta passa a usar o
// preco de venda direto (sem markup automatico).
export function MoneyCustoVenda({
  label,
  custo,
  venda,
  onCustoChange,
  onVendaChange,
  highlightCusto,
}: Props) {
  const v = venda ?? null;
  const margem = (v ?? 0) > 0 && (custo ?? 0) > 0 ? (v! - custo!) : null;
  const margemPct = margem !== null && (v ?? 0) > 0 ? (margem / v!) * 100 : null;
  const margemColor =
    margem === null
      ? 'text-[var(--t-text-muted)]'
      : margem >= 0
        ? 'text-green-600 dark:text-green-400'
        : 'text-red-500';

  return (
    <div>
      <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">
        {label}
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <MoneyInput
            value={custo}
            onChange={onCustoChange}
            highlight={highlightCusto}
            placeholder="Custo"
          />
          <span className="text-[9px] text-[var(--t-text-muted)] mt-0.5 block">Custo</span>
        </div>
        <div>
          <MoneyInput value={v} onChange={onVendaChange} placeholder="Venda" />
          <span className="text-[9px] text-[var(--t-text-muted)] mt-0.5 block">Venda</span>
        </div>
      </div>
      {margem !== null && (
        <div className={`text-[10px] mt-1 ${margemColor} tabular-nums font-medium`}>
          Margem: {formatBRL(margem)}
          {margemPct !== null && ` (${margemPct.toFixed(1)}%)`}
        </div>
      )}
    </div>
  );
}
