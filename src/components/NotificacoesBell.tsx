'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, MessageSquare, ThumbsUp, Eye, UserPlus } from 'lucide-react';

interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  descricao: string;
  link: string;
  lida: boolean;
  created_at: string;
}

const ICON_FOR_TIPO: Record<string, typeof ThumbsUp> = {
  PROPOSTA_ACEITA: ThumbsUp,
  PROPOSTA_FEEDBACK: MessageSquare,
  PROPOSTA_VISUALIZADA: Eye,
  PROPOSTA_LEAD: UserPlus,
};

const COLOR_FOR_TIPO: Record<string, string> = {
  PROPOSTA_ACEITA: 'text-emerald-500 bg-emerald-500/10',
  PROPOSTA_FEEDBACK: 'text-blue-500 bg-blue-500/10',
  PROPOSTA_VISUALIZADA: 'text-violet-500 bg-violet-500/10',
  PROPOSTA_LEAD: 'text-amber-500 bg-amber-500/10',
};

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export function NotificacoesBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notificacao[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const fetchNotificacoes = useCallback(async () => {
    try {
      const res = await fetch('/api/notificacoes?limit=20');
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items || []);
      setUnread(data.unread || 0);
    } catch {
      // silently
    }
  }, []);

  // Initial load + 60s polling
  useEffect(() => {
    fetchNotificacoes();
    const t = setInterval(fetchNotificacoes, 60000);
    return () => clearInterval(t);
  }, [fetchNotificacoes]);

  // Refetch when opening
  useEffect(() => {
    if (open) fetchNotificacoes();
  }, [open, fetchNotificacoes]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const marcarLida = async (id: string) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n));
    setUnread(prev => Math.max(prev - 1, 0));
    await fetch(`/api/notificacoes/${id}`, { method: 'PUT' });
  };

  const marcarTodasLidas = async () => {
    setLoading(true);
    setItems(prev => prev.map(n => ({ ...n, lida: true })));
    setUnread(0);
    await fetch('/api/notificacoes/marcar-lidas', { method: 'POST' });
    setLoading(false);
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-8 h-8 rounded-xl flex items-center justify-center text-[var(--t-text-muted)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors"
        aria-label="Notificações"
        title="Notificações"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
            style={{ boxShadow: '0 0 0 2px var(--t-surface)' }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[380px] max-w-[calc(100vw-32px)] bg-[var(--t-surface)] border border-[var(--t-border)] rounded-2xl py-1.5 z-50 dropdown-enter"
          style={{ boxShadow: 'var(--elevation-4)' }}
        >
          <div className="px-4 py-3 border-b border-[var(--t-border)] flex items-center justify-between gap-3">
            <div>
              <p className="text-[var(--text-body-sm)] font-semibold text-[var(--t-text)]">Notificações</p>
              <p className="text-[var(--text-caption)] text-[var(--t-text-muted)]">
                {unread > 0 ? `${unread} não lida${unread === 1 ? '' : 's'}` : 'Tudo em dia'}
              </p>
            </div>
            {unread > 0 && (
              <button
                onClick={marcarTodasLidas}
                disabled={loading}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--t-text-secondary)] hover:text-[var(--t-text)] hover:bg-[var(--t-surface-hover)] transition-colors disabled:opacity-50"
              >
                <CheckCheck className="w-3 h-3" />
                Marcar todas
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Bell className="w-8 h-8 text-[var(--t-text-muted)] mx-auto mb-2 opacity-40" />
                <p className="text-[var(--text-body-sm)] text-[var(--t-text-muted)]">
                  Nenhuma notificação
                </p>
                <p className="text-[var(--text-caption)] text-[var(--t-text-muted)] mt-1">
                  Quando um cliente aceitar uma proposta, ela aparece aqui.
                </p>
              </div>
            ) : (
              items.map(n => {
                const Icon = ICON_FOR_TIPO[n.tipo] || Bell;
                const colorClass = COLOR_FOR_TIPO[n.tipo] || 'text-gray-500 bg-gray-500/10';
                const inner = (
                  <>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colorClass}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[var(--text-body-sm)] leading-tight ${n.lida ? 'text-[var(--t-text-secondary)]' : 'font-semibold text-[var(--t-text)]'}`}>
                        {n.titulo}
                      </p>
                      {n.descricao && (
                        <p className="text-[11px] text-[var(--t-text-muted)] mt-0.5 line-clamp-2">
                          {n.descricao}
                        </p>
                      )}
                      <p className="text-[10px] text-[var(--t-text-muted)] mt-1">
                        {formatRelative(n.created_at)}
                      </p>
                    </div>
                    {!n.lida && (
                      <span className="w-2 h-2 rounded-full bg-[var(--t-green)] shrink-0 mt-1.5" />
                    )}
                  </>
                );

                const baseClass = `flex items-start gap-3 px-4 py-3 border-b border-[var(--t-border)]/50 last:border-b-0 transition-colors ${n.lida ? '' : 'bg-[var(--t-green)]/5'}`;

                if (n.link) {
                  return (
                    <Link
                      key={n.id}
                      href={n.link}
                      onClick={() => { void marcarLida(n.id); setOpen(false); }}
                      className={`${baseClass} hover:bg-[var(--t-surface-hover)]`}
                    >
                      {inner}
                    </Link>
                  );
                }
                return (
                  <button
                    key={n.id}
                    onClick={() => void marcarLida(n.id)}
                    className={`${baseClass} hover:bg-[var(--t-surface-hover)] w-full text-left`}
                  >
                    {inner}
                  </button>
                );
              })
            )}
          </div>

        </div>
      )}
    </div>
  );
}
