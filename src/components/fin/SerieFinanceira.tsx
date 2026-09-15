'use client';

import * as React from 'react';

import { RESPIRO, formatarEixoBRL, larguraDaMarca, ticksArredondados } from '@/lib/escala';
import { num, round2, soma } from '@/lib/money';
import { AreaDeGrafico } from '@/components/fin/GraficoMoldura';
import { CamadaDeToque, type AlvoDeToque } from '@/components/fin/CamadaDeToque';

/**
 * Entradas, saídas e resultado mês a mês — as três na MESMA régua de reais.
 *
 * POR QUE UM EIXO SÓ. Entrou, saiu e sobrou são a mesma grandeza: reais. Dois
 * eixos y fariam as três curvas caberem bonitas na mesma caixa e a distância
 * entre elas passaria a vir da escala escolhida, não do dinheiro. É o erro
 * clássico do gráfico financeiro: um mês em que entraram R$ 80 mil e saíram
 * R$ 79 mil desenharia duas barras visivelmente diferentes, e a leitura ("mês
 * folgado") nasceria do desenho. Aqui as três medidas dividem o mesmo zero e o
 * mesmo topo, então a diferença entre elas é a diferença real.
 *
 * O PONTO MAIS FÁCIL DE ERRAR É O NEGATIVO. Resultado no vermelho é fato
 * corriqueiro em agência (mês de repasse a fornecedor), e um eixo ancorado em
 * zero por baixo joga esses meses para fora do desenho ou os achata na linha
 * de base — o mês pior do ano vira o mês "zerado". O domínio aqui desce abaixo
 * de zero quando o dado desce, e a linha de base do zero fica desenhada para
 * que acima e abaixo sejam visivelmente lados diferentes.
 *
 * O NEGATIVO VALE PARA AS TRÊS MEDIDAS, não só para o resultado. Estorno de
 * cartão e devolução de fornecedor deixam um mês com entrada ou saída líquida
 * negativa; a versão anterior deste arquivo prendia as duas em zero com um
 * clamp, e aí um mês de -R$ 12 mil em entradas aparecia — e era informado no
 * balão — como R$ 0,00. Zero e "voltou dinheiro" são fatos diferentes. Toda
 * marca é ancorada no zero e cresce para o lado do seu SINAL.
 *
 * COR: entradas e saídas são categorias (série 1 e 2) e o resultado é a
 * terceira. Resultado NÃO usa positivo/negativo como tinta: essas cores
 * significam estado nesta casa, e um mês negativo já se lê por estar abaixo da
 * linha do zero — pintar de vermelho só a barra do mês ruim faria a mesma
 * série trocar de cor no meio do caminho.
 */

export type PontoFinanceiro = { chave: string; rotulo: string; entradas: number; saidas: number; resultado: number };

export type SerieFinanceiraProps = {
  pontos: PontoFinanceiro[];
  formatar: (v: number) => string;
  altura?: 180 | 240;
  /** Índice do ponto a destacar (o período atual), ou null. */
  destaque?: number | null;
  onAtivar?: (chave: string) => void;
};

const PADDING_DIR = 10;
const PADDING_TOPO = 12;
const PADDING_BAIXO = 20; // faixa dos rótulos do eixo x

/** Teto de fios horizontais, contando o do zero. Acima disto vira hachura. */
const MAX_FIOS = 4;
/** Fração da banda ocupada pelo par de barras; o resto é o vão entre períodos. */
const OCUPACAO_DA_BANDA = 0.72;
/** Barra larga demais lê como bloco; com 3 períodos ela ficaria gorda. */
const LARGURA_MAX_DA_BARRA = 28;
const RAIO_DO_MARCADOR = 4.5; // marcador de 9px, como pede o desenho do pilar
/** Vão entre a marca e o rótulo direto que a acompanha. */
const RESPIRO_DO_ROTULO = 8;
/** Dois rótulos do eixo x a menos que isto de distância se tocam. */
const FOLGA_ENTRE_ROTULOS = 6;

/**
 * Largura aproximada de um texto de 12px (fin-t-caption), em px.
 *
 * POR QUE ESTIMAR. Não dá para medir texto do SVG antes de pintar, e sem
 * medida o rótulo do eixo negativo ('R$ -100 mil') sai pela borda esquerda do
 * viewBox: texto fora do viewBox não avisa, não erra no console, só some. A
 * estimativa é de propósito generosa — superestimar afasta o rótulo alguns
 * pixels, subestimar corta o número.
 */
