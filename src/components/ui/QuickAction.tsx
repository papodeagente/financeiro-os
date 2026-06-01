'use client';

// Quick action card (estilo "Nova despesa" / "Conciliar contas"):
// - Ícone à esquerda em quadrado tintado
// - Título + subtítulo
// - Chevron à direita
// - Opcionalmente primário (bg azul cheio) — usado pra CTA destacada
//
// Aceita href (vira <Link>) ou onClick (vira <button>).

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  href?: string;
  onClick?: () => void;
  primary?: boolean;
  /** Sufixo opcional (ex.: "2 itens pendentes") */
  badge?: string;
  className?: string;
}

export function QuickAction({
  icon, title, subtitle, href, onClick, primary = false, badge, className = '',
}: Props) {
  const content = (
    <>
      <span className="qa-icon">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-[14px] leading-tight ${primary ? 'text-white' : 'text-[var(--lg-text)]'}`}>
          {title}
        </div>
        {subtitle && (
          <div className={`text-[12px] mt-0.5 ${primary ? 'text-white/80' : 'text-[var(--lg-text-3)]'}`}>
            {badge ? badge : subtitle}
          </div>
        )}
      </div>
      <ChevronRight className={`w-4 h-4 shrink-0 ${primary ? 'text-white/80' : 'text-[var(--lg-text-4)]'}`} />
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`quick-action ${className}`} data-primary={primary || undefined}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`quick-action ${className}`} data-primary={primary || undefined}>
      {content}
    </button>
  );
}
