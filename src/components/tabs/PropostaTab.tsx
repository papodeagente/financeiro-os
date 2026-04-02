'use client';

import { GrupoViagem } from '@/lib/types';
import { calcProposta } from '@/lib/calculations';
import { formatBRL } from '@/lib/utils';

interface Props { grupo: GrupoViagem; }

const TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
const LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };
const PAX_MAP: Record<string, number> = { sgl: 1, dbl: 2, tpl: 3, qdp: 4, chd: 1 };

export function PropostaTab({ grupo }: Props) {
  const p = calcProposta(grupo);

  const Row = ({ label, values, className = '' }: { label: string; values: Record<string, number>; className?: string }) => (
    <tr className={className}>
      <td className="p-2 border font-medium">{label}</td>
      {TIPOS.map(t => <td key={t} className="p-2 border text-right">{formatBRL(values[t])}</td>)}
    </tr>
  );

  return (
    <div className="space-y-8">
      <div className="bg-amber-50 border border-amber-400 text-amber-800 p-3 rounded-lg text-sm font-medium">
        Nesta aba não faça nenhuma alteração pois irá comprometer o resultado final do valor
      </div>

      {/* Header */}
      <div className="bg-[var(--t-header-bg)] text-[var(--t-header-text)] p-4 rounded-lg flex flex-wrap gap-6">
        <div><span className="text-xs text-[var(--t-accent)]">GRP#</span><div className="font-bold">{grupo.grp_id || '—'}</div></div>
        <div><span className="text-xs text-[var(--t-accent)]">Origem x Destino</span><div className="font-bold">{grupo.origem_destino || '—'}</div></div>
        <div><span className="text-xs text-[var(--t-accent)]">Parcelas</span><div className="font-bold">{grupo.params.parcelas}x</div></div>
      </div>

      {/* PAX por apto */}
      <div className="text-sm text-[var(--t-text-secondary)] flex gap-4">
        {TIPOS.map(t => <span key={t}><b>{LABELS[t]}</b> = {PAX_MAP[t]} PAX</span>)}
      </div>

      {/* Linhas de custo */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left border border-[var(--t-border)] w-40">Serviço</th>
            {TIPOS.map(t => <th key={t} className="p-2 border border-[var(--t-border)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            {p.lines.map((line, i) => {
              let cls = i % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]';
              if (line.label === 'MARKUP') cls = 'bg-[var(--t-blue-bg)]';
              if (line.label === 'CORTESIA') cls = 'bg-yellow-50';
              if (line.label === 'CONTRATO') cls = 'bg-[var(--t-surface-hover)]';
              const vals: Record<string, number> = { sgl: line.sgl, dbl: line.dbl, tpl: line.tpl, qdp: line.qdp, chd: line.chd };
              return <Row key={line.label} label={line.label} values={vals} className={cls} />;
            })}
          </tbody>
        </table>
      </div>

      {/* Total por Apartamento */}
      <h3 className="text-lg font-semibold text-[var(--t-text)]">Total por Apartamento</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left border border-[var(--t-border)] w-40">Modalidade</th>
            {TIPOS.map(t => <th key={t} className="p-2 border border-[var(--t-border)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            <Row label="À Vista / PIX" values={p.totalAvista} className="bg-green-50 font-bold" />
            <Row label="Cartão de Crédito" values={p.totalCartao} className="bg-[var(--t-blue-bg)]" />
            <Row label="Boleto" values={p.totalBoleto} className="bg-orange-50" />
          </tbody>
        </table>
      </div>

      {/* Parcela por Apartamento */}
      <h3 className="text-lg font-semibold text-[var(--t-text)]">Parcela por Apartamento ({grupo.params.parcelas}x)</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left border border-[var(--t-border)] w-40">Modalidade</th>
            {TIPOS.map(t => <th key={t} className="p-2 border border-[var(--t-border)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            <Row label="Parcela CC" values={p.parcelaAptoCC} className="bg-[var(--t-blue-bg)]" />
            <Row label="Parcela Boleto" values={p.parcelaAptoBoleto} className="bg-orange-50" />
          </tbody>
        </table>
      </div>

      {/* Total por PAX */}
      <h3 className="text-lg font-semibold text-[var(--t-text)]">Total por PAX</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left border border-[var(--t-border)] w-40">Modalidade</th>
            {TIPOS.map(t => <th key={t} className="p-2 border border-[var(--t-border)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            <Row label="À Vista / PIX" values={p.totalPaxAvista} className="bg-green-50 font-bold" />
            <Row label="Cartão de Crédito" values={p.totalPaxCartao} className="bg-[var(--t-blue-bg)]" />
            <Row label="Boleto" values={p.totalPaxBoleto} className="bg-orange-50" />
          </tbody>
        </table>
      </div>

      {/* Parcela por PAX */}
      <h3 className="text-lg font-semibold text-[var(--t-text)]">Parcela por PAX ({grupo.params.parcelas}x)</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left border border-[var(--t-border)] w-40">Modalidade</th>
            {TIPOS.map(t => <th key={t} className="p-2 border border-[var(--t-border)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            <Row label="Parcela CC" values={p.parcelaPaxCC} className="bg-[var(--t-blue-bg)]" />
            <Row label="Parcela Boleto" values={p.parcelaPaxBoleto} className="bg-orange-50" />
          </tbody>
        </table>
      </div>
    </div>
  );
}
