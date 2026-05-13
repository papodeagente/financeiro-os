'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Users, Loader2, ChevronRight, Search, AlertTriangle, LayoutGrid, List } from 'lucide-react';
import { MinimalPageHead, MinimalFooter } from '@/components/financeiro/MinimalPageHead';
import { Kanban } from './Kanban';
import type { KanbanStage } from '@/lib/gestao-grupos';
import { toast } from '@/lib/toast';

interface ResumoGrupo {
  id: string;
  grp_id: string;
  origem_destino: string;
  status_pipeline: string;
  gestao_status: string | null;
  kanban_stage: KanbanStage;
  data_inicio: string;
  data_fim: string;
  periodos_count: number;
  vagas: {
    total: number;
    ocupadas: number;
    disponiveis: number;
    reservadas: number;
    confirmadas: number;
  };
  reservas: number;
  confirmadas: number;
  materiais: number;
  alerta_vagas_restantes: number;
  financeiro?: {
    previsto: number;
    recebido: number;
    em_aberto: number;
    vencido: number;
  };
  updated_at: string;
}

type View = 'tabela' | 'kanban';
const VIEW_KEY = 'entur:gestao-grupos:view';

type FiltroVagas = 'todos' | 'disponiveis' | 'alerta' | 'lotado';

function fmtData(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

export default function VisaoGeralGestaoPage() {
  const [data, setData] = useState<ResumoGrupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroVagas, setFiltroVagas] = useState<FiltroVagas>('todos');
  const [view, setView] = useState<View>('kanban');

  // Persiste view escolhida pelo usuário entre sessões
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'tabela' || saved === 'kanban') setView(saved);
    } catch { /* ignore */ }
  }, []);

  const setViewPersist = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  };

  useEffect(() => {
    fetch('/api/gestao-grupos')
      .then(r => r.ok ? r.json() : [])
      .then(json => setData(Array.isArray(json) ? json : []))
      .finally(() => setLoading(false));
  }, []);

  // Move card do kanban — chamado pelo onDragEnd do Kanban
  const handleStageChange = useCallback(async (grupoId: string, stage: KanbanStage) => {
    // Otimista: atualiza UI antes da resposta
    setData(prev => prev.map(g => g.id === grupoId ? { ...g, kanban_stage: stage } : g));
    const res = await fetch(`/api/gestao-grupos/${grupoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanban_stage: stage }),
    });
    if (!res.ok) {
      // Reverte em caso de erro
      const json = await fetch('/api/gestao-grupos').then(r => r.json()).catch(() => null);
      if (Array.isArray(json)) setData(json);
      toast.error('Falha ao mover card — UI revertida');
      return;
    }
    toast.success('Card movido');
  }, []);

  const filtrados = useMemo(() => {
    const t = busca.toLowerCase().trim();
    return data.filter(g => {
      if (t && !(`${g.origem_destino} ${g.grp_id}`.toLowerCase().includes(t))) return false;
      if (filtroVagas === 'disponiveis' && g.vagas.disponiveis <= 0) return false;
      if (filtroVagas === 'alerta' && (g.vagas.disponiveis === 0 || g.vagas.disponiveis > g.alerta_vagas_restantes)) return false;
      if (filtroVagas === 'lotado' && (g.vagas.total === 0 || g.vagas.disponiveis > 0)) return false;
      return true;
    });
  }, [data, busca, filtroVagas]);

  // KPIs agregados
  const agg = useMemo(() => {
    return data.reduce(
      (acc, g) => ({
        grupos: acc.grupos + 1,
        vagasTotal: acc.vagasTotal + g.vagas.total,
        disponiveis: acc.disponiveis + g.vagas.disponiveis,
        reservas: acc.reservas + g.reservas,
        confirmadas: acc.confirmadas + g.confirmadas,
        previsto: acc.previsto + (g.financeiro?.previsto || 0),
        recebido: acc.recebido + (g.financeiro?.recebido || 0),
        em_aberto: acc.em_aberto + (g.financeiro?.em_aberto || 0),
        vencido: acc.vencido + (g.financeiro?.vencido || 0),
      }),
      { grupos: 0, vagasTotal: 0, disponiveis: 0, reservas: 0, confirmadas: 0, previsto: 0, recebido: 0, em_aberto: 0, vencido: 0 },
    );
  }, [data]);

  const fmtBRL = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-8 pt-6 pb-8 space-y-6">
        <MinimalPageHead
          title="Gestão de grupos"
          meta={
            <div className="mt-2.5 text-[12px] flex items-center gap-3 flex-wrap" style={{ color: 'var(--ink-3)' }}>
              <span><b className="mono" style={{ color: 'var(--ink-2)' }}>{agg.grupos}</b> grupos</span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span><b className="mono" style={{ color: 'var(--ink-2)' }}>{agg.disponiveis}</b> de <b className="mono" style={{ color: 'var(--ink-2)' }}>{agg.vagasTotal}</b> vagas livres</span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span><b className="mono" style={{ color: 'var(--ink-2)' }}>{agg.reservas}</b> reservas</span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span><b className="mono" style={{ color: 'var(--pos)' }}>{agg.confirmadas}</b> confirmadas</span>
            </div>
          }
        />

        {/* KPIs financeiros — só quando há receita prevista (Fase C) */}
        {agg.previsto > 0 && (
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-card__label">Receita prevista</div>
              <div className="kpi-card__value tabular-nums">{fmtBRL(agg.previsto)}</div>
              <div className="kpi-card__meta">Total das reservas confirmadas</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Recebido</div>
              <div className="kpi-card__value tabular-nums" style={{ color: 'var(--lg-pos)' }}>
                {fmtBRL(agg.recebido)}
              </div>
              <div className="kpi-card__meta">
                {agg.previsto > 0
                  ? `${((agg.recebido / agg.previsto) * 100).toFixed(0)}% do previsto`
                  : '—'}
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Em aberto</div>
              <div className="kpi-card__value tabular-nums">{fmtBRL(agg.em_aberto)}</div>
              <div className="kpi-card__meta">A receber nas próximas parcelas</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-card__label">Vencido</div>
              <div
                className="kpi-card__value tabular-nums"
                style={{ color: agg.vencido > 0 ? 'var(--lg-neg)' : 'var(--lg-text-4)' }}
              >
                {fmtBRL(agg.vencido)}
              </div>
              <div className="kpi-card__meta">
                {agg.vencido > 0 ? 'Cobrar com urgência' : 'Nenhuma parcela vencida'}
              </div>
            </div>
          </div>
        )}

        {/* Filtros + toggle Tabela/Kanban */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--ink-3)' }} />
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por destino ou GRP ID"
              className="h-[34px] pl-8 pr-3 border text-[12px] w-[320px] rounded-[8px]"
              style={{ borderColor: 'var(--line)', background: 'var(--ink-bg)', color: 'var(--ink)' }}
            />
          </div>
          <div className="flex items-stretch border rounded-[8px] overflow-hidden" style={{ borderColor: 'var(--line)', height: '34px' }}>
            {(['todos', 'disponiveis', 'alerta', 'lotado'] as const).map((k, i, arr) => {
              const ativo = filtroVagas === k;
              const labels: Record<FiltroVagas, string> = {
                todos: `Todos (${data.length})`,
                disponiveis: 'Com vagas',
                alerta: 'Atenção',
                lotado: 'Lotados',
              };
              return (
                <button
                  key={k}
                  onClick={() => setFiltroVagas(k)}
                  className="px-3 text-[11px] transition-colors"
                  style={{
                    color: ativo ? 'var(--ink)' : 'var(--ink-3)',
                    fontWeight: ativo ? 500 : 400,
                    background: ativo ? 'var(--ink-surface-2)' : 'transparent',
                    borderRight: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
                  }}
                >
                  {labels[k]}
                </button>
              );
            })}
          </div>

          {/* Toggle Tabela/Kanban */}
          <div className="ml-auto flex items-stretch border rounded-[8px] overflow-hidden" style={{ borderColor: 'var(--line)', height: '34px' }}>
            {([
              { key: 'kanban' as const, label: 'Kanban', Icon: LayoutGrid },
              { key: 'tabela' as const, label: 'Tabela', Icon: List },
            ]).map((opt, i, arr) => {
              const ativo = view === opt.key;
              const Icon = opt.Icon;
              return (
                <button
                  key={opt.key}
                  onClick={() => setViewPersist(opt.key)}
                  className="px-3 text-[11px] transition-colors flex items-center gap-1.5"
                  style={{
                    color: ativo ? 'var(--lg-accent)' : 'var(--ink-3)',
                    fontWeight: ativo ? 600 : 400,
                    background: ativo ? 'var(--lg-accent-fill)' : 'transparent',
                    borderRight: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tabela ou Kanban */}
        {loading ? (
          <div className="border p-10 text-center rounded-[12px]" style={{ borderColor: 'var(--line)' }}>
            <Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: 'var(--ink-3)' }} />
          </div>
        ) : filtrados.length === 0 ? (
          <div className="border p-10 text-center rounded-[12px]" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
            <Users className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--ink-3)' }} />
            <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
              {data.length === 0 ? 'Nenhum grupo cadastrado ainda.' : 'Nenhum grupo encontrado com esses filtros.'}
            </p>
            {data.length === 0 && (
              <Link href="/grupos" className="mt-3 inline-block text-[12px]" style={{ color: 'var(--ink)' }}>
                Ir para Produtos →
              </Link>
            )}
          </div>
        ) : view === 'kanban' ? (
          <Kanban grupos={filtrados} onStageChange={handleStageChange} />
        ) : (
          <div className="border overflow-hidden rounded-[12px]" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ background: 'var(--ink-surface-2)', borderBottom: '1px solid var(--line)' }}>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Destino</th>
                  <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Período</th>
                  <th className="text-left px-3 py-2 font-medium w-[280px]" style={{ color: 'var(--ink-2)' }}>Ocupação</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Reservas</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Confirmadas</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}>Materiais</th>
                  <th className="text-right px-3 py-2 font-medium" style={{ color: 'var(--ink-2)' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(g => {
                  const pct = g.vagas.total > 0 ? Math.min((g.vagas.ocupadas / g.vagas.total) * 100, 100) : 0;
                  const lotado = g.vagas.total > 0 && g.vagas.disponiveis === 0;
                  const emAlerta = !lotado && g.vagas.disponiveis <= g.alerta_vagas_restantes;
                  const cor = lotado ? 'var(--neg)' : emAlerta ? 'var(--warn)' : 'var(--pos)';
                  return (
                    <tr
                      key={g.id}
                      className="border-t transition-colors hover:bg-[var(--ink-surface-2)] cursor-pointer"
                      style={{ borderColor: 'var(--line)' }}
                      onClick={() => { window.location.assign(`/grupo/${g.id}/gestao`); }}
                    >
                      <td className="px-3 py-3">
                        <div className="font-medium" style={{ color: 'var(--ink)' }}>{g.origem_destino || '—'}</div>
                        <div className="text-[10px] mono" style={{ color: 'var(--ink-3)' }}>{g.grp_id}</div>
                      </td>
                      <td className="px-3 py-3 mono" style={{ color: 'var(--ink-2)' }}>
                        {g.data_inicio || g.data_fim ? (
                          <>
                            {fmtData(g.data_inicio)} → {fmtData(g.data_fim)}
                            <div className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                              {g.periodos_count} {g.periodos_count === 1 ? 'saída' : 'saídas'}
                            </div>
                          </>
                        ) : <span style={{ color: 'var(--ink-3)' }}>—</span>}
                      </td>
                      <td className="px-3 py-3">
                        {g.vagas.total > 0 ? (
                          <>
                            <div className="h-1.5 overflow-hidden mb-1" style={{ background: 'var(--ink-surface-2)' }}>
                              <div className="h-full transition-all" style={{ width: `${pct}%`, background: cor }} />
                            </div>
                            <div className="flex items-center justify-between text-[10px] mono">
                              <span style={{ color: cor }}>
                                {lotado && <AlertTriangle className="w-2.5 h-2.5 inline mr-0.5" />}
                                {g.vagas.disponiveis} livres
                              </span>
                              <span style={{ color: 'var(--ink-3)' }}>de {g.vagas.total}</span>
                            </div>
                          </>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>sem vagas configuradas</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right mono" style={{ color: 'var(--ink)' }}>
                        {g.reservas > 0 ? g.reservas : <span style={{ color: 'var(--ink-4)' }}>0</span>}
                      </td>
                      <td className="px-3 py-3 text-right mono" style={{ color: g.confirmadas > 0 ? 'var(--pos)' : 'var(--ink-4)' }}>
                        {g.confirmadas}
                      </td>
                      <td className="px-3 py-3 text-right mono" style={{ color: g.materiais > 0 ? 'var(--ink)' : 'var(--ink-4)' }}>
                        {g.materiais}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <ChevronRight className="w-3.5 h-3.5 inline" style={{ color: 'var(--ink-3)' }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <MinimalFooter pageId="gestão de grupos" />
      </div>
    </div>
  );
}
