'use client';

import * as React from 'react';
import { CircleCheck, CircleDashed, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';

import { ALVO_MIN, RAIO_PONTA, RESPIRO, TRACEJADO_AUSENCIA, escalaLinear } from '@/lib/escala';
import { ORDEM_DE_GRAVIDADE } from '@/lib/dashboard-insights';
import { AreaDeGrafico } from '@/components/fin/GraficoMoldura';

/**
 * "Como está a saúde financeira da minha agência?" respondido em três segundos,
 * SEM inventar uma nota.
 *
 * POR QUE NÃO EXISTE VELOCÍMETRO AQUI. Um score único honesto precisaria de dois
 * insumos que este sistema não tem no banco: tributo provisionado e despesa
 * recorrente confiável. Sem eles, qualquer "82/100" seria um número de aparência
 * científica com pesos escolhidos por quem escreveu o componente — e o dono
 * tomaria decisão de contratar, comprar e parcelar em cima dele. Um número
 * errado com duas casas decimais é mais perigoso que nenhum número.
 *
 * O QUE ENTRA NO LUGAR. Fatores NOMEADOS: cada um com o seu valor, a sua faixa e
 * uma frase que diz o que ele significa. A classificação geral é uma REGRA
 * VISÍVEL — é a faixa do PIOR fator, e o painel escreve isso na tela. Assim o
 * veredito é auditável: quem lê consegue apontar o fator que o produziu, em vez
 * de confiar num peso escondido. É também por isso que o painel não soma, não
 * pondera e não ordena os fatores: a ordem que chega é a ordem que o dono lê.
 *
 * CORES E O QUE ELAS PODEM DIZER. As zonas da régua são a rampa ORDINAL
 * (--fin-seq-1..3), porque risco → atenção → bom é uma progressão; a marca é
 * --fin-serie-1, porque ela é a medida, não o julgamento. O JULGAMENTO nunca sai
 * de cor sozinha: vem sempre de ícone com silhueta própria (círculo, triângulo,
 * octógono, círculo tracejado) MAIS a palavra escrita. Daltônico, impressão em
 * preto e branco e captura de tela em escala de cinza leem exatamente a mesma
 * coisa. A cor de estado (--fin-positive/warning/negative) aparece só no ÍCONE
 * do veredito, que é o único lugar onde ela significa o que o token diz —
 * estado. Nenhuma marca de gráfico e nenhum texto é pintado com ela.
 *
 * O QUE A RÉGUA SE RECUSA A DESENHAR. Sem base, sem marca: "não sei" e "zero"
 * são coisas diferentes, e pôr a marca no começo diria "está no pior lugar
 * possível". Sem largura para as três zonas, sem régua: com o respiro comendo as
 * duas primeiras, sobraria só a zona 'bom' pintada de ponta a ponta, e uma régua
 * inteiramente verde é uma afirmação — a pior possível, porque é a tranquila.
 *
 * NO PAPEL a régua some (.fin-grafico-svg) e o resto continua de pé: nome,
 * valor, palavra da faixa e leitura são HTML, não desenho. A folha impressa
 * perde a posição e não perde o veredito.
 */

export type FaixaDeSaude = 'bom' | 'atencao' | 'risco' | 'sem-base';

export type FatorDeSaude = {
  id: string;
  nome: string;
  /** O número já formatado: "0,6 mês", "18,2%", "R$ 12.400". */
  valor: string;
  faixa: FaixaDeSaude;
  /** Por que este fator está nesta faixa, em uma frase de dono. */
  leitura: string;
  /** Posição na régua de 0 a 1 para a marca, ou null quando não há base. */
  posicao: number | null;
};

export type PainelDeSaudeProps = {
  fatores: FatorDeSaude[];
  onAtivar?: (id: string) => void;
};

/**
 * Onde a régua vira outra faixa. Exportado de propósito: quem calcula `posicao`
 * precisa normalizar o domínio real (meses de reserva, % de margem) contra ESTES
 * números. Se a tela normalizar por conta própria com 0,3 e 0,7, a marca cai na
 * zona errada e o desenho passa a contradizer a palavra ao lado dele.
 */
export const FRONTEIRAS_DA_REGUA = [1 / 3, 2 / 3] as const;

/**
 * A régua é desenhada em três zonas iguais. As fronteiras do NEGÓCIO (2 meses de
 * reserva, 15% de margem) vivem em quem calcula; aqui elas chegam já traduzidas
 * para esta moldura fixa. Uma régua com zonas de tamanhos variáveis por fator
 * daria a cinco linhas cinco escalas diferentes empilhadas — e comparar linhas
 * empilhadas é justamente o que o olho faz sem pedir licença.
 */
const ZONAS: Array<{ faixa: Exclude<FaixaDeSaude, 'sem-base'>; cor: string }> = [
  { faixa: 'risco', cor: 'var(--fin-seq-1)' },
  { faixa: 'atencao', cor: 'var(--fin-seq-2)' },
  { faixa: 'bom', cor: 'var(--fin-seq-3)' },
];

/**
 * A ordem de gravidade que decide o veredito, escrita uma vez só.
 *
 * 'sem-base' fica ACIMA de 'bom' e ABAIXO de 'atencao', e as duas decisões têm
 * razão: com um fator sem base o painel não pode dizer "Saudável", porque não
 * olhou tudo; mas um risco medido continua sendo a manchete, porque ele é fato e
 * o outro é ausência.
 */
// A ordem vem do módulo de insights, que é quem também alimenta o chip da
// manchete. Duas tabelas iguais em dois arquivos divergem na primeira
// manutenção, e a tela passa a dizer duas coisas sobre a mesma agência.
const GRAVIDADE = ORDEM_DE_GRAVIDADE;

const VEREDITO: Record<
  FaixaDeSaude,
  { palavra: string; curto: string; icone: LucideIcon; corDoIcone: string }
> = {
  // status-ok: aqui a cor É o estado, e vem junto de ÍCONE e PALAVRA — nunca sozinha.
  bom: { palavra: 'Saudável', curto: 'bom', icone: CircleCheck, corDoIcone: 'var(--fin-positive)' },
  // status-ok: veredito, não série
  atencao: { palavra: 'Atenção', curto: 'atenção', icone: TriangleAlert, corDoIcone: 'var(--fin-warning-text)' },
  // status-ok: veredito, não série
  risco: { palavra: 'Risco', curto: 'risco', icone: OctagonAlert, corDoIcone: 'var(--fin-negative-text)' },
  'sem-base': {
    palavra: 'Sem base suficiente',
    curto: 'sem base',
    icone: CircleDashed,
    corDoIcone: 'var(--fin-text-3)',
  },
};

/** Altura da régua e da marca. A marca é maior que o trilho de propósito: ela
 *  precisa ser achável de relance numa lista de cinco linhas. */
const ALTURA_TRILHO = 8;
const RAIO_MARCA = 5; // marca de 10px
const ANEL_MARCA = 2; // o anel que separa a marca da zona embaixo dela
/**
 * O raio VISUAL da marca. O traço do SVG é centrado no caminho, então o anel de
 * 2px sobra 1px para fora do círculo: quem manda no recuo é este número, não o
 * raio. Recuar só RAIO_MARCA cortava 1px do anel justamente nas posições 0 e 1,
 * que são as duas que o recuo existe para proteger.
 */
const RAIO_VISUAL_DA_MARCA = RAIO_MARCA + ANEL_MARCA / 2;
const ALTURA_SVG = 14; // trilho (8) + o anel da marca sobrando 3px de cada lado
const TOPO_TRILHO = (ALTURA_SVG - ALTURA_TRILHO) / 2;
const CENTRO = ALTURA_SVG / 2;
/**
 * Menor zona que ainda é uma zona: o respiro que ela desconta mais uma ponta
 * arredondada. Abaixo disto as duas primeiras zonas viram largura zero, somem, e
 * a régua passa a mostrar só 'bom' de ponta a ponta.
 */
const LARGURA_MINIMA_DA_ZONA = RESPIRO + RAIO_PONTA;

/**
 * Ponta arredondada só nas extremidades da régua. As fronteiras internas ficam
 * retas porque é ali que a faixa troca: arredondá-las sugeriria três medidas
 * separadas em vez de uma escala contínua.
 */
function caminhoDaZona(x: number, w: number, esquerda: boolean, direita: boolean): string {
  if (w <= 0) return '';
  const r = Math.min(RAIO_PONTA, w / 2, ALTURA_TRILHO / 2);
  const y = TOPO_TRILHO;
  const b = TOPO_TRILHO + ALTURA_TRILHO;
  if (r <= 0 || (!esquerda && !direita)) return `M ${x} ${y} H ${x + w} V ${b} H ${x} Z`;
  const e = esquerda ? r : 0;
  const d = direita ? r : 0;
  return [
    `M ${x + e} ${y}`,
    `H ${x + w - d}`,
    d ? `A ${d} ${d} 0 0 1 ${x + w} ${y + d}` : '',
    `V ${b - d}`,
    d ? `A ${d} ${d} 0 0 1 ${x + w - d} ${b}` : '',
    `H ${x + e}`,
    e ? `A ${e} ${e} 0 0 1 ${x} ${b - e}` : '',
    `V ${y + e}`,
    e ? `A ${e} ${e} 0 0 1 ${x + e} ${y}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * A faixa que a POSIÇÃO desenhada afirma. Serve para conferir, em
 * desenvolvimento, se o desenho e a palavra estão contando a mesma história.
 *
 * Devolve null para não-finito de propósito. Com `NaN` as duas comparações `<`
 * são falsas e a função cairia em 'bom' pelo fim da escada — um NaN entraria na
 * conferência disfarçado da melhor faixa possível, e a única coisa pior que não
 * conferir é conferir errado para o lado tranquilo.
 */
function faixaDaPosicao(posicao: number): Exclude<FaixaDeSaude, 'sem-base'> | null {
  if (!Number.isFinite(posicao)) return null;
  const p = Math.min(1, Math.max(0, posicao));
  if (p < FRONTEIRAS_DA_REGUA[0]) return 'risco';
  if (p < FRONTEIRAS_DA_REGUA[1]) return 'atencao';
  return 'bom';
}

function Regua({
  largura,
  fator,
}: {
  largura: number;
  fator: FatorDeSaude;
}) {
  const idTitulo = React.useId();
  const idDesc = React.useId();

  // A régua recua o raio visual da marca nas duas pontas para que a posição 0 e a
  // posição 1 caibam inteiras, anel incluído. Sem esse recuo a marca precisaria
  // ser empurrada para dentro nas extremidades, e empurrar a marca é mover o
  // valor.
  const inicio = RAIO_VISUAL_DA_MARCA;
  const util = Math.max(1, largura - RAIO_VISUAL_DA_MARCA * 2);
  const larguraDaZona = util / ZONAS.length;

  const semBase = fator.faixa === 'sem-base';
  // Fator com faixa normal e posição nula também fica sem marca: "não sei" e
  // "zero" são coisas diferentes, e desenhar a marca no começo da régua diria
  // "está no pior lugar possível" quando o certo é não dizer nada.
  // Number.isFinite e não só `!== null`: um NaN vindo de uma divisão por zero lá
  // atrás viraria cx="NaN" e a marca sumiria sem deixar rastro, que é pior do que
  // a ausência declarada. E `num()` lá dentro da escala transformaria esse NaN em
  // zero, que é a mentira do parágrafo acima — por isso o guarda vem ANTES dela.
  const posicao =
    semBase || fator.posicao === null || !Number.isFinite(fator.posicao) ? null : fator.posicao;
  // A escala é a do sistema, mesmo sendo de 0 a 1: é ela que clampa nas duas
  // pontas, e uma régua com clamp próprio é a sétima régua que este projeto
  // combinou de não ter.
  const paraPx = escalaLinear(1, util);
  const cx = posicao === null ? null : inicio + paraPx(posicao);

  const curto = VEREDITO[fator.faixa].curto;
  const descricao = semBase
    ? `${fator.nome} está em ${fator.valor} e ainda não tem base para entrar na régua.`
    : posicao === null
      ? `${fator.nome} está em ${fator.valor}, faixa ${curto}, sem posição conhecida na régua.`
      : `Na régua que vai de risco a bom, ${fator.nome} marca ${fator.valor} e cai na faixa ${curto}.`;

  // Régua estreita demais para as três zonas não vira régua. Com larguraDaZona
  // abaixo do respiro, as duas primeiras desapareceriam e a última seria pintada
  // de ponta a ponta: um trilho inteiro na cor de 'bom', que afirma exatamente o
  // contrário do que um fator em risco precisa mostrar. Nome, valor, palavra da
  // faixa e leitura continuam em HTML acima e abaixo deste espaço.
  if (!semBase && larguraDaZona < LARGURA_MINIMA_DA_ZONA) return null;

  return (
    <svg
      className="fin-grafico-svg block"
      width={largura}
      height={ALTURA_SVG}
      viewBox={`0 0 ${largura} ${ALTURA_SVG}`}
      role="img"
      aria-labelledby={idTitulo}
      aria-describedby={idDesc}
    >
      <title id={idTitulo}>{`Régua de ${fator.nome}`}</title>
      <desc id={idDesc}>{descricao}</desc>

      {/* O trilho fica atrás das zonas e tem EXATAMENTE a extensão delas: é ele
          que aparece nos 2px de respiro e mantém a fronteira entre faixas
          visível. Esticá-lo até a borda do SVG faria sobrar trilho depois do fim
          da zona 'bom', e a marca em 1 pareceria não ter chegado ao fim. */}
      <rect
        x={inicio}
        y={TOPO_TRILHO}
        width={util}
        height={ALTURA_TRILHO}
        rx={RAIO_PONTA}
        fill="var(--fin-surface-sunken)"
      />

      {semBase ? (
        // Régua cinza e tracejada. Tracejado, neste sistema, só quer dizer uma
        // coisa: ausência de dado. É exatamente o caso.
        <>
          <rect
            x={inicio + 0.5}
            y={TOPO_TRILHO + 0.5}
            width={Math.max(1, util - 1)}
            height={ALTURA_TRILHO - 1}
            rx={RAIO_PONTA}
            fill="none"
            stroke="var(--fin-eixo)"
            strokeWidth={1}
          />
          <line
            x1={inicio}
            x2={inicio + util}
            y1={CENTRO}
            y2={CENTRO}
            stroke="var(--fin-eixo)"
            strokeWidth={1}
            strokeDasharray={TRACEJADO_AUSENCIA}
          />
        </>
      ) : (
        ZONAS.map((zona, i) => {
          const x = inicio + i * larguraDaZona;
          // O respiro sai da zona, nunca da escala: a última não desconta, senão
          // a régua encolheria e as fronteiras sairiam do lugar.
          const w = i === ZONAS.length - 1 ? larguraDaZona : Math.max(0, larguraDaZona - RESPIRO);
          const d = caminhoDaZona(x, w, i === 0, i === ZONAS.length - 1);
          return d ? <path key={zona.faixa} d={d} fill={zona.cor} /> : null;
        })
      )}

      {/* A marca é a MEDIDA, por isso sai da paleta de série e não da rampa das
          zonas. O anel da superfície evita que ela desapareça dentro da zona
          mais escura, que muda de ponta conforme o tema. */}
      {cx !== null ? (
        <circle
          cx={cx}
          cy={CENTRO}
          r={RAIO_MARCA}
          fill="var(--fin-serie-1)"
          stroke="var(--fin-surface)"
          strokeWidth={ANEL_MARCA}
        />
      ) : null}
    </svg>
  );
}

function LinhaDeFator({ fator, onAtivar }: { fator: FatorDeSaude; onAtivar?: (id: string) => void }) {
  const { palavra, curto, icone: Icone, corDoIcone } = VEREDITO[fator.faixa];
  const clicavel = typeof onAtivar === 'function';

  const conteudo = (
    <>
      <div className="flex w-full items-baseline justify-between gap-3">
        {/* break-words e não truncate: "Cobertura de despesa fixa" em 375px tem
            que caber inteiro, e cortar o nome de um fator com reticências esconde
            justamente qual dos cinco está falando. */}
        <span className="fin-t-body-strong min-w-0 break-words text-[var(--fin-text)]">{fator.nome}</span>
        {/* tabular-nums porque os valores das linhas se alinham em coluna. */}
        <span className="fin-t-body-strong shrink-0 tabular-nums text-[var(--fin-text)]">{fator.valor}</span>
      </div>

      {/* Altura reservada do lado de fora e AMARRADA em ALTURA_SVG: antes da
          primeira medição a AreaDeGrafico reserva 120px, e cinco linhas
          reservando 120px dariam um salto de meia tela a cada montagem. Amarrada
          e não escrita como literal porque um `h-[14px]` solto continua
          compilando depois que ALTURA_SVG muda — e aí ele corta a régua em
          silêncio, que é o tipo de defeito que este arquivo existe para não ter. */}
      <div className="mt-2 overflow-hidden" style={{ height: ALTURA_SVG }}>
        <AreaDeGrafico>{largura => <Regua largura={largura} fator={fator} />}</AreaDeGrafico>
      </div>

      <p className="fin-t-caption mt-1.5 flex items-start gap-1.5 text-[var(--fin-text-2)]">
        <Icone className="mt-0.5 size-3.5 shrink-0" style={{ color: corDoIcone }} aria-hidden="true" />
        <span className="min-w-0">
          {/* A palavra da faixa vem antes da leitura e em cor de TEXTO: quem
              enxerga a cor ganha velocidade, quem não enxerga não perde nada. */}
          <span className="font-semibold text-[var(--fin-text)]">{curto}</span>
          {' · '}
          {fator.leitura}
        </span>
      </p>
    </>
  );

  const rotulo = `${fator.nome}: ${fator.valor}. ${palavra}. ${fator.leitura}`;

  return (
    <li className="border-b border-[var(--fin-border)] last:border-b-0">
      {clicavel ? (
        <button
          type="button"
          onClick={() => onAtivar?.(fator.id)}
          aria-label={rotulo}
          // ALVO_MIN vem da régua do sistema: alvo de toque não é número que cada
          // componente escolhe.
          style={{ minHeight: ALVO_MIN }}
          className="flex w-full flex-col items-stretch rounded-[var(--fin-r-md)] px-1 py-3 text-left transition-colors hover:bg-[var(--fin-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]"
        >
          {conteudo}
        </button>
      ) : (
        // Sem onAtivar não existe botão: um alvo que não faz nada ensina a pessoa
        // a tocar e não ser atendida. A altura de 44px fica de qualquer jeito,
        // porque no celular ela também é respiro de leitura.
        <div style={{ minHeight: ALVO_MIN }} className="flex flex-col items-stretch px-1 py-3">
          {conteudo}
        </div>
      )}
    </li>
  );
}

export function PainelDeSaude({ fatores, onAtivar }: PainelDeSaudeProps) {
  // Sem fator não há painel. Um quadro com a moldura e nada dentro lê como bug;
  // quem tem um motivo para mostrar ("ainda não há lançamentos") mostra o motivo,
  // e isso é responsabilidade de quem chama, que sabe qual é o motivo.
  const pior = React.useMemo(() => {
    if (fatores.length === 0) return null;
    return fatores.reduce((p, f) => (GRAVIDADE[f.faixa] > GRAVIDADE[p.faixa] ? f : p), fatores[0]);
  }, [fatores]);

  const semBase = React.useMemo(() => fatores.filter(f => f.faixa === 'sem-base'), [fatores]);

  // Conferência de contrato, só em desenvolvimento: a faixa escrita e a zona em
  // que a marca cai precisam concordar. Discordando, a tela mostra a palavra
  // "bom" com a marca na zona vermelha — e o desenho vence a palavra na leitura
  // de três segundos, que é justamente a leitura que este painel existe para dar.
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const vistos = new Set<string>();
    for (const fator of fatores) {
      // Id repetido é chave de lista repetida: o React remonta a linha, o foco do
      // teclado cai e o `key` para de identificar quem é quem.
      if (vistos.has(fator.id)) {
        console.warn(
          `[fin] PainelDeSaude: o id "${fator.id}" aparece mais de uma vez. ` +
            'A chave da lista deixa de identificar a linha e o foco se perde a cada render.',
        );
      }
      vistos.add(fator.id);

      if (fator.faixa === 'sem-base') {
        if (fator.posicao !== null) {
          console.warn(
            `[fin] PainelDeSaude: o fator "${fator.id}" é 'sem-base' e mandou posicao ${fator.posicao}. ` +
              'A marca não será desenhada: sem base não é posição zero.',
          );
        }
        continue;
      }
      if (fator.posicao === null) {
        console.warn(
          `[fin] PainelDeSaude: o fator "${fator.id}" está em '${fator.faixa}' sem posicao. ` +
            'A régua sai sem marca; se a base não existe, a faixa é sem-base.',
        );
        continue;
      }
      // NaN e Infinity têm aviso próprio: sem ele a conferência abaixo diria que
      // eles "caem em bom", e um defeito de divisão lá atrás sairia daqui com
      // atestado de saúde.
      if (!Number.isFinite(fator.posicao)) {
        console.warn(
          `[fin] PainelDeSaude: o fator "${fator.id}" mandou posicao ${fator.posicao}, que não é número. ` +
            'A régua sai sem marca; conserte a divisão que produziu isso.',
        );
        continue;
      }
      if (fator.posicao < 0 || fator.posicao > 1) {
        console.warn(
          `[fin] PainelDeSaude: o fator "${fator.id}" mandou posicao ${fator.posicao}, fora de 0 a 1. ` +
            'A marca vai para a ponta mais próxima; normalize contra FRONTEIRAS_DA_REGUA.',
        );
      }
      const desenhada = faixaDaPosicao(fator.posicao);
      if (desenhada && desenhada !== fator.faixa) {
        console.warn(
          `[fin] PainelDeSaude: o fator "${fator.id}" diz '${fator.faixa}' e a posicao ${fator.posicao} ` +
            `cai na zona '${desenhada}'. Normalize a posição contra FRONTEIRAS_DA_REGUA.`,
        );
      }
    }
  }, [fatores]);

  if (!pior) return null;

  const { palavra, icone: IconeDoVeredito, corDoIcone } = VEREDITO[pior.faixa];
  const todosSemBase = semBase.length === fatores.length;

  // A regra, escrita na tela. É o que torna o veredito auditável: quem lê
  // consegue apontar o fator que o produziu, sem acreditar em peso nenhum.
  //
  // Os dois primeiros ramos existem porque "a classificação é a do pior fator" e
  // "único fator medido" afirmam uma comparação e uma medição que, quando nada
  // tem base, não aconteceram.
  const regra = todosSemBase
    ? fatores.length === 1
      ? `${pior.nome} é o único fator desta conta e ainda não tem base para ser medido.`
      : `Nenhum dos ${fatores.length} fatores tem base para ser medido ainda.`
    : fatores.length === 1
      ? `Há um só fator nesta conta, ${pior.nome}: a classificação é a dele e não olha mais nada.`
      : pior.faixa === 'sem-base'
        ? `A classificação é a do pior fator, e ${pior.nome} ainda não tem base para ser medido.`
        : `A classificação é a do pior fator, e agora o pior é ${pior.nome}.`;

  // Fatores sem base que NÃO decidiram continuam pesando na confiança do
  // veredito, e a pessoa precisa saber disso antes de agir.
  const ressalva =
    pior.faixa !== 'sem-base' && semBase.length > 0
      ? semBase.length === 1
        ? `${semBase[0].nome} ainda não tem base e ficou de fora desta conta.`
        : `${semBase.length} fatores ainda não têm base e ficaram de fora desta conta.`
      : null;

  return (
    <section
      data-fin-saude={pior.faixa}
      className="flex flex-col rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-4"
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <IconeDoVeredito className="size-8 shrink-0" style={{ color: corDoIcone }} aria-hidden="true" />
          {/* A palavra em cor de TEXTO. O ícone já carrega o estado; pintar a
              palavra de vermelho só repetiria o sinal para quem já o recebeu e
              continuaria não dizendo nada para quem não recebe. */}
          <p className="fin-t-resposta min-w-0 text-balance text-[var(--fin-text)]">{palavra}</p>
        </div>
        <p className="fin-t-body text-[var(--fin-text-2)]">{regra}</p>
        {ressalva ? <p className="fin-t-body text-[var(--fin-text-2)]">{ressalva}</p> : null}
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          Não existe nota de 0 a 100 aqui: cada fator é medido por conta própria e o pior deles dá o
          veredito.
        </p>
      </header>

      {/* Legenda da régua, uma vez para a lista toda. Sem ela três tons do mesmo
          matiz são três tons, e o sentido da progressão muda entre o tema claro
          e o escuro. */}
      <p className="fin-t-caption mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--fin-text-3)]">
        <span>Régua:</span>
        {ZONAS.map(zona => (
          <span key={zona.faixa} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-4 shrink-0 rounded-[2px]"
              style={{ background: zona.cor }}
            />
            {VEREDITO[zona.faixa].curto}
          </span>
        ))}
      </p>

      <ul className="mt-1 flex flex-col">
        {fatores.map(fator => (
          <LinhaDeFator key={fator.id} fator={fator} onAtivar={onAtivar} />
        ))}
      </ul>
    </section>
  );
}

export default PainelDeSaude;
