'use client';

import * as React from 'react';

import { ALVO_MIN, MARCA_MINUSCULA, RAIO_PONTA, escalaLinear } from '@/lib/escala';
import { num, round2 } from '@/lib/money';
import { AreaDeGrafico } from '@/components/fin/GraficoMoldura';
import { CamadaDeToque, type AlvoDeToque } from '@/components/fin/CamadaDeToque';

/**
 * Como o volume vendido vira (ou não vira) resultado, passo a passo.
 *
 * POR QUE EXISTE. Numa agência de viagens a maior parte do que o cliente paga
 * pertence ao fornecedor. Dito em cartões de métrica lado a lado — faturamento
 * aqui, lucro ali — isso vira uma comparação que cada pessoa refaz de cabeça, e
 * quem refaz errado conclui que a agência está perdendo dinheiro (ou ganhando
 * muito) sem nunca ver POR ONDE o dinheiro saiu. A cascata é o DRE gerencial
 * desenhado: cada passo começa onde o anterior parou, então o tamanho do que
 * sai e o tamanho do que sobra ficam na mesma régua, sem explicação.
 *
 * DUAS DECISÕES QUE MUDAM A LEITURA:
 *
 * 1. O QUE SAI NÃO É UMA SÉRIE. O passo de subtração é desenhado como RESTO —
 *    fundo recolhido com contorno de 1px — e não com um matiz da paleta.
 *    Duas cores de série no mesmo desenho dizem "duas coisas do mesmo tipo
 *    disputando o mesmo bolo", e repasse a fornecedor não disputa nada: ele é
 *    o bolo indo embora.
 *
 * 2. O TOTAL NASCE DA LINHA DE BASE, e o valor dele é o que o chamador
 *    informou — não a soma que este componente refaria. Se o total declarado
 *    não bater com o acumulado dos passos, a linha de ligação chega num nível
 *    diferente do topo da barra e a divergência aparece. Recalcular aqui
 *    esconderia justamente o erro que precisa ser visto.
 */

export type PassoDaCascata = {
  id: string;
  rotulo: string;
  valor: number;
  /** 'inicio' e 'total' nascem da base; 'soma' e 'subtrai' continuam de onde a anterior parou. */
  papel: 'inicio' | 'soma' | 'subtrai' | 'total';
  /** Explicação de uma linha, mostrada no balão. */
  detalhe?: string;
};

export type CascataProps = {
  passos: PassoDaCascata[];
  formatar: (v: number) => string;
  altura?: 200 | 260;
  onAtivar?: (id: string) => void;
};

/** Faixa do rótulo de valor, acima da barra mais alta. */
const PADDING_TOPO = 22;
/** Faixa do rótulo de valor de um total NEGATIVO, abaixo da linha de base. */
const PADDING_BAIXO = 22;
/** Vão entre duas colunas: é por onde passa a linha de ligação. */
const VAO_ENTRE_BARRAS = 14;
/** Acima disto a barra vira um bloco, e o desenho perde a leitura de passo. */
const LARGURA_MAXIMA_DA_BARRA = 56;
/**
 * Largura média de um caractere em fin-t-caption (12px, tabular-nums).
 * Não medimos o texto de verdade porque medir exigiria renderizar, ler o
 * layout e redesenhar a cada mudança de largura — três quadros de tremor num
 * gráfico que existe para ser lido de relance.
 */
const LARGURA_MEDIA_DO_CARACTERE = 6.6;
/** Folga do rótulo preso na borda, para o número não encostar no corte. */
const RESPIRO_DA_BORDA = 2;

type PassoCalculado = {
  passo: PassoDaCascata;
  /** Valor onde a barra começa. */
  base: number;
  /** Valor onde a barra termina. */
  topo: number;
  /** Acumulado DEPOIS deste passo: é de onde o próximo parte. */
  nivel: number;
};

