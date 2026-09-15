'use client';

import * as React from 'react';

import { formatarEixoBRL, ticksArredondados } from '@/lib/escala';
import { num, round2 } from '@/lib/money';
import { AreaDeGrafico } from '@/components/fin/GraficoMoldura';
import { CamadaDeToque, type AlvoDeToque } from '@/components/fin/CamadaDeToque';
import { Callout } from '@/components/fin/Callout';

/**
 * Como o saldo caminha nas próximas janelas SE tudo que já está lançado
 * acontecer.
 *
 * POR QUE EXISTE, E POR QUE ELE DESCONFIA DE SI MESMO. Um gráfico de projeção
 * convida a leitura de profecia: a linha continua depois de hoje, então parece
 * que alguém sabe o futuro. Aqui não há modelo, tendência nem sazonalidade —
 * há SOMA de contas a receber e a pagar que já existem no sistema. Por isso o
 * componente carrega uma frase fixa dizendo isso (não é sublinha opcional de
 * quem chama: se fosse, sumiria na primeira tela apertada) e por isso a linha é
 * DEGRAU, não curva. Curva interpolaria saldo em dias onde nada está lançado,
 * desenhando movimento que o dado não tem.
 *
 * A ZONA NEGATIVA É O ASSUNTO, E ELA NÃO É PINTADA DE VERMELHO. Quem abre esta
 * tela abre para saber se o caixa vira. A tentação é pintar o trecho abaixo de
 * zero com o token de estado — e essa é exatamente a troca que o sistema
 * proíbe: os tokens de estado significam ESTADO em toda a aplicação, e gastá-los
 * dentro de um gráfico faz "vencido" e "série 2" saírem da mesma cor na mesma
 * tela. Some-se a isso que cor sozinha não informa quem não distingue vermelho.
 * O cruzamento aqui é dito por QUATRO canais que não dependem de matiz:
 *   1. a geometria — a linha desce por baixo de uma linha de zero SÓLIDA, que
 *      só é desenhada quando existe saldo negativo;
 *   2. o preenchimento abaixo do zero, mais denso que o de cima, no MESMO
 *      matiz da série: é o mesmo dado, num pedaço que pesa mais;
 *   3. o rótulo da janela que virou, em tom de texto forte;
 *   4. um Callout em texto, fora do desenho, com a DATA e o VALOR — o
 *      componente de aviso é quem tem direito à cor de estado.
 *
 * O NEGATIVO DE HOJE TAMBÉM CAI PARA BAIXO DO ZERO. O aviso em texto fala de
 * projeção, mas o desenho responde ao saldo, venha ele de hoje ou de uma
 * janela: um saldo negativo hoje com projeções positivas precisa aparecer
 * abaixo da linha, senão o trecho some recortado e a tela afirma que nunca
 * houve buraco.
 *
 * A DATA DO CRUZAMENTO NÃO É INTERPOLADA. O saldo muda em degrau, de janela em
 * janela; dizer "vira no dia 23" a partir de uma reta entre 15d e 30d seria
 * inventar precisão. O aviso nomeia a PRIMEIRA JANELA em que o saldo já está
 * negativo, que é o que a aritmética sustenta.
 */

export type PontoDeProjecao = {
  /** Tamanho da janela em dias, sempre maior que zero. */
  dias: number;
  /** Fim da janela, 'YYYY-MM-DD'. */
  data: string;
  /** Nulo/ausente é AUSÊNCIA de movimento a somar, não movimento zero. */
  entradas: number | null;
  saidas: number | null;
  saldoProjetado: number;
};

export type ProjecaoDeCaixaProps = {
  saldoHoje: number;
  /** Data civil de hoje, 'YYYY-MM-DD'. Sem ela o nodo de hoje não afirma data. */
  dataDeHoje?: string;
  pontos: PontoDeProjecao[];
  formatar: (v: number) => string;
  altura?: 180 | 220;
  onAtivar?: (dias: number) => void;
};

const PADDING_DIR = 12;
const PADDING_TOPO = 14;
const PADDING_BAIXO = 22; // faixa dos rótulos de janela
/** Vão entre o rótulo do eixo y e a área de desenho. */
const RESPIRO_DO_EIXO = 12;
/** Largura média de um caractere de fin-t-caption (12px). Estimar basta, desde
 *  que erre para MAIS: sobrar margem só desloca o desenho, faltar corta o
 *  rótulo na borda do viewBox. */
const LARGURA_CARACTERE = 6.6;
/** Densidade do preenchimento: abaixo de zero pesa mais, no mesmo matiz. */
const TINTA_ACIMA = 0.1;
const TINTA_ABAIXO = 0.24;

