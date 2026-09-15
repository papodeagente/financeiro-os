'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { RAIO_PONTA, posicionarRotulosDeMarca } from '@/lib/escala';
import { divSegura, num, round2 } from '@/lib/money';
import { AreaDeGrafico } from '@/components/fin/GraficoMoldura';
import { CamadaDeToque, type AlvoDeToque } from '@/components/fin/CamadaDeToque';

/**
 * UMA medida contra N referências, por REESCALA.
 *
 * POR QUE EXISTE. O Meter do sistema faz Math.min(100, …): ele desenha 100% e
 * 220,4% exatamente iguais, e é o componente que a Folha usa hoje para mostrar
 * a folha sobre o faturamento. Uma folha que custa mais que o dobro do que
 * entrou aparece como uma barra cheia, igualzinha a um mês saudável.
 *
 * A saída é reescalar, não comprimir: a escala é max(base, valor) × 1,06, a
 * medida é sempre um comprimento honesto e a base vira uma MARCA no meio do
 * caminho. Sem dobra com chevron (comprimento partido em duas linhas não se
 * compara: o olho lê a maior metade, não a soma), sem hachura (textura
 * codificando quantidade some em 375px e área hachurada lê como MENOS densa,
 * invertendo a mensagem) e sem eixo comprimido (eixo quebrado numa codificação
 * por comprimento mente exatamente onde a magnitude é a mensagem).
 */

export type MarcaDeReferencia = {
  id: string;
  valor: number;
  /** 'faturamento', 'limite de 40%' — aparece junto da régua. */
  rotulo: string;
  /** A explicação no balão: por que esta referência importa. */
  descricao: string;
};

export type ReguaDeRazaoProps = {
  valor: number;
  rotuloValor: string;
  base: number;
  rotuloBase: string;
  marcas?: MarcaDeReferencia[];
  formatar: (v: number) => string;
  altura?: 12 | 16;
  /** Base zero NÃO apaga o bloco: entra esta frase no lugar da régua. */
  semBase?: { frase: string; acao?: { rotulo: string; href: string } };
  /** Linhas extras do balão da medida: '6 pessoas', '3 vendas'. */
  detalhes?: string[];
  className?: string;
};

/** 6% de folga à direita para o rótulo direto não encostar na borda. */
const FOLGA = 1.06;

