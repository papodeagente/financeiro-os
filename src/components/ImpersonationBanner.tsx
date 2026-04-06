'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Eye, X } from 'lucide-react';

export function ImpersonationBanner() {
  const { user } = useAuth();
  const router = useRouter();

  if (!user?.impersonatingTenantId) return null;

  const stopImpersonating = async () => {
    try {
      const res = await fetch('/api/admin/impersonate/stop', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        router.push(data.redirect || '/admin/dashboard');
        router.refresh();
      }
    } catch { /* ignore */ }
  };

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-3 px-4 py-2 bg-amber-500 text-gray-950 text-sm font-medium">
      <Eye className="w-4 h-4" />
      <span>Impersonando: {user.impersonatingTenantSlug || user.impersonatingTenantId}</span>
      <button
        onClick={stopImpersonating}
        className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-700 text-white text-xs hover:bg-amber-800 transition-colors"
      >
        <X className="w-3 h-3" />
        Sair
      </button>
    </div>
  );
}
