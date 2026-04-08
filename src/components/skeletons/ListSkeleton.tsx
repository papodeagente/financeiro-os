interface ListSkeletonProps {
  items?: number;
  showAvatar?: boolean;
}

export function ListSkeleton({ items = 6, showAvatar = false }: ListSkeletonProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)]"
        >
          {showAvatar && <div className="skeleton w-9 h-9 rounded-full shrink-0" />}
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-1/3 rounded" />
            <div className="skeleton h-3 w-2/3 rounded" />
          </div>
          <div className="skeleton h-3 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}
