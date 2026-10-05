/**
 * O andamento da importação de extrato, em números que a tela pode mostrar
 * sem inventar nada.
 *
 * Três etapas, cada uma com uma medida de verdade:
 *   1. Ler o arquivo      → bytes lidos pelo navegador
 *   2. Reconhecer         → as linhas que o leitor de OFX/CSV encontrou
 *   3. Gravar na conta    → linhas conferidas pelo servidor, contadas por ele
 *
 * A barra exibida PERSEGUE o valor real (`aproximar`) para não andar aos
 * saltos, mas nunca passa dele: a tela não diz que gravou o que não gravou.
 */
import { round2 } from './money';

export type FaseImportacao =
  | 'lendo' | 'reconhecendo' | 'conferindo' | 'gravando'
  | 'pronto' | 'vazio' | 'erro';

export const ETAPAS = ['Ler o arquivo', 'Reconhecer', 'Gravar na conta'] as const;

/** Em que etapa (0, 1, 2) cada fase está. Fases finais contam como concluídas. */
export function etapaDaFase(fase: FaseImportacao): number {
  switch (fase) {
    case 'lendo': return 0;
    case 'reconhecendo': return 1;
    case 'conferindo':
    case 'gravando': return 2;
    default: return 3;
  }
}

export interface Medidas {
  lidoBytes?: number;
  totalBytes?: number;
  feitas?: number;
  total?: number;
}

const fracao = (a: number | undefined, b: number | undefined) =>
  b && b > 0 ? Math.min(1, Math.max(0, (a ?? 0) / b)) : 0;

/**
 * Quanto de CADA etapa está cheio, de 0 a 1. A barra é dividida nas três
 * etapas e cada segmento enche com a medida dele.
 */
export function preenchimentoDasEtapas(fase: FaseImportacao, m: Medidas): [number, number, number] {
  switch (fase) {
    case 'lendo': return [fracao(m.lidoBytes, m.totalBytes), 0, 0];
    case 'reconhecendo': return [1, 0, 0];
    case 'conferindo': return [1, 1, 0];
    case 'gravando': return [1, 1, fracao(m.feitas, m.total)];
    case 'pronto': return [1, 1, 1];
    // Vazio e erro param onde pararam: quem chama guarda o último valor.
    default: return [0, 0, 0];
  }
}

/** Peso de cada etapa no percentual: gravar é quase todo o trabalho. */
const PESOS = [0.1, 0.1, 0.8] as const;

export function percentualTotal(etapas: readonly number[]): number {
  const p = etapas.reduce((s, v, i) => s + v * (PESOS[i] ?? 0), 0);
  return Math.round(Math.min(1, Math.max(0, p)) * 100);
}

/**
 * Um passo do perseguidor: o valor exibido anda em direção ao real, rápido
 * quando está longe e devagar quando chega, e NUNCA passa dele nem anda para
 * trás. `dtMs` é o tempo desde o último quadro.
 */
export function aproximar(exibido: number, real: number, dtMs: number): number {
  // Nunca volta: se o real ficou para trás (não deveria), o exibido espera.
  if (exibido >= real) return exibido;
  const distancia = real - exibido;
  // Fecha ~63% da distância a cada 160 ms, com um passo mínimo para não
  // ficar rastejando na casa decimal final.
  const k = 1 - Math.exp(-Math.max(0, dtMs) / 160);
  const passo = Math.max(distancia * k, Math.min(distancia, 0.0015 * dtMs));
  return Math.min(real, exibido + passo);
}

/**
 * Lê uma resposta NDJSON que chega em pedaços: um pedaço pode trazer meia
 * linha, e a outra metade vem no próximo.
 */
export function criarLeitorNdjson() {
  let resto = '';
  const interpretar = (linha: string): Record<string, unknown>[] => {
    const t = linha.trim();
    if (!t) return [];
    try { return [JSON.parse(t) as Record<string, unknown>]; } catch { return []; }
  };
  return {
    empurrar(pedaco: string): Record<string, unknown>[] {
      resto += pedaco;
      const partes = resto.split('\n');
      resto = partes.pop() ?? '';
      return partes.flatMap(interpretar);
    },
    fechar(): Record<string, unknown>[] {
      const r = interpretar(resto);
      resto = '';
      return r;
    },
  };
}

export interface ResumoDoArquivo {
  quantidade: number;
  de: string;
  ate: string;
  entradas: number;
  saidas: number;
}

/** O que o arquivo diz, antes de qualquer gravação: período e totais. */
export function resumoDoArquivo(linhas: readonly { data: string; valor: number }[]): ResumoDoArquivo {
  let de = '';
  let ate = '';
  let entradas = 0;
  let saidas = 0;
  for (const l of linhas) {
    if (l.data) {
      if (!de || l.data < de) de = l.data;
      if (!ate || l.data > ate) ate = l.data;
    }
    if (l.valor >= 0) entradas = round2(entradas + l.valor);
    else saidas = round2(saidas + l.valor);
  }
  return { quantidade: linhas.length, de, ate, entradas, saidas };
}

/** "2,4 MB", "180 KB", "900 bytes". */
export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
