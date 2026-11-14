'use client';

// Árvore de direitos por módulo, com "marcar tudo" em cada um (05/11/2026).
// Usada no perfil de acesso (marcado = o perfil pode) e na restrição por
// pessoa (marcado = a pessoa pode). Direito fora do teto do papel aparece
// apagado, com o motivo: o perfil nunca dá o que o papel não tem.

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ItemDoCatalogo { id: string; modulo: string; rotulo: string; descricao: string }
export interface ModuloDoCatalogo { modulo: { id: string; rotulo: string }; acoes: ItemDoCatalogo[] }

export function Caixinha({
  marcada, misto = false, onChange, desabilitada, rotulo, id,
}: {
  marcada: boolean; misto?: boolean; onChange: (v: boolean) => void; desabilitada?: boolean; rotulo?: string; id?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (ref.current) ref.current.indeterminate = misto; }, [misto]);
  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      aria-label={rotulo}
      checked={marcada}
      disabled={desabilitada}
      onChange={e => onChange(e.target.checked)}
      className="size-4 shrink-0 cursor-pointer rounded-[var(--fin-r-sm)] accent-[var(--fin-accent)] disabled:cursor-not-allowed"
    />
  );
}

export function MatrizDeDireitos({
  catalogo, marcadas, onChange, teto, desabilitada = false, foraDoTeto = 'Só administrador',
}: {
  catalogo: ModuloDoCatalogo[];
  marcadas: ReadonlySet<string>;
  onChange: (proximas: Set<string>) => void;
  /** Ações que o papel alcança. Fora daqui, a linha fica apagada. */
  teto?: ReadonlySet<string>;
  desabilitada?: boolean;
  foraDoTeto?: string;
}) {
  const alterar = (ids: string[], valor: boolean) => {
    const proximas = new Set(marcadas);
    for (const id of ids) { if (valor) proximas.add(id); else proximas.delete(id); }
    onChange(proximas);
  };

  return (
    <div className="flex flex-col gap-[var(--fin-s-3)]">
      {catalogo.map(({ modulo, acoes }) => {
        const editaveis = acoes.filter(a => !teto || teto.has(a.id));
        const marcadasNoModulo = editaveis.filter(a => marcadas.has(a.id)).length;
        const todas = editaveis.length > 0 && marcadasNoModulo === editaveis.length;
        const idModulo = `mod-${modulo.id}`;
        return (
          <fieldset
            key={modulo.id}
            disabled={desabilitada}
            className="overflow-hidden rounded-[var(--fin-r-lg)] border border-[var(--fin-border)] bg-[var(--fin-surface)] disabled:opacity-60"
          >
            <legend className="sr-only">{modulo.rotulo}</legend>
            <div className="flex items-center gap-3 border-b border-[var(--fin-border)] bg-[var(--fin-surface-2)] px-4 py-2.5">
              <Caixinha
                id={idModulo}
                marcada={todas}
                misto={marcadasNoModulo > 0 && !todas}
                desabilitada={desabilitada || editaveis.length === 0}
                onChange={v => alterar(editaveis.map(a => a.id), v)}
              />
              <label htmlFor={idModulo} className="fin-t-body-strong flex-1 cursor-pointer text-[var(--fin-text)]">
                {modulo.rotulo}
              </label>
              <span className="fin-t-caption tabular-nums text-[var(--fin-text-3)]">
                {marcadasNoModulo} de {editaveis.length}
              </span>
            </div>
            <ul className="divide-y divide-[var(--fin-border)]">
              {acoes.map(a => {
                const alcanca = !teto || teto.has(a.id);
                const idLinha = `acao-${a.id}`;
                return (
                  <li key={a.id} className={cn('flex items-start gap-3 px-4 py-2.5', !alcanca && 'bg-[var(--fin-surface-sunken)]')}>
                    <span className="pt-0.5">
                      <Caixinha
                        id={idLinha}
                        marcada={alcanca && marcadas.has(a.id)}
                        desabilitada={desabilitada || !alcanca}
                        onChange={v => alterar([a.id], v)}
                      />
                    </span>
                    <label htmlFor={idLinha} className={cn('flex min-w-0 flex-1 flex-col', alcanca ? 'cursor-pointer' : 'cursor-not-allowed')}>
                      <span className={cn('fin-t-body', alcanca ? 'text-[var(--fin-text)]' : 'text-[var(--fin-text-3)]')}>{a.rotulo}</span>
                      <span className="fin-t-caption text-[var(--fin-text-3)]">{a.descricao}</span>
                    </label>
                    {!alcanca && (
                      <span className="fin-t-caption shrink-0 rounded-[var(--fin-r-sm)] border border-[var(--fin-border)] px-1.5 py-0.5 text-[var(--fin-text-3)]">
                        {foraDoTeto}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

export default MatrizDeDireitos;
