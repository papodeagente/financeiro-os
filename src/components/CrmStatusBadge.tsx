'use client';

import { useEffect, useState } from 'react';

interface CrmStatusData {
  ativo: boolean;
  circuit_breaker: 'fechado' | 'aberto' | 'semi-aberto';
  eventos_pendentes: number;
  eventos_falha: number;
}

interface CrmStatusBadgeProps {
  variant?: 'compacto' | 'completo';
}

export function CrmStatusBadge({ variant = 'compacto' }: CrmStatusBadgeProps) {
  const [status, setStatus] = useState<CrmStatusData | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/v1/crm/status');
        if (res.ok) setStatus(await res.json());
      } catch { /* silent */ }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  const color = !status.ativo
    ? 'var(--crm-off)'
    : status.circuit_breaker === 'aberto' || status.eventos_falha > 0
    ? 'var(--crm-err)'
    : status.eventos_pendentes > 0
    ? 'var(--crm-warn)'
    : 'var(--crm-ok)';

  const label = !status.ativo
    ? 'CRM desconectado'
    : status.circuit_breaker === 'aberto'
    ? 'CRM com falhas'
    : status.eventos_falha > 0
    ? `CRM: ${status.eventos_falha} falha(s)`
    : 'CRM conectado';

  if (variant === 'compacto') {
    return (
      <div className="relative group" title={label} role="status">
        <span
          className="block w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-[10px] text-white bg-gray-900 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          {label}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[var(--text-caption)]" role="status">
      <span
        className="block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-[var(--t-text-muted)]">{label}</span>
    </div>
  );
}
