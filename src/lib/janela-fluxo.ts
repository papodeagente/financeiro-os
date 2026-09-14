/**
 * Janela de projeção do fluxo de caixa.
 *
 * Antes só existiam 3, 6 e 12 meses, todos começando no mês corrente. Quem
 * precisa saber o que vence no mês que vem tinha que ler seis meses e
 * procurar a linha. Agora a janela tem deslocamento além de tamanho, e
 * aceita um período escolhido à mão.
 *
 * Tudo em data civil 'YYYY-MM-DD' e mês 'YYYY-MM'. Nada de new Date sobre
 * string de data: no fuso de Brasília ela retrocede um dia.
 */
import { dataLocal, paraISO, mesDe, addMeses, ultimoDiaDoMes } from './money';

export type Horizonte =
  | { tipo: 'preset'; id: string }
  | { tipo: 'personalizado'; de: string; ate: string };

export interface Preset {
  id: string;
  rotulo: string;
  /** Quantos meses à frente do mês corrente a janela começa. */
  deslocamento: number;
  /** Quantos meses a janela cobre. */
  quantidade: number;
}

export const PRESETS: Preset[] = [
  { id: 'atual', rotulo: 'Este mês', deslocamento: 0, quantidade: 1 },
  { id: 'proximo', rotulo: 'Próximo mês', deslocamento: 1, quantidade: 1 },
  { id: '2', rotulo: '2 meses', deslocamento: 0, quantidade: 2 },
  { id: '3', rotulo: '3 meses', deslocamento: 0, quantidade: 3 },
  { id: '6', rotulo: '6 meses', deslocamento: 0, quantidade: 6 },
  { id: '12', rotulo: '12 meses', deslocamento: 0, quantidade: 12 },
];

export const PRESET_PADRAO = '6';

export function acharPreset(id: string): Preset {
  return PRESETS.find(p => p.id === id) ?? PRESETS.find(p => p.id === PRESET_PADRAO)!;
}

/** Teto de meses numa janela personalizada. Acima disso a tela vira uma
 *  lista que ninguém lê, e o cálculo passa a custar sem entregar leitura. */
export const MAX_MESES = 36;

function mesValido(ym: unknown): boolean {
  return typeof ym === 'string' && /^\d{4}-\d{2}$/.test(ym);
}

/** Meses cobertos pela janela, em ordem. */
export function mesesDaJanela(h: Horizonte, hoje: string): string[] {
  const base = mesDe(hoje);
  if (!mesValido(base)) return [];

  if (h.tipo === 'personalizado') {
    const de = mesDe(h.de);
    const ate = mesDe(h.ate);
    if (!mesValido(de) || !mesValido(ate)) return [];
    // Datas invertidas não devolvem lista vazia: quem escolheu quis o
    // intervalo entre elas, e a ordem é detalhe de digitação.
    const [ini, fim] = de <= ate ? [de, ate] : [ate, de];
    const saida: string[] = [];
    let atual = ini;
    while (atual <= fim && saida.length < MAX_MESES) {
      saida.push(atual);
      atual = mesDe(addMeses(`${atual}-01`, 1));
    }
    return saida;
  }

  const p = acharPreset(h.id);
  return Array.from({ length: p.quantidade }, (_, i) =>
    mesDe(addMeses(`${base}-01`, p.deslocamento + i)),
  );
}

/** Primeiro dia da janela. Tudo em aberto ANTES disso é atrasado e cai na
 *  primeira linha, que é como a tela sempre tratou. */
export function inicioDaJanela(h: Horizonte, hoje: string): string {
  const meses = mesesDaJanela(h, hoje);
  return meses.length > 0 ? `${meses[0]}-01` : `${mesDe(hoje)}-01`;
}

/** Último dia da janela. */
export function fimDaJanela(h: Horizonte, hoje: string): string {
  const meses = mesesDaJanela(h, hoje);
  if (meses.length === 0) return '';
  const ultimo = meses[meses.length - 1];
  const [ano, mes] = ultimo.split('-').map(Number);
  return `${ultimo}-${String(ultimoDiaDoMes(ano, mes)).padStart(2, '0')}`;
}

export interface SemanaDaJanela {
  inicio: string;
  fim: string;
}

/**
 * Semanas cobertas pela janela, de domingo a sábado.
 *
 * A primeira semana começa no domingo da semana que contém o início da
 * janela, para nenhum dia do primeiro mês ficar de fora da soma.
 */
export function semanasDaJanela(h: Horizonte, hoje: string): SemanaDaJanela[] {
  const inicio = inicioDaJanela(h, hoje);
  const fim = fimDaJanela(h, hoje);
  if (!inicio || !fim) return [];

  const d = dataLocal(inicio);
  if (!d) return [];
  d.setDate(d.getDate() - d.getDay());

  const saida: SemanaDaJanela[] = [];
  // 6 semanas por mês é folga suficiente e impede laço infinito caso
  // alguma data venha estranha.
  const teto = MAX_MESES * 6;
  while (saida.length < teto) {
    const ini = paraISO(d);
    if (ini > fim) break;
    const f = new Date(d);
    f.setDate(f.getDate() + 6);
    saida.push({ inicio: ini, fim: paraISO(f) });
    d.setDate(d.getDate() + 7);
  }
  return saida;
}

/** Texto curto da janela, para o resumo da tela. */
export function descreverJanela(h: Horizonte, hoje: string): string {
  const meses = mesesDaJanela(h, hoje);
  if (meses.length === 0) return 'período inválido';
  if (h.tipo === 'preset') return acharPreset(h.id).rotulo.toLowerCase();
  if (meses.length === 1) return rotuloMes(meses[0]);
  return `${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])}`;
}

function rotuloMes(ym: string): string {
  const [a, m] = ym.split('-');
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[Number(m) - 1]}/${a}`;
}
