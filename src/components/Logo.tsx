'use client';

import Link from 'next/link';

type LogoVariant = 'full' | 'compact' | 'icon';

interface Props {
  variant?: LogoVariant;
  href?: string;
  className?: string;
}

/**
 * enturOS FIN logo — 3 variantes:
 * - full:    enturOS [FIN]  (login, onboarding)
 * - compact: eOS [FIN]     (topbar, headers)
 * - icon:    eOS            (pillar rail, favicon)
 */
export function Logo({ variant = 'full', href, className = '' }: Props) {
  const content = (
    <span className={`inline-flex items-center gap-1.5 select-none ${className}`}>
      {variant === 'full' && (
        <>
          <span className="font-bold tracking-tight text-[var(--t-text)]" style={{ letterSpacing: '-0.03em' }}>
            entur
          </span>
          <span className="font-bold tracking-tight text-[var(--t-green)]" style={{ letterSpacing: '-0.03em' }}>
            OS
          </span>
          <span className="text-[0.55em] font-semibold text-[var(--t-text)] border border-[var(--t-text)] rounded-md px-[0.4em] py-[0.1em] leading-none uppercase tracking-wide ml-0.5">
            FIN
          </span>
        </>
      )}
      {variant === 'compact' && (
        <>
          <span className="font-bold tracking-tight text-[var(--t-text)]" style={{ letterSpacing: '-0.02em' }}>
            e
          </span>
          <span className="font-bold tracking-tight text-[var(--t-green)]" style={{ letterSpacing: '-0.02em' }}>
            OS
          </span>
          <span className="text-[0.5em] font-semibold text-[var(--t-text-secondary)] border border-[var(--t-border-hover)] rounded px-[0.35em] py-[0.08em] leading-none uppercase tracking-wide ml-0.5">
            FIN
          </span>
        </>
      )}
      {variant === 'icon' && (
        <>
          <span className="font-bold text-white" style={{ letterSpacing: '-0.02em' }}>
            e
          </span>
          <span className="font-bold text-white/80" style={{ letterSpacing: '-0.02em' }}>
            OS
          </span>
        </>
      )}
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
