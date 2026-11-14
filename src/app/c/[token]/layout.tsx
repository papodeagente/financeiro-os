import type { Metadata, Viewport } from 'next';

/**
 * Portal do cliente (público, 05/11/2026). O endereço é o link pessoal:
 * nada de indexar, nada de título com dado do cliente.
 */
export const metadata: Metadata = {
  title: 'Suas contas',
  description: 'Contas em aberto, pagamento por Pix ou boleto e recibos.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
