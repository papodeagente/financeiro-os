'use client';

import { usePathname } from 'next/navigation';

/**
 * Top loading bar that fires a short animation on every route change.
 * It is intentionally CSS-only — no nprogress, no real fetch tracking —
 * to provide instant microfeedback for client-side navigations.
 *
 * Re-mounting via `key={pathname}` retriggers the CSS @keyframes animation
 * declared in globals.css whenever the user navigates.
 */
export function RouteProgress() {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      aria-hidden
      className="route-progress fixed top-0 left-0 right-0 h-[2px] z-[60] origin-left"
      style={{ background: 'var(--t-accent-gradient)' }}
    />
  );
}
