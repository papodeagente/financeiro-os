import type { Metadata, Viewport } from 'next';

/**
 * Link de leitura de relatório (público, E7). O endereço é a chave: nada de
 * indexar, nada de Referer, nenhum dado no título.
 */
export const metadata: Metadata = {
  title: 'Relatório',
  description: 'Relatório enviado pela agência.',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function LeituraLayout({ children }: { children: React.ReactNode }) {
  return children;
}
