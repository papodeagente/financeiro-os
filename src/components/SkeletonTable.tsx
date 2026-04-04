'use client';

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  const widths = ['w-1/4', 'w-1/3', 'w-1/2', 'w-2/5', 'w-1/5'];
  return (
    <div className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 px-5 py-3 border-b border-[var(--t-border)] bg-[var(--t-surface-hover)]">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className={`skeleton h-3 ${widths[i % widths.length]}`} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-5 py-3.5 border-b border-[var(--t-border)] last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className={`skeleton h-3 ${widths[(r + c) % widths.length]}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
