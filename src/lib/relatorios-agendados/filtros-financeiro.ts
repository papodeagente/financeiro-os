/**
 * Os filtros salvos no envio agendado do DRE e do fluxo de caixa (E7), na
 * forma de URL, lidos de volta. Arquivo puro.
 *
 *   DRE:   regime=caixa · centro=<id> · rateio=rateadas|sem_rateio · detalhe=completo
 *   Fluxo: vista=grade · medida=movimento · agrupamento=dia|semana|mes · conta=<id> · folha=0
 *
 * O que não vem (ou vem com valor desconhecido) fica no padrão da tela.
 */
import type { RegimeDRE } from '../resultado-dre';
import type { FiltroDeRateio } from '../dre-recorte';
import type { Agrupamento } from '../caderno-caixa';
import type { MedidaDaGradeDoFluxo } from '../exportacao/documentos-financeiro';

export interface FiltrosSalvosDoDRE { regime: RegimeDRE; centro: string; rateio: FiltroDeRateio; simplificado: boolean }
export interface FiltrosSalvosDoFluxo { conta: string; agrupamento: Agrupamento | null; vista: 'caderno' | 'grade'; medida: MedidaDaGradeDoFluxo; folha: boolean }

export function filtrosDoDRE(consulta: string): FiltrosSalvosDoDRE {
  const q = new URLSearchParams(consulta);
  const rateio = q.get('rateio');
  return {
    regime: q.get('regime') === 'caixa' ? 'caixa' : 'competencia',
    centro: (q.get('centro') ?? '').slice(0, 120),
    rateio: rateio === 'rateadas' || rateio === 'sem_rateio' ? rateio : 'todas',
    simplificado: q.get('detalhe') !== 'completo',
  };
}

export function filtrosDoFluxo(consulta: string): FiltrosSalvosDoFluxo {
  const q = new URLSearchParams(consulta);
  const ag = q.get('agrupamento');
  return {
    conta: (q.get('conta') ?? '').slice(0, 120),
    agrupamento: ag === 'dia' || ag === 'semana' || ag === 'mes' ? ag : null,
    vista: q.get('vista') === 'grade' ? 'grade' : 'caderno',
    medida: q.get('medida') === 'movimento' ? 'movimento' : 'saldo',
    folha: q.get('folha') !== '0',
  };
}

/** O agrupamento quando a pessoa não escolheu: por dia até um mês, por semana até um trimestre, por mês acima. */
export function agrupamentoDoPeriodo(de: string, ate: string): Agrupamento {
  const dias = Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000) + 1;
  return dias <= 31 ? 'dia' : dias <= 92 ? 'semana' : 'mes';
}
