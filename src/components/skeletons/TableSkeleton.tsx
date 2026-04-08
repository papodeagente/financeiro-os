interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  showHeader?: boolean;
  showFooter?: boolean;
}

export function TableSkeleton({
  rows = 5,
  cols = 4,
  showHeader = true,
  showFooter = false,
}: TableSkeletonProps) {
  return (
    <div className="w-full rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] overflow-hidden">
      {showHeader && (
        <div className="flex items-center gap-3 border-b border-[var(--t-border)] px-4 py-3 bg-[var(--t-surface-muted,var(--t-surface))]">
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="skeleton h-3 flex-1 rounded" />
          ))}
        </div>
      )}
      <div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="flex items-center gap-3 px-4 py-3 border-b border-[var(--t-border)] last:border-b-0"
          >
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="skeleton h-4 flex-1 rounded" />
            ))}
          </div>
        ))}
      </div>
      {showFooter && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--t-border)]">
          <div className="skeleton h-3 w-32 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
        </div>
      )}
    </div>
  );
}