/**
 * Empilha os passos. O sinal de 'subtrai' mora no PAPEL, não no número: quem
 * monta a lista informa a magnitude do custo, e quem desenha decide o sentido.
 * Aceitar um negativo ali faria dois sinais brigarem e um custo digitado como
 * -8.000 subiria a cascata.
 */
function calcularPassos(passos: PassoDaCascata[]): PassoCalculado[] {
  const saida: PassoCalculado[] = [];
  let nivel = 0;
  for (const passo of passos) {
    const valor = round2(num(passo.valor));
    if (passo.papel === 'inicio') {
      nivel = valor;
      saida.push({ passo, base: 0, topo: valor, nivel });
    } else if (passo.papel === 'total') {
      // Subtotal ou resultado: nasce da base e o próximo passo continua dele.
      nivel = valor;
      saida.push({ passo, base: 0, topo: valor, nivel });
    } else if (passo.papel === 'subtrai') {
      const topo = round2(nivel - Math.abs(valor));
      saida.push({ passo, base: nivel, topo, nivel: topo });
      nivel = topo;
    } else {
      const topo = round2(nivel + valor);
      saida.push({ passo, base: nivel, topo, nivel: topo });
      nivel = topo;
    }
  }
  return saida;
}

/** O que o rótulo e o balão mostram: a subtração aparece com sinal. */
function textoDoValor(calculado: PassoCalculado, formatar: (v: number) => string): string {
  const valor = round2(num(calculado.passo.valor));
  if (calculado.passo.papel === 'subtrai') {
    const magnitude = Math.abs(valor);
    return magnitude === 0 ? formatar(0) : `-${formatar(magnitude)}`;
  }
  return formatar(valor);
}

/**
 * Barra com a PONTA arredondada e a base reta, como toda marca do sistema.
 * Só 'inicio' e 'total' ganham ponta: eles têm um começo real na linha de
 * base. Um passo intermediário é uma fatia do fluxo — arredondar as duas
 * extremidades sugeriria um início e um fim que ele não tem.
 */
function caminhoDaBarra(
  x: number,
  w: number,
  yTopo: number,
  yBase: number,
  pontaParaCima: boolean,
  arredondarAPonta: boolean,
): string {
  const altura = yBase - yTopo;
  if (w <= 0 || altura <= 0) return '';
  const r = arredondarAPonta ? Math.min(RAIO_PONTA, w / 2, altura / 2) : 0;
  if (r <= 0) return `M ${x} ${yTopo} H ${x + w} V ${yBase} H ${x} Z`;
  if (pontaParaCima) {
    return [
      `M ${x} ${yBase}`,
      `V ${yTopo + r}`,
      `A ${r} ${r} 0 0 1 ${x + r} ${yTopo}`,
      `H ${x + w - r}`,
      `A ${r} ${r} 0 0 1 ${x + w} ${yTopo + r}`,
      `V ${yBase}`,
      'Z',
    ].join(' ');
  }
  return [
    `M ${x} ${yTopo}`,
    `H ${x + w}`,
    `V ${yBase - r}`,
    `A ${r} ${r} 0 0 1 ${x + w - r} ${yBase}`,
    `H ${x + r}`,
    `A ${r} ${r} 0 0 1 ${x} ${yBase - r}`,
    'Z',
  ].join(' ');
}

function corDoPasso(papel: PassoDaCascata['papel']): string {
  // 'subtrai' usa a superfície recolhida: o que sai é o RESTO, não um par
  // comparável. O contorno existe porque sem ele a barra some no fundo.
  if (papel === 'subtrai') return 'var(--fin-surface-sunken)';
  if (papel === 'soma') return 'var(--fin-serie-3)';
  return 'var(--fin-serie-1)';
}

