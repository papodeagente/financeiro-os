/**
 * Os períodos do Dashboard Financeiro, em aritmética de data CIVIL.
 *
 * POR QUE UM MÓDULO PURO. Corte de período é onde dashboard mente sem avisar:
 * `new Date('2026-09-01')` volta um dia no fuso do Brasil e
 * `new Date().toISOString()` em produção (que roda em UTC) empurra tudo que
 * acontece depois das 21h para o dia seguinte — e, na virada, para o MÊS
 * seguinte. Um erro desses não aparece em teste manual às duas da tarde.
 *
 * Aqui tudo é string 'YYYY-MM-DD' comparada por string, com os helpers de
 * money.ts que já tratam o fuso do tenant. E fica testável sem navegador.
 */

import { addDias, addMeses, dataLocal, dataSegura, hojeISO, mesDe, ultimoDiaDoMes } from './money';

export type ChaveDePeriodo =
  | 'HOJE' | 'ONTEM'
  | 'ESTA_SEMANA' | 'SEMANA_PASSADA'
  | 'ESTE_MES' | 'MES_PASSADO'
  | 'ULTIMOS_30' | 'ULTIMOS_90'
  | 'ESTE_TRIMESTRE' | 'ESTE_ANO' | 'ANO_PASSADO'
  | 'PERSONALIZADO';

export interface JanelaDePeriodo {
  de: string;
  ate: string;
  rotulo: string;
  /** Como comparar: a janela anterior de mesmo tamanho, ou o ano passado. */
  comparacao: 'periodo-anterior' | 'ano-anterior';
}

export const ROTULO_DE_PERIODO: Record<ChaveDePeriodo, string> = {
  HOJE: 'Hoje',
  ONTEM: 'Ontem',
  ESTA_SEMANA: 'Esta semana',
  SEMANA_PASSADA: 'Semana passada',
  ESTE_MES: 'Este mês',
  MES_PASSADO: 'Mês passado',
  ULTIMOS_30: 'Últimos 30 dias',
  ULTIMOS_90: 'Últimos 90 dias',
  ESTE_TRIMESTRE: 'Este trimestre',
  ESTE_ANO: 'Este ano',
  ANO_PASSADO: 'Ano passado',
  PERSONALIZADO: 'Período personalizado',
};

export const PERIODOS_NA_ORDEM: ChaveDePeriodo[] = [
  'HOJE', 'ONTEM', 'ESTA_SEMANA', 'SEMANA_PASSADA', 'ESTE_MES', 'MES_PASSADO',
  'ULTIMOS_30', 'ULTIMOS_90', 'ESTE_TRIMESTRE', 'ESTE_ANO', 'ANO_PASSADO', 'PERSONALIZADO',
];

/**
 * Segunda-feira da semana de uma data.
 *
 * Semana comercial começa na segunda: "esta semana" para quem opera uma agência
 * é o bloco de trabalho, não o domingo do calendário de parede.
 */
export function segundaDaSemana(iso: string): string {
  const d = dataLocal(iso);
  if (!d) return iso;
  // getDay(): 0 é domingo. Domingo pertence à semana que COMEÇOU na segunda
  // anterior, então recua 6, não 0.
  const diaDaSemana = d.getDay();
  const recuo = diaDaSemana === 0 ? 6 : diaDaSemana - 1;
  return addDias(iso, -recuo);
}

/** Primeiro e último dia do trimestre da data. */
export function trimestreDe(iso: string): { de: string; ate: string } {
  const ano = Number(iso.slice(0, 4));
  const mes = Number(iso.slice(5, 7));
  const primeiroMes = Math.floor((mes - 1) / 3) * 3 + 1;
  const ultimoMes = primeiroMes + 2;
  return {
    de: dataSegura(ano, primeiroMes, 1),
    ate: dataSegura(ano, ultimoMes, ultimoDiaDoMes(ano, ultimoMes)),
  };
}

