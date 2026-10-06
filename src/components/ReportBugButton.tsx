'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LifeBuoy, X } from 'lucide-react';

// Botão flutuante de "Reportar bug / Suporte". Aparece em todas as
// rotas autenticadas do app — escondido em /login, /signup, propostas
// públicas, admin e editores fullscreen.
export function ReportBugButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  // Some em rotas onde não faz sentido aparecer
  const hidden =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/p/') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/suporte') ||
    pathname === '/preview-iframe';

  // Conta tickets com nova resposta pra mostrar badge
  useEffect(() => {
    if (hidden) return;
    fetch('/api/support/tickets')
      .then(r => r.ok ? r.json() : [])
      .then((d: Array<{ tem_nao_lida_usuario?: boolean }>) => {
        if (Array.isArray(d)) {
          setUnread(d.filter(t => t.tem_nao_lida_usuario).length);
        }
      })
      .catch(() => {});
  }, [pathname, hidden]);

  if (hidden) return null;

  return (
    <>
      {/* Botão flutuante */}
      <button
        type="button"
        onClick={() => setOpen(s => !s)}
        className="fixed z-40 bottom-5 right-5 w-12 h-12 rounded-full bg-[var(--fin-accent)] text-[var(--fin-text-on-fill)] shadow-lg hover:bg-[var(--fin-accent-hover)] transition-colors flex items-center justify-center"
        title="Suporte"
        aria-label="Suporte"
      >
        {open ? <X className="w-5 h-5" /> : <LifeBuoy className="w-5 h-5" />}
        {unread > 0 && !open && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[var(--fin-negative)] text-[var(--fin-text-on-fill)] text-[10px] font-bold flex items-center justify-center border-2 border-[var(--fin-surface)]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* Menu rápido */}
      {open && (
        <div
          className="fixed z-40 bottom-20 right-5 bg-[var(--fin-surface)] rounded-xl shadow-2xl border border-[var(--fin-border)] p-2 w-[240px]"
          onClick={() => setOpen(false)}
        >
          <Link
            href="/suporte"
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--fin-surface-2)] text-sm text-[var(--fin-text-2)]"
          >
            <LifeBuoy className="w-4 h-4 text-[var(--fin-accent)]" />
            <div className="flex-1">
              <div className="font-semibold">Meus tickets</div>
              <div className="text-[11px] text-[var(--fin-text-3)]">
                {unread > 0 ? `${unread} nova resposta` : 'Ver e responder'}
              </div>
            </div>
          </Link>
          <Link
            href="/suporte?novo=1"
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--fin-surface-2)] text-sm text-[var(--fin-text-2)] mt-0.5"
          >
            <span className="w-4 h-4 inline-flex items-center justify-center rounded-full bg-[var(--fin-negative-soft)] text-[var(--fin-negative-text)] text-[10px] font-bold">!</span>
            <div className="flex-1">
              <div className="font-semibold">Reportar um bug</div>
              <div className="text-[11px] text-[var(--fin-text-3)]">Print + descrição</div>
            </div>
          </Link>
        </div>
      )}
    </>
  );
}
