'use client';

type Size = 'sm' | 'md' | 'lg';
type Variant = 'default' | 'error' | 'search';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** Either a {label, onClick} for the default CTA or any custom node. */
  action?: { label: string; onClick: () => void } | React.ReactNode;
  size?: Size;
  variant?: Variant;
}

const PADS: Record<Size, string> = {
  sm: 'py-8 px-4',
  md: 'py-16 px-6',
  lg: 'py-24 px-8',
};

const HALO_VARS: Record<Variant, { color: string; bg: string }> = {
  default: { color: 'var(--t-green)', bg: 'var(--t-green-bg)' },
  error: { color: 'var(--t-status-danger)', bg: 'var(--t-status-danger-bg)' },
  search: { color: 'var(--t-text-muted)', bg: 'var(--t-surface-hover)' },
};

function isActionObject(
  a: EmptyStateProps['action'],
): a is { label: string; onClick: () => void } {
  return (
    typeof a === 'object' &&
    a !== null &&
    'label' in (a as object) &&
    'onClick' in (a as object)
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  variant = 'default',
}: EmptyStateProps) {
  const halo = HALO_VARS[variant];
  return (
    <div className={`flex flex-col items-center justify-center content-enter ${PADS[size]}`}>
      <div
        className="relative w-16 h-16 rounded-[20px] flex items-center justify-center mb-5"
        style={{
          color: halo.color,
          background: `linear-gradient(135deg, ${halo.bg}, rgba(0,0,0,0.02))`,
          boxShadow: `inset 0 0 0 1px ${halo.color}33`,
        }}
      >
        <span
          className="absolute inset-[-8px] rounded-[24px] border opacity-[0.08]"
          style={{ borderColor: halo.color }}
        />
        <span
          className="absolute inset-[-16px] rounded-[28px] border opacity-[0.04]"
          style={{ borderColor: halo.color }}
        />
        {icon}
      </div>
      <h3 className="text-[var(--text-body-lg)] font-semibold text-[var(--t-text)] mb-1">{title}</h3>
      {description && (
        <p className="text-[var(--text-body-sm)] text-[var(--t-text-muted)] text-center max-w-sm">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-5">
          {isActionObject(action) ? (
            <button
              onClick={action.onClick}
              className="px-5 py-2.5 text-[var(--text-body-sm)] font-medium text-white rounded-xl hover:opacity-90 transition-all"
              style={{
                background: 'var(--t-accent-gradient)',
                boxShadow: '0 2px 8px var(--t-green-shadow)',
              }}
            >
              {action.label}
            </button>
          ) : (
            action
          )}
        </div>
      )}
    </div>
  );
}
