'use client';

import { Input } from '@/components/ui/input';
import { Plane, Search, Clock, Leaf, AlertTriangle, ArrowRight } from 'lucide-react';
import { initiateProposalFlightSearch } from '@/lib/api-search-handoff';
import type { BlockProps } from './types';
import type { VooData } from '@/lib/crm-types';

function fmtMin(min: number): string {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m > 0 ? ` ${m}min` : ''}`;
}

function fmtBRL(v?: number): string {
  if (!v) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function extTime(s?: string): string {
  if (!s) return '—';
  return s.split(' ')[1]?.substring(0, 5) || s;
}

export function VooBlock({ conteudo, onChange }: BlockProps) {
  const c = conteudo as Partial<VooData>;
  const update = (patch: Partial<VooData>) => {
    onChange({ ...conteudo, ...patch } as Record<string, unknown>);
  };

  const temDadosImportados = !!(c.companhia || c.segmentos?.length);

  const abrirBuscaVoo = () => {
    const match = window.location.pathname.match(/\/propostas\/([^/?#]+)/);
    const propostaId = match?.[1] || '';
    const blockId = c.id || '';
    if (!propostaId || !blockId) return;
    initiateProposalFlightSearch({
      propostaId,
      blockId,
      origem: c.origem || '',
      destino: c.destino || '',
      dataIda: c.data || '',
      adultos: 1,
      returnTo: `${window.location.pathname}${window.location.search}`,
    });
  };

  return (
    <div className="space-y-3">
      {/* Botão de busca rica */}
      <button
        onClick={abrirBuscaVoo}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 hover:border-blue-400 text-blue-400 text-xs font-medium transition-all"
      >
        <Plane className="w-4 h-4" />
        <Search className="w-3.5 h-3.5" />
        {temDadosImportados ? 'Trocar voo (buscar de novo)' : 'Buscar voo na API'}
      </button>

      {/* Resumo visual quando há dados importados */}
      {temDadosImportados && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              {c.companhia_logo && <img src={c.companhia_logo} alt="" className="w-6 h-6 rounded bg-white p-0.5" />}
              <div className="min-w-0">
                <div className="font-semibold text-[var(--t-text)] truncate">
                  {c.companhia} {c.numero_voo}
                </div>
                {c.aeronave && (
                  <div className="text-[10px] text-[var(--t-text-muted)] truncate">{c.aeronave}</div>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-bold text-blue-400">{fmtBRL(c.valor)}</div>
              {c.classe && <div className="text-[10px] text-[var(--t-text-muted)] capitalize">{c.classe}</div>}
            </div>
          </div>

          {/* Trajeto */}
          <div className="flex items-center gap-2 text-xs">
            <div className="text-center">
              <div className="font-mono font-bold text-[var(--t-text)]">{c.origem}</div>
              <div className="text-[10px] text-[var(--t-text-muted)]">{extTime(c.horario_saida)}</div>
            </div>
            <div className="flex-1 flex items-center gap-1 text-[10px] text-[var(--t-text-muted)]">
              <span className="flex-1 border-t border-dashed border-[var(--t-border)]" />
              <Plane className="w-3 h-3" />
              <span>{c.escalas ? `${c.escalas} escala${c.escalas > 1 ? 's' : ''}` : 'Direto'}</span>
              <span className="flex-1 border-t border-dashed border-[var(--t-border)]" />
            </div>
            <div className="text-center">
              <div className="font-mono font-bold text-[var(--t-text)]">{c.destino}</div>
              <div className="text-[10px] text-[var(--t-text-muted)]">
                {extTime(c.horario_chegada)}
                {c.data_chegada && c.data && c.data_chegada !== c.data && (
                  <span className="text-amber-400 ml-0.5">+1d</span>
                )}
              </div>
            </div>
          </div>

          {/* Badges informativos */}
          <div className="flex flex-wrap gap-1.5">
            {c.bagagem && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--t-bg)] text-[var(--t-text-secondary)] border border-[var(--t-border)]">
                🧳 {c.bagagem}
              </span>
            )}
            {c.legroom && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--t-bg)] text-[var(--t-text-secondary)] border border-[var(--t-border)]">
                💺 {c.legroom}
              </span>
            )}
            {c.emissao_carbono_kg !== undefined && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <Leaf className="w-2.5 h-2.5" /> {c.emissao_carbono_kg} kg CO₂
                {c.emissao_carbono_diff_percent !== undefined && c.emissao_carbono_diff_percent < 0 && (
                  <span className="text-emerald-500"> ({c.emissao_carbono_diff_percent}%)</span>
                )}
              </span>
            )}
            {c.muitas_vezes_atrasado && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" /> Costuma atrasar
              </span>
            )}
          </div>

          {/* Segmentos (escalas) — só se houver mais de 1 */}
          {c.segmentos && c.segmentos.length > 1 && (
            <div className="border-t border-blue-500/20 pt-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">
                {c.segmentos.length} trechos
              </div>
              {c.segmentos.map((seg, i) => (
                <div key={i} className="text-[11px] text-[var(--t-text-secondary)] flex items-center gap-2 flex-wrap">
                  <span className="text-[var(--t-text-muted)]">{i + 1}.</span>
                  <span className="font-medium text-[var(--t-text)]">{seg.companhia} {seg.numero_voo}</span>
                  <span className="font-mono">{seg.origem}</span>
                  <span>{extTime(seg.horario_saida)}</span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="font-mono">{seg.destino}</span>
                  <span>{extTime(seg.horario_chegada)}</span>
                  <span className="text-[var(--t-text-muted)] flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" /> {fmtMin(seg.duracao_min)}
                  </span>
                </div>
              ))}
              {c.escalas_info && c.escalas_info.length > 0 && (
                <div className="text-[10px] text-amber-400 pt-1">
                  Escala{c.escalas_info.length > 1 ? 's' : ''} em: {c.escalas_info.map(e => `${e.aeroporto}${e.duracao_min ? ` (${fmtMin(e.duracao_min)})` : ''}`).join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edição manual quando não há dados importados (ou pra ajustes finos) */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Data</label>
          <Input
            type="date"
            value={c.data || ''}
            onChange={e => update({ data: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Origem (IATA)</label>
          <Input
            value={c.origem || ''}
            onChange={e => update({ origem: e.target.value.toUpperCase() })}
            placeholder="GRU"
            maxLength={3}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm uppercase"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--t-text-muted)]">Destino (IATA)</label>
          <Input
            value={c.destino || ''}
            onChange={e => update({ destino: e.target.value.toUpperCase() })}
            placeholder="CDG"
            maxLength={3}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm uppercase"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-[var(--t-text-muted)]">Detalhes / Observações</label>
        <textarea
          value={c.detalhes || ''}
          onChange={e => update({ detalhes: e.target.value })}
          rows={2}
          placeholder="Informações adicionais sobre o voo..."
          className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
        />
      </div>

      {/* Toggles de visibilidade na proposta pro cliente */}
      {temDadosImportados && (
        <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 space-y-2">
          <div className="text-[11px] font-semibold text-blue-400 uppercase tracking-wide">
            Detalhes do Google Flights na proposta
          </div>
          <div className="grid grid-cols-2 gap-2">
            {c.segmentos && c.segmentos.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-[var(--t-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.mostrar_segmentos !== false}
                  onChange={e => update({ mostrar_segmentos: e.target.checked })}
                  className="rounded"
                />
                <span>Mostrar escalas detalhadas</span>
              </label>
            )}
            {c.emissao_carbono_kg !== undefined && (
              <label className="flex items-center gap-2 text-xs text-[var(--t-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.mostrar_emissao_co2 !== false}
                  onChange={e => update({ mostrar_emissao_co2: e.target.checked })}
                  className="rounded"
                />
                <span>Mostrar emissão de CO₂</span>
              </label>
            )}
            {c.aeronave && (
              <label className="flex items-center gap-2 text-xs text-[var(--t-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.mostrar_aeronave !== false}
                  onChange={e => update({ mostrar_aeronave: e.target.checked })}
                  className="rounded"
                />
                <span>Mostrar aeronave/classe</span>
              </label>
            )}
            {c.bagagem && (
              <label className="flex items-center gap-2 text-xs text-[var(--t-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.mostrar_bagagem !== false}
                  onChange={e => update({ mostrar_bagagem: e.target.checked })}
                  className="rounded"
                />
                <span>Mostrar bagagem</span>
              </label>
            )}
            {c.muitas_vezes_atrasado && (
              <label className="flex items-center gap-2 text-xs text-[var(--t-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={c.mostrar_alerta_atraso === true}
                  onChange={e => update({ mostrar_alerta_atraso: e.target.checked })}
                  className="rounded"
                />
                <span>Alerta de atraso frequente</span>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
