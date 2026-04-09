'use client';

/**
 * Modal de comparação de 4 cenários. Cada coluna tem sliders para ajustar
 * multiplicadores e mostra os KPIs recalculados em tempo real. Gráfico de
 * barras horizontais em SVG manual comparando o lucro — coluna de maior
 * lucro ganha destaque visual.
 */

import { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import type { CenarioComparativo, NodeFunil, EdgeFunil, DadosReaisAgencia } from '@/lib/funil-types';
import { simularCenarios } from '@/lib/funil-engine';
import { formatBRL } from '@/lib/utils';

interface ModalComparacaoProps {
  nodes: NodeFunil[];
  edges: EdgeFunil[];
  cenariosIniciais: CenarioComparativo[];
  dadosReais?: DadosReaisAgencia | null;
  usarDadosReais: boolean;
  onClose: () => void;
  onSalvar: (cenarios: CenarioComparativo[]) => void;
}

export function ModalComparacao({
  nodes, edges, cenariosIniciais, dadosReais, usarDadosReais, onClose, onSalvar,
}: ModalComparacaoProps) {
  const [cenarios, setCenarios] = useState<CenarioComparativo[]>(cenariosIniciais);

  const cenariosSimulados = useMemo(
    () => simularCenarios(nodes, edges, cenarios, dadosReais ?? undefined, usarDadosReais),
    [nodes, edges, cenarios, dadosReais, usarDadosReais],
  );

  const maiorLucro = Math.max(...cenariosSimulados.map(c => c.kpis?.lucro ?? 0));
  const menorLucro = Math.min(...cenariosSimulados.map(c => c.kpis?.lucro ?? 0));
  const range = Math.max(1, maiorLucro - Math.min(0, menorLucro));

  const updateMult = (id: CenarioComparativo['id'], campo: keyof CenarioComparativo['multiplicadores'], valor: number) => {
    setCenarios(prev => prev.map(c =>
      c.id === id ? { ...c, multiplicadores: { ...c.multiplicadores, [campo]: valor } } : c,
    ));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-[1200px] max-h-[90vh] overflow-y-auto bg-[var(--t-surface)] rounded-2xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between p-5 border-b border-[var(--t-border)] bg-[var(--t-surface)]">
          <div>
            <h2 className="text-[var(--text-h2)] font-semibold text-[var(--t-text)]">Comparar cenários</h2>
            <p className="text-[var(--text-body-sm)] text-[var(--t-text-muted)]">
              Ajuste os multiplicadores e compare lucro, ROI e CAC entre os 4 cenários.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--t-surface-hover)]"
          >
            <X className="w-5 h-5 text-[var(--t-text-muted)]" />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {cenariosSimulados.map(c => {
            const isVencedor = c.kpis && maiorLucro > 0 && c.kpis.lucro === maiorLucro;
            return (
              <div
                key={c.id}
                className={`p-4 rounded-xl border ${isVencedor ? 'border-[var(--t-green)] bg-[var(--t-green-bg)]/20 shadow-md' : 'border-[var(--t-border)] bg-[var(--t-bg)]'}`}
              >
                <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)] mb-3">
                  {c.nome}
                  {isVencedor && <span className="ml-2 text-[10px] bg-[var(--t-green)] text-white px-1.5 py-0.5 rounded-full">MELHOR</span>}
                </p>

                <div className="space-y-3 mb-4">
                  <Slider
                    label="Taxa de conversão"
                    value={c.multiplicadores.taxa_conversao}
                    onChange={v => updateMult(c.id, 'taxa_conversao', v)}
                  />
                  <Slider
                    label="Investimento"
                    value={c.multiplicadores.investimento}
                    onChange={v => updateMult(c.id, 'investimento', v)}
                  />
                  <Slider
                    label="Ticket médio"
                    value={c.multiplicadores.ticket_medio}
                    onChange={v => updateMult(c.id, 'ticket_medio', v)}
                  />
                </div>

                <div className="space-y-1.5 pt-3 border-t border-[var(--t-border)]">
                  <Kpi label="Vendas" value={(c.kpis?.total_vendas ?? 0).toLocaleString('pt-BR')} />
                  <Kpi label="Receita" value={formatBRL(c.kpis?.receita_bruta ?? 0)} />
                  <Kpi label="Investido" value={formatBRL(c.kpis?.investimento_total ?? 0)} />
                  <Kpi
                    label="Lucro"
                    value={formatBRL(c.kpis?.lucro ?? 0)}
                    emphasize
                    negative={(c.kpis?.lucro ?? 0) < 0}
                  />
                  <Kpi label="ROI" value={`${((c.kpis?.roi ?? 0) * 100).toFixed(0)}%`} />
                  <Kpi label="CAC" value={formatBRL(c.kpis?.cac_simulado ?? 0)} />
                  <Kpi label="Margem" value={`${(c.kpis?.margem_percentual ?? 0).toFixed(1)}%`} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Gráfico SVG manual de lucro comparativo */}
        <div className="px-5 pb-5">
          <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)] mb-3">Lucro projetado</p>
          <div className="space-y-2">
            {cenariosSimulados.map(c => {
              const lucro = c.kpis?.lucro ?? 0;
              const widthPct = ((lucro - Math.min(0, menorLucro)) / range) * 100;
              const cor = lucro === maiorLucro && lucro > 0 ? '#10b981' : lucro < 0 ? '#ef4444' : '#94a3b8';
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <p className="w-24 text-[var(--text-caption)] text-[var(--t-text-muted)] truncate">{c.nome}</p>
                  <div className="flex-1 h-6 bg-[var(--t-bg)] rounded-md overflow-hidden relative">
                    <div
                      className="absolute inset-y-0 left-0 rounded-md transition-all"
                      style={{ width: `${Math.max(2, widthPct)}%`, background: cor }}
                    />
                    <div className="absolute inset-0 flex items-center px-2 text-[11px] font-semibold text-white mix-blend-difference">
                      {formatBRL(lucro)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 p-4 border-t border-[var(--t-border)] bg-[var(--t-surface)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[var(--text-body-sm)] text-[var(--t-text-muted)] hover:text-[var(--t-text)]"
          >
            Fechar
          </button>
          <button
            onClick={() => { onSalvar(cenarios); onClose(); }}
            className="px-4 py-2 text-[var(--text-body-sm)] font-semibold text-white bg-[var(--t-green)] rounded-lg hover:opacity-90"
          >
            Salvar cenários
          </button>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-[var(--t-text-muted)] uppercase tracking-wide">{label}</span>
        <span className="text-[11px] font-semibold text-[var(--t-text)]">{value.toFixed(2)}x</span>
      </div>
      <input
        type="range"
        min={0.5}
        max={1.5}
        step={0.05}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--t-green)]"
      />
    </div>
  );
}

function Kpi({ label, value, emphasize, negative }: { label: string; value: string; emphasize?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-[var(--t-text-muted)]">{label}</span>
      <span className={`${emphasize ? 'font-bold text-[13px]' : 'font-medium'} ${negative ? 'text-red-500' : 'text-[var(--t-text)]'}`}>
        {value}
      </span>
    </div>
  );
}
