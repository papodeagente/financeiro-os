'use client';

import * as React from 'react';
import { Check, Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { PessoaDoCadastro } from './api';

/**
 * Busca de pessoa no cadastro (cliente ou fornecedor) por nome ou CPF/CNPJ.
 * Uma caixa de busca com a lista logo abaixo: setas escolhem, Enter confirma,
 * Esc fecha. Mostra no máximo 8 nomes (cliente corporativo é procurado pelo
 * nome, não rolado).
 */
export function EscolherPessoa({
  id, valor, pessoas, carregando, onChange, desabilitado, placeholder, describedBy, invalido,
}: {
  id: string;
  valor: { id: string; nome: string } | null;
  pessoas: PessoaDoCadastro[];
  carregando: boolean;
  onChange: (p: { id: string; nome: string } | null) => void;
  desabilitado?: boolean;
  placeholder: string;
  describedBy?: string;
  invalido?: boolean;
}) {
  const [texto, setTexto] = React.useState('');
  const [aberto, setAberto] = React.useState(false);
  const [ativo, setAtivo] = React.useState(0);
  const listaId = `${id}-lista`;

  const termo = texto.trim().toLowerCase();
  const digitos = texto.replace(/\D/g, '');
  const achados = React.useMemo(() => {
    if (!termo) return pessoas.slice(0, 8);
    return pessoas.filter(p => p.nome.toLowerCase().includes(termo) || (digitos.length >= 3 && p.documento.includes(digitos))).slice(0, 8);
  }, [pessoas, termo, digitos]);

  React.useEffect(() => { setAtivo(0); }, [termo]);

  function escolher(p: PessoaDoCadastro) {
    onChange({ id: p.id, nome: p.nome });
    setTexto('');
    setAberto(false);
  }

  if (valor) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-[var(--fin-s-2)] rounded-[var(--fin-r-md)] border border-[var(--fin-border-strong)] bg-[var(--fin-surface-2)] pl-3 lg:min-h-10">
        <span className="min-w-0 truncate fin-t-body-strong text-[var(--fin-text)]" id={id}>{valor.nome || 'Cadastro sem nome'}</span>
        {!desabilitado ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Trocar ${valor.nome}`}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--fin-r-md)] text-[var(--fin-text-3)] hover:bg-[var(--fin-surface)] hover:text-[var(--fin-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fin-accent)] lg:size-10"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fin-text-3)]" />
      <Input
        id={id}
        role="combobox"
        aria-expanded={aberto}
        aria-controls={listaId}
        aria-autocomplete="list"
        aria-activedescendant={aberto && achados[ativo] ? `${listaId}-${achados[ativo].id}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalido || undefined}
        disabled={desabilitado}
        autoComplete="off"
        value={texto}
        placeholder={carregando ? 'Carregando o cadastro…' : placeholder}
        className="pl-9"
        onFocus={() => setAberto(true)}
        onBlur={() => window.setTimeout(() => setAberto(false), 120)}
        onChange={e => { setTexto(e.target.value); setAberto(true); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo(a => Math.min(a + 1, achados.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo(a => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && aberto && achados[ativo]) { e.preventDefault(); escolher(achados[ativo]); }
          else if (e.key === 'Escape' && aberto) { e.stopPropagation(); setAberto(false); }
        }}
      />
      {aberto && !carregando ? (
        <ul
          id={listaId}
          role="listbox"
          className="absolute inset-x-0 top-full z-[var(--fin-z-popover)] mt-1 max-h-72 overflow-auto rounded-[var(--fin-r-md)] border border-[var(--fin-border)] bg-[var(--fin-surface)] p-1 shadow-[var(--fin-e1)]"
        >
          {achados.length ? achados.map((p, i) => (
            <li
              key={p.id}
              id={`${listaId}-${p.id}`}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={e => { e.preventDefault(); escolher(p); }}
              onMouseEnter={() => setAtivo(i)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-between gap-[var(--fin-s-2)] rounded-[var(--fin-r-sm)] px-[var(--fin-s-2)] lg:min-h-9',
                i === ativo ? 'bg-[var(--fin-accent-soft)] text-[var(--fin-text)]' : 'text-[var(--fin-text-2)]',
              )}
            >
              <span className="min-w-0 truncate fin-t-body">{p.nome || 'Cadastro sem nome'}</span>
              {i === ativo ? <Check aria-hidden="true" className="size-4 shrink-0 text-[var(--fin-accent)]" /> : null}
            </li>
          )) : (
            <li className="px-[var(--fin-s-2)] py-[var(--fin-s-2)] fin-t-caption text-[var(--fin-text-3)]">
              {pessoas.length ? 'Ninguém com esse nome ou documento no cadastro.' : 'O cadastro ainda está vazio.'}
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
