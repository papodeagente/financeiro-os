'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

/**
 * O balão de dado do pilar, e o comportamento que o abre.
 *
 * POR QUE É UM SÓ. Os gráficos que este trabalho substitui informam pelo
 * `title=` nativo: ele não abre no toque, o que deixa os painéis mudos no
 * aparelho em que a agência mais os abre. Se cada gráfico resolvesse isso do
 * seu jeito, teríamos seis comportamentos de toque diferentes na mesma tela —
 * é literalmente o que aconteceu com os três painéis do Painel e os dois da
 * Folha. Aqui a marca do SVG e a linha de lista usam o MESMO balão.
 */

export type ConteudoDoBalao = {
  id: string;
  titulo: string;
  /** Valores CHEIOS, nunca abreviados: a abreviação vive só no tick de eixo. */
  linhas: string[];
};

/** O balão permanece este tempo depois que o dedo sai da tela. */
const PERMANENCIA_TOQUE_MS = 3000;

export function useBalao(container: HTMLElement | null) {
  const [conteudo, setConteudo] = React.useState<ConteudoDoBalao | null>(null);
  const [posicao, setPosicao] = React.useState<{ x: number; y: number } | null>(null);
  const [porTeclado, setPorTeclado] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpar = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const fechar = React.useCallback(() => {
    limpar();
    setConteudo(null);
    setPosicao(null);
  }, [limpar]);

  const abrir = React.useCallback(
    (el: Element, dados: ConteudoDoBalao, teclado = false) => {
      limpar();
      setPorTeclado(teclado);
      setConteudo(dados);
      if (!container) return;
      const r = el.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      setPosicao({ x: r.left - c.left + r.width / 2, y: r.top - c.top });
    },
    [container, limpar],
  );

  /** Chamado no touchend: o balão fica mais 3s, que é o tempo de ler. */
  const fecharDepoisDoToque = React.useCallback(() => {
    limpar();
    timer.current = setTimeout(fechar, PERMANENCIA_TOQUE_MS);
  }, [fechar, limpar]);

  React.useEffect(() => limpar, [limpar]);

  // Esc fecha, e um toque fora também: no celular não existe "sair com o
  // ponteiro", então sem isto o balão ficaria preso na tela.
  React.useEffect(() => {
    if (!conteudo) return;
    const naTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    const fora = (e: Event) => {
      const alvo = e.target as Node | null;
      if (container && alvo && !container.contains(alvo)) fechar();
    };
    document.addEventListener('keydown', naTecla);
    document.addEventListener('touchstart', fora, { passive: true });
    return () => {
      document.removeEventListener('keydown', naTecla);
      document.removeEventListener('touchstart', fora);
    };
  }, [conteudo, container, fechar]);

  return { conteudo, posicao, porTeclado, abrir, fechar, fecharDepoisDoToque };
}

export function Balao({
  container,
  conteudo,
  posicao,
  porTeclado,
}: {
  container: HTMLElement | null;
  conteudo: ConteudoDoBalao | null;
  posicao: { x: number; y: number } | null;
  porTeclado: boolean;
}) {
  if (!container || !conteudo || !posicao) return null;

  return createPortal(
    <div
      // aria-live só no teclado: no toque o leitor já anunciou o alvo, e
      // repetir a mesma frase vira ruído.
      role={porTeclado ? 'status' : undefined}
      aria-live={porTeclado ? 'polite' : undefined}
      aria-hidden={porTeclado ? undefined : true}
      style={{
        left: Math.min(Math.max(8, posicao.x), Math.max(8, (container.clientWidth || 0) - 8)),
        top: Math.max(4, posicao.y - 8),
      }}
      className="pointer-events-none absolute z-20 max-w-[280px] -translate-x-1/2 -translate-y-full rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] px-3 py-2 shadow-[var(--fin-e2)]"
    >
      <p className="fin-t-caption font-semibold text-[var(--fin-text)]">{conteudo.titulo}</p>
      {conteudo.linhas.map(linha => (
        <p key={linha} className="fin-t-caption tabular-nums text-[var(--fin-text-2)]">
          {linha}
        </p>
      ))}
    </div>,
    container,
  );
}

export default Balao;
