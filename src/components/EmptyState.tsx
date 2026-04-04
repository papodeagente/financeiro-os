'use client';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      <div className="w-14 h-14 rounded-[20px] bg-[var(--t-green-bg)] flex items-center justify-center mb-4 text-[var(--t-green)]">
        {icon}
      </div>
      <h3 className="text-[var(--text-body-lg)] font-medium text-[var(--t-text)] mb-1">{title}</h3>
      <p className="text-[var(--text-body-sm)] text-[var(--t-text-muted)] text-center max-w-sm">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 text-[var(--text-body-sm)] font-medium text-white bg-[var(--t-green)] rounded-lg hover:opacity-90 transition-opacity"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
