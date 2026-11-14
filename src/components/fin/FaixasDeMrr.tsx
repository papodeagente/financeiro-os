'use client';

/**
 * As faixas da comissão por MRR dentro do plano de comissão (só na conta do
 * ecossistema): "até X% da meta paga Y% do MRR vendido". A regra e a
 * validação moram em src/lib/comissao-mrr.ts; aqui só o formulário.
 */
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { faixasEmPalavras, normalizarFaixas, validarFaixas } from '@/lib/comissao-mrr';

/** A linha como a pessoa digita: texto, para "sem teto" ser o campo vazio. */
export interface FaixaDigitada { ate_pct: string; percentual: string }

const CAMPO = 'fin-t-body h-10 w-24 rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 text-right tabular-nums text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

export function faixasDigitadas(bruto: unknown): FaixaDigitada[] {
  return normalizarFaixas(bruto).map(f => ({ ate_pct: f.ate_pct === null ? '' : String(f.ate_pct), percentual: String(f.percentual) }));
}

/** O que o plano grava. Linha toda em branco é ignorada. */
export function faixasParaGravar(linhas: readonly FaixaDigitada[]) {
  return linhas
    .filter(l => l.ate_pct.trim() !== '' || l.percentual.trim() !== '')
    .map(l => ({ ate_pct: l.ate_pct.trim() === '' ? null : Number(l.ate_pct.replace(',', '.')), percentual: Number(l.percentual.replace(',', '.')) }));
}

export function erroDasFaixas(linhas: readonly FaixaDigitada[]): string | null {
  return validarFaixas(faixasParaGravar(linhas));
}

export function FaixasDeMrr({ linhas, onChange }: { linhas: FaixaDigitada[]; onChange: (l: FaixaDigitada[]) => void }) {
  const erro = erroDasFaixas(linhas);
  const validas = erro ? [] : normalizarFaixas(faixasParaGravar(linhas));
  const mudar = (i: number, campo: keyof FaixaDigitada, valor: string) => onChange(linhas.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  return (
    <div className="flex flex-col gap-[var(--fin-s-3)] rounded-[16px] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4">
      <div>
        <p className="fin-t-body-strong text-[var(--fin-text)]">Comissão por MRR</p>
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          Paga um percentual do MRR novo vendido, pela faixa do quanto a meta de MRR foi batida. A faixa vale para o MRR inteiro da meta; acima da última, vale a última. Metas e produtos ficam em Comissão por MRR.
        </p>
      </div>
      {linhas.length === 0 ? (
        <p className="fin-t-caption text-[var(--fin-text-3)]">Sem faixas: este plano não paga comissão por MRR.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {linhas.map((l, i) => (
            <li key={i} className="fin-t-body flex flex-wrap items-center gap-2 text-[var(--fin-text-2)]">
              <span>Até</span>
              <label className="sr-only" htmlFor={`faixa-ate-${i}`}>Teto da faixa {i + 1}, em % da meta</label>
              <input id={`faixa-ate-${i}`} inputMode="decimal" placeholder="sem teto" value={l.ate_pct} onChange={e => mudar(i, 'ate_pct', e.target.value)} className={CAMPO} />
              <span>% da meta, paga</span>
              <label className="sr-only" htmlFor={`faixa-pct-${i}`}>Percentual da faixa {i + 1}</label>
              <input id={`faixa-pct-${i}`} inputMode="decimal" value={l.percentual} onChange={e => mudar(i, 'percentual', e.target.value)} className={CAMPO} />
              <span>% do MRR</span>
              <Button variant="ghost" size="icon-sm" onClick={() => onChange(linhas.filter((_, j) => j !== i))} aria-label={`Tirar a faixa ${i + 1}`}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-[var(--fin-s-3)]">
        <Button variant="outline" size="sm" className="h-9 rounded-[10px] px-3" onClick={() => onChange([...linhas, { ate_pct: '', percentual: '' }])}>
          <Plus aria-hidden="true" /> Faixa
        </Button>
        {linhas.length === 0 ? (
          <Button
            variant="ghost" size="sm" className="h-9 rounded-[10px] px-3"
            onClick={() => onChange([{ ate_pct: '70', percentual: '20' }, { ate_pct: '100', percentual: '40' }, { ate_pct: '', percentual: '60' }])}
          >
            Começar com 70% · 100% · acima
          </Button>
        ) : null}
      </div>
      <p className={cn('fin-t-caption', erro ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text-3)]')} role={erro ? 'alert' : undefined}>
        {erro ?? (validas.length ? faixasEmPalavras(validas) : '')}
      </p>
    </div>
  );
}
