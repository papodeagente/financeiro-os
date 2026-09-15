/**
 * A régua dos gráficos do sistema. Sem React, sem DOM, sem cor.
 *
 * POR QUE EXISTE. Escala errada não quebra typecheck: ela só desenha errado, e
 * o erro chega ao usuário parecendo um fato. Com seis componentes de SVG
 * escritos à mão, seis réguas independentes divergiriam em silêncio. Aqui é a
 * única porta: largura de marca, tick de eixo, portão de série e alvo de toque
 * saem daqui, e nenhum componente calcula escala por conta própria.
 *
 * A REGRA QUE MAIS IMPORTA: não existe piso de marca. Valor zero desenha zero,
 * ausência desenha tracejado. O código que este módulo substitui tinha cinco
 * `Math.max` fabricando pixels, e era isso que fazia cinco meses sem
 * faturamento parecerem cinco meses de venda pequena — um gráfico mentindo
 * sobre o passado.
 */

import { divSegura, num, round2 } from './money';

/** Raio da ponta da marca. A base fica reta, ancorada na linha de base. */
export const RAIO_PONTA = 4;
/** Respiro entre preenchimentos vizinhos, para a fronteira não sumir. */
export const RESPIRO = 2;
/** Menor alvo de toque aceitável, em px. */
export const ALVO_MIN = 44;
/** Abaixo disto a marca é visível mas não clicável: precisa de linha-guia. */
export const MARCA_MINUSCULA = 6;
/** Tracejado significa AUSÊNCIA de dado. Em qualquer gráfico, sempre. */
export const TRACEJADO_AUSENCIA = '3 2';
/** Menos períodos com movimento que isto e a série temporal não nasce. */
export const PORTAO_SERIE_TEMPORAL = 3;

/** Um ponto da série. `null` é AUSÊNCIA de dado, que é diferente de zero. */
export interface Ponto {
  chave: string;
  rotulo: string;
  valor: number | null;
}

/**
 * Converte valor em pixels. Máximo zero devolve sempre zero: um gráfico sem
 * dado não tem escala, e inventar uma desenharia barras de tamanho arbitrário.
 */
export function escalaLinear(max: number, larguraPx: number): (v: number) => number {
  const m = round2(num(max));
  const w = Math.max(0, num(larguraPx));
  if (m <= 0 || w <= 0) return () => 0;
  return (v: number) => {
    const valor = num(v);
    if (valor <= 0) return 0;
    return Math.min(w, (valor / m) * w);
  };
}

/**
 * Ticks em passos que uma pessoa lê: 1, 2, 2,5 ou 5 vezes potência de dez.
 * Ticks "bonitos" derivados do máximo bruto (max/4) produzem eixos com
 * 7.704,50 escrito neles, que ninguém processa de relance.
 */
export function ticksArredondados(max: number, quantos = 4): number[] {
  const m = num(max);
  if (m <= 0 || quantos < 1) return [];
  const passoCru = m / quantos;
  const magnitude = 10 ** Math.floor(Math.log10(passoCru));
  const normalizado = passoCru / magnitude;
  const escolhido = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 2.5 ? 2.5 : normalizado <= 5 ? 5 : 10;
  const passo = escolhido * magnitude;
  // Sobe até PASSAR do máximo: o último tick precisa cobrir a maior marca,
  // senão a barra mais alta ultrapassa o topo do eixo e parece estourada.
  const ticks: number[] = [];
  for (let t = 0, voltas = 0; voltas <= 24; t += passo, voltas++) {
    ticks.push(round2(t));
    if (t >= m) break;
  }
  return ticks;
}

/**
 * Abreviação de dinheiro para TICK DE EIXO, nunca para rótulo de valor.
 * "R$ 30 mil" no eixo é orientação; no valor seria esconder o número que a
 * pessoa veio conferir.
 */
export function formatarEixoBRL(v: number): string {
  const n = num(v);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const mi = n / 1_000_000;
    return `R$ ${(Math.round(mi * 10) / 10).toLocaleString('pt-BR')} mi`;
  }
  if (abs >= 1_000) return `R$ ${Math.round(n / 1000).toLocaleString('pt-BR')} mil`;
  if (n === 0) return 'R$ 0';
  return `R$ ${Math.round(n).toLocaleString('pt-BR')}`;
}

/**
 * Largura real da marca, SEM piso. `minuscula` avisa que ela é visível mas
 * pequena demais para ser alvo — quem desenha resolve com linha-guia, não
 * aumentando a barra.
 */
export function larguraDaMarca(
  valor: number,
  total: number,
  larguraPx: number,
): { px: number; minuscula: boolean } {
  const t = num(total);
  const w = Math.max(0, num(larguraPx));
  if (t <= 0 || w <= 0) return { px: 0, minuscula: false };
  const px = Math.min(w, Math.max(0, num(valor)) / t * w);
  return { px, minuscula: px > 0 && px < MARCA_MINUSCULA };
}

/**
 * Expande cada alvo até ALVO_MIN sem invadir o vizinho.
 *
 * Doze barras em 343px dão 28px cada: menor que o dedo. Em vez de aumentar a
 * marca (o que mentiria sobre o valor), o alvo invisível cresce e divide o
 * espaço com os vizinhos.
 */
