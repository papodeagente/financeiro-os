interface FormSkeletonProps {
  fields?: number;
  showActions?: boolean;
}

export function FormSkeleton({ fields = 5, showActions = true }: FormSkeletonProps) {
  return (
    <div className="space-y-4">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-9 w-full rounded-lg" />
        </div>
      ))}
      {showActions && (
        <div className="flex items-center gap-2 pt-2">
          <div className="skeleton h-9 w-24 rounded-lg" />
          <div className="skeleton h-9 w-20 rounded-lg" />
        </div>
      )}
    </div>
  );
}