function Desenho({
  largura,
  altura,
  calculados,
  formatar,
  onAtivar,
}: {
  largura: number;
  altura: number;
  calculados: PassoCalculado[];
  formatar: (v: number) => string;
  onAtivar?: (id: string) => void;
}) {
  const alturaPlot = Math.max(1, altura - PADDING_TOPO - PADDING_BAIXO);
  const colunaW = largura / Math.max(1, calculados.length);
  const barraW = Math.min(LARGURA_MAXIMA_DA_BARRA, Math.max(1, colunaW - VAO_ENTRE_BARRAS));

  // A escala sai da régua do sistema: `escalaLinear` converte UMA MAGNITUDE em
  // pixels. O sentido (para cima ou para baixo da linha de base) é decidido
  // aqui, pelo sinal — prejuízo desenha para baixo, não desenha menor.
  const extremos = calculados.flatMap(c => [c.base, c.topo]);
  const teto = Math.max(0, ...extremos);
  const piso = Math.min(0, ...extremos);
  const amplitude = round2(teto - piso);
  const emPx = escalaLinear(amplitude, alturaPlot);

  const yZero = PADDING_TOPO + emPx(teto);
  const y = (v: number) => (num(v) >= 0 ? yZero - emPx(v) : yZero + emPx(-num(v)));

  const barras = calculados.map((calculado, i) => {
    const xColuna = i * colunaW;
    const x = xColuna + (colunaW - barraW) / 2;
    const yTopo = Math.min(y(calculado.base), y(calculado.topo));
    const yBase = Math.max(y(calculado.base), y(calculado.topo));
    const alturaPx = yBase - yTopo;
    // Barra de valor zero fica com altura zero e não desenha tinta nenhuma: o
    // fato ("nenhum imposto neste mês") continua no rótulo e no balão.
    //
    // Valor pequeno é OUTRA coisa: R$ 40,00 dentro de R$ 900.000,00 dá meio
    // décimo de pixel e SOME, e um passo que existe sumindo lê como passo que
    // não existe. A marca continua do tamanho real (crescê-la mentiria sobre o
    // valor) e ganha um apontador de 1px — o mesmo acordo da BarraDeParte.
    const minuscula = round2(num(calculado.passo.valor)) !== 0 && alturaPx < MARCA_MINUSCULA;
    return { calculado, i, xColuna, x, yTopo, yBase, alturaPx, minuscula };
  });

  const rotulos = calculados.map(c => textoDoValor(c, formatar));
  const maiorRotulo = Math.max(0, ...rotulos.map(r => r.length));
  /**
   * DECISÃO DO 375px: quando o rótulo de valor não cabe na coluna, ele NÃO
   * encolhe e NÃO gira — texto de dinheiro deitado ou em 9px não se lê. Só o
   * primeiro e o último passo mantêm o número visível (é entre eles que está a
   * pergunta: quanto entrou, quanto sobrou) e os do meio passam a viver no
   * balão, que o toque abre.
   */
  const rotulosCabem = colunaW >= maiorRotulo * LARGURA_MEDIA_DO_CARACTERE + 6;

  const alvos: AlvoDeToque[] = barras.map(b => ({
    id: b.calculado.passo.id,
    x: b.xColuna,
    y: b.yTopo,
    w: colunaW,
    h: b.alturaPx,
    titulo: b.calculado.passo.rotulo,
    linhas: [
      rotulos[b.i],
      ...(b.calculado.passo.detalhe ? [b.calculado.passo.detalhe] : []),
      // O ponto da cascata é o acumulado: sem ele o balão vira um número solto.
      ...(b.calculado.passo.papel === 'soma' || b.calculado.passo.papel === 'subtrai'
        ? [`resulta em ${formatar(b.calculado.nivel)}`]
        : []),
    ],
  }));

  const primeiro = calculados[0];
  const ultimo = calculados[calculados.length - 1];
  const maiorSaida = calculados
    .filter(c => c.passo.papel === 'subtrai')
    .sort((a, b) => Math.abs(num(b.passo.valor)) - Math.abs(num(a.passo.valor)))[0];

  const leitura =
    `De ${primeiro.passo.rotulo} (${formatar(primeiro.topo)}) a ${ultimo.passo.rotulo} (${formatar(ultimo.topo)})` +
    (maiorSaida
      ? `, e o maior passo que sai é ${maiorSaida.passo.rotulo} (${textoDoValor(maiorSaida, formatar)}).`
      : '.');

  return (
    <svg
      className="fin-grafico-svg block"
      width={largura}
      height={altura}
      viewBox={`0 0 ${largura} ${altura}`}
      role="img"
    >
      <title>{`Cascata de ${primeiro.passo.rotulo} a ${ultimo.passo.rotulo}`}</title>
      <desc>{leitura}</desc>

      {/* Ligação entre o topo de um passo e o começo do seguinte. SÓLIDA de
          1px: neste sistema tracejado significa AUSÊNCIA de dado, e aqui não
          falta dado nenhum — a linha só diz "continua daqui". */}
      {barras.map((b, i) => {
        const proxima = barras[i + 1];
        // 'inicio' nasce da base; nada se liga a ele.
        if (!proxima || proxima.calculado.passo.papel === 'inicio') return null;
        const yLigacao = y(b.calculado.nivel);
        return (
          <line
            key={`ligacao-${b.calculado.passo.id}`}
            x1={b.x + barraW}
            x2={proxima.x}
            y1={yLigacao}
            y2={yLigacao}
            stroke="var(--fin-grade)"
            strokeWidth={1}
          />
        );
      })}

      {/* Linha de base: é dela que 'inicio' e 'total' nascem, e é ela que
          torna um total negativo legível como "abaixo de zero". */}
      <line x1={0} x2={largura} y1={yZero} y2={yZero} stroke="var(--fin-eixo)" strokeWidth={1} />

      {barras.map(b => {
        const papel = b.calculado.passo.papel;
        // A ponta é a extremidade LIVRE, longe do zero: num prejuízo ela
        // aponta para baixo, senão a barra pareceria nascer no ar.
        const pontaParaCima = num(b.calculado.topo) >= num(b.calculado.base);
        const arredonda = papel === 'inicio' || papel === 'total';
        const d = caminhoDaBarra(b.x, barraW, b.yTopo, b.yBase, pontaParaCima, arredonda);
        if (!d) return null;
        return (
          <path
            key={b.calculado.passo.id}
            d={d}
            fill={corDoPasso(papel)}
            stroke={papel === 'subtrai' ? 'var(--fin-eixo)' : 'none'}
            strokeWidth={papel === 'subtrai' ? 1 : 0}
          />
        );
      })}

      {/* Apontador do passo pequeno demais para ser visto. Ele marca ONDE o
          passo acontece, na largura da barra e na altura de um fio: a marca
          não cresce, o apontador é que aparece. */}
      {barras
        .filter(b => b.minuscula)
        .map(b => (
          <line
            key={`guia-${b.calculado.passo.id}`}
            x1={b.x}
            x2={b.x + barraW}
            y1={y(b.calculado.topo)}
            y2={y(b.calculado.topo)}
            stroke="var(--fin-eixo)"
            strokeWidth={1}
          />
        ))}

      {/* Rótulo de valor: número CHEIO, nunca abreviado — a abreviação do eixo
          serve para orientar, e aqui a pessoa veio conferir. */}
      {barras.map(b => {
        const visivel = rotulosCabem || b.i === 0 || b.i === barras.length - 1;
        if (!visivel) return null;
        // Só cai para baixo quando a barra está INTEIRA abaixo da linha de
        // base: é o caso do prejuízo, onde o espaço acima pertence ao zero.
        const abaixo = b.yTopo >= yZero - 0.5 && b.yBase > yZero + 0.5;
        // O rótulo do primeiro e do último passo é mais largo que a coluna
        // quando os números não cabem: centralizado, metade dele cairia FORA
        // do viewBox e o SVG cortaria o número sem avisar. Nesse caso ele
        // encosta na borda em vez de sair da tela — descentralizar é feio,
        // perder dígito de dinheiro é defeito.
        const meia = (rotulos[b.i].length * LARGURA_MEDIA_DO_CARACTERE) / 2;
        const centro = b.x + barraW / 2;
        const ancora =
          centro - meia < 0 ? 'start' : centro + meia > largura ? 'end' : 'middle';
        const xTexto =
          ancora === 'start'
            ? RESPIRO_DA_BORDA
            : ancora === 'end'
              ? largura - RESPIRO_DA_BORDA
              : centro;
        return (
          <text
            key={`rotulo-${b.calculado.passo.id}`}
            x={xTexto}
            y={abaixo ? b.yBase + 14 : b.yTopo - 7}
            textAnchor={ancora}
            className="fin-t-caption tabular-nums"
            fill="var(--fin-text-2)"
          >
            {rotulos[b.i]}
          </text>
        );
      })}

      <CamadaDeToque alvos={alvos} larguraSvg={largura} alturaSvg={altura} onAtivar={onAtivar} />
    </svg>
  );
}

