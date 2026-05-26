'use client';

/**
 * Painel horizontal com os 14 KPIs agregados após simular o funil.
 * Borda vermelha quando `abaixo_margem_minima` — alerta crítico.
 */

import { useState } from 'react';
import type { KPIsFunil } from '@/lib/funil-types';
import { formatBRL } from '@/lib/utils';
import { Play, GitCompare, Download, Info } from 'lucide-react';

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
          <LtvCacCard
            ltv={kpis?.ticket_medio ?? 0}
            cac={kpis?.cac_simulado ?? 0}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Card LTV/CAC — destaque visual com proporção X:1 e saúde
// ============================================================
// LTV usado aqui = ticket médio (proxy — o sistema não tem histórico
// de recompra por cliente). Quando houver, o cálculo pode evoluir pra
// LTV = ticket × frequência × vida útil.
function LtvCacCard({ ltv, cac }: { ltv: number; cac: number }) {
  const ratio = cac > 0 ? ltv / cac : 0;
  const [showInfo, setShowInfo] = useState(false);

  // Referência padrão de mercado:
  //   < 1   prejuízo (cada cliente custa mais do que dá retorno)
  //   1-3   apertado (operação sobrevive, mas margem fina)
  //   3-5   saudável (benchmark SaaS/marketing)
  //   ≥ 5   excelente (possível subinvestir em aquisição)
  const health =
    ratio < 1 ? { label: 'prejuízo',  tone: 'bad'   as const }
  : ratio < 3 ? { label: 'no limite', tone: 'warn'  as const }
  : ratio < 5 ? { label: 'saudável',  tone: 'good'  as const }
  :             { label: 'excelente', tone: 'great' as const };

  const colors = {
    bad:   { bg: 'bg-red-500/10',     text: 'text-red-500',     dot: 'bg-red-500' },
    warn:  { bg: 'bg-amber-500/10',   text: 'text-amber-600',   dot: 'bg-amber-500' },
    good:  { bg: 'bg-emerald-500/10', text: 'text-emerald-600', dot: 'bg-emerald-500' },
    great: { bg: 'bg-emerald-500/15', text: 'text-emerald-600', dot: 'bg-emerald-600' },
  }[health.tone];

  // Formato da proporção: ratio≥1 mostra "X:1"; ratio<1 mostra "1:X"
  const ratioLabel =
    ratio === 0 ? '—'
  : ratio >= 1 ? `${ratio.toFixed(ratio >= 10 ? 0 : 1)}:1`
  : `1:${(1 / ratio).toFixed(ratio < 0.1 ? 0 : 1)}`;

  return (
    <div className={`relative min-w-[200px] p-2.5 rounded-lg ${colors.bg}`}>
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <p className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wide">LTV / CAC</p>
        <button
          type="button"
          onClick={() => setShowInfo(s => !s)}
          onBlur={() => setShowInfo(false)}
          className="text-[var(--t-text-muted)] hover:text-[var(--t-text)] transition-colors"
          aria-label="Como é calculado"
        >
          <Info className="w-3 h-3" />
        </button>
      </div>

      <div className="flex items-baseline gap-2">
        <p className={`text-[22px] font-bold leading-none ${colors.text}`}>{ratioLabel}</p>
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${colors.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
          {health.label}
        </span>
      </div>

      <p className="text-[10.5px] text-[var(--t-text-muted)] mt-1 leading-tight">
        Cada R$ 1 em aquisição traz{' '}
        <span className="font-semibold text-[var(--t-text)]">
          {ratio > 0 ? `R$ ${ratio.toFixed(ratio >= 10 ? 0 : ratio >= 1 ? 1 : 2)}` : '—'}
        </span>{' '}
        de receita
      </p>

      <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">
        LTV {formatBRL(ltv)} · CAC {formatBRL(cac)}
      </p>

      {showInfo && (
        <div
          className="absolute z-50 right-0 top-full mt-1 w-[260px] p-3 rounded-lg bg-[var(--t-surface)] border border-[var(--t-border)] shadow-xl text-left"
        >
          <p className="text-[11px] font-semibold text-[var(--t-text)] mb-1">Como ler</p>
          <p className="text-[11px] text-[var(--t-text-secondary)] leading-relaxed">
            Se LTV = R$ 900 e CAC = R$ 300, a proporção é{' '}
            <strong>3:1</strong> — cada cliente gera 3× o que custou pra ser conquistado.
          </p>
          <div className="my-2 h-px bg-[var(--t-border)]" />
          <ul className="space-y-1 text-[11px] text-[var(--t-text-secondary)]">
            <li><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5 align-middle" />menos que 1:1 → prejuízo</li>
            <li><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1.5 align-middle" />1:1 a 3:1 → no limite</li>
            <li><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />3:1 a 5:1 → saudável</li>
            <li><span className="inline-block w-2 h-2 rounded-full bg-emerald-600 mr-1.5 align-middle" />acima de 5:1 → excelente</li>
          </ul>
        </div>
      )}
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
