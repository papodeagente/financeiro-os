'use client';

import { useState, useRef, useEffect } from 'react';
import { GrupoViagem } from '@/lib/types';
import { createTktTrecho } from '@/lib/defaults';
import { minPositivo, formatBRL } from '@/lib/utils';
import { calcTktTotals } from '@/lib/calculations';
import { MoneyCustoVenda } from '@/components/MoneyCustoVenda';
import { FornecedorPicker } from '@/components/FornecedorPicker';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Plane, Trophy } from 'lucide-react';
import { formatFlightForTkt, formatFlightForTransporte } from '@/lib/flight-data-mapper';
import type { FlightOffer } from '@/lib/flight-data-mapper';
import type { TktVooApiMeta } from '@/lib/types';
import { initiateFlightSearch, consumePendingFlightHandoff } from '@/lib/api-search-handoff';
import { getPrimeiraDataViagem, getUltimaDataViagem } from '@/lib/grupo-datas';

interface Props { grupo: GrupoViagem; onChange: (grupo: GrupoViagem) => void; }

function fonteHasData(f: { valor_adt: number | null; valor_chd: number | null; partida_chegada: string }) {
  return (f.valor_adt !== null && f.valor_adt > 0) || (f.valor_chd !== null && f.valor_chd > 0) || !!f.partida_chegada;
}

