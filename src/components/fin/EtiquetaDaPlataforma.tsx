import { Plug } from 'lucide-react';

import { cn } from '@/lib/utils';
import { nomeDaPlataforma } from '@/lib/plataformas/rotulo';

/**
 * "via Hotmart": de qual integração o recebimento veio.
 *
 * Cor de destaque e não de status: não diz se a conta está paga ou atrasada,
 * diz de onde ela veio. O status continua no StatusChip ao lado.
 */
export function EtiquetaDaPlataforma({ plataforma, className }: { plataforma: string; className?: string }) {
  const nome = nomeDaPlataforma(plataforma);
  if (!nome) return null;
  return (
    <span
      title={`Recebido pela integração com ${nome}`}
      className={cn(
        'fin-t-caption inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--fin-r-sm)] border px-1.5 font-medium',
        'border-[var(--fin-accent)]/20 bg-[var(--fin-accent-soft)] text-[var(--fin-accent)]',
        className,
      )}
    >
      <Plug aria-hidden="true" className="size-3" />
      <span className="sr-only">Recebido pela integração, </span>via {nome}
    </span>
  );
}
