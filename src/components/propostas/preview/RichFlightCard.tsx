'use client';

import { useState } from 'react';
import { Plane, Clock, ChevronDown, Briefcase, Leaf, Users, AlertTriangle, Armchair } from 'lucide-react';
import type { TransporteData } from '@/lib/crm-types';
import type { IdiomaProposal } from '@/lib/i18n-proposta';

interface Props {
  voo: Partial<TransporteData>;
  corPrimaria?: string;
  idioma?: IdiomaProposal;
  className?: string;
}

const LABELS: Record<IdiomaProposal, {
  departure: string; arrival: string; return: string; outbound: string;
  direct: string; stops: string; duration: string; date: string;
  aircraft: string; cabin: string; baggage: string; legroom: string;
  co2: string; flight: string; stopAt: string; layoverDuration: string;
  showMore: string; showLess: string; delays: string; oftenDelayed: string;
  nextDay: string; segments: string; from: string; to: string;
}> = {
  'pt-BR': {
    departure: 'Partida', arrival: 'Chegada', return: 'VOLTA', outbound: 'IDA',
    direct: 'Voo direto', stops: 'escala(s)', duration: 'Duração', date: 'Data',
    aircraft: 'Aeronave', cabin: 'Classe', baggage: 'Bagagem', legroom: 'Espaço',
    co2: 'Emissão', flight: 'Voo', stopAt: 'Conexão em', layoverDuration: 'Espera',
    showMore: 'Mais detalhes', showLess: 'Menos detalhes', delays: 'Histórico de atrasos', oftenDelayed: 'Costuma atrasar +30min',
    nextDay: '+1 dia', segments: 'Trechos', from: 'De', to: 'Para',
  },
  en: {
    departure: 'Departure', arrival: 'Arrival', return: 'RETURN', outbound: 'OUTBOUND',
    direct: 'Direct flight', stops: 'stop(s)', duration: 'Duration', date: 'Date',
    aircraft: 'Aircraft', cabin: 'Cabin', baggage: 'Baggage', legroom: 'Legroom',
    co2: 'Carbon', flight: 'Flight', stopAt: 'Layover at', layoverDuration: 'Layover',
    showMore: 'More details', showLess: 'Less details', delays: 'Delay record', oftenDelayed: 'Often delayed +30min',
    nextDay: '+1 day', segments: 'Segments', from: 'From', to: 'To',
  },
  es: {
    departure: 'Salida', arrival: 'Llegada', return: 'VUELTA', outbound: 'IDA',
    direct: 'Vuelo directo', stops: 'escala(s)', duration: 'Duración', date: 'Fecha',
    aircraft: 'Aeronave', cabin: 'Clase', baggage: 'Equipaje', legroom: 'Espacio',
    co2: 'Emisión', flight: 'Vuelo', stopAt: 'Conexión en', layoverDuration: 'Espera',
    showMore: 'Más detalles', showLess: 'Menos detalles', delays: 'Historial de retrasos', oftenDelayed: 'Suele retrasarse +30min',
    nextDay: '+1 día', segments: 'Tramos', from: 'De', to: 'A',
  },
};

