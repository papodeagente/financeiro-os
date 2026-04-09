'use client';

/**
 * Painel horizontal com os 14 KPIs agregados após simular o funil.
 * Borda vermelha quando `abaixo_margem_minima` — alerta crítico.
 */

import type { KPIsFunil } from '@/lib/funil-types';
import { formatBRL } from '@/lib/utils';
import { Play, GitCompare, Download } from 'lucide-react';

interface PainelKPIsProps {
  kpis: KPIsFunil | null;
  loading?: boolean;
  onSimular: () => void;
  onComparar: () => void;
  onExportar: () => void;
}

export function PainelKPIs({ kpis, loading, onSimular, onComparar, onExportar }: PainelKPIsProps) {
  const alert = kpis?.abaixo_margem_minima;

  return (
    <div
      className={`border-t bg-[var(--t-surface)] ${alert ? 'border-red-500' : 'border-[var(--t-border)]'}`}
      style={{ minHeight: 170 }}
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <div>
          <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] uppercase tracking-wider">Resultado da simulação</p>
          {alert && (
            <p className="text-[11px] text-red-500 font-medium mt-0.5">
              ⚠️ Margem abaixo do mínimo configurado
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSimular}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-semibold text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> Simular
          </button>
          <button
            onClick={onComparar}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] font-medium text-[var(--t-text)] border border-[var(--t-border)] rounded-lg hover:bg-[var(--t-surface-hover)]"
          >
            <GitCompare className="w-3.5 h-3.5" /> Comparar cenários
          </button>
          <button
            onClick={onExportar}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[var(--text-body-sm)] text-[var(--t-text-muted)] border border-[var(--t-border)] rounded-lg hover:bg-[var(--t-surface-hover)]"
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </button>
        </div>
      </div>

      <div className="px-4 py-3 overflow-x-auto">
        <div className="flex items-stretch gap-3 min-w-max">
          <KpiCard label="Visitantes" value={kpis?.total_visitantes ?? 0} />
          <KpiCard label="Leads" value={kpis?.total_leads ?? 0} />
          <KpiCard label="Propostas" value={kpis?.total_propostas ?? 0} />
          <KpiCard label="Vendas" value={kpis?.total_vendas ?? 0} highlight />
          <KpiCard label="Conv. geral" value={`${(kpis?.taxa_conversao_geral ?? 0).toFixed(1)}%`} />
          <KpiCard label="Receita bruta" value={formatBRL(kpis?.receita_bruta ?? 0)} />
          <KpiCard label="Receita líquida" value={formatBRL(kpis?.receita_liquida ?? 0)} />
          <KpiCard label="Investimento" value={formatBRL(kpis?.investimento_total ?? 0)} />
          <KpiCard
            label="Lucro"
            value={formatBRL(kpis?.lucro ?? 0)}
            highlight
            negative={(kpis?.lucro ?? 0) < 0}
          />
          <KpiCard label="Margem" value={`${(kpis?.margem_percentual ?? 0).toFixed(1)}%`} />
          <KpiCard label="CAC simulado" value={formatBRL(kpis?.cac_simulado ?? 0)} />
          <KpiCard label="Ticket médio" value={formatBRL(kpis?.ticket_medio ?? 0)} />
          <KpiCard label="ROI" value={`${((kpis?.roi ?? 0) * 100).toFixed(0)}%`} />
          <KpiCard label="LTV/CAC" value={(kpis?.ltv_cac ?? 0).toFixed(2)} />
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label, value, highlight, negative,
}: {
  label: string; value: string | number; highlight?: boolean; negative?: boolean;
}) {
  return (
    <div className={`min-w-[110px] p-2.5 rounded-lg ${highlight ? 'bg-[var(--t-green-bg)]' : 'bg-[var(--t-bg)]'}`}>
      <p className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wide truncate">{label}</p>
      <p className={`text-[16px] font-bold ${negative ? 'text-red-500' : highlight ? 'text-[var(--t-green)]' : 'text-[var(--t-text)]'}`}>
        {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
      </p>
    </div>
  );
}
