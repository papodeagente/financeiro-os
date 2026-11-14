'use client';

/**
 * Seletor de empresas (06/11/2026, E7 G2): várias empresas ao mesmo tempo,
 * ao lado do título das listas e relatórios. Só aparece quando a agência tem
 * duas ou mais empresas; com uma, não desenha nada.
 *
 * A escolha fica guardada para a pessoa (no servidor) e vale em todas as
 * telas até ela mudar. Por isso, ao aplicar, a página recarrega inteira: os
 * números de todos os quadros passam a ser os das empresas marcadas.
 */
import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { Building2, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { formatarCnpj, rotuloDaSelecao } from '@/lib/empresas';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { esquecerEmpresas, useEmpresas } from './useEmpresas';

const FOCO =
  'focus-visible:outline-2 focus-visible:outline-[var(--fin-accent)] focus-visible:outline-offset-2 focus-visible:ring-0';

export function SeletorDeEmpresas() {
  const ctx = useEmpresas();
  const [aberto, setAberto] = React.useState(false);
  const [marcadas, setMarcadas] = React.useState<Set<string>>(new Set());
  const [gravando, setGravando] = React.useState(false);

  // O que vale agora: as visíveis (null = todas as oferecidas).
  const atuais = React.useMemo(
    () => (ctx.visiveis ?? ctx.empresas.map(e => e.id)).filter(id => ctx.empresas.some(e => e.id === id)),
    [ctx.visiveis, ctx.empresas],
  );

  if (ctx.carregando || !ctx.multi || ctx.empresas.length < 2) return null;

  const recortado = atuais.length < ctx.empresas.length;
  const rotulo = rotuloDaSelecao(recortado ? atuais : [], ctx.empresas);
  const todasMarcadas = marcadas.size === ctx.empresas.length;

  function alternar(id: string) {
    setMarcadas(atual => {
      const nova = new Set(atual);
      if (nova.has(id)) nova.delete(id); else nova.add(id);
      return nova;
    });
  }

  async function aplicar() {
    if (marcadas.size === 0 || gravando) return;
    setGravando(true);
    try {
      const res = await fetch('/api/empresas/selecao', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresas: todasMarcadas ? [] : [...marcadas] }),
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof corpo?.error === 'string' ? corpo.error : 'Tente de novo.');
      esquecerEmpresas();
      setAberto(false);
      // Todos os quadros da página passam a contar só as empresas marcadas.
      window.location.reload();
    } catch (e) {
      toast.error('Não foi possível trocar as empresas.', e instanceof Error ? e.message : '');
      setGravando(false);
    }
  }

  return (
    <Popover.Root
      open={aberto}
      onOpenChange={abrir => {
        // Ao abrir, começa do que vale agora.
        if (abrir) setMarcadas(new Set(atuais));
        setAberto(abrir);
      }}
    >
      <Popover.Trigger
        render={
          <button
            type="button"
            aria-label={`Empresas nesta visão: ${rotulo}. Trocar`}
            className={cn(
              'fin-t-caption inline-flex h-8 max-w-[16rem] items-center gap-1.5 rounded-[var(--fin-r-md)] border px-2.5 font-medium',
              'transition-colors duration-[var(--fin-dur-rapida)] ease-[var(--fin-curva)]',
              recortado
                ? 'border-[var(--fin-accent)] bg-[var(--fin-accent-soft)] text-[var(--fin-accent)] hover:bg-[var(--fin-surface-2)]'
                : 'border-[var(--fin-border-strong)] bg-[var(--fin-surface)] text-[var(--fin-text-2)] hover:bg-[var(--fin-surface-2)] hover:text-[var(--fin-text)]',
              FOCO,
            )}
          />
        }
      >
        <Building2 aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{rotulo}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="start" sideOffset={6} className="z-[var(--fin-z-popover)]">
          <Popover.Popup className="w-[min(20rem,calc(100vw-2rem))] rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] shadow-[var(--fin-e2)] outline-none">
            <div className="flex flex-col gap-[var(--fin-s-1)] px-[var(--fin-s-4)] pt-[var(--fin-s-4)]">
              <Popover.Title className="fin-t-subhead text-[var(--fin-text)]">Empresas nesta visão</Popover.Title>
              <Popover.Description className="fin-t-caption text-[var(--fin-text-3)]">
                Vale para todas as listas e relatórios e fica guardado para você.
              </Popover.Description>
            </div>
            <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto px-[var(--fin-s-2)] py-[var(--fin-s-3)]">
              {ctx.empresas.map(e => {
                const marcada = marcadas.has(e.id);
                return (
                  <li key={e.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-start gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] px-[var(--fin-s-2)] py-2',
                        'hover:bg-[var(--fin-surface-2)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--fin-accent)]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() => alternar(e.id)}
                        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--fin-accent)] focus-visible:outline-none"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="fin-t-body truncate text-[var(--fin-text)]">
                          {e.nome}
                          {e.principal ? <span className="fin-t-caption ml-1.5 text-[var(--fin-text-3)]">principal</span> : null}
                        </span>
                        {e.cnpj ? <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">{formatarCnpj(e.cnpj)}</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between gap-[var(--fin-s-2)] border-t border-[var(--fin-border)] px-[var(--fin-s-4)] py-[var(--fin-s-3)]">
              <button
                type="button"
                disabled={todasMarcadas}
                onClick={() => setMarcadas(new Set(ctx.empresas.map(e => e.id)))}
                className={cn('fin-t-caption font-medium text-[var(--fin-accent)] underline-offset-4 hover:underline disabled:text-[var(--fin-text-3)] disabled:no-underline', FOCO)}
              >
                Marcar todas
              </button>
              <div className="flex items-center gap-[var(--fin-s-2)]">
                {marcadas.size === 0 ? (
                  <span role="status" className="fin-t-caption text-[var(--fin-negative-text)]">Marque ao menos uma</span>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  disabled={marcadas.size === 0 || gravando}
                  onClick={aplicar}
                  className={cn('h-8 rounded-[var(--fin-r-md)] px-3 shadow-none', FOCO)}
                >
                  {gravando ? 'Aplicando…' : 'Aplicar'}
                </Button>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default SeletorDeEmpresas;