function larguraAproximada(texto: string): number {
  let px = 0;
  for (const c of texto) {
    if (c === ' ' || c === ',' || c === '.') px += 3.2;
    else if (c === 'i' || c === 'l' || c === 'j' || c === '-' || c === '/') px += 4;
    else if (c === 'm' || c === 'M' || c === 'W') px += 10.5;
    else px += 7.2;
  }
  return px;
}

type AncoraDeTexto = 'start' | 'middle' | 'end';

/** Faixa horizontal que um rótulo ocupa de verdade, já contando a âncora. */
function extensaoDoRotulo(x: number, texto: string, ancora: AncoraDeTexto): { de: number; ate: number } {
  const w = larguraAproximada(texto);
  if (ancora === 'start') return { de: x, ate: x + w };
  if (ancora === 'end') return { de: x - w, ate: x };
  return { de: x - w / 2, ate: x + w / 2 };
}

/**
 * Onde pousar o rótulo direto de um ponto, sem sair do desenho.
 *
 * Tenta à direita, depois à esquerda, e só então centraliza: o que não pode
 * acontecer é o número vazar o viewBox ou cair por cima da coluna de ticks.
 */
function ancorarRotulo(
  centro: number,
  texto: string,
  larguraSvg: number,
  paddingEsq: number,
): { x: number; ancora: AncoraDeTexto } {
  const w = larguraAproximada(texto);
  const direita = larguraSvg - PADDING_DIR;
  if (centro + RESPIRO_DO_ROTULO + w <= direita) return { x: centro + RESPIRO_DO_ROTULO, ancora: 'start' };
  if (centro - RESPIRO_DO_ROTULO - w >= paddingEsq) return { x: centro - RESPIRO_DO_ROTULO, ancora: 'end' };
  // Não cabe de lado nenhum: centraliza e prende dentro do plot.
  return { x: Math.min(Math.max(paddingEsq + w / 2, centro), direita - w / 2), ancora: 'middle' };
}

/** Divisão em passos com folga contra erro de ponto flutuante (30000/10000 = 3, não 3.0000000000000004). */
function emPassos(valor: number, passo: number): number {
  return Math.ceil(valor / passo - 1e-9);
}

/**
 * O domínio comum das três medidas, já encaixado nos passos da régua.
 *
 * O passo vem de ticksArredondados: pedir 3 e afrouxar até caber existe porque
 * o lado negativo acrescenta fios que o pedido não previu, e quatro fios é o
 * limite em que a grade ainda é leitura e não hachura.
 */
function eixoDaSerie(maxPositivo: number, minNegativo: number): { topo: number; fundo: number; fios: number[] } {
  const topoBruto = Math.max(0, round2(maxPositivo));
  const fundoBruto = Math.min(0, round2(minNegativo));
  const amplitude = round2(topoBruto - fundoBruto);
  // Tudo zerado não tem escala: inventar uma desenharia barras arbitrárias.
  if (amplitude <= 0) return { topo: 0, fundo: 0, fios: [0] };

  for (const quantos of [3, 2, 1]) {
    const ticks = ticksArredondados(amplitude, quantos);
    const passo = ticks.length > 1 ? round2(ticks[1] - ticks[0]) : 0;
    if (passo <= 0) continue;
    const topo = round2(emPassos(topoBruto, passo) * passo);
    const fundo = round2(-emPassos(Math.abs(fundoBruto), passo) * passo);
    const fios: number[] = [];
    for (let v = fundo; v <= topo + passo / 2; v = round2(v + passo)) fios.push(round2(v));
    if (fios.length <= MAX_FIOS) return { topo, fundo, fios };
  }

  // Último recurso: o zero, o topo e (se houver) o fundo — o mínimo para haver
  // escala. O Set é contra fio repetido quando topo e zero coincidem: chave de
  // lista duplicada some do DOM sem dizer por quê.
  return {
    topo: topoBruto,
    fundo: fundoBruto,
    fios: [...new Set(fundoBruto < 0 ? [fundoBruto, 0, topoBruto] : [0, topoBruto])].sort((a, b) => a - b),
  };
}

