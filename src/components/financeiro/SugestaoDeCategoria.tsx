'use client';

/**
 * Sugestão de categoria pelo histórico, no lançamento à mão (E7, frente D).
 * Mostra as categorias que a agência mais usou com a mesma pessoa
 * (fornecedor ou cliente): um toque aplica. Só sugere; nunca troca sozinha.
 */
import * as React from 'react';
import { Sparkles } from 'lucide-react';

import type { CategoriaSugerida } from '@/lib/leitura-documento';
import { cn } from '@/lib/utils';

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)]';

export function SugestaoDeCategoria({
  tabela, pessoaId, nome, documento, atual, onEscolher,
}: {
  tabela: 'pagar' | 'receber';
  pessoaId?: string | null;
  nome?: string | null;
  documento?: string | null;
  /** Categoria já escolhida (a sugestão igual a ela some). */
  atual?: string | null;
  onEscolher: (categoria: CategoriaSugerida) => void;
}) {
  const [lista, setLista] = React.useState<CategoriaSugerida[]>([]);
  const chave = `${tabela}|${pessoaId ?? ''}|${(nome ?? '').trim()}|${documento ?? ''}`;
  const n = (nome ?? '').trim();
  const temPessoa = Boolean(pessoaId) || n.length >= 3 || Boolean(documento);

  React.useEffect(() => {
    if (!temPessoa) return;
    let vivo = true;
    // Espera a pessoa parar de digitar o nome.
    const t = setTimeout(() => {
      const q = new URLSearchParams({ tabela, pessoa_id: pessoaId ?? '', nome: n, documento: documento ?? '' });
      fetch(`/api/sugestao-categoria?${q}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((c: { categorias?: CategoriaSugerida[] } | null) => { if (vivo) setLista(Array.isArray(c?.categorias) ? c!.categorias! : []); })
        .catch(() => { if (vivo) setLista([]); });
    }, 400);
    return () => { vivo = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const outras = temPessoa ? lista.filter(c => c.id !== atual) : [];
  if (outras.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-[var(--fin-s-2)]" aria-live="polite">
      <span className="fin-t-caption flex items-center gap-1 text-[var(--fin-text-3)]">
        <Sparkles aria-hidden="true" className="size-3.5" />
        {atual ? 'Também usada com esta pessoa:' : 'Pelo histórico desta pessoa:'}
      </span>
      {outras.map(c => (
        <button
          key={c.id}
          type="button"
          onClick={() => onEscolher(c)}
          className={cn(
            'fin-t-caption inline-flex min-h-8 items-center gap-1 rounded-[var(--fin-r-sm)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface)] px-2 text-[var(--fin-text)] transition-colors hover:bg-[var(--fin-accent-soft)] hover:text-[var(--fin-accent)]',
            FOCO,
          )}
          aria-label={`Usar a categoria ${c.codigo} ${c.nome}, usada ${c.vezes} ${c.vezes === 1 ? 'vez' : 'vezes'} com esta pessoa`}
        >
          {c.codigo ? <span className="tabular-nums text-[var(--fin-text-3)]">{c.codigo}</span> : null}
          {c.nome}
          <span className="tabular-nums text-[var(--fin-text-3)]">· {c.vezes}×</span>
        </button>
      ))}
    </div>
  );
}
