'use client';

import Link from 'next/link';
import Image from 'next/image';

type LogoVariant = 'full' | 'sidebar' | 'icon';

interface Props {
  variant?: LogoVariant;
  href?: string;
  className?: string;
  invertOnDark?: boolean;
}

/**
 * enturOS FIN — logo oficial
 *
 * Variantes:
 * - full:    Logo completa, tamanho grande (login, onboarding)
 * - sidebar: Logo compacta para FeaturePanel header
 * - icon:    Badge pequeno para PillarRail (40px)
 *
 * invertOnDark: aplica filtro para inverter preto→branco no dark mode
 *               mantém o azul do "OS" intacto
 */

const SIZES: Record<LogoVariant, { width: number; height: number }> = {
  full: { width: 220, height: 42 },
  sidebar: { width: 130, height: 26 },
  icon: { width: 56, height: 12 },
};

export function Logo({ variant = 'full', href, className = '', invertOnDark = true }: Props) {
  const size = SIZES[variant];
  const isIcon = variant === 'icon';

  const content = (
    <span className={`inline-flex items-center select-none ${className}`}>
      <Image
        src="/logo-enturos-fin.svg"
        alt="enturOS FIN"
        width={size.width}
        height={size.height}
        priority
        className={`h-auto ${invertOnDark ? 'dark:logo-invert' : ''} ${isIcon ? 'logo-icon-invert' : ''}`}
        style={{ width: size.width, height: 'auto' }}
        draggable={false}
      />
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex items-center hover:opacity-80 transition-opacity">
        {content}
      </Link>
    );
  }

  return content;
}
