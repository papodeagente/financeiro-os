'use client';

import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  // Hora visivel na status bar do frame. Default = hora atual.
  time?: string;
}

// Frame estilizado iPhone Pro Max (aspect 19.5:9). Usado pra mostrar
// preview de proposta dentro do editor com proporcao real de celular.
//
// Dimensoes base: 430 × 932 (CSS px equivalente ao Pro Max). Em telas
// menores reduz proporcionalmente via wrapper externo.
//
// O frame e desenhado puramente em CSS — sem imagens externas. Cobre:
// - Bordas externas (aluminum chrome ~14px)
// - Bordas internas (screen bezel)
// - Dynamic Island (pill preto no topo)
// - Status bar (hora + indicadores)
// - Home indicator (barra inferior)
//
// O conteudo (children) e scrollavel dentro da "tela" — passa por
// overflow-y-auto e mantem a area de safe area no topo (status bar) e
// no bottom (home indicator).
export function PhoneFrame({ children, time }: Props) {
  const now = time || new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className="relative shrink-0 mx-auto"
      style={{
        // Aspect 9:19.5 — base 430 × 932. Mantemos largura fixa e
        // delegamos altura via aspect-ratio pra responsividade.
        width: '430px',
        aspectRatio: '9 / 19.5',
        // Sombra de elevacao pra dar a sensacao de "lampada do produto"
        // separado do background.
        filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.25)) drop-shadow(0 8px 16px rgba(0,0,0,0.15))',
      }}
    >
      {/* Outer chrome (aluminum frame) */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(145deg, #2a2a2c, #1a1a1c)',
          borderRadius: '55px',
          padding: '14px',
        }}
      >
        {/* Inner bezel (the screen border) */}
        <div
          className="relative w-full h-full overflow-hidden"
          style={{
            background: '#000',
            borderRadius: '42px',
            padding: '2px',
          }}
        >
          {/* Screen content area */}
          <div
            className="relative w-full h-full overflow-hidden bg-white"
            style={{ borderRadius: '40px' }}
          >
            {/* Status bar (hora + indicadores) */}
            <div
              className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-8 pt-2.5 text-[14px] font-semibold pointer-events-none"
              style={{ color: '#000', height: '54px' }}
            >
              <span className="tabular-nums">{now}</span>
              <span className="flex items-center gap-1.5">
                {/* Signal bars */}
                <span className="flex items-end gap-0.5 h-3">
                  <span className="w-[3px] h-1 bg-current rounded-sm" />
                  <span className="w-[3px] h-1.5 bg-current rounded-sm" />
                  <span className="w-[3px] h-2 bg-current rounded-sm" />
                  <span className="w-[3px] h-2.5 bg-current rounded-sm" />
                </span>
                {/* Wi-Fi */}
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                  <path d="M12 18a1.5 1.5 0 11-.001 3.001A1.5 1.5 0 0112 18zm5.66-5.66a1.5 1.5 0 010 2.12 1.5 1.5 0 01-2.12 0 4.5 4.5 0 00-6.36 0 1.5 1.5 0 11-2.12-2.12 7.5 7.5 0 0110.6 0zm4.24-4.24a1.5 1.5 0 010 2.12 1.5 1.5 0 01-2.12 0 10.5 10.5 0 00-14.85 0 1.5 1.5 0 11-2.12-2.12 13.5 13.5 0 0119.1 0z" />
                </svg>
                {/* Battery */}
                <span className="relative inline-flex items-center">
                  <span className="w-6 h-3 border border-current rounded-[3px] relative">
                    <span className="absolute inset-[1.5px] right-[3px] bg-current rounded-[1px]" />
                  </span>
                  <span className="absolute -right-[3px] top-1/2 -translate-y-1/2 w-[2px] h-1.5 bg-current rounded-[1px]" />
                </span>
              </span>
            </div>

            {/* Dynamic Island (preto, centralizado, abaixo da status bar) */}
            <div
              className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none"
              style={{
                top: '12px',
                width: '125px',
                height: '36px',
                background: '#000',
                borderRadius: '20px',
              }}
            />

            {/* Conteudo full-bleed — em iOS real o conteudo vai por baixo
                da status bar e do home indicator. Aqui o iframe (ou
                qualquer children) ocupa 100% da tela e os overlays
                ficam por cima. */}
            <div className="absolute inset-0">
              {children}
            </div>

            {/* Home indicator (barra preta sutil no rodape) */}
            <div
              className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
              style={{
                width: '140px',
                height: '5px',
                background: 'rgba(0,0,0,0.85)',
                borderRadius: '3px',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
