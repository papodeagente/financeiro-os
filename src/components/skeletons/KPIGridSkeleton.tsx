interface KPIGridSkeletonProps {
  count?: number;
  columns?: 2 | 3 | 4 | 6;
}

const COLS: Record<2 | 3 | 4 | 6, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  6: 'sm:grid-cols-3 lg:grid-cols-6',
};

export function KPIGridSkeleton({ count = 4, columns = 4 }: KPIGridSkeletonProps) {
  return (
    <div className={`grid grid-cols-1 ${COLS[columns]} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-4"
          style={{ boxShadow: 'var(--elevation-1)' }}
        >
          <div className="skeleton h-3 w-24 rounded mb-3" />
          <div className="skeleton h-7 w-32 rounded" />
        </div>
      ))}
    </div>
  );
}