export function alvosSemColisao(
  bandas: Array<{ id: string; x: number; w: number }>,
  larguraPx: number,
): Array<{ id: string; x: number; w: number }> {
  if (bandas.length === 0) return [];
  const limite = Math.max(0, num(larguraPx));
  const ordenadas = [...bandas].sort((a, b) => a.x - b.x);
  return ordenadas.map((banda, i) => {
    if (banda.w >= ALVO_MIN) return banda;
    const anterior = ordenadas[i - 1];
    const proximo = ordenadas[i + 1];
    // A fronteira com o vizinho é o meio do vão entre as duas marcas.
    const inicio = anterior ? (anterior.x + anterior.w + banda.x) / 2 : 0;
    const fim = proximo ? (banda.x + banda.w + proximo.x) / 2 : limite;
    const x = Math.max(0, inicio);
    const w = Math.max(banda.w, Math.min(fim, limite) - x);
    return { id: banda.id, x, w };
  });
}

/** Agrupa por dia: duas vendas no mesmo dia são um degrau e um alvo só. */
export function agruparPorDia<T extends { data: string }>(
  itens: readonly T[],
): Array<{ dia: string; itens: T[] }> {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const dia = String(item?.data ?? '').slice(0, 10);
    if (!dia) continue;
    const lista = mapa.get(dia);
    if (lista) lista.push(item);
    else mapa.set(dia, [item]);
  }
  return [...mapa.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, lista]) => ({ dia, itens: lista }));
}

/** Quantos períodos têm dado de verdade — nulo e zero não contam como movimento. */
export function periodosComMovimento(pontos: readonly Ponto[]): number {
  return pontos.filter(p => p.valor !== null && num(p.valor) !== 0).length;
}

/**
 * O portão da série temporal.
 *
 * 'sem-dado' nunca teve nada; 'insuficiente' tem dado mas pouco para uma linha
 * dizer qualquer coisa. Os dois viram frase, não gráfico: uma tendência
 * desenhada sobre um ponto é uma afirmação que o dado não sustenta.
 */
export function portaoDeSerie(
  pontos: readonly Ponto[],
  minimo: number = PORTAO_SERIE_TEMPORAL,
): 'desenha' | 'insuficiente' | 'sem-dado' {
  const comDado = pontos.filter(p => p.valor !== null).length;
  if (comDado === 0) return 'sem-dado';
  return periodosComMovimento(pontos) >= minimo ? 'desenha' : 'insuficiente';
}

/** Quanto do mês já passou, em %. É a régua contra a qual o realizado se lê. */
export function ritmoEsperadoPct(diaDeHoje: number, diasDoMes: number): number {
  const dias = Math.max(1, Math.floor(num(diasDoMes)));
  const hoje = Math.min(dias, Math.max(0, Math.floor(num(diaDeHoje))));
  return round2(divSegura(hoje, dias) * 100);
}

/**
 * Quanto falta por dia para chegar na meta. É aritmética do que resta, NÃO
 * projeção: não afirma onde o mês vai fechar, diz o que teria que acontecer.
 */
export function ritmoNecessario(faltam: number, diasRestantes: number): number | null {
  const f = round2(num(faltam));
  const d = Math.floor(num(diasRestantes));
  if (f <= 0) return 0;
  if (d <= 0) return null;
  return round2(f / d);
}

/**
 * Escala comum entre painéis de faixa. Sem isto, cada plano desenha a própria
 * escada na largura toda e planos diferentes parecem iguais.
 */
export function escalaComumDeFaixas(
  planos: ReadonlyArray<{ faixas: ReadonlyArray<{ de: number; ate: number | null; percentual: number }> }>,
): { maxBase: number; maxPct: number } {
  let maxBase = 0;
  let maxPct = 0;
  for (const plano of planos) {
    for (const faixa of plano.faixas ?? []) {
      const fim = faixa.ate === null ? num(faixa.de) : num(faixa.ate);
      if (fim > maxBase) maxBase = fim;
      if (num(faixa.percentual) > maxPct) maxPct = num(faixa.percentual);
    }
  }
  return { maxBase: round2(maxBase), maxPct: round2(maxPct) };
}

/**
 * Alterna rótulos acima e abaixo quando as marcas estão perto demais para
 * caberem do mesmo lado.
 */
export function posicionarRotulosDeMarca(
  marcas: ReadonlyArray<{ pct: number }>,
  larguraPx: number,
): Array<'acima' | 'abaixo'> {
  const w = Math.max(1, num(larguraPx));
  // Abaixo de 64px entre duas marcas os rótulos de dinheiro se tocam.
  const minimoPx = 64;
  const saida: Array<'acima' | 'abaixo'> = [];
  let ultimoAcimaPx = -Infinity;
  for (const marca of marcas) {
    const px = (num(marca.pct) / 100) * w;
    if (px - ultimoAcimaPx >= minimoPx) {
      saida.push('acima');
      ultimoAcimaPx = px;
    } else {
      saida.push('abaixo');
    }
  }
  return saida;
}