function Desenho({
  largura,
  altura,
  pontos,
  destaque,
  formatar,
  onAtivar,
}: {
  largura: number;
  altura: number;
  pontos: PontoFinanceiro[];
  destaque: number | null;
  formatar: (v: number) => string;
  onAtivar?: (chave: string) => void;
}) {
  // num() no lugar de confiar na medida: largura NaN produziria viewBox e
  // width NaN, e um SVG com atributo NaN desaparece sem erro no console.
  const larguraSvg = Math.max(0, num(largura));
  const alturaSvg = Math.max(0, num(altura));
  const alturaPlot = Math.max(1, alturaSvg - PADDING_TOPO - PADDING_BAIXO);

  // Toda medida entra com SINAL. Zerar entrada/saída negativa esconderia o
  // estorno, que é exatamente o mês que alguém abriu o gráfico para entender.
  const medidas = React.useMemo(
    () =>
      pontos.map(p => ({
        chave: p.chave,
        rotulo: p.rotulo,
        entradas: num(p.entradas),
        saidas: num(p.saidas),
        resultado: num(p.resultado),
      })),
    [pontos],
  );

  const { topo, fundo, fios } = React.useMemo(() => {
    let maxPositivo = 0;
    let minNegativo = 0;
    for (const m of medidas) {
      for (const v of [m.entradas, m.saidas, m.resultado]) {
        if (v > maxPositivo) maxPositivo = v;
        if (v < minNegativo) minNegativo = v;
      }
    }
    return eixoDaSerie(maxPositivo, minNegativo);
  }, [medidas]);

  // A faixa do eixo y é medida pelos rótulos que ela vai mesmo receber: um
  // padding fixo cabe 'R$ 30 mil' e corta 'R$ -100 mil' pela borda.
  const paddingEsq = Math.min(
    Math.round(RESPIRO_DO_ROTULO + Math.max(0, ...fios.map(t => larguraAproximada(formatarEixoBRL(t))))),
    Math.round(larguraSvg * 0.4),
  );
  const larguraPlot = Math.max(1, larguraSvg - paddingEsq - PADDING_DIR);

  const amplitude = round2(topo - fundo);
  // Sem amplitude todo valor cai na base: zero desenha zero, e a base é o chão.
  const y = (v: number) =>
    amplitude <= 0 ? PADDING_TOPO + alturaPlot : PADDING_TOPO + ((topo - num(v)) / amplitude) * alturaPlot;

  const yZero = y(0);
  const alturaAcimaDoZero = yZero - PADDING_TOPO;
  const alturaAbaixoDoZero = PADDING_TOPO + alturaPlot - yZero;

  /**
   * A marca de uma medida, ancorada no zero e crescendo para o lado do sinal.
   * A altura sai de larguraDaMarca (a régua), nunca daqui — e sem piso: mês
   * sem movimento fica no chão. `minuscula` avisa que a marca existe mas é
   * fina demais para ser vista; quem desenha resolve com linha-guia.
   */
  const marcaNoZero = (valor: number): { y: number; h: number; ponta: number; minuscula: boolean } => {
    const v = num(valor);
    if (v >= 0) {
      const { px, minuscula } = larguraDaMarca(v, topo, alturaAcimaDoZero);
      return { y: yZero - px, h: px, ponta: yZero - px, minuscula };
    }
    const { px, minuscula } = larguraDaMarca(-v, Math.abs(fundo), alturaAbaixoDoZero);
    return { y: yZero, h: px, ponta: yZero + px, minuscula };
  };

  const banda = larguraPlot / Math.max(1, medidas.length);
  // O respiro sai do VÃO, não da barra: fixo em 2px ele come a barra inteira
  // quando a banda é estreita, e aí a marca some sem ter valor zero.
  const respiro = Math.min(RESPIRO, banda * 0.15);
  const larguraBarra = Math.min(LARGURA_MAX_DA_BARRA, Math.max(0, (banda * OCUPACAO_DA_BANDA - respiro) / 2));
  const larguraDoGrupo = larguraBarra * 2 + respiro;

  const colunas = medidas.map((m, i) => {
    const x0 = paddingEsq + i * banda;
    const centro = x0 + banda / 2;
    return {
      ...m,
      indice: i,
      x0,
      centro,
      xEntradas: centro - larguraDoGrupo / 2,
      xSaidas: centro - larguraDoGrupo / 2 + larguraBarra + respiro,
      marcaEntradas: marcaNoZero(m.entradas),
      marcaSaidas: marcaNoZero(m.saidas),
      yResultado: y(m.resultado),
    };
  });

  const caminhoDoResultado = colunas
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${round2(c.centro)} ${round2(c.yResultado)}`)
    .join(' ');

  const alvos: AlvoDeToque[] = colunas.map(c => ({
    id: c.chave,
    // O alvo é a COLUNA INTEIRA, não cada barra: ninguém quer acertar com o
    // dedo a barra de 6px de saídas para descobrir o mês inteiro. Bandas
    // encostadas e cobrindo o plot inteiro é o máximo que dá para oferecer ao
    // dedo sem invadir o vizinho — e é por isso que o chamador deve mandar
    // períodos na quantidade que cabe, não o ano todo num cartão de 375px.
    x: c.x0,
    y: PADDING_TOPO,
    w: banda,
    h: alturaPlot,
    titulo: c.indice === destaque ? `${c.rotulo} · período atual` : c.rotulo,
    linhas: [
      `entradas ${formatar(c.entradas)}`,
      `saídas ${formatar(c.saidas)}`,
      `resultado ${formatar(c.resultado)}`,
    ],
  }));

  /**
   * Rótulo de eixo x só no primeiro, no destaque e no último: doze rótulos em
   * 375px viram um borrão, e o que orienta é começo, fim e "onde estou".
   *
   * A ordem abaixo é de PRIORIDADE, não de desenho: quando o destaque cai
   * colado no primeiro ou no último (destaque = penúltimo é o caso comum), os
   * dois rótulos se sobrepõem e viram rabisco. Quem chega depois e não cabe
   * fica de fora — o destaque continua legível pela faixa de fundo e pelo
   * balão.
   */
  const rotulosDoEixoX: Array<{ indice: number; x: number; ancora: AncoraDeTexto }> = [];
  {
    const ocupado: Array<{ de: number; ate: number }> = [];
    const prioridade = [0, colunas.length - 1, ...(destaque !== null ? [destaque] : [])];
    for (const indice of prioridade) {
      const coluna = colunas[indice];
      if (!coluna || rotulosDoEixoX.some(r => r.indice === indice)) continue;
      const ancora: AncoraDeTexto = indice === 0 ? 'start' : indice === colunas.length - 1 ? 'end' : 'middle';
      const faixa = extensaoDoRotulo(coluna.centro, coluna.rotulo, ancora);
      const colide = ocupado.some(
        o => faixa.de - FOLGA_ENTRE_ROTULOS < o.ate && faixa.ate + FOLGA_ENTRE_ROTULOS > o.de,
      );
      if (colide) continue;
      ocupado.push(faixa);
      rotulosDoEixoX.push({ indice, x: coluna.centro, ancora });
    }
    rotulosDoEixoX.sort((a, b) => a.indice - b.indice);
  }

  const emFoco = colunas[destaque ?? colunas.length - 1] ?? colunas[colunas.length - 1];
  const textoEmFoco = formatar(emFoco.resultado);
  const rotuloEmFoco = ancorarRotulo(emFoco.centro, textoEmFoco, larguraSvg, paddingEsq);
  const yDoRotuloEmFoco = Math.min(
    Math.max(PADDING_TOPO + 10, emFoco.yResultado - 10),
    PADDING_TOPO + alturaPlot,
  );

  const totalResultado = soma(medidas.map(m => m.resultado));
  const periodosNegativos = medidas.filter(m => m.resultado < 0).length;
  const primeiro = colunas[0];
  const ultimo = colunas[colunas.length - 1];

  return (
    <svg
      className="fin-grafico-svg block"
      width={larguraSvg}
      height={alturaSvg}
      viewBox={`0 0 ${larguraSvg} ${alturaSvg}`}
      role="img"
    >
      <title>Entradas, saídas e resultado por período</title>
      <desc>
        {`De ${primeiro.rotulo} a ${ultimo.rotulo} o resultado somou ${formatar(totalResultado)}, com ${periodosNegativos} ${periodosNegativos === 1 ? 'período negativo' : 'períodos negativos'}, e o último período fechou em ${formatar(ultimo.resultado)}.`}
      </desc>

      {/* Faixa do período atual, atrás de tudo: destaque é fundo, não contorno,
          para não competir com a tinta das séries. */}
      {destaque !== null && colunas[destaque] ? (
        <rect
          x={colunas[destaque].x0}
          y={PADDING_TOPO}
          width={banda}
          height={alturaPlot}
          fill="var(--fin-surface-2)"
        />
      ) : null}

      {/* Grade sólida de 1px. O fio do zero sai daqui porque ele é EIXO. */}
      {fios
        .filter(t => t !== 0)
        .map(t => (
          <line
            key={`fio-${t}`}
            x1={paddingEsq}
            x2={larguraSvg - PADDING_DIR}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--fin-grade)"
            strokeWidth={1}
          />
        ))}

      {fios.map(t => (
        <text
          key={`tick-${t}`}
          x={paddingEsq - RESPIRO_DO_ROTULO}
          y={y(t) + 4}
          textAnchor="end"
          className="fin-t-caption tabular-nums"
          fill="var(--fin-text-3)"
        >
          {formatarEixoBRL(t)}
        </text>
      ))}

      {/* A linha do zero. Com valores negativos ela é a fronteira entre sobrar
          e faltar, e sem ela o mês no vermelho lê como barra curta. */}
      <line
        x1={paddingEsq}
        x2={larguraSvg - PADDING_DIR}
        y1={yZero}
        y2={yZero}
        stroke="var(--fin-eixo)"
        strokeWidth={1}
      />

      {colunas.map(c => (
        <g key={`barras-${c.chave}`}>
          <rect
            x={c.xEntradas}
            y={c.marcaEntradas.y}
            width={larguraBarra}
            height={c.marcaEntradas.h}
            fill="var(--fin-serie-1)"
          />
          <rect
            x={c.xSaidas}
            y={c.marcaSaidas.y}
            width={larguraBarra}
            height={c.marcaSaidas.h}
            fill="var(--fin-serie-2)"
          />
        </g>
      ))}

      {/* Linha-guia da marca fina demais para enxergar. A barra NÃO cresce: o
          fio de 1px fica na ponta verdadeira dela, que é onde o valor está.
          Sem isto, R$ 300 num mês de R$ 80 mil desenha meio pixel e fica
          idêntico a um mês zerado — dois fatos bem diferentes. */}
      {colunas.map(c => (
        <g key={`guia-${c.chave}`}>
          {c.marcaEntradas.minuscula ? (
            <line
              x1={c.xEntradas}
              x2={c.xEntradas + larguraBarra}
              y1={c.marcaEntradas.ponta}
              y2={c.marcaEntradas.ponta}
              stroke="var(--fin-serie-1)"
              strokeWidth={1}
            />
          ) : null}
          {c.marcaSaidas.minuscula ? (
            <line
              x1={c.xSaidas}
              x2={c.xSaidas + larguraBarra}
              y1={c.marcaSaidas.ponta}
              y2={c.marcaSaidas.ponta}
              stroke="var(--fin-serie-2)"
              strokeWidth={1}
            />
          ) : null}
        </g>
      ))}

      {/* O resultado é linha, não barra: ele é a leitura contínua do saldo, e
          barra a mais competiria com as duas que já disputam a coluna. */}
      <path
        d={caminhoDoResultado}
        fill="none"
        stroke="var(--fin-serie-3)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {colunas.map(c => (
        <circle
          key={`marcador-${c.chave}`}
          cx={c.centro}
          cy={c.yResultado}
          r={RAIO_DO_MARCADOR}
          fill="var(--fin-serie-3)"
          // Anel da superfície: sobre a barra, o marcador sem anel some dentro dela.
          stroke="var(--fin-surface)"
          strokeWidth={2}
        />
      ))}

      {/* UM rótulo direto, no período em foco, com o valor CHEIO (com sinal): a
          abreviação vive só no tick de eixo. */}
      <text
        x={rotuloEmFoco.x}
        y={yDoRotuloEmFoco}
        textAnchor={rotuloEmFoco.ancora}
        className="fin-t-caption tabular-nums"
        fill="var(--fin-text-2)"
      >
        {textoEmFoco}
      </text>

      {rotulosDoEixoX.map(r => (
        <text
          key={`eixo-${colunas[r.indice].chave}`}
          x={r.x}
          y={alturaSvg - 6}
          textAnchor={r.ancora}
          className="fin-t-caption"
          fill={r.indice === destaque ? 'var(--fin-text)' : 'var(--fin-text-3)'}
        >
          {colunas[r.indice].rotulo}
        </text>
      ))}

      {/* Sem crosshair: o eixo x aqui é categórico (períodos), e uma vertical
          contínua sugeriria leitura entre dois meses. A camada de toque é a
          ÚLTIMA do SVG — abaixo de qualquer marca ela perderia o dedo. */}
      <CamadaDeToque alvos={alvos} larguraSvg={larguraSvg} alturaSvg={alturaSvg} onAtivar={onAtivar} />
    </svg>
  );
}

function Legenda({
  totais,
  quantos,
  formatar,
}: {
  totais: { entradas: number; saidas: number; resultado: number };
  quantos: number;
  formatar: (v: number) => string;
}) {
  const itens = [
    { id: 'entradas', rotulo: 'Entradas', cor: 'var(--fin-serie-1)', valor: totais.entradas, linha: false },
    { id: 'saidas', rotulo: 'Saídas', cor: 'var(--fin-serie-2)', valor: totais.saidas, linha: false },
    { id: 'resultado', rotulo: 'Resultado', cor: 'var(--fin-serie-3)', valor: totais.resultado, linha: true },
  ];

  return (
    <div className="flex flex-col gap-1">
      {/* Legenda sempre presente: com três séries, identidade nunca só por cor. */}
      <ul className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
        {itens.map(item => (
          <li key={item.id} className="flex items-center gap-2">
            {item.linha ? (
              <span aria-hidden="true" className="relative flex h-[9px] w-4 shrink-0 items-center">
                <span className="h-[2px] w-full" style={{ background: item.cor }} />
                <span
                  className="absolute left-1/2 h-[9px] w-[9px] -translate-x-1/2 rounded-full border-2"
                  style={{ background: item.cor, borderColor: 'var(--fin-surface)' }}
                />
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ background: item.cor }}
              />
            )}
            <span className="fin-t-caption text-[var(--fin-text-2)]">{item.rotulo}</span>
            <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{formatar(item.valor)}</span>
          </li>
        ))}
      </ul>
      {/* O número da legenda é SOMA, não o mês em foco: dito em palavras porque
          um total ao lado de um gráfico mensal lê como "o último mês". */}
      <p className="fin-t-caption text-[var(--fin-text-3)]">{`somas dos ${quantos} períodos mostrados`}</p>
    </div>
  );
}

export function SerieFinanceira({
  pontos,
  formatar,
  altura = 180,
  destaque = null,
  onAtivar,
}: SerieFinanceiraProps) {
  // Chave repetida não é detalhe: ela vira id de alvo de toque, e dois alvos
  // com o mesmo id colidem no mapa da CamadaDeToque — o segundo herda a banda
  // do primeiro e o dedo passa a abrir o mês errado. Fica o primeiro.
  const validos = React.useMemo(() => {
    const vistas = new Set<string>();
    return pontos.filter(p => {
      if (!p || !p.chave || vistas.has(p.chave)) return false;
      vistas.add(p.chave);
      return true;
    });
  }, [pontos]);

  // Somas com SINAL, para casarem com o que o balão mostra em cada mês.
  const totais = React.useMemo(
    () => ({
      entradas: soma(validos.map(p => num(p.entradas))),
      saidas: soma(validos.map(p => num(p.saidas))),
      resultado: soma(validos.map(p => num(p.resultado))),
    }),
    [validos],
  );

  const destaqueValido =
    destaque !== null && Number.isInteger(destaque) && destaque >= 0 && destaque < validos.length ? destaque : null;

  // Zero ponto e um ponto só não desenham. Uma série temporal de um período é
  // um número com tinta em volta, e duas barras isoladas ainda sugeririam uma
  // tendência que o dado não tem. A frase é do chamador, que sabe se o vazio é
  // 'ainda não há lançamentos' ou 'o filtro não achou nada'.
  if (validos.length < 2) return null;

  return (
    <div className="flex w-full flex-col gap-2">
      <AreaDeGrafico>
        {largura => (
          <Desenho
            largura={largura}
            altura={altura}
            pontos={validos}
            destaque={destaqueValido}
            formatar={formatar}
            onAtivar={onAtivar}
          />
        )}
      </AreaDeGrafico>

      <Legenda totais={totais} quantos={validos.length} formatar={formatar} />
    </div>
  );
}

export default SerieFinanceira;
