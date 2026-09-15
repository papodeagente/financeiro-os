'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { RAIO_PONTA, RESPIRO, larguraDaMarca } from '@/lib/escala';
import { divSegura, num, round2, soma } from '@/lib/money';
import { AreaDeGrafico } from '@/components/fin/GraficoMoldura';
import { CamadaDeToque, type AlvoDeToque } from '@/components/fin/CamadaDeToque';

/**
 * Uma barra dividida em partes de um mesmo todo.
 *
 * DUAS DECISÕES QUE MUDAM A LEITURA:
 *
 * 1. FATIA MINÚSCULA NÃO GANHA PISO. Um benefício de R$ 300,00 dentro de
 *    R$ 67.914,19 é 0,44%, cerca de 1,4px numa barra de 327px. Desenhar 3px
 *    ali é proporção distorcida com asterisco na legenda — continua sendo
 *    mentira. Ela desenha na largura real e ganha uma linha-guia de 1px até um
 *    rótulo acima da barra.
 *
 * 2. 2PX DE RESPIRO entre as fatias. Sem eles, duas cores vizinhas de
 *    luminosidade parecida colam e a fronteira some, que é onde a proporção é
 *    lida.
 *
 * O papel 'resto' existe para o repasse a fornecedor: ele é o que SOBRA, não
 * um par comparável. Dar cor de série a ele sugeriria duas coisas do mesmo
 * tipo disputando o mesmo bolo.
 */

export type PapelDaParte = 'serie' | 'resto' | 'seq';

export type Parte = {
  id: string;
  rotulo: string;
  valor: number;
  papel: PapelDaParte;
  /** Só para papel 'seq': qual degrau da rampa sequencial. */
  indiceSeq?: 1 | 2 | 3 | 4;
  /**
   * Só para papel 'serie': qual matiz da paleta categórica, em ordem FIXA.
   * Categoria nominal (rubrica, tipo de contrato) recebe matizes distintos —
   * a rampa sequencial sugeriria uma ordem que não existe entre "encargos" e
   * "benefícios", e um matiz só deixaria quatro fatias indistinguíveis.
   */
  indiceSerie?: 1 | 2 | 3 | 4 | 5 | 6;
  icone?: LucideIcon;
};

export type BarraDeParteProps = {
  /** De 2 a 6. A 7ª é responsabilidade de quem chama — e para PESSOAS não existe. */
  partes: Parte[];
  /** Quando o todo é maior que a soma. É o que dá ESCALA COMUM a duas barras irmãs. */
  total?: number;
  altura?: 12 | 16 | 20;
  /** 'nada a pagar nos próximos 30 dias' — barra vazia continua desenhada. */
  trilhoVazioRotulo?: string;
  formatar: (v: number) => string;
  onAtivar?: (id: string) => void;
  className?: string;
};

function corDaParte(parte: Parte): string {
  if (parte.papel === 'resto') return 'var(--fin-surface-sunken)';
  if (parte.papel === 'seq') return `var(--fin-seq-${parte.indiceSeq ?? 1})`;
  return `var(--fin-serie-${parte.indiceSerie ?? 1})`;
}