/** A frase que impede a leitura de profecia. Não é opcional de propósito. */
const AVISO_DE_ARITMETICA =
  'Soma do que já está lançado. Não é previsão: nenhuma venda nova entra nesta conta.';

/** Devolve '' quando a data não tem forma de data: melhor omitir que inventar. */
function dataCurta(iso: string): string {
  const texto = String(iso ?? '');
  if (texto.length < 10) return '';
  return `${texto.slice(8, 10)}/${texto.slice(5, 7)}`;
}

function rotuloDaJanela(dias: number): string {
  return `${Math.round(num(dias))}d`;
}

/** Nulo e indefinido são ausência; qualquer outra coisa vira dinheiro. */
function dinheiroOuAusencia(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  return round2(num(v));
}

type Nodo = {
  /** 0 é hoje. */
  dias: number;
  data: string;
  rotulo: string;
  entradas: number | null;
  saidas: number | null;
  saldo: number;
};

function Desenho({
  largura,
  altura,
  nodos,
  formatar,
  onAtivar,
}: {
  largura: number;
  altura: number;
  nodos: Nodo[];
  formatar: (v: number) => string;
  onAtivar?: (dias: number) => void;
}) {
  // useId traz caracteres que não valem dentro de url(#…); só letras e dígitos
  // sobrevivem, e o sufixo continua único por instância.
  const idDoRecorte = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const recortePositivo = `positivo-${idDoRecorte}`;
  const recorteNegativo = `negativo-${idDoRecorte}`;

  const alturaPlot = Math.max(1, altura - PADDING_TOPO - PADDING_BAIXO);

  const saldos = nodos.map(n => n.saldo);
  const topoDoDado = Math.max(0, ...saldos);
  const fundoDoDado = Math.min(0, ...saldos);
  // O desenho responde ao SALDO, não ao aviso em texto: negativo hoje é buraco
  // igual, e precisa cair para baixo do zero como qualquer outro.
  const haNegativo = fundoDoDado < 0;

  // Eixo assimétrico de propósito: ticks positivos cobrem o topo, ticks
  // negativos cobrem a profundidade. Reservar espaço para um lado que o dado
  // não tem achataria o lado que ele tem.
  const ticksAcima = ticksArredondados(topoDoDado, 2);
  const ticksAbaixo = ticksArredondados(Math.abs(fundoDoDado), 2);
  const maxEixo = ticksAcima.length > 0 ? ticksAcima[ticksAcima.length - 1] : 0;
  const minEixo = ticksAbaixo.length > 0 ? -ticksAbaixo[ticksAbaixo.length - 1] : 0;
  const tudoNoZero = maxEixo === 0 && minEixo === 0;
  const amplitude = Math.max(1, maxEixo - minEixo); // guarda de divisão

  const ticks = tudoNoZero
    ? [0]
    : [...new Set([...ticksAbaixo.map(t => -t), ...ticksAcima])].sort((a, b) => b - a);

  // Margem esquerda MEDIDA no rótulo mais largo, e não fixa em 56px como nos
  // gráficos irmãos: este é o único com tick negativo, e o sinal de menos faz
  // "R$ -100 mil" estourar os 56px a 375px — o rótulo saía pela borda esquerda
  // do viewBox, onde ninguém o vê e nada avisa.
  const padEsquerda = Math.min(
    Math.ceil(ticks.reduce((maior, t) => Math.max(maior, formatarEixoBRL(t).length * LARGURA_CARACTERE), 0)) +
      RESPIRO_DO_EIXO,
    Math.round(largura * 0.4),
  );
  const larguraPlot = Math.max(1, largura - padEsquerda - PADDING_DIR);

  const base = PADDING_TOPO + alturaPlot;

  // Janelas igualmente espaçadas, não proporcionais ao número de dias: o eixo
  // aqui é a LISTA de janelas que o financeiro pergunta (7, 15, 30, 60, 90) e
  // não uma reta do tempo. Espaçar por dias colaria 7d e 15d num amontoado e
  // daria metade da largura ao vão entre 60d e 90d, que é o trecho de que
  // menos se sabe.
  const passo = nodos.length > 1 ? larguraPlot / (nodos.length - 1) : 0;
  const x = (indice: number) => padEsquerda + indice * passo;
  const y = (v: number) =>
    tudoNoZero ? base : PADDING_TOPO + ((maxEixo - num(v)) / amplitude) * alturaPlot;

  const yZero = y(0);

  // M x0 y0 H x1 V y1 H x2 V y2 … — o saldo só muda quando a janela vira.
  const partes: string[] = [`M ${x(0)} ${y(nodos[0].saldo)}`];
  nodos.forEach((nodo, i) => {
    if (i === 0) return;
    partes.push(`H ${x(i)}`, `V ${y(nodo.saldo)}`);
  });
  const caminho = partes.join(' ');
  // A área fecha na LINHA DE ZERO, não na borda de baixo: é o que faz o pedaço
  // negativo cair para baixo do zero em vez de ficar de cabeça para cima num
  // trilho que não significa nada.
  const area = `${caminho} V ${yZero} H ${x(0)} Z`;

  const alvos: AlvoDeToque[] = nodos.map((nodo, i) => {
    // O alvo é meio vão para cada lado, cortado nas bordas do SVG: sem o corte,
    // com duas ou três janelas o vão passa de 100px e o alvo da ponta invade o
    // vizinho — dois alvos sobrepostos e o balão respondendo pelo errado.
    const esquerda = Math.max(0, x(i) - passo / 2);
    const direita = Math.min(largura, x(i) + passo / 2);
    const quando = dataCurta(nodo.data);
    return {
      id: nodo.dias === 0 ? 'hoje' : `j-${nodo.dias}`,
      x: esquerda,
      y: PADDING_TOPO,
      w: Math.max(1, direita - esquerda),
      h: alturaPlot,
      titulo: quando ? `${nodo.rotulo} · ${quando}` : nodo.rotulo,
      // Sem entradas e saídas o balão diz só o saldo. Escrever "entram R$ 0,00"
      // no lugar de um dado que não veio é afirmar movimento nenhum, que é uma
      // afirmação — e diferente de "não sei".
      linhas:
        nodo.entradas === null || nodo.saidas === null
          ? [`saldo ${formatar(nodo.saldo)}`]
          : [
              `entram ${formatar(nodo.entradas)}`,
              `saem ${formatar(nodo.saidas)}`,
              `saldo projetado ${formatar(nodo.saldo)}`,
            ],
      onAtivar: onAtivar && nodo.dias > 0 ? () => onAtivar(nodo.dias) : undefined,
    };
  });

  const posicaoPorId = new Map(alvos.map((alvo, i) => [alvo.id, x(i)]));
  const ultimo = nodos[nodos.length - 1];
  const primeiroNegativo = nodos.find(n => n.saldo < 0) ?? null;

  const desfecho = !primeiroNegativo
    ? ', sem cruzar o zero em nenhuma janela.'
    : primeiroNegativo.dias === 0
      ? `, partindo já negativo hoje (${formatar(nodos[0].saldo)}).`
      : `, cruzando o zero na janela de ${primeiroNegativo.rotulo} (${formatar(primeiroNegativo.saldo)}).`;
  const leitura = `Se tudo que já está lançado acontecer, o saldo sai de ${formatar(nodos[0].saldo)} hoje e chega a ${formatar(ultimo.saldo)} em ${ultimo.rotulo}${desfecho}`;

  // Rótulo da ponta: acima do ponto quando há teto, abaixo quando não há.
  // Fixá-lo acima e apenas travar no topo faria o texto pousar sobre o marcador.
  const yDoUltimo = y(ultimo.saldo);
  const yDoRotulo =
    yDoUltimo - 10 >= PADDING_TOPO ? yDoUltimo - 10 : Math.min(yDoUltimo + 18, base - 2);

  return (
    <svg
      className="fin-grafico-svg block"
      width={largura}
      height={altura}
      viewBox={`0 0 ${largura} ${altura}`}
      role="img"
    >
      {/* O título nomeia a janela QUE EXISTE: fixá-lo em "7 a 90 dias" mentiria
          no dia em que a tela passar a mostrar 30 e 60. */}
      <title>{`Projeção de caixa, de hoje até ${ultimo.rotulo}`}</title>
      <desc>{leitura}</desc>

      <defs>
        {/* Dois recortes sobre a MESMA área: acima do zero ela é leve, abaixo é
            densa. Recortar evita desenhar dois polígonos que discordam de um
            pixel na fronteira, que é justo onde a leitura acontece. */}
        <clipPath id={recortePositivo}>
          <rect x={0} y={0} width={largura} height={Math.max(0, yZero)} />
        </clipPath>
        <clipPath id={recorteNegativo}>
          <rect x={0} y={Math.max(0, yZero)} width={largura} height={Math.max(0, altura - yZero)} />
        </clipPath>
      </defs>

      {/* Grade: fios SÓLIDOS e recuados. Tracejado, neste sistema, é ausência. */}
      {ticks.map(t => (
        <g key={t}>
          <line
            x1={padEsquerda}
            x2={largura - PADDING_DIR}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--fin-grade)"
            strokeWidth={1}
          />
          <text
            x={padEsquerda - 8}
            y={y(t) + 4}
            textAnchor="end"
            className="fin-t-caption tabular-nums"
            fill="var(--fin-text-3)"
          >
            {/* Abreviação vive só no tick: no rótulo de valor a pessoa veio
                conferir o número exato. */}
            {formatarEixoBRL(t)}
          </text>
        </g>
      ))}

      {haNegativo ? (
        <>
          <path
            d={area}
            fill="var(--fin-serie-1)"
            fillOpacity={TINTA_ACIMA}
            clipPath={`url(#${recortePositivo})`}
          />
          {/* Mesmo matiz, mais tinta: é o mesmo dado num pedaço que pesa mais.
              Trocar de cor aqui gastaria um token de estado dentro do gráfico. */}
          <path
            d={area}
            fill="var(--fin-serie-1)"
            fillOpacity={TINTA_ABAIXO}
            clipPath={`url(#${recorteNegativo})`}
          />
        </>
      ) : (
        // Sem negativo não há por que recortar: o recorte cortaria pela metade
        // o traço de 2px que encosta na linha de base.
        <path d={area} fill="var(--fin-serie-1)" fillOpacity={TINTA_ACIMA} />
      )}

      {/* A linha é UMA só, inteira e sem recorte: ela é uma série, não duas. */}
      <path
        d={caminho}
        fill="none"
        stroke="var(--fin-serie-1)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Linha de zero: só existe quando há negativo, e aí ela é a fronteira que
          o olho procura. Sólida de 1px, como todo eixo do sistema. */}
      {haNegativo ? (
        <line
          x1={padEsquerda}
          x2={largura - PADDING_DIR}
          y1={yZero}
          y2={yZero}
          stroke="var(--fin-eixo)"
          strokeWidth={1}
        />
      ) : null}

      {/* Marcador por janela, sempre do mesmo tamanho: crescer o ponto do mês
          ruim mentiria sobre o valor. O anel da superfície impede que ele suma
          quando dois degraus ficam colados. */}
      {nodos.map((nodo, i) => (
        <circle
          key={nodo.dias}
          cx={x(i)}
          cy={y(nodo.saldo)}
          r={4}
          fill="var(--fin-serie-1)"
          stroke="var(--fin-surface)"
          strokeWidth={2}
        />
      ))}

      {/* Rótulo direto só na ponta: um número por ponto vira ruído, e o resto
          está a um toque de distância no balão. Valor CHEIO, nunca abreviado. */}
      <text
        x={largura - PADDING_DIR}
        y={yDoRotulo}
        textAnchor="end"
        className="fin-t-caption tabular-nums"
        fill="var(--fin-text-2)"
      >
        {formatar(ultimo.saldo)}
      </text>

      {/* Eixo x: uma etiqueta por janela. A janela que está no vermelho ganha
          tom de texto forte — peso, não matiz, porque quem imprime em cinza e
          quem não distingue vermelho continuam lendo. */}
      {nodos.map((nodo, i) => (
        <text
          key={`eixo-${nodo.dias}`}
          x={x(i)}
          y={altura - 6}
          textAnchor={i === 0 ? 'start' : i === nodos.length - 1 ? 'end' : 'middle'}
          className="fin-t-caption"
          fill={nodo.saldo < 0 ? 'var(--fin-text)' : 'var(--fin-text-3)'}
        >
          {nodo.rotulo}
        </text>
      ))}

      {/* A camada de toque é sempre a ÚLTIMA dentro do <svg>: qualquer coisa
          desenhada depois dela roubaria o ponteiro e o gráfico ficaria mudo. */}
      <CamadaDeToque
        alvos={alvos}
        larguraSvg={largura}
        alturaSvg={altura}
        crosshair={{ x: id => posicaoPorId.get(id) ?? Number.NaN, altura }}
      />
    </svg>
  );
}

