'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { AppSidebar } from './AppSidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  // Login page and public proposal preview — no sidebar, no auth check
  if (pathname === '/login' || pathname.startsWith('/p/')) {
    return <>{children}</>;
  }

  // Loading session
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--t-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated — middleware handles redirect, but just in case
  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--t-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Authenticated — show sidebar + content
  return (
    <div className="flex h-full">
      <AppSidebar />
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
