'use client';

import * as React from 'react';
import { use } from 'react';

import type { PortalPublico } from '@/lib/cobranca/portal-regras';
import { VisaoDoPortal } from './VisaoDoPortal';

/** Portal do cliente: lê o recorte público pelo token e mostra (VisaoDoPortal). */

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'ok'; portal: PortalPublico }
  | { tipo: 'erro'; titulo: string; texto: string };

export default function PortalDoClientePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [estado, setEstado] = React.useState<Estado>({ tipo: 'carregando' });

  React.useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/portal/${encodeURIComponent(token)}`, { signal: ac.signal, cache: 'no-store' })
      .then(async r => {
        const corpo = await r.json().catch(() => null);
        if (r.ok) { setEstado({ tipo: 'ok', portal: corpo as PortalPublico }); return; }
        if (r.status === 404) setEstado({ tipo: 'erro', titulo: 'Este link não abre mais', texto: 'Ele pode ter sido trocado pela agência. Peça um link novo a quem atende você.' });
        else if (r.status === 429) setEstado({ tipo: 'erro', titulo: 'Muitas tentativas', texto: 'Espere alguns minutos e abra o link de novo.' });
        else setEstado({ tipo: 'erro', titulo: 'Não foi possível abrir agora', texto: 'Tente de novo em alguns minutos.' });
      })
      .catch(() => { if (!ac.signal.aborted) setEstado({ tipo: 'erro', titulo: 'Sem conexão', texto: 'Confira a internet e abra o link de novo.' }); });
    return () => ac.abort();
  }, [token]);

  if (estado.tipo === 'carregando') {
    return (
      <main aria-busy="true" className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-[var(--fin-s-4)] bg-[var(--fin-bg)] px-[var(--fin-s-4)] py-[var(--fin-s-5)]">
        <span className="block h-6 w-40 animate-pulse rounded-[var(--fin-r-sm)] bg-[var(--fin-surface-2)]" />
        <span className="block h-24 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
        <span className="block h-40 animate-pulse rounded-[var(--fin-r-lg)] bg-[var(--fin-surface-2)]" />
        <span className="sr-only" role="status">Abrindo as suas contas.</span>
      </main>
    );
  }

  if (estado.tipo === 'erro') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center gap-[var(--fin-s-2)] bg-[var(--fin-bg)] px-[var(--fin-s-5)] py-[var(--fin-s-6)]">
        <h1 className="fin-t-title text-[var(--fin-text)]">{estado.titulo}</h1>
        <p className="fin-t-body text-[var(--fin-text-2)]">{estado.texto}</p>
      </main>
    );
  }

  return <VisaoDoPortal portal={estado.portal} token={token} />;
}