export function ProjecaoDeCaixa({
  saldoHoje,
  dataDeHoje,
  pontos,
  formatar,
  altura = 180,
  onAtivar,
}: ProjecaoDeCaixaProps) {
  const nodos = React.useMemo<Nodo[]>(() => {
    // Janela sem dias, com dias <= 0 ou repetida sai fora. Repetida não é
    // detalhe: duas janelas de 30d gerariam dois alvos com o mesmo id, e o
    // balão e o crosshair passariam a responder sempre pela última.
    const vistos = new Set<number>();
    const ordenados = [...(pontos ?? [])]
      .map(p => ({ ...p, dias: Math.round(num(p?.dias)) }))
      .filter(p => p.dias > 0)
      .sort((a, b) => a.dias - b.dias)
      .filter(p => {
        if (vistos.has(p.dias)) return false;
        vistos.add(p.dias);
        return true;
      });

    // Hoje é um nodo como os outros para a escala e para o traço, mas não tem
    // entradas nem saídas: é um saldo medido, não uma janela somada. Os nulos
    // aqui dizem AUSÊNCIA de movimento a somar, não movimento zero. A data vem
    // por prop: herdar a data da primeira janela faria o balão de hoje exibir
    // uma data que não é hoje.
    const hoje: Nodo = {
      dias: 0,
      data: String(dataDeHoje ?? ''),
      rotulo: 'hoje',
      entradas: null,
      saidas: null,
      saldo: round2(num(saldoHoje)),
    };
    return [
      hoje,
      ...ordenados.map<Nodo>(p => ({
        dias: p.dias,
        data: String(p.data ?? ''),
        rotulo: rotuloDaJanela(p.dias),
        entradas: dinheiroOuAusencia(p.entradas),
        saidas: dinheiroOuAusencia(p.saidas),
        saldo: round2(num(p.saldoProjetado)),
      })),
    ];
  }, [pontos, saldoHoje, dataDeHoje]);

  const primeiroNegativo = React.useMemo(
    () => nodos.find(n => n.dias > 0 && n.saldo < 0) ?? null,
    [nodos],
  );

  // Sem janela VÁLIDA não há projeção: o saldo de hoje sozinho é um número que
  // já está no cartão de métrica ao lado, e desenhá-lo aqui seria inventar um
  // gráfico para não deixar o espaço vazio. O portão olha os nodos, não os
  // pontos crus — uma lista só de janelas inválidas também não é projeção.
  if (nodos.length < 2) return null;

  const negativoHoje = nodos[0].saldo < 0;
  const quandoVira = primeiroNegativo ? dataCurta(primeiroNegativo.data) : '';

  // O aviso é um Callout: a cor de estado mora no componente de aviso, nunca
  // dentro do desenho. Ícone e frase carregam o significado; a cor só reforça.
  const alarme =
    negativoHoje || primeiroNegativo ? (
      <Callout
        tom="negativo"
        titulo={negativoHoje ? 'O caixa já está negativo hoje' : 'O caixa fica negativo antes do fim do período'}
      >
        {negativoHoje ? (
          <>
            Saldo de hoje:{' '}
            <span className="tabular-nums font-semibold">{formatar(nodos[0].saldo)}</span>.
          </>
        ) : (
          <>
            Na janela de {primeiroNegativo!.rotulo}
            {quandoVira ? ` (até ${quandoVira})` : ''} o saldo projetado é{' '}
            <span className="tabular-nums font-semibold">{formatar(primeiroNegativo!.saldo)}</span>.
          </>
        )}
      </Callout>
    ) : null;

  // Uma janela só: o desenho seria um degrau entre dois pontos, ou seja, dois
  // números com tinta em volta — e uma reta ligando dois pontos já sugere
  // trajetória. A frase diz o mesmo sem sugerir nada.
  if (nodos.length === 2) {
    const unica = nodos[1];
    const quando = dataCurta(unica.data);
    return (
      <div className="flex flex-col gap-2">
        <p className="fin-t-body text-[var(--fin-text-2)]">
          Hoje:{' '}
          <span className="tabular-nums text-[var(--fin-text)]">{formatar(nodos[0].saldo)}</span>. Em{' '}
          {unica.rotulo}
          {quando ? ` (${quando})` : ''}, se tudo que já está lançado acontecer:{' '}
          <span className="tabular-nums text-[var(--fin-text)]">{formatar(unica.saldo)}</span>.
        </p>
        {alarme}
        <p className="fin-t-caption text-[var(--fin-text-3)]">{AVISO_DE_ARITMETICA}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <AreaDeGrafico>
        {largura => (
          <Desenho
            largura={largura}
            altura={altura}
            nodos={nodos}
            formatar={formatar}
            onAtivar={onAtivar}
          />
        )}
      </AreaDeGrafico>

      {alarme}

      {/* O aviso de aritmética fecha o gráfico SEMPRE, com ou sem alarme. */}
      <p className="fin-t-caption text-[var(--fin-text-3)]">{AVISO_DE_ARITMETICA}</p>
    </div>
  );
}

export default ProjecaoDeCaixa;
