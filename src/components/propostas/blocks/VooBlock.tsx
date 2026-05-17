'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Plane, Search, Clock, Leaf, AlertTriangle, ArrowRight, Plus, Trash2, GitBranch } from 'lucide-react';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import { formatFlightForTransporte } from '@/lib/flight-data-mapper';
import { FlightSearchModal } from '@/components/FlightSearchModal';
import type { BlockProps } from './types';
import type { VooData } from '@/lib/crm-types';

function fmtMin(min: number): string {
  if (!min || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m > 0 ? ` ${String(m).padStart(2, '0')}min` : ''}`;
}

function fmtBRL(v?: number): string {
  if (!v) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function extTime(s?: string): string {
  if (!s) return '—';
  return s.split(' ')[1]?.substring(0, 5) || s;
}

export function VooBlock({ conteudo, onChange, onInsertAfter }: BlockProps) {
  const c = conteudo as Partial<VooData>;
  const [flightModalOpen, setFlightModalOpen] = useState(false);
  const update = (patch: Partial<VooData>) => {
    onChange({ ...conteudo, ...patch } as Record<string, unknown>);
  };

  const temDadosImportados = !!(c.companhia || c.segmentos?.length);
  const etapa = c.voo_etapa;
  const escalas = c.escalas || 0;
  const segs = c.segmentos || [];

  // Aplica voo da API direto neste bloco. Round-trip cria 2o bloco VOO
  // (VOLTA) via onInsertAfter, preservando ID do bloco atual.
  const handleFlightSelect = (ida: FlightOffer, volta?: FlightOffer) => {
    const oneWayIda: FlightOffer = {
      ...ida,
      returnFlights: undefined,
      returnDuration: undefined,
      returnLayovers: undefined,
    };
    const [idaContent] = formatFlightForTransporte(oneWayIda) as unknown as Partial<VooData>[];
    onChange({
      ...conteudo,
      ...idaContent,
      id: c.id || idaContent.id,
      voo_etapa: volta ? 'IDA' : undefined,
    } as Record<string, unknown>);
    if (volta && onInsertAfter) {
      const oneWayVolta: FlightOffer = {
        ...volta,
        returnFlights: undefined,
        returnDuration: undefined,
        returnLayovers: undefined,
      };
      const [voltaContent] = formatFlightForTransporte(oneWayVolta) as unknown as Partial<VooData>[];
      onInsertAfter('VOO', { ...voltaContent, voo_etapa: 'VOLTA' } as Record<string, unknown>);
    }
  };

  return (
    <div className="space-y-4">
      {/* Botão de busca rica — modal in-place, atualiza ESTE bloco */}
      <button
        onClick={() => setFlightModalOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-3 h-[34px] text-[12px] transition-colors border"
        style={{
          background: 'var(--ink-surface)',
          color: 'var(--ink)',
          borderColor: 'var(--line-strong)',
        }}
      >
        <Plane className="w-3.5 h-3.5" />
        <Search className="w-3 h-3" />
        {temDadosImportados ? 'Trocar voo (buscar de novo)' : 'Buscar voo na API · Google Flights'}
      </button>
      <FlightSearchModal
        open={flightModalOpen}
        onClose={() => setFlightModalOpen(false)}
        onSelect={handleFlightSelect}
        defaultOrigem={c.origem || ''}
        defaultDestino={c.destino || ''}
        defaultDataIda={c.data || ''}
      />

      {/* Resumo visual quando há dados importados — minimal w/ hairlines */}
      {temDadosImportados && (
        <div
          className="border p-4 space-y-3"
          style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}
        >
          {/* Header: selo IDA/VOLTA + companhia + número + preço */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {etapa && (
                <span
                  className="inline-flex items-center px-2 py-0.5 text-[10px] tracking-[0.08em] font-medium uppercase border"
                  style={{
                    borderColor: 'var(--line-strong)',
                    color: 'var(--ink)',
                    background: 'var(--ink-surface-2)',
                  }}
                >
                  {etapa}
                </span>
              )}
              {c.companhia_logo && (
                <img
                  src={c.companhia_logo}
                  alt=""
                  className="w-7 h-7 object-contain p-0.5 bg-white border"
                  style={{ borderColor: 'var(--line)' }}
                />
              )}
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: 'var(--ink)' }}>
                  {c.companhia} <span className="mono">{c.numero_voo}</span>
                </div>
                {c.aeronave && (
                  <div className="text-[11px] truncate" style={{ color: 'var(--ink-3)' }}>
                    {c.aeronave}{c.classe ? ` · ${c.classe}` : ''}
                  </div>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[15px] font-medium mono" style={{ color: 'var(--ink)' }}>{fmtBRL(c.valor)}</div>
              {c.data && (
                <div className="text-[10px] mono" style={{ color: 'var(--ink-3)' }}>
                  {c.data.split('-').reverse().join('/')}
                </div>
              )}
            </div>
          </div>

          {/* Trajeto principal — origem → destino com timeline minimal */}
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 pt-1">
            <div>
              <div className="text-[18px] font-medium mono leading-none" style={{ color: 'var(--ink)' }}>{c.origem || '—'}</div>
              <div className="text-[11px] mono mt-1" style={{ color: 'var(--ink-2)' }}>{extTime(c.horario_saida)}</div>
              {c.aeroporto_origem_nome && (
                <div className="text-[10px] mt-0.5 max-w-[140px] truncate" style={{ color: 'var(--ink-3)' }} title={c.aeroporto_origem_nome}>
                  {c.aeroporto_origem_nome}
                </div>
              )}
            </div>

            <div className="flex flex-col items-stretch gap-1 px-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 border-t" style={{ borderColor: 'var(--line)' }} />
                <Plane className="w-3 h-3" style={{ color: 'var(--ink-3)' }} />
                <span className="flex-1 border-t" style={{ borderColor: 'var(--line)' }} />
              </div>
              <div className="text-center text-[10px] uppercase tracking-[0.05em]" style={{ color: 'var(--ink-3)' }}>
                {escalas === 0 ? 'Direto' : `${escalas} conex${escalas > 1 ? 'ões' : 'ão'}`}
                {c.tempo_estimado && <span className="mono ml-1.5">· {c.tempo_estimado}</span>}
              </div>
            </div>

            <div className="text-right">
              <div className="text-[18px] font-medium mono leading-none" style={{ color: 'var(--ink)' }}>{c.destino || '—'}</div>
              <div className="text-[11px] mono mt-1" style={{ color: 'var(--ink-2)' }}>
                {extTime(c.horario_chegada)}
                {c.data_chegada && c.data && c.data_chegada !== c.data && (
                  <span style={{ color: 'var(--warn)' }} className="ml-1">+1d</span>
                )}
              </div>
              {c.aeroporto_destino_nome && (
                <div className="text-[10px] mt-0.5 max-w-[140px] truncate ml-auto" style={{ color: 'var(--ink-3)' }} title={c.aeroporto_destino_nome}>
                  {c.aeroporto_destino_nome}
                </div>
              )}
            </div>
          </div>

          {/* Conexões detalhadas — timeline com todos os segmentos */}
          {segs.length > 1 && (
            <div className="border-t pt-3 mt-1" style={{ borderColor: 'var(--line)' }}>
              <div className="text-[10px] uppercase tracking-[0.08em] mb-2 font-medium" style={{ color: 'var(--ink-2)' }}>
                {segs.length} trechos · todas as conexões
              </div>
              <div className="space-y-2.5">
                {segs.map((seg, i) => {
                  const escalaInfo = c.escalas_info?.[i];
                  return (
                    <div key={i}>
                      <div className="grid grid-cols-[16px_1fr] gap-2 items-start">
                        <div className="text-[10px] mono mt-1" style={{ color: 'var(--ink-3)' }}>{i + 1}.</div>
                        <div className="space-y-1">
                          <div className="flex items-baseline gap-2 flex-wrap text-[11px]">
                            <span className="font-medium" style={{ color: 'var(--ink)' }}>{seg.companhia}</span>
                            <span className="mono" style={{ color: 'var(--ink-2)' }}>{seg.numero_voo}</span>
                            {seg.aeronave && <span style={{ color: 'var(--ink-3)' }}>· {seg.aeronave}</span>}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] mono" style={{ color: 'var(--ink-2)' }}>
                            <span>{seg.origem}</span>
                            <span style={{ color: 'var(--ink-3)' }}>{extTime(seg.horario_saida)}</span>
                            <ArrowRight className="w-2.5 h-2.5" style={{ color: 'var(--ink-4)' }} />
                            <span>{seg.destino}</span>
                            <span style={{ color: 'var(--ink-3)' }}>{extTime(seg.horario_chegada)}</span>
                            <span className="flex items-center gap-0.5 ml-1" style={{ color: 'var(--ink-3)' }}>
                              <Clock className="w-2.5 h-2.5" /> {fmtMin(seg.duracao_min)}
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Escala entre este segmento e o próximo */}
                      {i < segs.length - 1 && escalaInfo && (
                        <div
                          className="grid grid-cols-[16px_1fr] gap-2 mt-2 ml-0 py-1 px-2 text-[10px]"
                          style={{ background: 'var(--ink-surface-2)', borderLeft: '2px solid var(--warn)' }}
                        >
                          <div />
                          <div style={{ color: 'var(--ink-2)' }}>
                            <span className="uppercase tracking-[0.08em] font-medium">Escala em {escalaInfo.aeroporto}</span>
                            {escalaInfo.nome && <span className="ml-1" style={{ color: 'var(--ink-3)' }}>· {escalaInfo.nome}</span>}
                            {escalaInfo.duracao_min && <span className="mono ml-1.5" style={{ color: 'var(--ink-3)' }}>· {fmtMin(escalaInfo.duracao_min)}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Badges informativos — bagagem, legroom, CO2, atraso */}
          {(c.bagagem || c.legroom || c.emissao_carbono_kg !== undefined || c.muitas_vezes_atrasado) && (
            <div className="flex flex-wrap gap-1.5 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
              {c.bagagem && (
                <span
                  className="text-[10px] px-2 py-0.5 border"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)' }}
                >
                  Bagagem · {c.bagagem}
                </span>
              )}
              {c.legroom && (
                <span
                  className="text-[10px] px-2 py-0.5 border"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-2)' }}
                >
                  Espaço · {c.legroom}
                </span>
              )}
              {c.emissao_carbono_kg !== undefined && (
                <span
                  className="text-[10px] px-2 py-0.5 border flex items-center gap-1"
                  style={{ borderColor: 'var(--line-strong)', color: 'var(--pos)' }}
                >
                  <Leaf className="w-2.5 h-2.5" />
                  {c.emissao_carbono_kg} kg CO₂
                  {c.emissao_carbono_diff_percent !== undefined && c.emissao_carbono_diff_percent < 0 && (
                    <span className="ml-0.5">({c.emissao_carbono_diff_percent}%)</span>
                  )}
                </span>
              )}
              {c.muitas_vezes_atrasado && (
                <span
                  className="text-[10px] px-2 py-0.5 border flex items-center gap-1"
                  style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
                >
                  <AlertTriangle className="w-2.5 h-2.5" /> Costuma atrasar
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edição manual — campos básicos sempre acessíveis */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--ink-3)' }}>Data</label>
          <Input
            type="date"
            value={c.data || ''}
            onChange={e => update({ data: e.target.value })}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--ink-3)' }}>Origem (IATA)</label>
          <Input
            value={c.origem || ''}
            onChange={e => update({ origem: e.target.value.toUpperCase() })}
            placeholder="GRU"
            maxLength={3}
            className="bg-[var(--t-bg)] border-[var(--t-border)] text-[var(--t-text)] text-sm uppercase"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--ink-3)' }}>Destino (IATA)</label>
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
        <label className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--ink-3)' }}>Detalhes / Observações</label>
        <textarea
          value={c.detalhes || ''}
          onChange={e => update({ detalhes: e.target.value })}
          rows={2}
          placeholder="Informações adicionais sobre o voo..."
          className="w-full bg-[var(--t-bg)] text-[var(--t-text)] shadow-[var(--t-card-shadow)] rounded-lg px-3 py-2 text-sm resize-none"
        />
      </div>

      {/* Editor de CONEXOES / SEGMENTOS — permite preencher manualmente
          igual o que vem da API. Quando ha 2+ segmentos, o RichFlightCard
          renderiza a timeline de conexoes. Recalcula `escalas` (n-1) e
          `escalas_info` derivado automaticamente quando segmentos mudam. */}
      <ConexoesEditor
        segmentos={c.segmentos || []}
        onChange={(novos) => {
          const escalas = Math.max(0, novos.length - 1);
          // escalas_info: entre cada par (i, i+1) registra o aeroporto de
          // conexao + duracao (chegada do i ate saida do i+1).
          const escalasInfo: Array<{ aeroporto: string; nome?: string; duracao_min?: number }> = [];
          for (let i = 0; i < novos.length - 1; i++) {
            const arrTime = novos[i].horario_chegada;
            const depTime = novos[i + 1].horario_saida;
            let duracao_min = 0;
            if (arrTime && depTime) {
              // Espera "HH:MM" — se passar meia-noite o calculo fica negativo
              // e adicionamos 24h. Heuristica simples mas suficiente.
              const [ah, am] = arrTime.split(':').map(Number);
              const [dh, dm] = depTime.split(':').map(Number);
              duracao_min = (dh * 60 + dm) - (ah * 60 + am);
              if (duracao_min < 0) duracao_min += 24 * 60;
            }
            escalasInfo.push({
              aeroporto: novos[i].destino || '',
              nome: novos[i].aeroporto_destino_nome,
              duracao_min,
            });
          }
          // Atualiza tambem origem/destino "macro" do voo com o 1o/ultimo
          // segmento, e companhia/numero_voo com o 1o.
          const patch: Partial<VooData> = { segmentos: novos, escalas, escalas_info: escalasInfo };
          if (novos.length > 0) {
            patch.origem = novos[0].origem || c.origem || '';
            patch.destino = novos[novos.length - 1].destino || c.destino || '';
            patch.horario_saida = novos[0].horario_saida || c.horario_saida || '';
            patch.horario_chegada = novos[novos.length - 1].horario_chegada || c.horario_chegada || '';
            patch.companhia = c.companhia || novos[0].companhia || '';
            patch.numero_voo = c.numero_voo || novos[0].numero_voo || '';
          }
          update(patch);
        }}
      />

      {/* Toggles de visibilidade na proposta pro cliente */}
      {temDadosImportados && (
        <div className="p-3 border space-y-2" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
          <div className="text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--ink-2)' }}>
            Mostrar na proposta do cliente
          </div>
          <div className="grid grid-cols-2 gap-2">
            {segs.length > 1 && (
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={c.mostrar_segmentos !== false}
                  onChange={e => update({ mostrar_segmentos: e.target.checked })}
                  className="rounded"
                />
                <span>Conexões detalhadas</span>
              </label>
            )}
            {c.emissao_carbono_kg !== undefined && (
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={c.mostrar_emissao_co2 !== false}
                  onChange={e => update({ mostrar_emissao_co2: e.target.checked })}
                  className="rounded"
                />
                <span>Emissão de CO₂</span>
              </label>
            )}
            {c.aeronave && (
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={c.mostrar_aeronave !== false}
                  onChange={e => update({ mostrar_aeronave: e.target.checked })}
                  className="rounded"
                />
                <span>Aeronave / classe</span>
              </label>
            )}
            {c.bagagem && (
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={c.mostrar_bagagem !== false}
                  onChange={e => update({ mostrar_bagagem: e.target.checked })}
                  className="rounded"
                />
                <span>Bagagem</span>
              </label>
            )}
            {c.muitas_vezes_atrasado && (
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={c.mostrar_alerta_atraso === true}
                  onChange={e => update({ mostrar_alerta_atraso: e.target.checked })}
                  className="rounded"
                />
                <span>Alerta de atraso</span>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// ConexoesEditor — editor de segmentos do voo
// ============================================================

type Segmento = NonNullable<VooData['segmentos']>[number];

function novoSegmentoVazio(): Segmento {
  return {
    companhia: '', numero_voo: '',
    origem: '', destino: '',
    aeroporto_origem_nome: '', aeroporto_destino_nome: '',
    horario_saida: '', horario_chegada: '',
    duracao_min: 0,
    aeronave: '', classe: '',
  };
}

function ConexoesEditor({
  segmentos, onChange,
}: {
  segmentos: Segmento[];
  onChange: (novos: Segmento[]) => void;
}) {
  const escalas = Math.max(0, segmentos.length - 1);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const adicionarSegmento = () => {
    // Pre-preenche origem do novo segmento com destino do ultimo
    // (sequencia logica: voo A→B + B→C + C→D).
    const ultimo = segmentos[segmentos.length - 1];
    const novo = novoSegmentoVazio();
    if (ultimo) {
      novo.origem = ultimo.destino;
      novo.aeroporto_origem_nome = ultimo.aeroporto_destino_nome;
    }
    onChange([...segmentos, novo]);
    setExpandedIdx(segmentos.length); // expande o recem-criado
  };

  const removerSegmento = (idx: number) => {
    onChange(segmentos.filter((_, i) => i !== idx));
  };

  const atualizarSegmento = (idx: number, patch: Partial<Segmento>) => {
    onChange(segmentos.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  return (
    <div className="border rounded-lg" style={{ borderColor: 'var(--line)', background: 'var(--ink-surface)' }}>
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5" style={{ color: 'var(--ink-2)' }} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--ink)' }}>
            Conexões / Segmentos
          </span>
          <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
            {segmentos.length === 0 ? 'Voo direto' : escalas === 0 ? 'Voo direto' : `${escalas} conex${escalas > 1 ? 'ões' : 'ão'}`}
          </span>
        </div>
        <button
          onClick={adicionarSegmento}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border transition-colors"
          style={{ borderColor: 'var(--line-strong)', color: 'var(--ink)', background: 'var(--ink-surface-2)' }}
          title={segmentos.length === 0 ? 'Adicionar 1o trecho' : 'Adicionar conexão'}
        >
          <Plus className="w-3 h-3" />
          {segmentos.length === 0 ? 'Trecho' : 'Conexão'}
        </button>
      </div>

      {segmentos.length === 0 ? (
        <p className="px-3 py-3 text-[11px]" style={{ color: 'var(--ink-3)' }}>
          Voo direto. Clique <strong>+ Trecho</strong> para adicionar o trajeto manualmente, ou <strong>+ Conexão</strong> para criar voo com escalas.
        </p>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
          {segmentos.map((seg, i) => {
            const isLast = i === segmentos.length - 1;
            const expanded = expandedIdx === i;
            return (
              <div key={i} className="px-3 py-2" style={{ borderColor: 'var(--line)' }}>
                {/* Resumo da linha */}
                <div className="flex items-center gap-2">
                  <span className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                    style={{ background: 'var(--ink-2)', color: 'var(--ink-surface)' }}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0 flex items-center gap-2 text-[12px]" style={{ color: 'var(--ink)' }}>
                    <span className="font-mono font-semibold">{seg.origem || '???'}</span>
                    <ArrowRight className="w-3 h-3 shrink-0" style={{ color: 'var(--ink-3)' }} />
                    <span className="font-mono font-semibold">{seg.destino || '???'}</span>
                    {(seg.companhia || seg.numero_voo) && (
                      <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                        · {seg.companhia} {seg.numero_voo}
                      </span>
                    )}
                    {(seg.horario_saida && seg.horario_chegada) && (
                      <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                        · {seg.horario_saida} → {seg.horario_chegada}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setExpandedIdx(expanded ? null : i)}
                    className="text-[11px] font-medium underline-offset-2"
                    style={{ color: 'var(--ink-2)' }}
                  >
                    {expanded ? 'Fechar' : 'Editar'}
                  </button>
                  <button
                    onClick={() => removerSegmento(i)}
                    className="p-1 rounded hover:bg-red-50 transition-colors"
                    style={{ color: 'var(--ink-3)' }}
                    title="Remover trecho"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Form expandido — campos completos do segmento */}
                {expanded && (
                  <div className="mt-3 grid grid-cols-2 gap-2 pl-7">
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Companhia</label>
                      <Input
                        value={seg.companhia || ''}
                        onChange={e => atualizarSegmento(i, { companhia: e.target.value })}
                        placeholder="LATAM, AZUL..."
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Nº do voo</label>
                      <Input
                        value={seg.numero_voo || ''}
                        onChange={e => atualizarSegmento(i, { numero_voo: e.target.value.toUpperCase() })}
                        placeholder="LA754"
                        className="text-xs uppercase"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Origem (IATA)</label>
                      <Input
                        value={seg.origem || ''}
                        onChange={e => atualizarSegmento(i, { origem: e.target.value.toUpperCase().slice(0, 3) })}
                        placeholder="GRU"
                        maxLength={3}
                        className="text-xs uppercase"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Destino (IATA)</label>
                      <Input
                        value={seg.destino || ''}
                        onChange={e => atualizarSegmento(i, { destino: e.target.value.toUpperCase().slice(0, 3) })}
                        placeholder="MIA"
                        maxLength={3}
                        className="text-xs uppercase"
                      />
                    </div>
                    <div className="col-span-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Aeroporto origem (nome)</label>
                        <Input
                          value={seg.aeroporto_origem_nome || ''}
                          onChange={e => atualizarSegmento(i, { aeroporto_origem_nome: e.target.value })}
                          placeholder="São Paulo / Guarulhos"
                          className="text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Aeroporto destino (nome)</label>
                        <Input
                          value={seg.aeroporto_destino_nome || ''}
                          onChange={e => atualizarSegmento(i, { aeroporto_destino_nome: e.target.value })}
                          placeholder="Miami International"
                          className="text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Saída (HH:MM)</label>
                      <Input
                        type="time"
                        value={seg.horario_saida || ''}
                        onChange={e => atualizarSegmento(i, { horario_saida: e.target.value })}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Chegada (HH:MM)</label>
                      <Input
                        type="time"
                        value={seg.horario_chegada || ''}
                        onChange={e => atualizarSegmento(i, { horario_chegada: e.target.value })}
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Duração (min)</label>
                      <Input
                        type="number"
                        min={0}
                        value={seg.duracao_min || ''}
                        onChange={e => atualizarSegmento(i, { duracao_min: Number(e.target.value) || 0 })}
                        placeholder="180"
                        className="text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Aeronave</label>
                      <Input
                        value={seg.aeronave || ''}
                        onChange={e => atualizarSegmento(i, { aeronave: e.target.value })}
                        placeholder="Boeing 777"
                        className="text-xs"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>Classe</label>
                      <Input
                        value={seg.classe || ''}
                        onChange={e => atualizarSegmento(i, { classe: e.target.value })}
                        placeholder="Economica"
                        className="text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* Mostra "ponto de conexão" entre segmento N e N+1 */}
                {!isLast && (
                  <div className="mt-2 pl-7 flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--ink-3)' }}>
                    <Clock className="w-3 h-3" />
                    <span>
                      Conexão em <strong>{seg.destino || '???'}</strong>
                      {seg.aeroporto_destino_nome ? ` (${seg.aeroporto_destino_nome})` : ''}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