/** Ponta arredondada só nas EXTREMIDADES da barra; as internas ficam retas. */
function caminhoDoSegmento(x: number, w: number, altura: number, primeiro: boolean, ultimo: boolean): string {
  const r = Math.min(RAIO_PONTA, w / 2, altura / 2);
  if (w <= 0) return '';
  if (r <= 0 || (!primeiro && !ultimo)) return `M ${x} 0 H ${x + w} V ${altura} H ${x} Z`;
  const e = primeiro ? r : 0;
  const d = ultimo ? r : 0;
  return [
    `M ${x + e} 0`,
    `H ${x + w - d}`,
    d ? `A ${d} ${d} 0 0 1 ${x + w} ${d}` : '',
    `V ${altura - d}`,
    d ? `A ${d} ${d} 0 0 1 ${x + w - d} ${altura}` : '',
    `H ${x + e}`,
    e ? `A ${e} ${e} 0 0 1 ${x} ${altura - e}` : '',
    `V ${e}`,
    e ? `A ${e} ${e} 0 0 1 ${x + e} 0` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}

function Desenho({
  largura,
  partes,
  total,
  altura,
  formatar,
  onAtivar,
}: {
  largura: number;
  partes: Parte[];
  total: number;
  altura: number;
  formatar: (v: number) => string;
  onAtivar?: (id: string) => void;
}) {
  const alturaSvg = altura + 12; // espaço para a linha-guia da fatia minúscula

  const segmentos = partes.reduce<
    Array<{ parte: Parte; inicio: number; w: number; px: number; minuscula: boolean; primeiro: boolean; ultimo: boolean }>
  >((acc, parte, i) => {
    const anterior = acc[acc.length - 1];
    const inicio = anterior ? anterior.inicio + anterior.px : 0;
    const { px, minuscula } = larguraDaMarca(num(parte.valor), total, largura);
    // O respiro sai da largura do segmento, nunca do valor: a última fatia não
    // desconta, senão a barra inteira encolheria a cada parte adicionada.
    const w = i === partes.length - 1 ? px : Math.max(0, px - RESPIRO);
    acc.push({ parte, inicio, w, px, minuscula, primeiro: i === 0, ultimo: i === partes.length - 1 });
    return acc;
  }, []);

  const alvos: AlvoDeToque[] = segmentos
    .filter(s => s.px > 0)
    .map(s => ({
      id: s.parte.id,
      x: s.inicio,
      y: alturaSvg - altura,
      w: Math.max(1, s.px),
      h: altura,
      titulo: s.parte.rotulo,
      linhas: [
        formatar(s.parte.valor),
        `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(
          round2(divSegura(num(s.parte.valor), total) * 100),
        )}% de ${formatar(total)}`,
      ],
      onAtivar: onAtivar ? () => onAtivar(s.parte.id) : undefined,
    }));

  return (
    <svg
      className="fin-grafico-svg block"
      width={largura}
      height={alturaSvg}
      viewBox={`0 0 ${largura} ${alturaSvg}`}
      role="img"
    >
      <desc>
        {segmentos
          .map(s => `${s.parte.rotulo}: ${formatar(s.parte.valor)}`)
          .join(', ')}
      </desc>

      <g transform={`translate(0 ${alturaSvg - altura})`}>
        <rect x={0} y={0} width={largura} height={altura} rx={RAIO_PONTA} fill="var(--fin-surface-sunken)" />
        {segmentos.map(s => {
          const d = caminhoDoSegmento(s.inicio, s.w, altura, s.primeiro, s.ultimo);
          if (!d) return null;
          return (
            <path
              key={s.parte.id}
              d={d}
              fill={corDaParte(s.parte)}
              // O resto ganha contorno: sem ele, o trilho e a fatia de resto
              // têm a mesma cor e a divisa some.
              stroke={s.parte.papel === 'resto' ? 'var(--fin-eixo)' : 'none'}
              strokeWidth={s.parte.papel === 'resto' ? 1 : 0}
            />
          );
        })}
      </g>

      {/* Linha-guia da fatia pequena demais para ser vista: a barra não cresce,
          o apontador é que aparece. */}
      {segmentos
        .filter(s => s.minuscula)
        .map(s => (
          <line
            key={`guia-${s.parte.id}`}
            x1={s.inicio + s.px / 2}
            x2={s.inicio + s.px / 2}
            y1={0}
            y2={alturaSvg - altura}
            stroke="var(--fin-eixo)"
            strokeWidth={1}
          />
        ))}

      <CamadaDeToque alvos={alvos} larguraSvg={largura} alturaSvg={alturaSvg} onAtivar={onAtivar} />
    </svg>
  );
}

export function BarraDeParte({
  partes,
  total,
  altura = 16,
  trilhoVazioRotulo,
  formatar,
  onAtivar,
  className,
}: BarraDeParteProps) {
  const comValor = React.useMemo(() => partes.filter(p => num(p.valor) > 0), [partes]);
  const somaDasPartes = React.useMemo(() => soma(comValor.map(p => num(p.valor))), [comValor]);
  const todo = round2(Math.max(num(total ?? 0), somaDasPartes));

  // Contrato de API: o todo tem que CONTER as partes. Duas medidas que não se
  // contêm numa escala comum é o defeito que este componente existe para não
  // repetir (folha e faturamento na mesma régua, por exemplo).
  if (process.env.NODE_ENV !== 'production' && total !== undefined && somaDasPartes - num(total) > 0.01) {
    throw new Error(
      `[fin] BarraDeParte: as partes somam ${somaDasPartes} e o total informado é ${total}. ` +
        'Escala comum exige que o todo contenha as partes; medidas independentes pedem dois gráficos.',
    );
  }

  // Barra vazia CONTINUA desenhada: apagá-la faria a comparação com a barra
  // irmã mentir por ausência.
  if (comValor.length === 0) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <div
          className="w-full rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-sunken)]"
          style={{ height: altura }}
          aria-hidden="true"
        />
        <p className="fin-t-caption text-[var(--fin-text-3)]">
          {trilhoVazioRotulo ?? 'nada lançado no período'}
        </p>
      </div>
    );
  }

  // Uma parte só: a barra sai. Uma barra de um segmento é um número com tinta
  // em volta, e ainda sugere uma divisão que não existe.
  if (comValor.length === 1) {
    return (
      <p className={cn('fin-t-body text-[var(--fin-text-2)]', className)}>
        {`Tudo em ${comValor[0].rotulo}: ${formatar(comValor[0].valor)}.`}
      </p>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <AreaDeGrafico>
        {largura => (
          <Desenho
            largura={largura}
            partes={comValor}
            total={todo}
            altura={altura}
            formatar={formatar}
            onAtivar={onAtivar}
          />
        )}
      </AreaDeGrafico>

      {/* Legenda sempre presente com 2+ partes: identidade nunca só por cor. */}
      <ul className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-4">
        {partes.map(parte => {
          const Icone = parte.icone;
          const zerada = !(num(parte.valor) > 0);
          return (
            <li key={parte.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                style={{
                  background: zerada ? 'transparent' : corDaParte(parte),
                  borderColor: parte.papel === 'resto' || zerada ? 'var(--fin-eixo)' : 'transparent',
                }}
              />
              {Icone ? <Icone className="size-3.5 shrink-0 text-[var(--fin-text-3)]" aria-hidden="true" /> : null}
              <span className="fin-t-caption text-[var(--fin-text-2)]">{parte.rotulo}</span>
              {/* Parte zerada some do desenho, não da leitura. */}
              <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">
                {zerada ? 'nenhum lançado' : formatar(parte.valor)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default BarraDeParte;