export function TktTab({ grupo, onChange }: Props) {
  const totals = calcTktTotals(grupo);
  const [addedSources, setAddedSources] = useState<Record<number, Set<number>>>({});
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Abre /voos em modo handoff. Usa getPrimeiraDataViagem/getUltimaDataViagem
  // como fonte única de verdade — mesma lógica usada em outros tabs.
  const abrirBuscaVoo = (tIdx: number) => {
    const returnTo = `${window.location.pathname}?tab=tkt`;
    // Se trecho atual já tem data, usa ela. Senão, primeira data da viagem.
    const trechoAtual = grupo.trechos?.[tIdx];
    const dataIda = trechoAtual?.data || getPrimeiraDataViagem(grupo);
    const dataVolta = tIdx === 0 ? getUltimaDataViagem(grupo) : '';
    initiateFlightSearch({
      grupoId: grupo.id,
      tIdx,
      dataIda,
      dataVolta,
      adultos: grupo.params?.qtd_min_pax || 1,
      classe: 'economica',
      returnTo,
    });
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Consome handoff de voo quando o usuário volta da página /voos.
  useEffect(() => {
    const pending = consumePendingFlightHandoff(grupo.id);
    if (pending) {
      handleFlightSelect(pending.ctx.tIdx, pending.flight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateFonte = (tIdx: number, fIdx: number, field: string, value: number | null | string) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[tIdx] = { ...tkt.trechos[tIdx], fontes: [...tkt.trechos[tIdx].fontes] };
    tkt.trechos[tIdx].fontes[fIdx] = { ...tkt.trechos[tIdx].fontes[fIdx], [field]: value };
    onChange({ ...grupo, tkt });
  };

  const updateDeadline = (tIdx: number, value: string | null) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[tIdx] = { ...tkt.trechos[tIdx], deadline: value };
    onChange({ ...grupo, tkt });
  };

  const addTrecho = () => { if (grupo.tkt.trechos.length < 4) onChange({ ...grupo, tkt: { trechos: [...grupo.tkt.trechos, createTktTrecho()] } }); };
  const removeTrecho = (idx: number) => { onChange({ ...grupo, tkt: { trechos: grupo.tkt.trechos.filter((_, i) => i !== idx) } }); };

  // Constrói o snapshot rico do voo a ser preservado no trecho. Reaproveita
  // formatFlightForTransporte (já trata IDA + VOLTA dividindo preço).
  const buildVooApiMeta = (offer: FlightOffer, leg: 0 | 1): TktVooApiMeta | undefined => {
    const arr = formatFlightForTransporte(offer);
    const t = arr[leg] as Record<string, unknown> | undefined;
    if (!t) return undefined;
    return {
      companhia: String(t.companhia || ''),
      companhia_logo: t.companhia_logo as string | undefined,
      numero_voo: String(t.numero_voo || ''),
      aeroporto_origem_nome: t.aeroporto_origem_nome as string | undefined,
      aeroporto_destino_nome: t.aeroporto_destino_nome as string | undefined,
      origem: String(t.origem || ''),
      destino: String(t.destino || ''),
      data: String(t.data || ''),
      data_chegada: t.data_chegada as string | undefined,
      horario_saida: String(t.horario_saida || ''),
      horario_chegada: String(t.horario_chegada || ''),
      duracao: String(t.tempo_estimado || ''),
      aeronave: t.aeronave as string | undefined,
      classe: t.classe as string | undefined,
      bagagem: t.bagagem as string | undefined,
      legroom: t.legroom as string | undefined,
      emissao_carbono_kg: t.emissao_carbono_kg as number | undefined,
      escalas: t.escalas as number | undefined,
      escalas_info: t.escalas_info as TktVooApiMeta['escalas_info'],
      segmentos: t.segmentos as TktVooApiMeta['segmentos'],
      muitas_vezes_atrasado: t.muitas_vezes_atrasado as boolean | undefined,
      valor: Number(t.valor) || 0,
    };
  };

  const handleFlightSelect = (tIdx: number, ida: FlightOffer, volta?: FlightOffer) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };

    // Import IDA into current trecho
    tkt.trechos[tIdx] = { ...tkt.trechos[tIdx], fontes: [...tkt.trechos[tIdx].fontes] };
    const mappedIda = formatFlightForTkt(ida, 0);
    const existingIdaIdx = tkt.trechos[tIdx].fontes.findIndex(f => f.nome === 'Google Flights');
    if (existingIdaIdx >= 0) {
      tkt.trechos[tIdx].fontes[existingIdaIdx] = { ...tkt.trechos[tIdx].fontes[existingIdaIdx], partida_chegada: mappedIda.partida_chegada, valor_adt: mappedIda.valor_adt };
    } else {
      tkt.trechos[tIdx].fontes.push({ nome: mappedIda.nome, valor_adt: mappedIda.valor_adt, valor_chd: null, partida_chegada: mappedIda.partida_chegada });
    }
    // Preserva snapshot rico do voo IDA (logo, segmentos, bagagem, CO2…).
    tkt.trechos[tIdx].voo_api = buildVooApiMeta(ida, 0);

    // Round-trip num único FlightOffer (offer.returnFlights presente):
    // popula tIdx+1 com a volta. Caso o handoff já tenha sido feito como
    // round-trip, isso evita perder o trecho de volta.
    if (!volta && ida.returnFlights && ida.returnFlights.length > 0) {
      const voltaIdx = tIdx + 1;
      if (voltaIdx >= tkt.trechos.length) {
        tkt.trechos.push(createTktTrecho());
      }
      tkt.trechos[voltaIdx] = { ...tkt.trechos[voltaIdx], fontes: [...tkt.trechos[voltaIdx].fontes] };
      // formatFlightForTkt já mapeia returnFlights quando legIndex=1.
      const mappedVolta = formatFlightForTkt(ida, 1);
      const exVoltaIdx = tkt.trechos[voltaIdx].fontes.findIndex(f => f.nome === 'Google Flights');
      if (exVoltaIdx >= 0) {
        tkt.trechos[voltaIdx].fontes[exVoltaIdx] = { ...tkt.trechos[voltaIdx].fontes[exVoltaIdx], partida_chegada: mappedVolta.partida_chegada, valor_adt: mappedVolta.valor_adt };
      } else {
        tkt.trechos[voltaIdx].fontes.push({ nome: mappedVolta.nome, valor_adt: mappedVolta.valor_adt, valor_chd: null, partida_chegada: mappedVolta.partida_chegada });
      }
      tkt.trechos[voltaIdx].voo_api = buildVooApiMeta(ida, 1);
      const updatedGrupo = { ...grupo, tkt };
      if (voltaIdx >= updatedGrupo.trechos.length) {
        updatedGrupo.trechos = [...updatedGrupo.trechos, { data: null, qtd_adt: updatedGrupo.trechos[tIdx]?.qtd_adt || 0, qtd_chd: updatedGrupo.trechos[tIdx]?.qtd_chd || 0 }];
      }
      onChange(updatedGrupo);
      return;
    }

    // Import VOLTA into next trecho (create if needed)
    if (volta) {
      const voltaIdx = tIdx + 1;
      if (voltaIdx >= tkt.trechos.length) {
        tkt.trechos.push(createTktTrecho());
      }
      tkt.trechos[voltaIdx] = { ...tkt.trechos[voltaIdx], fontes: [...tkt.trechos[voltaIdx].fontes] };
      const mappedVolta = formatFlightForTkt(volta, 0);
      const existingVoltaIdx = tkt.trechos[voltaIdx].fontes.findIndex(f => f.nome === 'Google Flights');
      if (existingVoltaIdx >= 0) {
        tkt.trechos[voltaIdx].fontes[existingVoltaIdx] = { ...tkt.trechos[voltaIdx].fontes[existingVoltaIdx], partida_chegada: mappedVolta.partida_chegada, valor_adt: mappedVolta.valor_adt };
      } else {
        tkt.trechos[voltaIdx].fontes.push({ nome: mappedVolta.nome, valor_adt: mappedVolta.valor_adt, valor_chd: null, partida_chegada: mappedVolta.partida_chegada });
      }
      tkt.trechos[voltaIdx].voo_api = buildVooApiMeta(volta, 0);

      // Also ensure trechos (InfTab) has a matching entry for the return flight
      const updatedGrupo = { ...grupo, tkt };
      if (voltaIdx >= updatedGrupo.trechos.length) {
        updatedGrupo.trechos = [...updatedGrupo.trechos, { data: null, qtd_adt: updatedGrupo.trechos[tIdx]?.qtd_adt || 0, qtd_chd: updatedGrupo.trechos[tIdx]?.qtd_chd || 0 }];
      }
      onChange(updatedGrupo);
      return;
    }

    onChange({ ...grupo, tkt });
  };

  const isVisible = (tIdx: number, fIdx: number) =>
    fonteHasData(grupo.tkt.trechos[tIdx].fontes[fIdx]) || addedSources[tIdx]?.has(fIdx) || false;

  const addSource = (tIdx: number, fIdx: number) => {
    setAddedSources(prev => ({ ...prev, [tIdx]: new Set([...(prev[tIdx] || []), fIdx]) }));
    setPickerOpen(null);
  };

  const clearSource = (tIdx: number, fIdx: number) => {
    const tkt = { ...grupo.tkt, trechos: [...grupo.tkt.trechos] };
    tkt.trechos[tIdx] = { ...tkt.trechos[tIdx], fontes: [...tkt.trechos[tIdx].fontes] };
    tkt.trechos[tIdx].fontes[fIdx] = { ...tkt.trechos[tIdx].fontes[fIdx], valor_adt: null, valor_chd: null, partida_chegada: '' };
    onChange({ ...grupo, tkt });
    setAddedSources(prev => { const s = new Set(prev[tIdx] || []); s.delete(fIdx); return { ...prev, [tIdx]: s }; });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        {(['totalAdt', 'totalChd'] as const).map((k, i) => (
          <div key={k} className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-3" style={{ boxShadow: 'var(--elevation-1)' }}>
            <span className="text-[11px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide">Total TKT {i === 0 ? 'ADT' : 'CHD'}</span>
            <div className="text-lg font-bold text-[var(--t-text)] mt-0.5">{formatBRL(totals[k])}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={addTrecho} disabled={grupo.tkt.trechos.length >= 4}><Plus className="w-4 h-4 mr-1" /> Trecho</Button>
      </div>

      {grupo.tkt.trechos.map((trecho, tIdx) => {
        const infTrecho = grupo.trechos[tIdx];
        const melhorAdt = minPositivo(trecho.fontes.map(f => f.valor_adt));
        const melhorChd = minPositivo(trecho.fontes.map(f => f.valor_chd));
        const visibleIndices = trecho.fontes.map((_, i) => i).filter(i => isVisible(tIdx, i));
        const hiddenSources = trecho.fontes.map((f, i) => ({ nome: f.nome, idx: i })).filter((_, i) => !isVisible(tIdx, i));
        const filledCount = trecho.fontes.filter(fonteHasData).length;

        return (
          <div key={tIdx} className="rounded-[var(--t-card-radius)] border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden" style={{ boxShadow: 'var(--elevation-2)' }}>
            <div className="p-4 flex items-center justify-between border-b border-[var(--t-border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--t-green)]/10 flex items-center justify-center"><Plane className="w-5 h-5 text-[var(--t-green)]" /></div>
                <div>
                  <h3 className="font-semibold text-[var(--t-text)]">Trecho {tIdx + 1}</h3>
                  {infTrecho && <span className="text-xs text-[var(--t-text-muted)]">ADT: {infTrecho.qtd_adt} | CHD: {infTrecho.qtd_chd}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-[var(--t-text-muted)]">
                  <span>Deadline</span>
                  <Input type="date" value={trecho.deadline || ''} onChange={e => updateDeadline(tIdx, e.target.value || null)} className="h-8 w-40" />
                </div>
                <Button variant="outline" size="sm" onClick={() => abrirBuscaVoo(tIdx)}><Plane className="w-4 h-4 mr-1" /> Buscar via API</Button>
                {grupo.tkt.trechos.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => removeTrecho(tIdx)} className="text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)]"><Trash2 className="w-4 h-4" /></Button>
                )}
              </div>
            </div>

            <div className="p-4 space-y-4">
              {filledCount > 1 && (
                <div className="flex items-center gap-4 p-3 rounded-xl bg-[var(--t-status-success-bg)] border border-[var(--t-status-success)]/20">
                  <Trophy className="w-4 h-4 text-[var(--t-status-success)] shrink-0" />
                  <div className="flex gap-6">
                    {melhorAdt > 0 && <div><span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">ADT</span><div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(melhorAdt)}</div></div>}
                    {melhorChd > 0 && <div><span className="text-[10px] font-medium text-[var(--t-status-success)] uppercase">CHD</span><div className="text-sm font-bold text-[var(--t-status-success)]">{formatBRL(melhorChd)}</div></div>}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {visibleIndices.map(fIdx => {
                  const fonte = trecho.fontes[fIdx];
                  const isMinAdt = fonte.valor_adt !== null && fonte.valor_adt > 0 && fonte.valor_adt === melhorAdt;
                  const isMinChd = fonte.valor_chd !== null && fonte.valor_chd > 0 && fonte.valor_chd === melhorChd;
                  const isBest = isMinAdt || isMinChd;
                  const isApi = fonte.nome === 'API Amadeus';
                  return (
                    <div key={fIdx} className={`rounded-xl border p-4 transition-all ${isBest ? 'border-[var(--t-status-success)]/30 bg-[var(--t-status-success-bg)]/30' : isApi ? 'border-[var(--t-status-info)]/30 bg-[var(--t-status-info-bg)]/30' : 'border-[var(--t-border)] bg-[var(--t-bg)]'}`}>
                      <div className="flex items-center justify-between mb-3 gap-2">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-xs font-bold text-[var(--t-text-muted)] w-6 shrink-0">{fIdx + 1}.</span>
                          <div className="w-64 shrink-0">
                            <FornecedorPicker
                              value={fonte.fornecedor_id}
                              nome={fonte.nome}
                              tipoSugerido="CIA_AEREA"
                              placeholder="Selecionar fornecedor"
                              onChange={f => {
                                updateFonte(tIdx, fIdx, 'fornecedor_id', f?.id || '');
                                updateFonte(tIdx, fIdx, 'nome', f?.nome || '');
                              }}
                            />
                          </div>
                          {isBest && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-success-bg)] text-[var(--t-status-success)]">Melhor</span>}
                          {isApi && <span className="text-[9px] font-semibold uppercase px-2 py-0.5 rounded-full bg-[var(--t-status-info-bg)] text-[var(--t-status-info)]">API</span>}
                        </div>
                        <button onClick={() => clearSource(tIdx, fIdx)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-status-danger)] hover:bg-[var(--t-status-danger-bg)] transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <MoneyCustoVenda
                          label="ADT"
                          custo={fonte.valor_adt}
                          venda={fonte.valor_venda_adt}
                          onCustoChange={v => updateFonte(tIdx, fIdx, 'valor_adt', v)}
                          onVendaChange={v => updateFonte(tIdx, fIdx, 'valor_venda_adt', v)}
                          highlightCusto={isMinAdt}
                        />
                        <MoneyCustoVenda
                          label="CHD"
                          custo={fonte.valor_chd}
                          venda={fonte.valor_venda_chd}
                          onCustoChange={v => updateFonte(tIdx, fIdx, 'valor_chd', v)}
                          onVendaChange={v => updateFonte(tIdx, fIdx, 'valor_venda_chd', v)}
                          highlightCusto={isMinChd}
                        />
                      </div>
                      <div className="mt-3">
                        <label className="text-[10px] font-medium text-[var(--t-text-muted)] uppercase tracking-wide mb-1 block">Partida / Chegada</label>
                        <Input value={fonte.partida_chegada} onChange={e => updateFonte(tIdx, fIdx, 'partida_chegada', e.target.value)} className="h-8" placeholder="GRU 10:00 → LIS 22:00" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {hiddenSources.length > 0 && (
                <div className="relative" ref={pickerOpen === tIdx ? pickerRef : undefined}>
                  <button onClick={() => setPickerOpen(pickerOpen === tIdx ? null : tIdx)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-[var(--t-border)] text-sm text-[var(--t-text-muted)] hover:border-[var(--t-green)] hover:text-[var(--t-green)] transition-colors"><Plus className="w-4 h-4" /> Adicionar cotação</button>
                  {pickerOpen === tIdx && (
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-[var(--t-surface)] border border-[var(--t-border)] rounded-xl p-1.5 w-56 dropdown-enter" style={{ boxShadow: 'var(--elevation-4)' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] px-3 py-1.5">Selecione a fonte</div>
                      {hiddenSources.map(s => (
                        <button key={s.idx} onClick={() => addSource(tIdx, s.idx)} className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-[var(--t-surface-hover)] text-[var(--t-text)] transition-colors">{s.nome}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {visibleIndices.length === 0 && <div className="text-center py-8 text-sm text-[var(--t-text-muted)]">Nenhuma cotação adicionada.</div>}
            </div>
          </div>
        );
      })}

    </div>
  );
}
