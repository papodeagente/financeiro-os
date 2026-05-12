import type { GrupoViagem } from './types';

// Centraliza a derivação das datas principais da viagem.
// Sempre que algum tab precisar de "data de início" ou "data de fim",
// usa essas funções — assim toda a UI puxa a mesma fonte de verdade.

export function getPrimeiraDataViagem(grupo: GrupoViagem | null | undefined): string {
  if (!grupo) return '';
  return (
    grupo.periodos?.[0]?.check_in ||
    grupo.trechos?.[0]?.data ||
    grupo.navio_info?.embarque ||
    ''
  );
}

export function getUltimaDataViagem(grupo: GrupoViagem | null | undefined): string {
  if (!grupo) return '';
  const ultimoPeriodo = grupo.periodos?.[grupo.periodos.length - 1];
  return (
    ultimoPeriodo?.check_out ||
    ultimoPeriodo?.check_in ||
    grupo.navio_info?.desembarque ||
    grupo.trechos?.[grupo.trechos.length - 1]?.data ||
    ''
  );
}

// Avança data ISO em N dias (para definir um min mais sensato).
export function avancarISO(iso: string, dias: number = 1): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}
