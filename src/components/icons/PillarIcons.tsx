/**
 * Ícones das abas (pilares) do topo.
 *
 * Desenhados para 16px, que é o tamanho em que aparecem na barra: nessa
 * escala o traço do lucide-react funciona, mas alguns dos ícones genéricos
 * perdem a leitura (a calculadora vira um retângulo de pontinhos) ou não
 * dizem o que a aba faz (três círculos concêntricos leem como "mira", não
 * como "meta a alcançar").
 *
 * Mesma gramática visual do lucide para conviverem no mesmo header:
 * viewBox 24, traço 2, pontas e junções arredondadas, sem preenchimento —
 * exceto o centro do alvo, que é o único ponto sólido de propósito.
 */
import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Planejamento — prancheta com a linha do plano subindo. */
export function PlanejamentoIcon(props: Props) {
  return (
    <svg {...base} {...props}>
      <path d="M15 2H9a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z" />
      <path d="M16 4h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m8 15.5 3-3.5 2.5 2.5L17 10" />
    </svg>
  );
}

/**
 * Metas — alvo com a flecha cravada no centro.
 *
 * O alvo é deslocado para baixo/esquerda para abrir espaço à flecha: com os
 * anéis centralizados a haste fica curta e a ponta lê como um quadradinho
 * solto. O ponto central é o único elemento preenchido do conjunto — é ele
 * que transforma "mira" em "acertou o alvo".
 */
export function MetasIcon(props: Props) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="14" r="7.5" />
      <circle cx="10" cy="14" r="3.4" />
      <circle cx="10" cy="14" r="0.9" fill="currentColor" stroke="none" />
      <path d="M10 14 21 3" />
      <path d="M15.5 3H21v5.5" />
    </svg>
  );
}

/**
 * Financeiro — moeda: o cifrão ganha corpo e para de sumir ao lado dos
 * outros. A haste é uma linha inteira atravessando o S; em versões com dois
 * traços curtos nas pontas eles viram ruído a 16px.
 */
export function FinanceiroIcon(props: Props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 6.5v11" />
      <path d="M14.8 9.2h-3.9a2.3 2.3 0 0 0 0 4.6h2.2a2.3 2.3 0 0 1 0 4.6H9" />
    </svg>
  );
}
