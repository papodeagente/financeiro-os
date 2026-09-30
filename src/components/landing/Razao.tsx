'use client';

/**
 * A RAZÃO: os três números que uma agência de viagem confunde.
 *
 * Tese do Bruno (29/09/2026): "Comissão não é lucro. Agência de viagem vive
 * da comissão que recebe pelo que vende; a gestão separa faturamento,
 * comissão e lucro."
 *
 * A confusão é em cadeia, e cada degrau tem um dono diferente:
 *
 *   FATURAMENTO  é o que passou pela conta. A maior parte pertence ao
 *                fornecedor e só está de passagem.
 *   COMISSÃO     é o que ficou da agência. Quase toda agência para de
 *                contar aqui e chama isso de resultado.
 *   LUCRO        é o que sobra depois do vendedor, da plataforma, do
 *                imposto e da parte que aquela venda paga da folha e do
 *                aluguel. É o único dos três que é dinheiro da empresa.
 *
 * Por isso o herói não é uma frase: é essa escada se montando na frente de
 * quem chega. Um número por degrau, em ordem decrescente, e a distância
 * entre o primeiro e o último dizendo sozinha o que a página quer dizer.
 *
 * Os valores são exemplo, declarado como exemplo na tela, e cada linha segue
 * a regra que o sistema aplica de verdade: comissão do vendedor sobre a
 * COMISSÃO da agência (não sobre a venda), taxa da plataforma sobre o valor
 * cobrado do cliente, ISS sobre a comissão — que é como sai a nota de
 * agenciamento — e rateio do custo fixo, que é o que o DRE faz no fim do mês.
 */
import { useEffect, useRef, useState } from 'react';

interface Corte {
  rotulo: string;
  detalhe: string;
  valor: number;
}

/** Primeiro degrau: tudo que o cliente pagou. */
const FATURAMENTO = 20000;

/** Do faturamento até a comissão: o que nunca foi da agência. */
const ATE_COMISSAO: Corte[] = [
  { rotulo: 'Fornecedores', detalhe: 'operadora, aéreo e hotel', valor: 16500 },
];

/** Da comissão até o lucro: o que a agência paga do que é dela. */
const ATE_LUCRO: Corte[] = [
  { rotulo: 'Comissão do vendedor', detalhe: '12% sobre a comissão da agência', valor: 420 },
  { rotulo: 'Taxa da plataforma', detalhe: '3,99% do valor cobrado no cartão', valor: 798 },
  { rotulo: 'ISS sobre a comissão', detalhe: '3% — nota de agenciamento', valor: 105 },
  { rotulo: 'Custo fixo rateado', detalhe: 'folha, aluguel e sistema', valor: 1250 },
];