function formatarPct(v: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`;
}

function Desenho({
  largura,
  valor,
  rotuloValor,
  base,
  rotuloBase,
  marcas,
  formatar,
  altura,
  detalhes,
}: Required<Pick<ReguaDeRazaoProps, 'valor' | 'rotuloValor' | 'base' | 'rotuloBase' | 'formatar' | 'altura'>> & {
  largura: number;
  marcas: MarcaDeReferencia[];
  detalhes: string[];
}) {
  const todasAsMarcas = React.useMemo<MarcaDeReferencia[]>(
    () => [
      { id: '__base', valor: base, rotulo: rotuloBase, descricao: `${rotuloBase}: ${formatar(base)}` },
      ...marcas,
    ],
    [base, rotuloBase, marcas, formatar],
  );

  const escala = Math.max(num(base), num(valor), ...todasAsMarcas.map(m => num(m.valor))) * FOLGA;
  const emPx = (v: number) => (escala <= 0 ? 0 : Math.min(largura, (num(v) / escala) * largura));

  const larguraDoValor = emPx(valor);
  const razao = round2(divSegura(num(valor), num(base)) * 100);

  // O rótulo da marca alterna acima e abaixo quando duas ficam perto demais.
  const posicoes = posicionarRotulosDeMarca(
    todasAsMarcas.map(m => ({ pct: escala <= 0 ? 0 : (num(m.valor) / escala) * 100 })),
    largura,
  );

  const alturaFaixa = altura + 8; // a marca passa 4px acima e 4px abaixo
  const topoDaBarra = 4;

  const alvos: AlvoDeToque[] = [
    {
      id: '__valor',
      x: 0,
      y: topoDaBarra,
      w: Math.max(1, larguraDoValor),
      h: altura,
      titulo: rotuloValor,
      linhas: [formatar(valor), `${formatarPct(razao)} de ${rotuloBase} (${formatar(base)})`, ...detalhes],
    },
    ...todasAsMarcas.map(marca => ({
      id: marca.id,
      x: Math.max(0, emPx(marca.valor) - 1),
      y: 0,
      w: 2,
      h: alturaFaixa,
      titulo: marca.rotulo,
      linhas: [formatar(marca.valor), marca.descricao],
    })),
  ];

  // Ponta arredondada só do lado do dado; a base fica reta, ancorada no zero.
  const r = Math.min(RAIO_PONTA, larguraDoValor / 2, altura / 2);
  const y0 = topoDaBarra;
  const y1 = topoDaBarra + altura;
  const caminho =
    larguraDoValor <= 0
      ? ''
      : `M 0 ${y0} H ${larguraDoValor - r} A ${r} ${r} 0 0 1 ${larguraDoValor} ${y0 + r} V ${y1 - r} A ${r} ${r} 0 0 1 ${larguraDoValor - r} ${y1} H 0 Z`;

  return (
    <div className="flex flex-col gap-1">
      <svg
        className="fin-grafico-svg block"
        width={largura}
        height={alturaFaixa}
        viewBox={`0 0 ${largura} ${alturaFaixa}`}
        role="img"
      >
        <title>{`${rotuloValor} comparado a ${rotuloBase}`}</title>
        <desc>{`${rotuloValor}: ${formatar(valor)}, ${formatarPct(razao)} de ${rotuloBase} (${formatar(base)}).`}</desc>

        <rect x={0} y={y0} width={largura} height={altura} rx={RAIO_PONTA} fill="var(--fin-surface-sunken)" />
        {caminho ? <path d={caminho} fill="var(--fin-serie-1)" /> : null}

        {todasAsMarcas.map(marca => {
          const x = emPx(marca.valor);
          return (
            <line
              key={marca.id}
              x1={x}
              x2={x}
              y1={0}
              y2={alturaFaixa}
              stroke="var(--fin-eixo)"
              strokeWidth={2}
            />
          );
        })}

        <CamadaDeToque alvos={alvos} larguraSvg={largura} alturaSvg={alturaFaixa} />
      </svg>

      {/* Rótulos das marcas: texto em token de texto, nunca na cor da série. */}
      <div className="relative h-8">
        {todasAsMarcas.map((marca, i) => {
          const x = emPx(marca.valor);
          return (
            <span
              key={marca.id}
              style={{ left: Math.min(Math.max(0, x), Math.max(0, largura - 4)) }}
              className={cn(
                'fin-t-caption absolute -translate-x-1/2 whitespace-nowrap text-[var(--fin-text-3)]',
                posicoes[i] === 'abaixo' ? 'top-4' : 'top-0',
              )}
            >
              {marca.rotulo}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function ReguaDeRazao({
  valor,
  rotuloValor,
  base,
  rotuloBase,
  marcas = [],
  formatar,
  altura = 16,
  semBase,
  detalhes = [],
  className,
}: ReguaDeRazaoProps) {
  // Base zero é o caso COMUM (onze dos doze meses da folha), não a exceção.
  // O bloco não some: some a régua, e a frase assume — apagar o bloco faria a
  // tela perder a própria resposta justamente no mês em que ela mais importa.
  if (!(num(base) > 0)) {
    return (
      <div className={cn('flex flex-col items-start gap-2', className)}>
        <p className="fin-t-body text-[var(--fin-text-2)]">
          {semBase?.frase ?? `Não há ${rotuloBase} neste período, então não há com o que comparar.`}
        </p>
        {semBase?.acao ? (
          <a
            href={semBase.acao.href}
            className="fin-t-body-strong inline-flex h-11 items-center rounded-[var(--fin-r-md)] border border-[var(--fin-border)] px-4 text-[var(--fin-text)] hover:bg-[var(--fin-surface-2)]"
          >
            {semBase.acao.rotulo}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <AreaDeGrafico className={className}>
      {largura => (
        <Desenho
          largura={largura}
          valor={num(valor)}
          rotuloValor={rotuloValor}
          base={num(base)}
          rotuloBase={rotuloBase}
          marcas={marcas}
          formatar={formatar}
          altura={altura}
          detalhes={detalhes}
        />
      )}
    </AreaDeGrafico>
  );
}

export default ReguaDeRazao;
