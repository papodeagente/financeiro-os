'use client';

import Link from 'next/link';
import Image from 'next/image';

type LogoVariant = 'full' | 'sidebar' | 'icon';

interface Props {
  variant?: LogoVariant;
  href?: string;
  className?: string;
}

/**
 * enturOS FIN — logo oficial (PNG exata do upload)
 *
 * - full:    Login, onboarding (200px largura)
 * - sidebar: FeaturePanel header (120px largura)
 * - icon:    PillarRail badge (48px largura, sempre branco)
 */

const WIDTHS: Record<LogoVariant, number> = {
  full: 200,
  sidebar: 120,
  icon: 48,
};

export function Logo({ variant = 'full', href, className = '' }: Props) {
  const w = WIDTHS[variant];
  const isIcon = variant === 'icon';

  const img = (
    <Image
      src="/logo-enturos-fin.png"
      alt="enturOS FIN"
      width={500}
      height={150}
      priority
      draggable={false}
      className={isIcon ? 'logo-white' : 'dark:logo-invert'}
      style={{ width: w, height: 'auto' }}
    />
  );

  const wrapper = (
    <span className={`inline-flex items-center select-none ${className}`}>
      {img}
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex items-center hover:opacity-80 transition-opacity">
        {wrapper}
      </Link>
    );
  }

  return wrapper;
}