const soma = (c: Corte[]) => c.reduce((s, x) => s + x.valor, 0);
const COMISSAO = FATURAMENTO - soma(ATE_COMISSAO);
const LUCRO = COMISSAO - soma(ATE_LUCRO);

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pct = (n: number) =>
  ((n / FATURAMENTO) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** O ritmo da escada: cada linha entra depois da anterior, como quem desce. */
const PASSO = 190;
const ATRASO_COMISSAO = 140 + (ATE_COMISSAO.length + 1) * PASSO;
const ATRASO_LUCRO = ATRASO_COMISSAO + (ATE_LUCRO.length + 1) * PASSO;

export function Razao() {
  const [lucro, setLucro] = useState<number | null>(null);
  const quadro = useRef<number | null>(null);

  useEffect(() => {
    const menosMovimento =
      typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (menosMovimento) { setLucro(LUCRO); return; }

    let inicio = 0;
    const duracao = 850;
    const comecar = window.setTimeout(() => {
      const passo = (t: number) => {
        if (!inicio) inicio = t;
        const p = Math.min(1, (t - inicio) / duracao);
        const e = 1 - Math.pow(1 - p, 3);
        setLucro(LUCRO * e);
        if (p < 1) quadro.current = window.requestAnimationFrame(passo);
      };
      quadro.current = window.requestAnimationFrame(passo);
    }, ATRASO_LUCRO);

    return () => {
      window.clearTimeout(comecar);
      if (quadro.current) window.cancelAnimationFrame(quadro.current);
    };
  }, []);

  return (
    <figure className="lp-razao m-0 p-6 sm:p-7">
      <figcaption className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-4">
        <span className="lp-eyebrow" style={{ color: 'rgba(230,237,247,0.55)' }}>
          Exemplo · uma venda
        </span>
        <span className="lp-num text-[11px]" style={{ color: 'rgba(230,237,247,0.45)' }}>
          nº 1042
        </span>
      </figcaption>

      <Degrau
        nome="Faturamento"
        explicacao="o que passou pela conta"
        valor={FATURAMENTO}
        texto={`R$ ${brl(FATURAMENTO)}`}
        cor="rgba(230,237,247,0.92)"
        atraso={140}
        primeiro
      />

      <Cortes itens={ATE_COMISSAO} atrasoBase={140 + PASSO} />

      <Degrau
        nome="Comissão"
        explicacao="o que é da agência"
        valor={COMISSAO}
        texto={`R$ ${brl(COMISSAO)}`}
        cor="rgba(230,237,247,0.92)"
        atraso={ATRASO_COMISSAO}
      />

      <Cortes itens={ATE_LUCRO} atrasoBase={ATRASO_COMISSAO + PASSO} />

      {/* O terceiro degrau é o único que é dinheiro da empresa. */}
      <Degrau
        nome="Lucro"
        explicacao={`${pct(LUCRO)}% do que o cliente pagou`}
        valor={LUCRO}
        texto={`R$ ${brl(lucro ?? 0)}`}
        cor="#34D399"
        atraso={ATRASO_LUCRO - 120}
        destaque
      />
    </figure>
  );
}

function Cortes({ itens, atrasoBase }: { itens: Corte[]; atrasoBase: number }) {
  return (
    <div className="mt-3 flex flex-col gap-2.5 pl-3">
      {itens.map((c, i) => (
        <div
          key={c.rotulo}
          className="lp-razao-linha flex items-baseline justify-between gap-4"
          style={{ animationDelay: `${atrasoBase + i * PASSO}ms` }}
        >
          <span className="min-w-0">
            <span className="block text-[13px]" style={{ color: 'rgba(230,237,247,0.6)' }}>
              {c.rotulo}
            </span>
            <span className="block text-[11px]" style={{ color: 'rgba(230,237,247,0.35)' }}>
              {c.detalhe}
            </span>
          </span>
          <span className="lp-num shrink-0 text-[14px]" style={{ color: 'rgba(230,237,247,0.6)' }}>
            −R$ {brl(c.valor)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Um dos três números. O nome fica maior que o valor cortado logo acima,
 * porque é ele que a pessoa precisa aprender a distinguir.
 */
function Degrau({
  nome, explicacao, texto, cor, atraso, primeiro, destaque,
}: {
  nome: string;
  explicacao: string;
  valor: number;
  texto: string;
  cor: string;
  atraso: number;
  primeiro?: boolean;
  destaque?: boolean;
}) {
  return (
    <div className={primeiro ? 'pt-5' : 'mt-4'}>
      {!primeiro ? (
        <div
          className="lp-razao-regua mb-4 h-px w-full"
          style={{ background: 'rgba(230,237,247,0.16)', animationDelay: `${atraso - 90}ms` }}
        />
      ) : null}
      <div
        className="lp-razao-linha flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between sm:gap-4"
        style={{ animationDelay: `${atraso}ms` }}
      >
        <span>
          <span className="lp-eyebrow block" style={{ color: 'rgba(230,237,247,0.5)' }}>
            {nome}
          </span>
          <span className="mt-1 block text-[12px]" style={{ color: 'rgba(230,237,247,0.45)' }}>
            {explicacao}
          </span>
        </span>
        <span
          className={`lp-num whitespace-nowrap leading-none ${destaque ? 'text-[30px] sm:text-[38px]' : 'text-[20px] sm:text-[24px]'}`}
          style={{ color: cor }}
        >
          {texto}
        </span>
      </div>
    </div>
  );
}
