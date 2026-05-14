'use client';

import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Users, FileText, Folder, AlertTriangle, Check, Loader2, Edit2, UserCircle2, DollarSign } from 'lucide-react';
import { MinimalPageHead, MinimalFooter, MinimalSectionHeader } from '@/components/financeiro/MinimalPageHead';
import { toast } from '@/lib/toast';
import { ReservasTab } from './ReservasTab';
import { MateriaisTab } from './MateriaisTab';
import { PassageirosTab } from './PassageirosTab';
import { FinanceiroTab } from './FinanceiroTab';

type SubAba = 'vagas' | 'reservas' | 'passageiros' | 'financeiro' | 'materiais';

interface PeriodoVagas {
  id: string;
  periodo_index: number;
  label: string;
  data_inicio: string | null;
  data_fim: string | null;
  destino?: string;
  vagas_total: number;
  vagas_reservadas: number;
  vagas_confirmadas: number;
  vagas_disponiveis: number;
}

interface GestaoData {
  grupo_id: string;
  grupo: { id: string; grp_id: string; origem_destino: string; tipo?: string; tarifas_ativas?: string[] };
  gestao: {
    id: string;
    status: string;
    observacoes: string;
    config_vagas: {
      controle_por_periodo: boolean;
      permitir_lista_espera: boolean;
      alerta_vagas_restantes: number;
    };
  } | null;
  periodos: PeriodoVagas[];
  contagem_reservas: Record<string, number>;
  materiais: unknown[];
}

