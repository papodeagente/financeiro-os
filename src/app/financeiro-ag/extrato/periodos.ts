/**
 * Atalhos de período do Extrato de conta e das Movimentações (05/11/2026).
 * Período livre: os atalhos só preenchem as duas datas. Datas civis.
 */
import { addDias, addMeses, ultimoDiaDoMes } from '@/lib/money';

export type AtalhoDePeriodo = 'este_mes' | 'mes_passado' | 'ultimos_30' | 'este_ano' | 'ano_passado' | 'personalizado';

export const ATALHOS_DE_PERIODO: ReadonlyArray<{ valor: AtalhoDePeriodo; rotulo: string }> = [
  { valor: 'este_mes', rotulo: 'Este mês' },
  { valor: 'mes_passado', rotulo: 'Mês passado' },
  { valor: 'ultimos_30', rotulo: 'Últimos 30 dias' },
  { valor: 'este_ano', rotulo: 'Este ano' },
  { valor: 'ano_passado', rotulo: 'Ano passado' },
  { valor: 'personalizado', rotulo: 'Personalizado' },
];

function fimDoMes(iso: string): string {
  const [a, m] = iso.split('-').map(Number);
  return `${iso.slice(0, 7)}-${String(ultimoDiaDoMes(a, m)).padStart(2, '0')}`;
}

export function intervaloDoAtalho(atalho: AtalhoDePeriodo, hoje: string): { de: string; ate: string } | null {
  switch (atalho) {
    case 'este_mes': return { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
    case 'mes_passado': {
      const inicio = addMeses(`${hoje.slice(0, 7)}-01`, -1);
      return { de: inicio, ate: fimDoMes(inicio) };
    }
    case 'ultimos_30': return { de: addDias(hoje, -29), ate: hoje };
    case 'este_ano': return { de: `${hoje.slice(0, 4)}-01-01`, ate: hoje };
    case 'ano_passado': {
      const ano = Number(hoje.slice(0, 4)) - 1;
      return { de: `${ano}-01-01`, ate: `${ano}-12-31` };
    }
    default: return null;
  }
}

/** Qual atalho as datas representam (ou "personalizado"). */
export function atalhoDoIntervalo(de: string, ate: string, hoje: string): AtalhoDePeriodo {
  for (const a of ATALHOS_DE_PERIODO) {
    const iv = intervaloDoAtalho(a.valor, hoje);
    if (iv && iv.de === de && iv.ate === ate) return a.valor;
  }
  return 'personalizado';
}

/** "05/11/2026". */
export function dataCurta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : 'sem data';
}
