import type { Proposta, AlojamentoData, TransporteData, DestinoRoteiro } from './crm-types';

export interface DayGroup {
  destinoNome: string;
  alojamento?: AlojamentoData;
  dias: DayInfo[];
}

export interface DayInfo {
  numero: number;
  titulo: string;
  descricao: string;
  imagem?: string;
  atividades: string[];
  refeicoes_inclusas?: string;
  transports: TransporteData[];
  checkIn?: AlojamentoData;
  checkOut?: AlojamentoData;
}

/**
 * Groups ROTEIRO_DIA days by destination, using viagem.destinos config
 * or falling back to matching by alojamento dates.
 */
export function groupDaysByDestination(proposta: Proposta): DayGroup[] {
  const viagem = proposta.viagem;
  const roteiroDia = proposta.secoes.find(s => s.tipo === 'ROTEIRO_DIA' && s.visivel);
  if (!roteiroDia) return [];

  const rawDias = (roteiroDia.conteudo as { dias?: Array<{
    numero: number;
    titulo: string;
    descricao: string;
    imagem?: string;
    atividades?: string[];
    refeicoes_inclusas?: string;
  }> }).dias || [];

  const alojamentos = viagem?.alojamentos || [];
  const transportes = viagem?.transportes || [];
  const destinos = viagem?.destinos || [];

  // Build day infos with transport/check-in/check-out actions
  const dayInfos: DayInfo[] = rawDias.map((d, idx) => {
    const dayNum = d.numero || idx + 1;
    return {
      numero: dayNum,
      titulo: d.titulo || `Dia ${dayNum}`,
      descricao: d.descricao || '',
      imagem: d.imagem,
      atividades: d.atividades || [],
      refeicoes_inclusas: d.refeicoes_inclusas,
      transports: getTransportsForDay(dayNum, transportes, alojamentos),
      checkIn: getCheckInForDay(dayNum, alojamentos),
      checkOut: getCheckOutForDay(dayNum, alojamentos),
    };
  });

  // If destinos are configured, group by them
  if (destinos.length > 0) {
    return destinos.map(dest => {
      const matching = dayInfos.filter(
        d => d.numero >= dest.dias_inicio && d.numero <= dest.dias_fim
      );
      const aloj = alojamentos.find(a => dest.alojamento_ids?.includes(a.id));
      return {
        destinoNome: dest.nome,
        alojamento: aloj,
        dias: matching,
      };
    }).filter(g => g.dias.length > 0);
  }

  // Fallback: group by alojamento check-in/check-out spans
  if (alojamentos.length > 0) {
    return groupByAlojamentos(dayInfos, alojamentos);
  }

  // No grouping available — single group
  return [{
    destinoNome: '',
    dias: dayInfos,
  }];
}

function groupByAlojamentos(days: DayInfo[], alojamentos: AlojamentoData[]): DayGroup[] {
  // Sort alojamentos by check_in date
  const sorted = [...alojamentos].sort((a, b) => (a.check_in || '').localeCompare(b.check_in || ''));

  if (sorted.length === 0) return [{ destinoNome: '', dias: days }];

  const groups: DayGroup[] = [];
  let currentDayIdx = 0;

  for (const aloj of sorted) {
    const noites = aloj.noites || 1;
    const daysForAloj = days.slice(currentDayIdx, currentDayIdx + noites);
    if (daysForAloj.length > 0) {
      groups.push({
        destinoNome: aloj.destino_nome || aloj.hotel_nome || '',
        alojamento: aloj,
        dias: daysForAloj,
      });
    }
    currentDayIdx += noites;
  }

  // Remaining days
  if (currentDayIdx < days.length) {
    const remaining = days.slice(currentDayIdx);
    if (groups.length > 0) {
      groups[groups.length - 1].dias.push(...remaining);
    } else {
      groups.push({ destinoNome: '', dias: remaining });
    }
  }

  return groups;
}

function getTransportsForDay(dayNum: number, transportes: TransporteData[], alojamentos: AlojamentoData[]): TransporteData[] {
  // Find date for this day number based on first alojamento check_in
  const firstCheckIn = alojamentos[0]?.check_in;
  if (!firstCheckIn) return [];

  const dayDate = new Date(firstCheckIn + 'T12:00:00');
  dayDate.setDate(dayDate.getDate() + dayNum - 1);
  const dateStr = dayDate.toISOString().split('T')[0];

  return transportes.filter(t => t.data === dateStr);
}

function getCheckInForDay(dayNum: number, alojamentos: AlojamentoData[]): AlojamentoData | undefined {
  const firstCheckIn = alojamentos[0]?.check_in;
  if (!firstCheckIn) return undefined;

  const dayDate = new Date(firstCheckIn + 'T12:00:00');
  dayDate.setDate(dayDate.getDate() + dayNum - 1);
  const dateStr = dayDate.toISOString().split('T')[0];

  return alojamentos.find(a => a.check_in === dateStr);
}

function getCheckOutForDay(dayNum: number, alojamentos: AlojamentoData[]): AlojamentoData | undefined {
  const firstCheckIn = alojamentos[0]?.check_in;
  if (!firstCheckIn) return undefined;

  const dayDate = new Date(firstCheckIn + 'T12:00:00');
  dayDate.setDate(dayDate.getDate() + dayNum - 1);
  const dateStr = dayDate.toISOString().split('T')[0];

  return alojamentos.find(a => a.check_out === dateStr);
}