export function Cascata({ passos, formatar, altura = 200, onAtivar }: CascataProps) {
  const calculados = React.useMemo(() => calcularPassos(passos ?? []), [passos]);

  // Sem passo nenhum não há o que dizer, nem em desenho nem em frase.
  if (calculados.length === 0) return null;

  // Um passo só não é cascata: é um número com tinta em volta, e o desenho
  // ainda sugeriria uma passagem que não existe. O NÚMERO fica — sumir com ele
  // deixaria um buraco silencioso no painel, que lê como bug.
  if (calculados.length === 1) {
    const unico = calculados[0];
    return (
      <p className="fin-t-body tabular-nums text-[var(--fin-text-2)]">
        {`${unico.passo.rotulo}: ${textoDoValor(unico, formatar)}. Um passo só não forma cascata.`}
      </p>
    );
  }

  const tudoZerado = calculados.every(c => round2(num(c.passo.valor)) === 0);

  // Sem amplitude não há escala. Desenhar a linha de base com quatro barras de
  // altura zero seria um gráfico dizendo "nada aqui" em código; a frase diz o
  // mesmo em português e ocupa uma linha.
  if (tudoZerado) {
    return (
      <p className="fin-t-body text-[var(--fin-text-2)]">
        {`Nenhum movimento no período: todos os passos estão em ${formatar(0)}.`}
      </p>
    );
  }

  return (
    <AreaDeGrafico>
      {largura => {
        // O ALVO é que manda na largura da coluna. Oito passos em 343px dariam
        // 42px por coluna, e como as colunas são CONTÍGUAS não sobra vão para
        // alvosSemColisao repartir: o dedo ficaria sem os 44px em todo lugar.
        // Então o desenho fica mais largo que a tela e rola na horizontal —
        // engordar a barra ou apertar o alvo seria resolver no lugar errado.
        const larguraDesenho = Math.max(largura, calculados.length * ALVO_MIN);
        const rola = larguraDesenho > largura;
        return (
          <div className={rola ? 'overflow-x-auto' : undefined}>
            <div className="flex flex-col gap-1" style={{ width: larguraDesenho }}>
              <Desenho
                largura={larguraDesenho}
                altura={altura}
                calculados={calculados}
                formatar={formatar}
                onAtivar={onAtivar}
              />

              {/* Os nomes dos passos ficam em HTML, não em <text> do SVG: texto
                  de SVG não quebra linha, e "Custo com fornecedores" numa coluna
                  de 62px em 375px precisa de duas. Colunas de fração igual
                  (flex-1 basis-0) sobre a MESMA largura do desenho repetem
                  exatamente a divisão dele, sem medir nada de novo. */}
              <ul className="fin-no-print flex w-full">
                {calculados.map(c => (
                  <li
                    key={c.passo.id}
                    className="fin-t-caption line-clamp-2 min-w-0 flex-1 basis-0 px-1 text-center break-words text-[var(--fin-text-3)]"
                  >
                    {c.passo.rotulo}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      }}
    </AreaDeGrafico>
  );
}

export default Cascata;
