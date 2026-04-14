'use client';

import { GrupoViagem } from '@/lib/types';
import { calcProposta } from '@/lib/calculations';
import { formatBRL } from '@/lib/utils';

interface Props { grupo: GrupoViagem; }

const ALL_TIPOS = ['sgl', 'dbl', 'tpl', 'qdp', 'chd'] as const;
const LABELS: Record<string, string> = { sgl: 'SGL', dbl: 'DBL', tpl: 'TPL', qdp: 'QDP', chd: 'CHD' };
const PAX_MAP: Record<string, number> = { sgl: 1, dbl: 2, tpl: 3, qdp: 4, chd: 1 };

const SERVICE_NAMES: Record<string, string> = {
  TKT: 'Passagem Aérea',
  HTL: 'Hotel',
  REC: 'Receptivo',
  CAR: 'Transporte',
  GUIA: 'Guia',
  SEG: 'Seguro Viagem',
  NAVIO: 'Navio / Cruzeiro',
  ING: 'Ingresso',
  BRINDE: 'Brinde',
  DIVULGACAO: 'Divulgação',
  CORTESIA: 'Cortesia',
  CONTRATO: 'Contrato',
  MARKUP: 'Markup',
};

export function PropostaTab({ grupo }: Props) {
  const tarifas = grupo.tarifas_ativas || ['sgl', 'dbl', 'tpl', 'qdp'];
  const TIPOS = [...tarifas.filter(t => ALL_TIPOS.includes(t as typeof ALL_TIPOS[number])), 'chd'] as typeof ALL_TIPOS[number][];
  const p = calcProposta(grupo);

  const Row = ({ label, values, className = '' }: { label: string; values: Record<string, number>; className?: string }) => (
    <tr className={className}>
      <td className="p-2 border border-[var(--t-border)] font-medium text-[var(--t-text)]">{label}</td>
      {TIPOS.map(t => <td key={t} className="p-2 border border-[var(--t-border)] text-right tabular-nums">{formatBRL(values[t])}</td>)}
    </tr>
  );

  return (
    <div className="space-y-8">
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

      {/* ============================================================ */}
      {/* PREÇO POR PESSOA — seção principal                           */}
      {/* ============================================================ */}

      <h3 className="text-lg font-semibold text-[var(--t-text)]">Preço por Pessoa</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left shadow-[var(--t-card-shadow)] w-40">Modalidade</th>
            {TIPOS.map(t => <th key={t} className="p-2 shadow-[var(--t-card-shadow)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            <Row label="À Vista / PIX" values={p.totalPaxAvista} className="bg-green-50 dark:bg-green-950/20 font-bold" />
            <Row label="Cartão de Crédito" values={p.totalPaxCartao} className="bg-blue-50 dark:bg-blue-950/20" />
            <Row label="Boleto" values={p.totalPaxBoleto} className="bg-orange-50 dark:bg-orange-950/20" />
          </tbody>
        </table>
      </div>

      {/* Parcela por PAX */}
      <h3 className="text-lg font-semibold text-[var(--t-text)]">Parcela por Pessoa ({grupo.params.parcelas}x)</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left shadow-[var(--t-card-shadow)] w-40">Modalidade</th>
            {TIPOS.map(t => <th key={t} className="p-2 shadow-[var(--t-card-shadow)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            <Row label="Parcela Cartão" values={p.parcelaPaxCC} className="bg-blue-50 dark:bg-blue-950/20" />
            <Row label="Parcela Boleto" values={p.parcelaPaxBoleto} className="bg-orange-50 dark:bg-orange-950/20" />
          </tbody>
        </table>
      </div>

      {/* ============================================================ */}
      {/* CUSTOS POR SERVIÇO — detalhamento                            */}
      {/* ============================================================ */}

      <h3 className="text-lg font-semibold text-[var(--t-text)]">Custos por Serviço (por apartamento)</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left shadow-[var(--t-card-shadow)] w-44">Serviço</th>
            {TIPOS.map(t => <th key={t} className="p-2 shadow-[var(--t-card-shadow)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            {p.lines.map((line, i) => {
              let cls = i % 2 === 0 ? 'bg-[var(--t-surface)]' : 'bg-[var(--t-surface-hover)]';
              if (line.label === 'MARKUP') cls = 'bg-blue-50 dark:bg-blue-950/20';
              if (line.label === 'CORTESIA') cls = 'bg-yellow-50 dark:bg-yellow-950/20';
              if (line.label === 'CONTRATO') cls = 'bg-[var(--t-surface-hover)]';
              const vals: Record<string, number> = { sgl: line.sgl, dbl: line.dbl, tpl: line.tpl, qdp: line.qdp, chd: line.chd };
              return <Row key={line.label} label={SERVICE_NAMES[line.label] || line.label} values={vals} className={cls} />;
            })}
          </tbody>
        </table>
      </div>

      {/* ============================================================ */}
      {/* TOTAL POR APARTAMENTO                                        */}
      {/* ============================================================ */}

      <h3 className="text-lg font-semibold text-[var(--t-text)]">Total por Apartamento</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left shadow-[var(--t-card-shadow)] w-40">Modalidade</th>
            {TIPOS.map(t => <th key={t} className="p-2 shadow-[var(--t-card-shadow)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            <Row label="À Vista / PIX" values={p.totalAvista} className="bg-green-50 dark:bg-green-950/20 font-bold" />
            <Row label="Cartão de Crédito" values={p.totalCartao} className="bg-blue-50 dark:bg-blue-950/20" />
            <Row label="Boleto" values={p.totalBoleto} className="bg-orange-50 dark:bg-orange-950/20" />
          </tbody>
        </table>
      </div>

      {/* Parcela por Apartamento */}
      <h3 className="text-lg font-semibold text-[var(--t-text)]">Parcela por Apartamento ({grupo.params.parcelas}x)</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead><tr className="bg-[var(--t-header-bg)] text-[var(--t-header-text)]">
            <th className="p-2 text-left shadow-[var(--t-card-shadow)] w-40">Modalidade</th>
            {TIPOS.map(t => <th key={t} className="p-2 shadow-[var(--t-card-shadow)] w-32">{LABELS[t]}</th>)}
          </tr></thead>
          <tbody>
            <Row label="Parcela Cartão" values={p.parcelaAptoCC} className="bg-blue-50 dark:bg-blue-950/20" />
            <Row label="Parcela Boleto" values={p.parcelaAptoBoleto} className="bg-orange-50 dark:bg-orange-950/20" />
          </tbody>
        </table>
      </div>
    </div>
  );
}
