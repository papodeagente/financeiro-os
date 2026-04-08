'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Crumb } from '@/lib/breadcrumbs';

interface BreadcrumbsProps {
  trail: Crumb[];
  className?: string;
}

export function Breadcrumbs({ trail, className }: BreadcrumbsProps) {
  if (!trail.length) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-1.5 text-[11px] flex-wrap ${className ?? ''}`}
    >
      {trail.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1.5 crumb-enter">
          {i > 0 && <ChevronRight className="w-3 h-3 text-[var(--t-text-muted)]" />}
          {c.isLeaf ? (
            <span aria-current="page" className="text-[var(--t-text)] font-medium">
              {c.label}
            </span>
          ) : (
            <Link
              href={c.href}
              className="text-[var(--t-text-muted)] hover:text-[var(--t-text)] transition-colors"
            >
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
