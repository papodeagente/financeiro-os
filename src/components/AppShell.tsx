'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { TopRail } from './TopRail';
import { PillarSidebar } from './PillarSidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  // Login page and public proposal preview — no shell
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

  // Not authenticated
  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-[var(--t-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Authenticated — Top Rail + Pillar Sidebar + Content
  return (
    <div className="flex flex-col h-full">
      <TopRail />
      <div className="flex flex-1 overflow-hidden">
        <PillarSidebar />
        <div className="flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
