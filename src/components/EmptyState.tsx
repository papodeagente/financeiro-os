'use client';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 content-enter">
      <div className="relative w-16 h-16 rounded-[20px] flex items-center justify-center mb-5 text-[var(--t-green)]"
        style={{ background: 'linear-gradient(135deg, var(--t-green-bg), rgba(0,74,173,0.04))', boxShadow: 'inset 0 0 0 1px var(--t-green-shadow)' }}
      >
        <span className="absolute inset-[-8px] rounded-[24px] border border-[var(--t-green)] opacity-[0.06]" />
        <span className="absolute inset-[-16px] rounded-[28px] border border-[var(--t-green)] opacity-[0.03]" />
        {icon}
      </div>
      <h3 className="text-[var(--text-body-lg)] font-semibold text-[var(--t-text)] mb-1">{title}</h3>
      <p className="text-[var(--text-body-sm)] text-[var(--t-text-muted)] text-center max-w-sm">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 px-5 py-2.5 text-[var(--text-body-sm)] font-medium text-white rounded-xl hover:opacity-90 transition-all"
          style={{ background: 'var(--t-accent-gradient)', boxShadow: '0 2px 8px var(--t-green-shadow)' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
