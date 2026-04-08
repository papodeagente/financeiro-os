'use client';

import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@/contexts/ThemeContext';

export function Toaster() {
  const { theme } = useTheme();
  return (
    <SonnerToaster
      theme={theme === 'dark' ? 'dark' : 'light'}
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'rounded-[var(--t-card-radius)] shadow-[var(--elevation-2)] border border-[var(--t-border)] bg-[var(--t-surface)] text-[var(--t-text)]',
          title: 'text-[var(--text-body)] font-semibold',
          description: 'text-[var(--text-body-sm)] text-[var(--t-text-muted)]',
          success: 'border-[var(--t-status-success)]',
          error: 'border-[var(--t-status-danger)]',
          warning: 'border-[var(--t-status-warning)]',
          info: 'border-[var(--t-status-info)]',
        },
      }}
    />
  );
}
