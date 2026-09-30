'use client';

/**
 * A RAZÃO: uma venda agenciada se decompondo até o que fica com a agência.
 *
 * É o elemento de assinatura da landing, e existe porque esta é a verdade
 * mais específica do negócio de quem vai comprar o sistema: numa venda
 * agenciada a maior parte do dinheiro só PASSA pela conta da agência. Um
 * pacote de R$ 20.000 com R$ 16.500 de fornecedores não é faturamento de
 * R$ 20.000, e a agência que trata assim paga imposto sobre repasse e
 * comemora margem que não existe.
 *
 * Por isso o herói da página não é uma frase com degradê: é uma conta. Ela
 * se soma na frente de quem chega, linha a linha, e termina no único número
 * que interessa.
 *
 * Os valores são de um exemplo declarado como exemplo na própria tela. Cada
 * um segue a regra que o sistema aplica de verdade: comissão do vendedor
 * sobre a COMISSÃO da agência (não sobre a venda), taxa da plataforma sobre
 * o valor cobrado do cliente, e ISS sobre a comissão, que é como sai a nota
 * de agenciamento.
 */
import { useEffect, useRef, useState } from 'react';

interface Linha {
  rotulo: string;
  detalhe: string;
  valor: number;
  /** Entradas somam, saídas subtraem. O sinal é o que a linha significa. */
  sinal: 1 | -1;
}

const VENDA = 20000;

const LINHAS: Linha[] = [
  { rotulo: 'Fornecedores', detalhe: 'operadora, aéreo e hotel', valor: 16500, sinal: -1 },
  { rotulo: 'Comissão do vendedor', detalhe: '12% sobre a comissão da agência', valor: 420, sinal: -1 },
  { rotulo: 'Taxa da plataforma', detalhe: '3,99% do valor cobrado no cartão', valor: 798, sinal: -1 },
  { rotulo: 'ISS sobre a comissão', detalhe: '3% — nota de agenciamento', valor: 105, sinal: -1 },
];

const SOBRA = LINHAS.reduce((s, l) => s + l.sinal * l.valor, VENDA);

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** O ritmo da conta: cada linha entra depois da anterior, como quem soma. */
const ATRASO_BASE = 420;
const PASSO = 240;
const ATRASO_TOTAL = ATRASO_BASE + LINHAS.length * PASSO + 180;

export function Razao() {
  const [total, setTotal] = useState<number | null>(null);
  const quadro = useRef<number | null>(null);

  useEffect(() => {
    const menosMovimento =
      typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Quem pediu menos movimento recebe o resultado, não uma animação lenta.
    if (menosMovimento) { setTotal(SOBRA); return; }

    let inicio = 0;
    const duracao = 900;
    const comecar = window.setTimeout(() => {
      const passo = (t: number) => {
        if (!inicio) inicio = t;
        const p = Math.min(1, (t - inicio) / duracao);
        // Desaceleração no fim: o número "assenta" em vez de parar seco.
        const e = 1 - Math.pow(1 - p, 3);
        setTotal(SOBRA * e);
        if (p < 1) quadro.current = window.requestAnimationFrame(passo);
      };
      quadro.current = window.requestAnimationFrame(passo);
    }, ATRASO_TOTAL);

    return () => {
      window.clearTimeout(comecar);
      if (quadro.current) window.cancelAnimationFrame(quadro.current);
    };
  }, []);

  return (
    <figure className="lp-razao m-0 p-6 sm:p-7">
      <figcaption className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-4">
        <span className="lp-eyebrow" style={{ color: 'rgba(230,237,247,0.55)' }}>
          Exemplo · venda agenciada
        </span>
        <span className="lp-num text-[11px]" style={{ color: 'rgba(230,237,247,0.45)' }}>
          nº 1042
        </span>
      </figcaption>

      {/* A entrada: o número grande que todo mundo comemora. */}
      <div
        className="lp-razao-linha flex items-baseline justify-between gap-4 pt-5"
        style={{ animationDelay: '120ms' }}
      >
        <span className="text-[13px]" style={{ color: 'rgba(230,237,247,0.72)' }}>
          Pacote vendido
        </span>
        <span className="lp-num text-[22px] sm:text-[26px]" style={{ color: '#E6EDF7' }}>
          R$ {brl(VENDA)}
        </span>
      </div>

      {/* As saídas, uma a uma. */}
      <div className="mt-4 flex flex-col gap-3">
        {LINHAS.map((l, i) => (
          <div
            key={l.rotulo}
            className="lp-razao-linha flex items-baseline justify-between gap-4"
            style={{ animationDelay: `${ATRASO_BASE + i * PASSO}ms` }}
          >
            <span className="min-w-0">
              <span className="block text-[13px]" style={{ color: 'rgba(230,237,247,0.72)' }}>
                {l.rotulo}
              </span>
              <span className="block text-[11px]" style={{ color: 'rgba(230,237,247,0.4)' }}>
                {l.detalhe}
              </span>
            </span>
            <span className="lp-num shrink-0 text-[15px]" style={{ color: 'rgba(230,237,247,0.82)' }}>
              −R$ {brl(l.valor)}
            </span>
          </div>
        ))}
      </div>

      <div
        className="lp-razao-regua mt-5 h-px w-full"
        style={{ background: 'rgba(230,237,247,0.22)', animationDelay: `${ATRASO_TOTAL - 120}ms` }}
      />

      {/* O único número que interessa.
          No celular ele empilha: lado a lado, "R$" ficava numa linha e
          "2.177,00" na seguinte, que é o pior lugar possível para uma
          quebra — parte o número que a página inteira existe para mostrar. */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <span className="text-[13px] leading-snug sm:max-w-[9.5rem]" style={{ color: 'rgba(230,237,247,0.72)' }}>
          Ficou com a agência
        </span>
        <span className="sm:text-right">
          <span
            className="lp-num block whitespace-nowrap text-[28px] leading-none sm:text-[38px]"
            style={{ color: '#34D399' }}
          >
            R$ {brl(total ?? 0)}
          </span>
          <span className="lp-num mt-1.5 block text-[11px]" style={{ color: 'rgba(230,237,247,0.45)' }}>
            10,9% do que o cliente pagou
          </span>
        </span>
      </div>
    </figure>
  );
}