function formatDate(d?: string, idioma: IdiomaProposal = 'pt-BR'): string {
  if (!d) return '';
  const date = new Date(d + 'T12:00:00');
  if (isNaN(date.getTime())) return '';
  const locale = idioma === 'en' ? 'en-US' : idioma === 'es' ? 'es-ES' : 'pt-BR';
  return date.toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function formatPrice(value?: number): string {
  if (!value || value <= 0) return '';
  return 'R$ ' + value.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatMinutes(min?: number): string {
  if (!min) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

function classeLabel(c?: string): string {
  if (!c) return '';
  const lower = c.toLowerCase();
  if (lower.includes('econom')) return 'Economy';
  if (lower.includes('business') || lower.includes('exec')) return 'Business';
  if (lower.includes('first') || lower.includes('primeira')) return 'First Class';
  if (lower.includes('premium')) return 'Premium Economy';
  return c;
}

export function RichFlightCard({ voo, corPrimaria, idioma = 'pt-BR', className = '' }: Props) {
  const [expanded, setExpanded] = useState(false);
  const cor = corPrimaria || '#004aad';
  const l = LABELS[idioma] || LABELS['pt-BR'];

  const isVolta = voo.detalhes?.startsWith('VOLTA');
  const label = isVolta ? l.return : l.outbound;
  const formattedDate = formatDate(voo.data, idioma);
  const price = formatPrice(voo.valor);
  const nextDay = voo.data && voo.data_chegada && voo.data !== voo.data_chegada;

  const hasExtras = !!(voo.aeronave || voo.classe || voo.bagagem || voo.legroom ||
    voo.emissao_carbono_kg || (voo.segmentos && voo.segmentos.length > 1) ||
    voo.escalas_info?.length || voo.muitas_vezes_atrasado);

  return (
    <div
      className={`rounded-2xl overflow-hidden border-2 shadow-lg transition-all ${className}`}
      style={{ borderColor: cor }}
    >
      {/* Header — companhia + numero + data + preço */}
      <div
        className="text-white px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3"
        style={{ backgroundColor: cor }}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {voo.companhia_logo ? (
            <img src={voo.companhia_logo} alt={voo.companhia || ''} className="w-7 h-7 rounded bg-white p-0.5 shrink-0" />
          ) : (
            <Plane className="w-5 h-5 shrink-0 opacity-80" />
          )}
          <span className="font-bold text-base tracking-wide truncate">{voo.companhia || l.flight}</span>
          {voo.numero_voo && <span className="font-mono text-sm opacity-80 shrink-0">{voo.numero_voo}</span>}
          <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded shrink-0">{label}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {formattedDate && <span className="text-xs opacity-80 capitalize hidden sm:inline">{formattedDate}</span>}
          {price && <span className="font-bold text-lg whitespace-nowrap">{price}</span>}
        </div>
      </div>

      {/* Mobile date row */}
      {formattedDate && (
        <div className="bg-white px-4 sm:px-6 pt-3 sm:hidden">
          <span className="text-xs text-gray-500 capitalize">{formattedDate}</span>
        </div>
      )}

      {/* Route — origem → tempo → destino */}
      <div className="bg-white px-4 sm:px-6 py-5 sm:py-6">
        <div className="flex items-center justify-between gap-3 sm:gap-6">
          {/* Departure */}
          <div className="text-center shrink-0 min-w-0">
            <div className="text-3xl sm:text-4xl font-black tracking-tight text-gray-900">{voo.origem || '---'}</div>
            {voo.horario_saida && (
              <div className="text-base sm:text-lg font-bold text-gray-700 mt-1">{voo.horario_saida}</div>
            )}
            {voo.aeroporto_origem_nome && (
              <div className="text-[10px] sm:text-[11px] text-gray-500 mt-0.5 truncate max-w-[110px] sm:max-w-[140px]">
                {voo.aeroporto_origem_nome}
              </div>
            )}
            <div className="text-[9px] sm:text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{l.departure}</div>
          </div>

          {/* Route line */}
          <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0 px-1 sm:px-2">
            {voo.tempo_estimado && (
              <div
                className="flex items-center gap-1 text-[10px] sm:text-xs font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap"
                style={{ backgroundColor: `${cor}15`, color: cor }}
              >
                <Clock className="w-3 h-3" /> {voo.tempo_estimado}
              </div>
            )}
            <div className="flex items-center w-full">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cor }} />
              <div className="flex-1 relative h-[2px] mx-1">
                <div className="absolute inset-0 border-t-2 border-dashed" style={{ borderColor: `${cor}50` }} />
                {/* Layover dots */}
                {voo.escalas_info?.map((lay, i) => (
                  <div
                    key={i}
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-500 border-2 border-white shadow"
                    style={{ left: `${((i + 1) / ((voo.escalas || 0) + 1)) * 100}%` }}
                    title={`${lay.aeroporto}${lay.duracao_min ? ` (${formatMinutes(lay.duracao_min)})` : ''}`}
                  />
                ))}
                <Plane className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 bg-white" style={{ color: cor }} />
              </div>
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cor }} />
            </div>
            <div className="text-[9px] sm:text-[10px] text-gray-500 text-center">
              {(voo.escalas || 0) === 0 ? (
                <span className="text-emerald-600 font-semibold">{l.direct}</span>
              ) : (
                <span>{voo.escalas} {l.stops}{voo.escalas_info?.length ? `: ${voo.escalas_info.map(e => e.aeroporto).join(', ')}` : ''}</span>
              )}
            </div>
          </div>

          {/* Arrival */}
          <div className="text-center shrink-0 min-w-0">
            <div className="text-3xl sm:text-4xl font-black tracking-tight text-gray-900">
              {voo.destino || '---'}
              {nextDay && <span className="text-xs align-top text-amber-600 ml-0.5">+1</span>}
            </div>
            {voo.horario_chegada && (
              <div className="text-base sm:text-lg font-bold text-gray-700 mt-1">{voo.horario_chegada}</div>
            )}
            {voo.aeroporto_destino_nome && (
              <div className="text-[10px] sm:text-[11px] text-gray-500 mt-0.5 truncate max-w-[110px] sm:max-w-[140px]">
                {voo.aeroporto_destino_nome}
              </div>
            )}
            <div className="text-[9px] sm:text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{l.arrival}</div>
          </div>
        </div>

        {/* Tags row — aeronave, classe, bagagem, legroom, co2 */}
        {(voo.aeronave || voo.classe || voo.bagagem || voo.legroom || voo.emissao_carbono_kg) && (
          <div className="flex items-center gap-1.5 sm:gap-2 mt-4 pt-4 border-t border-gray-100 flex-wrap">
            {voo.aeronave && (
              <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                <Plane className="w-3 h-3" /> {voo.aeronave}
              </span>
            )}
            {voo.classe && (
              <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                <Users className="w-3 h-3" /> {classeLabel(voo.classe)}
              </span>
            )}
            {voo.bagagem && (
              <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-700">
                <Briefcase className="w-3 h-3" /> {voo.bagagem}
              </span>
            )}
            {voo.legroom && (
              <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                <Armchair className="w-3 h-3" /> {voo.legroom}
              </span>
            )}
            {voo.emissao_carbono_kg && (
              <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                <Leaf className="w-3 h-3" /> {voo.emissao_carbono_kg} kg CO₂
              </span>
            )}
            {voo.muitas_vezes_atrasado && (
              <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs px-2 py-1 rounded-full bg-red-50 text-red-700">
                <AlertTriangle className="w-3 h-3" /> {l.oftenDelayed}
              </span>
            )}
          </div>
        )}

        {/* Expand toggle */}
        {hasExtras && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="mt-4 w-full flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg transition-colors hover:bg-gray-50"
            style={{ color: cor }}
          >
            {expanded ? l.showLess : l.showMore}
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Expanded — segmentos detalhados + escalas */}
      {expanded && voo.segmentos && voo.segmentos.length > 0 && (
        <div className="bg-gray-50 border-t border-gray-100 px-4 sm:px-6 py-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">{l.segments}</div>
          {voo.segmentos.map((seg, i) => (
            <div key={i}>
              <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Plane className="w-4 h-4" style={{ color: cor }} />
                  <span className="font-bold text-sm text-gray-900">{seg.companhia}</span>
                  <span className="font-mono text-xs text-gray-500">{seg.numero_voo}</span>
                  {seg.aeronave && <span className="text-xs text-gray-500 ml-auto">{seg.aeronave}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 sm:gap-3 items-center">
                  <div>
                    <div className="text-lg font-black text-gray-900">{seg.origem}</div>
                    <div className="text-sm font-bold text-gray-700">{seg.horario_saida}</div>
                    {seg.aeroporto_origem_nome && (
                      <div className="text-[10px] text-gray-500 truncate">{seg.aeroporto_origem_nome}</div>
                    )}
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] font-semibold text-gray-500">{formatMinutes(seg.duracao_min)}</div>
                    <div className="h-[2px] bg-gray-200 my-1 relative">
                      <Plane className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 bg-white" />
                    </div>
                    {seg.classe && <div className="text-[10px] text-gray-400">{classeLabel(seg.classe)}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-gray-900">{seg.destino}</div>
                    <div className="text-sm font-bold text-gray-700">{seg.horario_chegada}</div>
                    {seg.aeroporto_destino_nome && (
                      <div className="text-[10px] text-gray-500 truncate">{seg.aeroporto_destino_nome}</div>
                    )}
                  </div>
                </div>
              </div>
              {/* Layover between segments */}
              {voo.escalas_info && voo.escalas_info[i] && (
                <div className="my-2 mx-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs text-amber-800">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="font-semibold">{l.stopAt} {voo.escalas_info[i].aeroporto}</span>
                  {voo.escalas_info[i].nome && <span className="text-amber-700 truncate">— {voo.escalas_info[i].nome}</span>}
                  {voo.escalas_info[i].duracao_min && (
                    <span className="ml-auto font-bold whitespace-nowrap">{l.layoverDuration}: {formatMinutes(voo.escalas_info[i].duracao_min)}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
