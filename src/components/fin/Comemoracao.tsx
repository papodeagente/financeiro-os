'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Comemoração de venda fechada.
 *
 * Regras que não são enfeite:
 * - Respeita prefers-reduced-motion: quem pediu menos movimento recebe o
 *   aviso parado, sem confete. Tela de dinheiro com animação obrigatória
 *   é hostil.
 * - Nunca toca som sozinho. Navegador bloqueia e susto em ambiente de
 *   trabalho é pior que silêncio.
 * - Some sozinha e não bloqueia clique (pointer-events none), então nunca
 *   fica na frente de um botão de dar baixa.
 * - Anuncia por aria-live polite: quem usa leitor de tela recebe a notícia
 *   sem ser interrompido no meio de outra coisa.
 */

export type ComemoracaoProps = {
  /** Muda para disparar. Use o id da venda, para não repetir a mesma festa. */
  chave: string | null;
  titulo?: string;
  /** "Ana fechou R$ 8.200,00" */
  detalhe?: string;
  duracaoMs?: number;
  onFim?: () => void;
};

const CORES = [
  'var(--fin-accent)',
  'var(--fin-positive)',
  'var(--fin-warning)',
  'var(--fin-info)',
];

/** Confete determinístico: mesma peça, mesmo lugar, sem Math.random no
 *  render, que quebraria a hidratação do servidor. */
const PECAS = Array.from({ length: 36 }, (_, i) => {
  const passo = (i * 997) % 100;          // espalha sem aleatório
  const atraso = ((i * 37) % 40) / 100;
  const giro = ((i * 53) % 360);
  return {
    esquerda: passo,
    atraso,
    giro,
    cor: CORES[i % CORES.length],
    largura: 6 + (i % 3) * 2,
    altura: 10 + (i % 4) * 3,
  };
});

export function Comemoracao({
  chave,
  titulo = 'Yabba dabba doo!',
  detalhe,
  duracaoMs = 4200,
  onFim,
}: ComemoracaoProps) {
  const [visivel, setVisivel] = React.useState(false);
  const [semMovimento, setSemMovimento] = React.useState(false);
  const ultima = React.useRef<string | null>(null);

  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aplicar = () => setSemMovimento(mq.matches);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);

  React.useEffect(() => {
    if (!chave || chave === ultima.current) return;
    ultima.current = chave;
    setVisivel(true);
    const t = setTimeout(() => { setVisivel(false); onFim?.(); }, duracaoMs);
    return () => clearTimeout(t);
  }, [chave, duracaoMs, onFim]);

  if (!visivel) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
      aria-live="polite"
      aria-atomic="true"
    >
      {!semMovimento && (
        <>
          <style>{`
            @keyframes fin-confete {
              0%   { transform: translate3d(0,-12vh,0) rotate(0deg);   opacity: 0; }
              8%   { opacity: 1; }
              100% { transform: translate3d(0,104vh,0) rotate(720deg); opacity: 0; }
            }
            @keyframes fin-selo {
              0%   { transform: scale(.82) translateY(8px); opacity: 0; }
              14%  { transform: scale(1.04) translateY(0);  opacity: 1; }
              22%  { transform: scale(1);                   opacity: 1; }
              86%  { opacity: 1; }
              100% { opacity: 0; }
            }
          `}</style>
          {PECAS.map((p, i) => (
            <span
              key={i}
              className="absolute top-0 block rounded-[1px]"
              style={{
                left: `${p.esquerda}%`,
                width: p.largura,
                height: p.altura,
                background: p.cor,
                transform: `rotate(${p.giro}deg)`,
                animation: `fin-confete ${2.4 + (i % 5) * 0.28}s linear ${p.atraso}s forwards`,
              }}
            />
          ))}
        </>
      )}

      <div className="absolute inset-x-0 top-[12vh] flex justify-center px-4">
        <div
          className={cn(
            'rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)]',
            'px-5 py-4 text-center shadow-[var(--fin-e2)]',
          )}
          style={semMovimento ? undefined : { animation: `fin-selo ${duracaoMs}ms ease-out forwards` }}
        >
          <p className="fin-t-metric-sm text-[var(--fin-accent)]">{titulo}</p>
          {detalhe && (
            <p className="mt-1 fin-t-body text-[var(--fin-text-2)]">{detalhe}</p>
          )}
        </div>
      </div>
    </div>
  );
}