/**
 * Resolve a chave numa janela de datas.
 *
 * REGRA QUE VALE PARA TODAS AS JANELAS DO MÊS/TRIMESTRE/ANO CORRENTES: elas
 * terminam HOJE, não no último dia do calendário. Somar um mês inteiro de
 * despesa contra vinte dias de receita é o jeito mais fácil de anunciar um
 * prejuízo que não existe.
 */
export function resolverPeriodo(
  chave: ChaveDePeriodo,
  hoje: string = hojeISO(),
  personalizado?: { de?: string; ate?: string },
): JanelaDePeriodo {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  const rotulo = ROTULO_DE_PERIODO[chave];
  const janela = (de: string, ate: string, comparacao: JanelaDePeriodo['comparacao'] = 'periodo-anterior') =>
    ({ de, ate, rotulo, comparacao });

  switch (chave) {
    case 'HOJE':
      return janela(hoje, hoje);
    case 'ONTEM': {
      const ontem = addDias(hoje, -1);
      return janela(ontem, ontem);
    }
    case 'ESTA_SEMANA':
      return janela(segundaDaSemana(hoje), hoje);
    case 'SEMANA_PASSADA': {
      const inicio = addDias(segundaDaSemana(hoje), -7);
      return janela(inicio, addDias(inicio, 6));
    }
    case 'ESTE_MES':
      return janela(dataSegura(ano, mes, 1), hoje);
    case 'MES_PASSADO': {
      const noMesPassado = addMeses(dataSegura(ano, mes, 1), -1);
      const a = Number(noMesPassado.slice(0, 4));
      const m = Number(noMesPassado.slice(5, 7));
      return janela(dataSegura(a, m, 1), dataSegura(a, m, ultimoDiaDoMes(a, m)));
    }
    case 'ULTIMOS_30':
      // 30 dias contando hoje: de hoje−29 até hoje. Contar hoje−30 daria 31.
      return janela(addDias(hoje, -29), hoje);
    case 'ULTIMOS_90':
      return janela(addDias(hoje, -89), hoje);
    case 'ESTE_TRIMESTRE':
      return janela(trimestreDe(hoje).de, hoje);
    case 'ESTE_ANO':
      return janela(dataSegura(ano, 1, 1), hoje, 'ano-anterior');
    case 'ANO_PASSADO':
      return janela(dataSegura(ano - 1, 1, 1), dataSegura(ano - 1, 12, 31), 'ano-anterior');
    case 'PERSONALIZADO': {
      const de = personalizado?.de || dataSegura(ano, mes, 1);
      const ate = personalizado?.ate || hoje;
      // Datas invertidas não viram erro: viram a janela na ordem certa. O
      // usuário escolheu duas datas, e a ordem em que ele clicou não é o ponto.
      return de <= ate ? janela(de, ate) : janela(ate, de);
    }
  }
}

/** Quantos dias a janela cobre, contando os dois extremos. */
export function diasDaJanela(de: string, ate: string): number {
  const a = dataLocal(de);
  const b = dataLocal(ate);
  if (!a || !b) return 1;
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
}

/**
 * A janela de comparação.
 *
 * 'periodo-anterior' devolve a janela imediatamente anterior, do MESMO tamanho.
 * 'ano-anterior' devolve o mesmo intervalo doze meses atrás, que é a comparação
 * que faz sentido para um negócio sazonal — e turismo é sazonal.
 */
export function janelaDeComparacao(j: JanelaDePeriodo): { de: string; ate: string } {
  if (j.comparacao === 'ano-anterior') {
    return { de: addMeses(j.de, -12), ate: addMeses(j.ate, -12) };
  }
  const dias = diasDaJanela(j.de, j.ate);
  const ate = addDias(j.de, -1);
  return { de: addDias(ate, -(dias - 1)), ate };
}

/** O mês da janela, quando ela cabe num mês só. Serve para rotular a tela. */
export function mesDaJanela(j: { de: string; ate: string }): string | null {
  return mesDe(j.de) === mesDe(j.ate) ? mesDe(j.de) : null;
}