function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function GestaoGrupoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: grupoId } = use(params);
  const [data, setData] = useState<GestaoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<SubAba>('vagas');
  const [editingPeriodo, setEditingPeriodo] = useState<string | null>(null);
  const [novoTotal, setNovoTotal] = useState<number>(0);
  const [savingVagas, setSavingVagas] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/gestao-grupos/${grupoId}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else {
        toast.error('Não foi possível carregar a gestão do grupo');
      }
    } finally {
      setLoading(false);
    }
  }, [grupoId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvarVagasTotal = async (periodoId: string) => {
    setSavingVagas(true);
    try {
      const res = await fetch(`/api/gestao-grupos/${grupoId}/vagas/${periodoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vagas_total: novoTotal }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || 'Falha ao atualizar vagas');
        return;
      }
      toast.success('Vagas atualizadas');
      setEditingPeriodo(null);
      await carregar();
    } finally {
      setSavingVagas(false);
    }
  };

  const alerta = data?.gestao?.config_vagas.alerta_vagas_restantes ?? 5;

  // Indicador de vagas global (somando todos os períodos)
  const totalGeral = data?.periodos.reduce((s, p) => s + p.vagas_total, 0) || 0;
  const ocupadasGeral = data?.periodos.reduce((s, p) => s + p.vagas_reservadas + p.vagas_confirmadas, 0) || 0;
  const disponiveisGeral = data?.periodos.reduce((s, p) => s + p.vagas_disponiveis, 0) || 0;
  const reservasTotal = (data?.contagem_reservas['reservado'] || 0) + (data?.contagem_reservas['lista_espera'] || 0);
  const confirmadasTotal = data?.contagem_reservas['confirmado'] || 0;

  if (loading || !data) {
    return (
      <div className="px-8 pt-6 pb-8">
        <MinimalPageHead
          title="Gestão do grupo"
          meta={<div className="mt-2.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>Carregando…</div>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-8 pt-6 pb-8 space-y-6">
        <MinimalPageHead
          title={`Gestão · ${data.grupo.origem_destino || data.grupo.grp_id || 'Grupo'}`}
          meta={
            <div className="mt-2.5 text-[12px] flex items-center gap-3 flex-wrap" style={{ color: 'var(--ink-3)' }}>
              <Link href={`/grupo/${grupoId}`} className="inline-flex items-center gap-1 hover:underline" style={{ color: 'var(--ink)' }}>
                <ArrowLeft className="w-3 h-3" /> Voltar ao produto
              </Link>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span><b className="mono" style={{ color: 'var(--ink-2)' }}>{disponiveisGeral}</b> de <b className="mono" style={{ color: 'var(--ink-2)' }}>{totalGeral}</b> vagas livres</span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span><b className="mono" style={{ color: 'var(--ink-2)' }}>{reservasTotal}</b> reservas</span>
              <span style={{ color: 'var(--ink-4)' }}>·</span>
              <span><b className="mono" style={{ color: 'var(--pos)' }}>{confirmadasTotal}</b> confirmadas</span>
            </div>
          }
        />

        {/* Sub-tabs minimal */}
        <div className="flex items-stretch border w-fit" style={{ borderColor: 'var(--line)', height: '34px' }}>
          {([
            { key: 'vagas', label: 'Vagas', icon: Users, count: data.periodos.length },
            { key: 'reservas', label: 'Reservas', icon: FileText, count: reservasTotal + confirmadasTotal },
            { key: 'passageiros', label: 'Passageiros', icon: UserCircle2, count: 0 },
            { key: 'financeiro', label: 'Financeiro', icon: DollarSign, count: 0 },
            { key: 'materiais', label: 'Materiais', icon: Folder, count: data.materiais.length },
          ] as const).map((t, i, arr) => {
            const ativo = aba === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setAba(t.key)}
                className="px-4 text-[12px] transition-colors flex items-center gap-1.5"
                style={{
                  color: ativo ? 'var(--ink)' : 'var(--ink-3)',
                  fontWeight: ativo ? 500 : 400,
                  background: ativo ? 'var(--ink-surface-2)' : 'transparent',
                  borderRight: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
                {t.count > 0 && (
                  <span className="mono text-[10px] px-1.5 py-0.5" style={{ background: 'var(--ink-bg)', color: 'var(--ink-2)' }}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Aba VAGAS */}
        {aba === 'vagas' && (
          <div className="space-y-4">
            <MinimalSectionHeader label="Vagas por período" sub={`· ${data.periodos.length} ${data.periodos.length === 1 ? 'período' : 'períodos'}`} />

            {data.periodos.length === 0 && (
              <div className="border p-8 text-center" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
                <p className="text-[13px]" style={{ color: 'var(--ink-2)' }}>Nenhum período cadastrado ainda.</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>Adicione períodos na aba Info do produto.</p>
              </div>
            )}

            {data.periodos.map(p => {
              const ocupadas = p.vagas_reservadas + p.vagas_confirmadas;
              const pctOcupacao = p.vagas_total > 0 ? Math.min((ocupadas / p.vagas_total) * 100, 100) : 0;
              const lotado = p.vagas_disponiveis === 0 && p.vagas_total > 0;
              const emAlerta = !lotado && p.vagas_disponiveis <= alerta;
              const corBarra = lotado ? 'var(--neg)' : emAlerta ? 'var(--warn)' : 'var(--pos)';
              const editando = editingPeriodo === p.id;

              return (
                <div key={p.id} className="border p-5" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-[15px] font-medium" style={{ color: 'var(--ink)' }}>{p.label}</h3>
                        {lotado && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 uppercase tracking-wide" style={{ background: 'var(--neg)', color: 'white' }}>
                            <AlertTriangle className="w-2.5 h-2.5" /> Lotado
                          </span>
                        )}
                        {emAlerta && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 uppercase tracking-wide border" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
                            <AlertTriangle className="w-2.5 h-2.5" /> Atenção
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] mt-1 mono" style={{ color: 'var(--ink-3)' }}>
                        {fmtData(p.data_inicio)} → {fmtData(p.data_fim)}
                        {p.destino && <span className="ml-2" style={{ color: 'var(--ink-2)' }}>· {p.destino}</span>}
                      </p>
                    </div>

                    {!editando ? (
                      <button
                        onClick={() => { setEditingPeriodo(p.id); setNovoTotal(p.vagas_total); }}
                        className="inline-flex items-center gap-1 px-3 h-[28px] text-[11px] border transition-colors"
                        style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)' }}
                      >
                        <Edit2 className="w-3 h-3" /> Editar vagas totais
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          value={novoTotal}
                          onChange={e => setNovoTotal(parseInt(e.target.value) || 0)}
                          className="w-24 h-[28px] px-2 border text-[12px] mono"
                          style={{ borderColor: 'var(--line-strong)', background: 'var(--ink-bg)', color: 'var(--ink)' }}
                          autoFocus
                        />
                        <button
                          onClick={() => salvarVagasTotal(p.id)}
                          disabled={savingVagas}
                          className="inline-flex items-center gap-1 px-3 h-[28px] text-[11px] disabled:opacity-50"
                          style={{ background: 'var(--ink)', color: 'var(--ink-bg)' }}
                        >
                          {savingVagas ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Salvar
                        </button>
                        <button
                          onClick={() => setEditingPeriodo(null)}
                          className="px-3 h-[28px] text-[11px]"
                          style={{ color: 'var(--ink-3)' }}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Barra de ocupação */}
                  <div className="space-y-2">
                    <div className="h-2 w-full overflow-hidden" style={{ background: 'var(--ink-surface-2)' }}>
                      <div className="h-full transition-all" style={{ width: `${pctOcupacao}%`, background: corBarra }} />
                    </div>
                    <div className="grid grid-cols-4 gap-3 text-[11px]">
                      <div>
                        <p className="uppercase tracking-wide text-[10px]" style={{ color: 'var(--ink-3)' }}>Total</p>
                        <p className="mono text-[14px] font-medium" style={{ color: 'var(--ink)' }}>{p.vagas_total}</p>
                      </div>
                      <div>
                        <p className="uppercase tracking-wide text-[10px]" style={{ color: 'var(--ink-3)' }}>Reservadas</p>
                        <p className="mono text-[14px] font-medium" style={{ color: 'var(--ink)' }}>{p.vagas_reservadas}</p>
                      </div>
                      <div>
                        <p className="uppercase tracking-wide text-[10px]" style={{ color: 'var(--ink-3)' }}>Confirmadas</p>
                        <p className="mono text-[14px] font-medium" style={{ color: 'var(--pos)' }}>{p.vagas_confirmadas}</p>
                      </div>
                      <div>
                        <p className="uppercase tracking-wide text-[10px]" style={{ color: 'var(--ink-3)' }}>Disponíveis</p>
                        <p className="mono text-[14px] font-medium" style={{ color: corBarra }}>{p.vagas_disponiveis}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <p className="text-[11px] italic mt-3" style={{ color: 'var(--ink-3)' }}>
              Reservadas e confirmadas são calculadas automaticamente a partir das reservas (aba Reservas) — só Vagas totais é editável aqui.
            </p>
          </div>
        )}

        {/* Aba RESERVAS */}
        {aba === 'reservas' && (
          <ReservasTab
            grupoId={grupoId}
            periodos={data.periodos.map(p => ({
              id: p.id,
              label: p.label,
              vagas_disponiveis: p.vagas_disponiveis,
              vagas_total: p.vagas_total,
            }))}
            tarifasAtivas={data.grupo.tarifas_ativas || []}
            permiteListaEspera={!!data.gestao?.config_vagas.permitir_lista_espera}
            onReservaChange={() => { void carregar(); }}
          />
        )}

        {/* Aba PASSAGEIROS */}
        {aba === 'passageiros' && (
          <PassageirosTab grupoId={grupoId} onChange={() => { void carregar(); }} />
        )}

        {/* Aba FINANCEIRO */}
        {aba === 'financeiro' && (
          <FinanceiroTab grupoId={grupoId} origemDestino={data.grupo.origem_destino} />
        )}

        {/* Aba MATERIAIS */}
        {aba === 'materiais' && (
          <MateriaisTab grupoId={grupoId} onChange={() => { void carregar(); }} />
        )}

        <MinimalFooter pageId={`gestão · ${data.grupo.grp_id || ''}`} />
      </div>
    </div>
  );
}
