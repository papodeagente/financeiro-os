'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ItemDoMenu {
  id: string;
  rotulo: string;
  icone: LucideIcon;
  atalho?: string;
  destrutivo?: boolean;
  desabilitado?: string | null;
  onEscolher: () => void;
}

/**
 * Menu de clique direito da linha (05/11/2026). Abre onde o clique foi (ou
 * embaixo do botão "…"), fica dentro da janela, recebe o foco e anda pelas
 * setas; Esc, clique fora, rolagem ou redimensionar fecham. Item que não
 * vale para aquela conta aparece apagado com o motivo, para a pessoa saber
 * por que não pode.
 */
export function MenuDaLinha({
  aberto, posicao, titulo, itens, onFechar,
}: {
  aberto: boolean;
  posicao: { x: number; y: number };
  titulo: string;
  itens: ItemDoMenu[];
  onFechar: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [lugar, setLugar] = React.useState(posicao);

  React.useLayoutEffect(() => {
    if (!aberto || !ref.current) return;
    const caixa = ref.current.getBoundingClientRect();
    const margem = 8;
    setLugar({
      x: Math.max(margem, Math.min(posicao.x, window.innerWidth - caixa.width - margem)),
      y: Math.max(margem, Math.min(posicao.y, window.innerHeight - caixa.height - margem)),
    });
    ref.current.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [aberto, posicao]);

  React.useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onFechar(); };
    const fechar = () => onFechar();
    document.addEventListener('mousedown', fora);
    window.addEventListener('resize', fechar);
    window.addEventListener('scroll', fechar, true);
    return () => {
      document.removeEventListener('mousedown', fora);
      window.removeEventListener('resize', fechar);
      window.removeEventListener('scroll', fechar, true);
    };
  }, [aberto, onFechar]);

  if (!aberto || typeof document === 'undefined') return null;

  function teclado(e: React.KeyboardEvent<HTMLDivElement>) {
    const botoes = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const atual = botoes.indexOf(document.activeElement as HTMLButtonElement);
    const ir = (i: number) => { e.preventDefault(); botoes[(i + botoes.length) % botoes.length]?.focus(); };
    if (e.key === 'ArrowDown') ir(atual + 1);
    else if (e.key === 'ArrowUp') ir(atual - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(botoes.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onFechar(); }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={titulo}
      onKeyDown={teclado}
      style={{ left: lugar.x, top: lugar.y }}
      className={cn(
        'fixed z-[var(--fin-z-popover)] min-w-56 max-w-80 rounded-[var(--fin-r-md)] border border-[var(--fin-border)]',
        'bg-[var(--fin-surface)] p-[var(--fin-s-1)] shadow-[var(--fin-e1)]',
      )}
    >
      <p className="truncate px-[var(--fin-s-2)] pb-[var(--fin-s-1)] pt-[var(--fin-s-1)] fin-t-caption text-[var(--fin-text-3)]" title={titulo}>
        {titulo}
      </p>
      {itens.map(item => {
        const Icone = item.icone;
        const bloqueado = Boolean(item.desabilitado);
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            aria-disabled={bloqueado || undefined}
            title={item.desabilitado ?? undefined}
            onClick={() => { if (bloqueado) return; onFechar(); item.onEscolher(); }}
            className={cn(
              'flex min-h-11 w-full items-center gap-[var(--fin-s-2)] rounded-[var(--fin-r-sm)] px-[var(--fin-s-2)] text-left fin-t-body lg:min-h-9',
              'outline-none focus-visible:bg-[var(--fin-surface-2)] hover:bg-[var(--fin-surface-2)]',
              item.destrutivo ? 'text-[var(--fin-negative-text)]' : 'text-[var(--fin-text)]',
              bloqueado && 'cursor-not-allowed text-[var(--fin-text-3)] hover:bg-transparent',
            )}
          >
            <Icone aria-hidden="true" className="size-4 shrink-0" />
            <span className="flex min-w-0 grow flex-col">
              <span>{item.rotulo}</span>
              {bloqueado ? <span className="fin-t-caption text-[var(--fin-text-3)]">{item.desabilitado}</span> : null}
            </span>
            {item.atalho ? <kbd className="fin-t-caption font-sans text-[var(--fin-text-3)]">{item.atalho}</kbd> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
