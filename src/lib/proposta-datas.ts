// Resolve datas default pra blocos de hotel/voo/passeio na proposta.
//
// Estrategia (prioridade decrescente):
// 1. proposta.cabecalho.data_inicio_viagem / data_fim_viagem (config explicita)
// 2. Inferir da PRIMEIRA secao ALOJAMENTO ja preenchida (check_in/check_out)
// 3. Inferir da PRIMEIRA secao VOO/TRANSPORTE com data (ida = data_inicio)
// 4. Vazio (usuario preenche manualmente)
//
// Retorna ISO date string (YYYY-MM-DD) ou string vazia.

import type { Proposta, AlojamentoData, TransporteData } from './crm-types';

export interface DatasViagem {
  checkIn: string;   // 1o dia da viagem (embarque, check-in hotel)
  checkOut: string;  // ultimo dia (desembarque, check-out hotel)
}

export function getDatasViagemDefaults(proposta: Proposta): DatasViagem {
  // 1. Configuracao explicita no cabecalho
  const cabIn = proposta.cabecalho.data_inicio_viagem || '';
  const cabOut = proposta.cabecalho.data_fim_viagem || '';
  if (cabIn || cabOut) {
    return { checkIn: cabIn, checkOut: cabOut };
  }

  // 2. Inferir do 1o ALOJAMENTO preenchido
  for (const s of proposta.secoes) {
    if (s.tipo === 'ALOJAMENTO') {
      const c = s.conteudo as Partial<AlojamentoData>;
      if (c.check_in || c.check_out) {
        return { checkIn: c.check_in || '', checkOut: c.check_out || '' };
      }
    }
  }

  // 3. Inferir do 1o VOO/TRANSPORTE preenchido (data = embarque)
  const datas: string[] = [];
  for (const s of proposta.secoes) {
    if (s.tipo === 'VOO' || s.tipo === 'TRANSPORTE') {
      const c = s.conteudo as Partial<TransporteData>;
      if (c.data) datas.push(c.data);
    }
  }
  if (datas.length > 0) {
    datas.sort();
    return {
      checkIn: datas[0],
      checkOut: datas.length > 1 ? datas[datas.length - 1] : '',
    };
  }

  // 4. Vazio
  return { checkIn: '', checkOut: '' };
}
